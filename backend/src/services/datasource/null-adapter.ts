import type { DataSourceAdapter, BookingDay, HotSlot, ActiveDiscount } from './types'

/** Пустой источник: бизнес без ERP-интеграции (digest/plan работают без погоды/броней). */
export class NullDataSourceAdapter implements DataSourceAdapter {
  async getDailySummary(): Promise<null> {
    return null
  }
  async getBookingsInRange(): Promise<BookingDay[]> {
    return []
  }
  async getHotSlots(): Promise<HotSlot[]> {
    return []
  }
  async getActiveDiscounts(): Promise<ActiveDiscount[]> {
    return []
  }
}
