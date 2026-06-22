import type { DataSourceAdapter, DailySummary, BookingDay, HotSlot } from './types'

/**
 * NawodeErpAdapter — текущая реализация контракта для НаWоде через прямой Bun.sql
 * (`nawode-data.ts`, read-only к nawode PG). Это «fallback-адаптер» из ADR: когда на
 * стороне ERP появится `GET /public/daily-summary`, добавим NawodeHttpAdapter и
 * переключим реестр — ядро CF не изменится.
 *
 * `nawode-data` импортируется ДИНАМИЧЕСКИ (внутри методов): он тянет `import {SQL} from 'bun'`,
 * которого нет в Node-окружении тестов — ленивый импорт грузит его только в рантайме (Bun).
 */
export class NawodeErpAdapter implements DataSourceAdapter {
  async getDailySummary(daysAhead = 3): Promise<DailySummary | null> {
    const { getNawodeData } = await import('../nawode-data')
    return await getNawodeData(daysAhead)
  }

  async getBookingsInRange(startISO: string, endISO: string): Promise<BookingDay[]> {
    const { getBookingsInRange } = await import('../nawode-data')
    return await getBookingsInRange(startISO, endISO)
  }

  async getHotSlots(daysAhead = 14): Promise<HotSlot[]> {
    const { getHotSlots } = await import('../nawode-data')
    return await getHotSlots(daysAhead)
  }
}
