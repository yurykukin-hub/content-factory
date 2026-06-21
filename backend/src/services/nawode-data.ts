/**
 * НаWоде ERP data access (read-only) for the morning content agent.
 *
 * Connects directly to the nawode PostgreSQL via Bun's built-in SQL client.
 * Encapsulated here so the rest of CF doesn't couple to nawode's schema —
 * if a public HTTP daily-summary endpoint appears later, swap this module out.
 *
 * Config: NAWODE_DATABASE_URL (read-only creds). If unset, returns null gracefully.
 */

import { SQL } from 'bun'
import { log } from '../utils/logger'

const MAIN_LOCATION = 'loc-naberezh' // SUP SPOT Выборг (набережная)

let sql: SQL | null = null
function getSql(): SQL | null {
  const url = process.env.NAWODE_DATABASE_URL
  if (!url) return null
  if (!sql) sql = new SQL(url, { max: 2, idleTimeout: 20 })
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
  const db = getSql()
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
  const db = getSql()
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
  const db = getSql()
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
