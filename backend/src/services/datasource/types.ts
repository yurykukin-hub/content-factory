/**
 * Контракт источника данных бизнеса (Эпик B Phase 2).
 *
 * Ядро CF (digest/plan) зависит ОТ ЭТОГО ИНТЕРФЕЙСА, а не от схемы конкретного ERP.
 * Реализации: NawodeErpAdapter (прямой Bun.sql — текущий/fallback), в будущем
 * NawodeHttpAdapter (GET /public/daily-summary на стороне ERP), KbErpAdapter и т.д.
 */

export interface WeatherDay {
  date: string // YYYY-MM-DD
  tempAvg: number | null
  tempMax: number | null
  tempMin: number | null
  windMax: number | null
  precipMm: number | null
  code: number | null
  label: string
}

export interface BookingDay {
  date: string
  bookings: number
  people: number
}

export interface DailySummary {
  weather: WeatherDay[]
  bookings: BookingDay[]
  generatedAt: string
}

/** «Горячий» слот: тур/слот, где уже есть записанные люди (для слот-филла). */
export interface HotSlot {
  date: string
  startTime: string | null
  tourName: string | null
  serviceType: string | null
  peopleBooked: number
  bookingsCount: number
  capacity: number | null
  remaining: number | null
}

export type DiscountSource = 'day_of_week' | 'slot_override' | 'promo_code'

/** Действующая скидка на дату (для промо-автопостинга). Деньги в КОПЕЙКАХ. */
export interface ActiveDiscount {
  source: DiscountSource
  serviceType: string | null
  productId: string | null
  label: string
  basePriceKopecks: number | null
  discountPriceKopecks: number | null
  percentOff: number | null
  date: string | null
  startTime: string | null
  code: string | null
  note: string | null
}

export interface DataSourceAdapter {
  /** Дневная сводка (погода + брони) на сегодня и ближайшие дни. null — источник недоступен. */
  getDailySummary(daysAhead?: number): Promise<DailySummary | null>
  /** Брони в диапазоне дат (для контент-плана). [] — недоступно. */
  getBookingsInRange(startISO: string, endISO: string): Promise<BookingDay[]>
  /** «Горячие» слоты (где уже есть записи) для слот-филла. [] — недоступно. */
  getHotSlots(daysAhead?: number): Promise<HotSlot[]>
  /** Действующие скидки на дату (по умолчанию сегодня). [] — недоступно/нет скидок. */
  getActiveDiscounts(onDateISO?: string): Promise<ActiveDiscount[]>
}
