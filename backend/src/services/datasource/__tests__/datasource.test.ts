/**
 * DataSourceAdapter реестр (Эпик B Phase 2): выбор источника по business.erpType.
 * nawode-data замокан (в Node-окружении нет bun SQL).
 */
import { describe, it, expect, vi } from 'vitest'

vi.mock('../../nawode-data', () => ({
  getNawodeData: vi.fn().mockResolvedValue(null),
  getBookingsInRange: vi.fn().mockResolvedValue([]),
  getHotSlots: vi.fn().mockResolvedValue([]),
}))

import { getDataSourceAdapter } from '../index'
import { NawodeErpAdapter } from '../nawode-erp-adapter'
import { NullDataSourceAdapter } from '../null-adapter'

describe('getDataSourceAdapter — реестр по erpType', () => {
  it('nawode → NawodeErpAdapter', () => {
    expect(getDataSourceAdapter({ erpType: 'nawode' })).toBeInstanceOf(NawodeErpAdapter)
  })

  it('null / undefined / неизвестный → NullDataSourceAdapter', () => {
    expect(getDataSourceAdapter({ erpType: null })).toBeInstanceOf(NullDataSourceAdapter)
    expect(getDataSourceAdapter({})).toBeInstanceOf(NullDataSourceAdapter)
    expect(getDataSourceAdapter({ erpType: 'unknown' })).toBeInstanceOf(NullDataSourceAdapter)
  })

  it('NullDataSourceAdapter возвращает null / []', async () => {
    const a = new NullDataSourceAdapter()
    expect(await a.getDailySummary()).toBeNull()
    expect(await a.getBookingsInRange()).toEqual([])
    expect(await a.getHotSlots()).toEqual([])
  })
})
