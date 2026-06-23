/**
 * НаWоде ERP data access (read-only) for the morning content agent.
 *
 * Connects directly to the nawode PostgreSQL via Bun's built-in SQL client.
 * Encapsulated here so the rest of CF doesn't couple to nawode's schema —
 * if a public HTTP daily-summary endpoint appears later, swap this module out.
 *
 * Config: NAWODE_DATABASE_URL (read-only creds). If unset, returns null gracefully.
 */

import type { SQL } from 'bun'
import { log } from '../utils/logger'

const MAIN_LOCATION = 'loc-naberezh' // SUP SPOT Выборг (набережная)

// 'bun' импортируется ЛЕНИВО (dynamic import внутри getSql): top-level `import {SQL} from 'bun'`
// роняет vitest (резолвит импорты не через bun-runtime). Тип берём через `import type` — он
// стирается компилятором и не вызывает рантайм-резолв. Паттерн как в datasource/nawode-erp-adapter.
let sql: SQL | null = null
async function getSql(): Promise<SQL | null> {
  const url = process.env.NAWODE_DATABASE_URL
  if (!url) return null
  if (!sql) {
    const bun = await import('bun')
    sql = new bun.SQL(url, { max: 2, idleTimeout: 20 })
  }
  return sql
}

export interface WeatherDay {
  date: string // YYYY-MM-DD
  tempAvg: number | null
  tempMax: number | null
  tempMin: number | null
  windMax: number | null // m/s
  precipMm: number | null
  code: number | null
  label: string
}

export interface BookingDay {
  date: string
  bookings: number
  people: number
}

export interface NawodeData {
  weather: WeatherDay[]
  bookings: BookingDay[]
  generatedAt: string
}

// WMO weather code → краткая русская метка
function weatherLabel(code: number | null): string {
  if (code === null) return 'нет данных'
  if (code === 0) return 'ясно'
  if (code <= 2) return 'малооблачно'
  if (code === 3) return 'облачно'
  if (code <= 48) return 'туман'
  if (code <= 57) return 'морось'
  if (code <= 67) return 'дождь'
  if (code <= 77) return 'снег'
  if (code <= 82) return 'ливень'
  if (code <= 86) return 'снегопад'
  if (code <= 99) return 'гроза'
  return 'переменно'
}

/** Доступна ли интеграция (настроен ли NAWODE_DATABASE_URL) */
export function isNawodeDataAvailable(): boolean {
  return !!process.env.NAWODE_DATABASE_URL
}

/**
 * Дневная сводка: погода (главная локация, дневные часы 9–21) + бронирования
 * на сегодня и ближайшие дни.
 */
export async function getNawodeData(daysAhead = 3): Promise<NawodeData | null> {
  const db = await getSql()
  if (!db) {
    log.warn('[NawodeData] NAWODE_DATABASE_URL not set — skipping')
    return null
  }
  try {
    // Погода: берём самый свежий прогноз (max fetched_at) для главной локации,
    // агрегируем по дням в дневные часы (9–21).
    const weatherRows = await db<any[]>`
      WITH latest AS (
        SELECT max(fetched_at) AS f FROM weather_forecasts WHERE location_id = ${MAIN_LOCATION}
      )
      SELECT
        to_char(date::date, 'YYYY-MM-DD') AS date,
        round(avg(temperature) FILTER (WHERE hour BETWEEN 9 AND 21)::numeric, 1)::float AS "tempAvg",
        round(max(temperature) FILTER (WHERE hour BETWEEN 9 AND 21)::numeric, 1)::float AS "tempMax",
        round(min(temperature) FILTER (WHERE hour BETWEEN 9 AND 21)::numeric, 1)::float AS "tempMin",
        round(max(wind_speed) FILTER (WHERE hour BETWEEN 9 AND 21)::numeric, 1)::float AS "windMax",
        round(sum(precipitation) FILTER (WHERE hour BETWEEN 9 AND 21)::numeric, 1)::float AS "precipMm",
        mode() WITHIN GROUP (ORDER BY weather_code) AS code
      FROM weather_forecasts, latest
      WHERE location_id = ${MAIN_LOCATION}
        AND fetched_at = latest.f
        AND date::date BETWEEN CURRENT_DATE AND CURRENT_DATE + ${daysAhead}
      GROUP BY date::date
      ORDER BY date::date
    `
    const weather: WeatherDay[] = (weatherRows || []).map((r: any) => ({
      date: r.date,
      tempAvg: r.tempAvg,
      tempMax: r.tempMax,
      tempMin: r.tempMin,
      windMax: r.windMax,
      precipMm: r.precipMm,
      code: r.code,
      label: weatherLabel(r.code),
    }))

    // Бронирования: предстоящие, сгруппированы по дню (исключаем отменённые)
    const bookingRows = await db<any[]>`
      SELECT
        to_char(date::date, 'YYYY-MM-DD') AS date,
        count(*)::int AS bookings,
        coalesce(sum(group_size), 0)::int AS people
      FROM bookings
      WHERE date::date BETWEEN CURRENT_DATE AND CURRENT_DATE + ${daysAhead}
        AND status::text NOT IN ('CANCELLED', 'cancelled', 'CANCELED')
      GROUP BY date::date
      ORDER BY date::date
    `
    const bookings: BookingDay[] = (bookingRows || []).map((r: any) => ({
      date: r.date,
      bookings: r.bookings,
      people: r.people,
    }))

    return { weather, bookings, generatedAt: new Date().toISOString() }
  } catch (err: any) {
    log.error('[NawodeData] query failed', { error: err.message })
    return null
  }
}

/** Бронирования в произвольном диапазоне дат (для контент-плана) */
export async function getBookingsInRange(startISO: string, endISO: string): Promise<BookingDay[]> {
  const db = await getSql()
  if (!db) return []
  try {
    const rows = await db<any[]>`
      SELECT to_char(date::date, 'YYYY-MM-DD') AS date, count(*)::int AS bookings, coalesce(sum(group_size), 0)::int AS people
      FROM bookings
      WHERE date::date BETWEEN ${startISO}::date AND ${endISO}::date
        AND status::text NOT IN ('CANCELLED', 'cancelled', 'CANCELED')
      GROUP BY date::date
      ORDER BY date::date
    `
    return (rows || []).map((r: any) => ({ date: r.date, bookings: r.bookings, people: r.people }))
  } catch (err: any) {
    log.error('[NawodeData] getBookingsInRange failed', { error: err.message })
    return []
  }
}

// ─────────────────────────────────────────────────────────────────────────
// Готовые ref-ссылки бронирования (booking_links) — для кнопки-ссылки в редакторе.
// ─────────────────────────────────────────────────────────────────────────

export interface BookingLinkOption {
  label: string
  ref: string
  url: string
  scope: string[] // ['vk'] | ['vk','story'] | ['instagram'] | ['cert'] — для авто-дефолта по платформе/типу
}

/** Базовый URL ref-ссылок по умолчанию (переопределяется AppConfig `nawode_booking_base_url`). */
export const DEFAULT_BOOKING_BASE_URL = 'https://nawode.ru/?ref='

/** Полный URL ref-ссылки из базового шаблона. Форматы: '…/?ref=' (base+ref) · '…/{ref}' (подстановка) · '…' (добавит ?ref=/&ref=). */
function buildRefUrl(baseUrl: string, ref: string): string {
  const enc = encodeURIComponent(ref)
  if (baseUrl.includes('{ref}')) return baseUrl.replace('{ref}', enc)
  if (baseUrl.endsWith('=')) return baseUrl + enc
  const sep = baseUrl.includes('?') ? '&' : '?'
  return `${baseUrl}${sep}ref=${enc}`
}

/** Назначение ссылки по названию (для авто-дефолта в редакторе): VK / сторис / Instagram / сертификат. */
function deriveScope(name: string): string[] {
  const n = name.toLowerCase()
  const scope: string[] = []
  if (n.includes('сторис') || n.includes('сториз') || n.includes('stories')) scope.push('story')
  if (n.includes('вк') || n.includes('vk') || n.includes('вконтакт')) scope.push('vk')
  if (n.includes('инст') || n.includes('insta')) scope.push('instagram')
  if (n.includes('сертификат')) scope.push('cert')
  return scope
}

/** Готовые ref-ссылки бронирования из НаWоде ERP (booking_links) → опции для редактора. */
export async function getBookingLinks(baseUrl = DEFAULT_BOOKING_BASE_URL): Promise<BookingLinkOption[]> {
  const db = await getSql()
  if (!db) return []
  try {
    const rows = await db<any[]>`
      SELECT name, ref FROM booking_links
      WHERE ref IS NOT NULL AND ref <> ''
      ORDER BY created_at DESC
    `
    return (rows || [])
      .filter((r: any) => r.ref)
      .map((r: any) => {
        const label = String(r.name || r.ref)
        return { label, ref: String(r.ref), url: buildRefUrl(baseUrl, String(r.ref)), scope: deriveScope(label) }
      })
  } catch (err: any) {
    log.error('[NawodeData] getBookingLinks failed', { error: err.message })
    return []
  }
}

// ─────────────────────────────────────────────────────────────────────────
// SMM ROI: реальные брони по источнику (referral_source) + деньги — для аналитики.
// ─────────────────────────────────────────────────────────────────────────

export interface BookingRefRoi {
  ref: string            // referral_source брони (== booking_links.ref / utm ref)
  bookings: number       // активные брони (не отменённые)
  cancelled: number      // отменённые
  people: number         // суммарно гостей по активным броням
  bookedKopecks: number  // сумма total_price активных броней (копейки)
  paidKopecks: number    // реально полученные деньги (settled-платежи − возвраты, копейки)
}

/**
 * ROI по источникам броней (referral_source) за период [startISO, endISO) — нижний
 * уровень воронки SMM («ссылка/канал → брони → ₽»). Период по created_at брони.
 *
 * Логика «оплачено» 1:1 с ERP (utils/payments.isSettledPayment): из выручки
 * исключаются только онлайн-платежи ЮKassa в статусе pending/canceled; возвраты
 * (is_refund) вычитаются. paidKopecks считается по ВСЕМ броням источника (включая
 * позднее отменённые, но реально оплаченные) — как aggregateLinkStats в ERP.
 * Только брони с непустым referral_source (атрибутированные).
 */
export async function getBookingRoiByRef(startISO: string, endISO: string): Promise<BookingRefRoi[]> {
  const db = await getSql()
  if (!db) return []
  try {
    const rows = await db<any[]>`
      WITH paid AS (
        SELECT p.booking_id,
               sum(CASE WHEN p.is_refund THEN -p.amount ELSE p.amount END) AS paid_kopecks
        FROM payments p
        WHERE (p.method <> 'ONLINE' OR p.yookassa_status IS NULL OR p.yookassa_status NOT IN ('pending','canceled'))
        GROUP BY p.booking_id
      )
      SELECT
        b.referral_source AS ref,
        count(*) FILTER (WHERE b.status::text NOT IN ('CANCELLED','cancelled','CANCELED'))::int AS bookings,
        count(*) FILTER (WHERE b.status::text IN ('CANCELLED','cancelled','CANCELED'))::int AS cancelled,
        coalesce(sum(b.group_size) FILTER (WHERE b.status::text NOT IN ('CANCELLED','cancelled','CANCELED')), 0)::int AS people,
        coalesce(sum(b.total_price) FILTER (WHERE b.status::text NOT IN ('CANCELLED','cancelled','CANCELED')), 0)::bigint AS booked_kopecks,
        coalesce(sum(pd.paid_kopecks), 0)::bigint AS paid_kopecks
      FROM bookings b
      LEFT JOIN paid pd ON pd.booking_id = b.id
      WHERE b.created_at >= ${startISO}::timestamptz
        AND b.created_at < ${endISO}::timestamptz
        AND b.referral_source IS NOT NULL
      GROUP BY b.referral_source
      ORDER BY bookings DESC, booked_kopecks DESC
    `
    return (rows || []).map((r: any) => ({
      ref: String(r.ref),
      bookings: Number(r.bookings) || 0,
      cancelled: Number(r.cancelled) || 0,
      people: Number(r.people) || 0,
      bookedKopecks: Number(r.booked_kopecks) || 0,
      paidKopecks: Number(r.paid_kopecks) || 0,
    }))
  } catch (err: any) {
    log.error('[NawodeData] getBookingRoiByRef failed', { error: err.message })
    return []
  }
}

// ─────────────────────────────────────────────────────────────────────────
// Слот-филл: «горячие» слоты — туры/слоты, где УЖЕ есть записанные люди.
// Промоутить такие = добивка слота (social proof + почти чистая маржа на доп. участника).
// ─────────────────────────────────────────────────────────────────────────

export interface HotSlot {
  date: string                // YYYY-MM-DD
  startTime: string | null    // '18:00' (как в booking.start_time)
  tourName: string | null     // название продукта/тура (null у проката без product_id)
  serviceType: string | null  // RENTAL | WALK | TOUR | LESSON
  peopleBooked: number        // суммарно гостей (group_size) в слоте
  bookingsCount: number       // число броней в слоте
  capacity: number | null     // вместимость (best-effort из service_slots.max_clients); null — не сматчилось
  remaining: number | null    // capacity - peopleBooked (null если capacity неизвестна)
}

const HOT_SLOT_GROUP_TYPES = new Set(['WALK', 'TOUR', 'LESSON']) // групповые форматы — приоритет для «присоединяйся»

/**
 * Pure-маппер сырых строк → HotSlot[] (map + filter + sort). Вынесен для тестируемости.
 * Фильтр «горячий»: есть записанные (peopleBooked ≥ 1) И (вместимость неизвестна ИЛИ ещё есть места).
 * Сортировка: ближайший день → групповые форматы → «почти заполнен» (меньше осталось).
 *
 * ВНИМАНИЕ к данным: в ERP нет прямой связи booking↔slot (только date+start_time+product_id),
 * вместимость берётся из service_slots best-effort → может быть null. Поэтому подача в дайджесте =
 * social-proof-first («уже N человек, тур точно состоится»); жёсткое «осталось M мест» — только при
 * известном небольшом remaining.
 */
export function mapHotSlotRows(rows: any[]): HotSlot[] {
  return (rows || [])
    .map((r: any): HotSlot => {
      const peopleBooked = Number(r.people) || 0
      const capacity = r.capacity != null ? Number(r.capacity) : null
      return {
        date: String(r.date),
        startTime: r.start_time ?? null,
        tourName: r.tour_name ?? null,
        serviceType: r.service_type ?? null,
        peopleBooked,
        bookingsCount: Number(r.bookings_cnt) || 0,
        capacity,
        remaining: capacity != null ? Math.max(0, capacity - peopleBooked) : null,
      }
    })
    .filter(s => s.peopleBooked >= 1 && (s.capacity == null || s.peopleBooked < s.capacity))
    .sort((a, b) => {
      if (a.date !== b.date) return a.date < b.date ? -1 : 1 // ближайший день первым
      const ag = HOT_SLOT_GROUP_TYPES.has((a.serviceType || '').toUpperCase()) ? 0 : 1
      const bg = HOT_SLOT_GROUP_TYPES.has((b.serviceType || '').toUpperCase()) ? 0 : 1
      if (ag !== bg) return ag - bg // групповые форматы приоритетнее проката
      const ar = a.remaining ?? Number.POSITIVE_INFINITY
      const br = b.remaining ?? Number.POSITIVE_INFINITY
      return ar - br // «почти заполнен» первым
    })
}

/**
 * «Горячие» слоты на ближайшие дни: будущие брони (не отменённые/без проблем),
 * сгруппированные по (день, время, продукт) → сколько уже записано + вместимость.
 * Capacity — best-effort из service_slots (MAX(max_clients) по day_of_week+start_time+product,
 * MAX чтобы дубль-строки слотов не завышали). Грейсфул []: нет ERP / ошибка.
 */
export async function getHotSlots(daysAhead = 14): Promise<HotSlot[]> {
  const db = await getSql()
  if (!db) return []
  try {
    const rows = await db<any[]>`
      WITH booked AS (
        SELECT
          b.date::date AS d,
          b.start_time AS st,
          b.product_id AS pid,
          b.service_type::text AS stype,
          count(*)::int AS bookings_cnt,
          coalesce(sum(b.group_size), 0)::int AS people
        FROM bookings b
        WHERE b.date::date BETWEEN CURRENT_DATE AND CURRENT_DATE + ${daysAhead}
          AND b.status::text NOT IN ('CANCELLED','cancelled','CANCELED','PROBLEM')
        GROUP BY b.date::date, b.start_time, b.product_id, b.service_type::text
      )
      SELECT
        to_char(bk.d, 'YYYY-MM-DD') AS date,
        bk.st AS start_time,
        p.name AS tour_name,
        coalesce(p.service_type::text, bk.stype) AS service_type,
        bk.bookings_cnt AS bookings_cnt,
        bk.people AS people,
        (
          SELECT max(s.max_clients)
          FROM service_slots s
          WHERE s.start_time = bk.st
            AND s.day_of_week = extract(dow from bk.d)::int
            AND s.is_active
            -- product-specific слоты (тур/прогулка/урок) матчим по product_id;
            -- прокат хранит вместимость на service_type (product_id NULL) → фолбэк по типу
            AND (s.product_id = bk.pid OR (s.product_id IS NULL AND s.service_type::text = bk.stype))
        )::int AS capacity
      FROM booked bk
      LEFT JOIN products p ON p.id = bk.pid
      ORDER BY bk.d ASC, bk.st ASC
    `
    return mapHotSlotRows(rows)
  } catch (err: any) {
    log.error('[NawodeData] getHotSlots failed', { error: err.message })
    return []
  }
}

// ─────────────────────────────────────────────────────────────────────────
// Промо: действующие скидки на дату (для промо-автопостинга, Фаза 3).
// Источники в ERP (read-only):
//   • price_lists.discount_days   — скидка по дням недели (price_weekday → price_discount);
//   • service_slot_overrides.discount_price — разовые спец-цены на конкретный слот+дату (Света);
//   • promo_codes                 — активные промокоды (среди них партнёрские/реферальные).
// Деньги ВЕЗДЕ в КОПЕЙКАХ. Подача — human-in-the-loop (дайджест → одобрение).
// ─────────────────────────────────────────────────────────────────────────

export type DiscountSource = 'day_of_week' | 'slot_override' | 'promo_code'

export interface ActiveDiscount {
  source: DiscountSource
  serviceType: string | null          // RENTAL | WALK | TOUR | LESSON | ...
  productId: string | null
  label: string                       // человекочитаемо: «Прокат в Выборге» / «Промокод ЙОГА5»
  basePriceKopecks: number | null     // обычная цена (база), если надёжно известна
  discountPriceKopecks: number | null // фикс-цена со скидкой (day_of_week / slot_override / FIXED-промо)
  percentOff: number | null           // % скидки: точный (day_of_week), из PERCENT-промо, иначе null
  date: string | null                 // конкретная дата (slot_override); null — повторяющаяся/бессрочная
  startTime: string | null            // время слота (slot_override)
  code: string | null                 // промокод (promo_code)
  note: string | null                 // предупреждение для подачи (анонс по решению / причина override)
}

/** День недели даты в конвенции JS Date.getDay (0=вс..6=сб) — как в ERP (discount_days пишет JS).
 *  UTC, чтобы не зависеть от таймзоны сервера/контейнера. */
export function dayOfWeekOf(dateISO: string): number {
  return new Date(`${dateISO}T00:00:00Z`).getUTCDay()
}

/** «Сегодня» в Europe/Moscow как YYYY-MM-DD (локаль sv-SE даёт ISO-формат). */
function moscowTodayISO(): string {
  return new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Moscow' }).format(new Date())
}

/** price_lists-строка со скидкой по дням → ActiveDiscount, если onDate попадает в discount_days. Иначе null. */
export function mapDayDiscount(row: any, onDateISO: string): ActiveDiscount | null {
  const days: number[] = Array.isArray(row?.discount_days) ? row.discount_days.map((d: any) => Number(d)) : []
  const base = row?.price_weekday != null ? Number(row.price_weekday) : null
  const disc = row?.price_discount != null ? Number(row.price_discount) : null
  if (!days.length || base == null || disc == null) return null
  if (!days.includes(dayOfWeekOf(onDateISO))) return null
  if (disc >= base) return null // не скидка (цена не ниже базовой)
  return {
    source: 'day_of_week',
    serviceType: row.service_type ?? null,
    productId: row.product_id ?? null,
    label: String(row.name || row.service_type || 'Услуга'),
    basePriceKopecks: base,
    discountPriceKopecks: disc,
    percentOff: Math.round((1 - disc / base) * 100),
    date: null,
    startTime: null,
    code: null,
    note: null,
  }
}

/** service_slot_overrides-строка (разовая спец-цена на дату/слот) → ActiveDiscount. */
export function mapSlotOverrideDiscount(row: any): ActiveDiscount {
  const disc = row?.discount_price != null ? Number(row.discount_price) : null
  const stype = row?.service_type ?? null
  return {
    source: 'slot_override',
    serviceType: stype,
    productId: row?.product_id ?? null,
    label: String(row?.product_name || stype || 'Услуга'),
    basePriceKopecks: null,           // база ненадёжна (несколько price_lists на тип) — % не считаем
    discountPriceKopecks: disc,
    percentOff: null,
    date: row?.date ?? null,
    startTime: row?.start_time ?? null,
    code: null,
    note: row?.reason ? String(row.reason) : null,
  }
}

/** promo_codes-строка (активный код) → ActiveDiscount. Помечается note: анонс — по решению. */
export function mapPromoCodeDiscount(row: any): ActiveDiscount {
  const type = String(row?.type || 'PERCENT')
  const value = Number(row?.value) || 0
  const isPercent = type === 'PERCENT'
  return {
    source: 'promo_code',
    serviceType: row?.service_type ?? null,
    productId: row?.product_id ?? null,
    label: `Промокод ${row?.code ?? ''}`.trim(),
    basePriceKopecks: null,
    discountPriceKopecks: isPercent ? null : value, // FIXED: value = копейки скидки
    percentOff: isPercent ? value : null,
    date: null,
    startTime: null,
    code: row?.code ? String(row.code) : null,
    note: 'промокод — анонсировать только по решению (возможно партнёрский/реферальный)',
  }
}

const DISCOUNT_SOURCE_ORDER: Record<DiscountSource, number> = {
  slot_override: 0, // разовые, привязаны к дате → самые «горящие»
  day_of_week: 1,   // регулярные скидки дня
  promo_code: 2,    // коды — в конце (анонс по решению)
}

/** Pure-сборка/сортировка действующих скидок из 3 источников. Вынесена для тестов. */
export function buildActiveDiscounts(
  raw: { dayRows?: any[]; overrideRows?: any[]; promoRows?: any[] },
  onDateISO: string,
): ActiveDiscount[] {
  const out: ActiveDiscount[] = []
  for (const r of raw.dayRows || []) {
    const d = mapDayDiscount(r, onDateISO)
    if (d) out.push(d)
  }
  for (const r of raw.overrideRows || []) out.push(mapSlotOverrideDiscount(r))
  for (const r of raw.promoRows || []) out.push(mapPromoCodeDiscount(r))
  return out.sort((a, b) => {
    const so = DISCOUNT_SOURCE_ORDER[a.source] - DISCOUNT_SOURCE_ORDER[b.source]
    if (so !== 0) return so
    return (b.percentOff ?? -1) - (a.percentOff ?? -1) // бОльшая скидка инфоповоднее
  })
}

/**
 * Действующие скидки на дату onDateISO (по умолчанию — сегодня по МСК): скидки по дням
 * недели (price_lists.discount_days) + разовые спец-цены слотов (service_slot_overrides) +
 * активные промокоды. Грейсфул []: нет ERP / ошибка. Деньги в КОПЕЙКАХ.
 *
 * Для промо-автопостинга (Фаза 3). Промокоды помечены note (анонс по решению — среди них
 * партнёрские/реферальные 5%). Защита маржи (getRedLine) — на уровне подачи, не тут.
 */
export async function getActiveDiscounts(onDateISO?: string): Promise<ActiveDiscount[]> {
  const db = await getSql()
  if (!db) return []
  const onDate = onDateISO || moscowTodayISO()
  try {
    const [dayRows, overrideRows, promoRows] = await Promise.all([
      db<any[]>`
        SELECT id, service_type::text AS service_type, name, product_id,
               price_weekday, price_discount, discount_days
        FROM price_lists
        WHERE is_active = true
          AND price_discount IS NOT NULL
          AND discount_days IS NOT NULL
          AND array_length(discount_days, 1) > 0
      `,
      db<any[]>`
        SELECT o.id, to_char(o.date::date, 'YYYY-MM-DD') AS date, o.discount_price, o.reason,
               s.product_id, s.service_type::text AS service_type, s.start_time,
               p.name AS product_name
        FROM service_slot_overrides o
        JOIN service_slots s ON s.id = o.slot_id
        LEFT JOIN products p ON p.id = s.product_id
        WHERE o.is_enabled = true
          AND o.discount_price IS NOT NULL
          AND o.date::date = ${onDate}::date
      `,
      db<any[]>`
        SELECT id, code, type::text AS type, value, product_id, service_type::text AS service_type
        FROM promo_codes
        WHERE is_active = true
          AND (valid_from IS NULL OR valid_from::date <= ${onDate}::date)
          AND (valid_to   IS NULL OR valid_to::date   >= ${onDate}::date)
          AND (max_uses   IS NULL OR used_count < max_uses)
      `,
    ])
    return buildActiveDiscounts({ dayRows, overrideRows, promoRows }, onDate)
  } catch (err: any) {
    log.error('[NawodeData] getActiveDiscounts failed', { error: err.message })
    return []
  }
}
