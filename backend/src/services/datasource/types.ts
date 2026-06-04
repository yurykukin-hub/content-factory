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

export interface DataSourceAdapter {
  /** Дневная сводка (погода + брони) на сегодня и ближайшие дни. null — источник недоступен. */
  getDailySummary(daysAhead?: number): Promise<DailySummary | null>
  /** Брони в диапазоне дат (для контент-плана). [] — недоступно. */
  getBookingsInRange(startISO: string, endISO: string): Promise<BookingDay[]>
}
