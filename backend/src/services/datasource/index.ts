import type { DataSourceAdapter } from './types'
import { NawodeErpAdapter } from './nawode-erp-adapter'
import { NullDataSourceAdapter } from './null-adapter'

const nullAdapter = new NullDataSourceAdapter()

/**
 * Реестр источников данных по `business.erpType`.
 * Добавить новый ERP = добавить ветку (или HTTP-адаптер по контракту), ядро CF не трогаем.
 */
export function getDataSourceAdapter(business: { erpType?: string | null }): DataSourceAdapter {
  switch (business.erpType) {
    case 'nawode':
      return new NawodeErpAdapter()
    // future: 'kukin' | 'inpulse' → HTTP-адаптер (GET /public/daily-summary)
    default:
      return nullAdapter
  }
}

export type { DataSourceAdapter, DailySummary, BookingDay, WeatherDay, HotSlot } from './types'
