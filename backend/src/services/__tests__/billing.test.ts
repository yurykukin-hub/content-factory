/**
 * Tests for billing service — критичный путь: ДЕНЬГИ (наценка, конвертация USD→RUB, списание баланса).
 *
 * Баланс в копейках (целые). Наценка из AppConfig. ADMIN не списывается.
 * Только моки Prisma — никаких живых вызовов.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'

const { mockDb } = vi.hoisted(() => {
  const m = () => ({
    findUnique: vi.fn().mockResolvedValue(null),
    findMany: vi.fn().mockResolvedValue([]),
    update: vi.fn().mockResolvedValue({ balanceKopecks: 0 }),
    updateMany: vi.fn().mockResolvedValue({ count: 1 }),
    create: vi.fn().mockResolvedValue({ id: 'tx-id' }),
  })
  const db: any = {
    appConfig: m(),
    user: m(),
    balanceTransaction: m(),
  }
  // $transaction(callback) — прокидывает сам db как tx (как в существующих тестах CF)
  db.$transaction = vi.fn(async (fn: any) => fn(db))
  return { mockDb: db }
})

vi.mock('../../db', () => ({ db: mockDb }))

import {
  calculateChargedKopecks,
  calculateChargedRub,
  getUsdRubRate,
  getMarkupPercent,
  getChargedRub,
  canAfford,
  chargeUser,
  topUpBalance,
  KIE_CREDIT_PRICE,
  DEFAULT_USD_RUB,
} from '../billing'

beforeEach(() => {
  vi.clearAllMocks()
  // дефолтные возвраты после clear
  mockDb.appConfig.findUnique.mockResolvedValue(null)
  mockDb.user.findUnique.mockResolvedValue(null)
  mockDb.user.updateMany.mockResolvedValue({ count: 1 })
  mockDb.user.update.mockResolvedValue({ balanceKopecks: 0 })
  mockDb.balanceTransaction.create.mockResolvedValue({ id: 'tx-id' })
  mockDb.$transaction.mockImplementation(async (fn: any) => fn(mockDb))
})

// ============================================================
// calculateChargedKopecks — чистая математика наценки
// ============================================================
describe('calculateChargedKopecks', () => {
  it('базовый: $1 × курс 95 × наценка 50% = 14250 копеек', () => {
    // 1 * 95 = 95 руб; *1.5 = 142.5 руб; *100 = 14250 коп
    expect(calculateChargedKopecks(1, 50, 95)).toBe(14250)
  })

  it('наценка 0% — только конвертация по курсу', () => {
    expect(calculateChargedKopecks(1, 0, 95)).toBe(9500)
  })

  it('наценка 100% — удвоение стоимости', () => {
    expect(calculateChargedKopecks(1, 100, 95)).toBe(19000)
  })

  it('ceil — округляет ВВЕРХ (в пользу владельца) на дробных копейках', () => {
    // 0.001 * 95 = 0.095; *1.5 = 0.1425; *100 = 14.25 → ceil → 15
    expect(calculateChargedKopecks(0.001, 50, 95)).toBe(15)
  })

  it('нулевая стоимость → 0 копеек', () => {
    expect(calculateChargedKopecks(0, 50, 95)).toBe(0)
  })

  it('использует дефолтный курс 95 если не передан', () => {
    expect(calculateChargedKopecks(1, 0)).toBe(DEFAULT_USD_RUB * 100)
  })

  it('кастомный курс применяется', () => {
    expect(calculateChargedKopecks(1, 0, 100)).toBe(10000)
  })
})

describe('calculateChargedRub', () => {
  it('= копейки / 100', () => {
    expect(calculateChargedRub(1, 50, 95)).toBe(142.5)
  })
})

describe('KIE_CREDIT_PRICE', () => {
  it('зафиксирован платформой KIE.ai = $0.005', () => {
    expect(KIE_CREDIT_PRICE).toBe(0.005)
  })
})

// ============================================================
// getUsdRubRate — чтение курса из AppConfig + фолбэк
// ============================================================
describe('getUsdRubRate', () => {
  it('возвращает значение из AppConfig', async () => {
    mockDb.appConfig.findUnique.mockResolvedValue({ value: '100' })
    expect(await getUsdRubRate()).toBe(100)
  })

  it('фолбэк 95 если конфига нет', async () => {
    mockDb.appConfig.findUnique.mockResolvedValue(null)
    expect(await getUsdRubRate()).toBe(95)
  })

  it('фолбэк 95 если значение не число', async () => {
    mockDb.appConfig.findUnique.mockResolvedValue({ value: 'abc' })
    expect(await getUsdRubRate()).toBe(95)
  })

  it('фолбэк 95 если значение <= 0', async () => {
    mockDb.appConfig.findUnique.mockResolvedValue({ value: '-5' })
    expect(await getUsdRubRate()).toBe(95)
  })

  it('фолбэк 95 при ошибке БД (не падает)', async () => {
    mockDb.appConfig.findUnique.mockRejectedValue(new Error('db down'))
    expect(await getUsdRubRate()).toBe(95)
  })
})

// ============================================================
// getMarkupPercent — чтение наценки + фолбэк
// ============================================================
describe('getMarkupPercent', () => {
  it('возвращает значение из AppConfig', async () => {
    mockDb.appConfig.findUnique.mockResolvedValue({ value: '30' })
    expect(await getMarkupPercent()).toBe(30)
  })

  it('допускает 0% (наценка >= 0)', async () => {
    mockDb.appConfig.findUnique.mockResolvedValue({ value: '0' })
    expect(await getMarkupPercent()).toBe(0)
  })

  it('фолбэк 50 если конфига нет', async () => {
    mockDb.appConfig.findUnique.mockResolvedValue(null)
    expect(await getMarkupPercent()).toBe(50)
  })

  it('фолбэк 50 если значение отрицательное', async () => {
    mockDb.appConfig.findUnique.mockResolvedValue({ value: '-1' })
    expect(await getMarkupPercent()).toBe(50)
  })

  it('фолбэк 50 при ошибке БД', async () => {
    mockDb.appConfig.findUnique.mockRejectedValue(new Error('db down'))
    expect(await getMarkupPercent()).toBe(50)
  })
})

describe('getChargedRub', () => {
  it('читает курс из AppConfig и считает с наценкой', async () => {
    mockDb.appConfig.findUnique.mockResolvedValue({ value: '100' })
    // $1 × 100 × 1.5 = 150 руб
    expect(await getChargedRub(1, 50)).toBe(150)
  })
})

// ============================================================
// canAfford — проверка баланса
// ============================================================
describe('canAfford', () => {
  it('ADMIN всегда allowed без запроса в БД', async () => {
    const res = await canAfford('admin-1', 'ADMIN')
    expect(res.allowed).toBe(true)
    expect(mockDb.user.findUnique).not.toHaveBeenCalled()
  })

  it('обычный юзер с положительным балансом — allowed', async () => {
    mockDb.user.findUnique.mockResolvedValue({ balanceKopecks: 5000 })
    const res = await canAfford('u-1', 'EDITOR')
    expect(res.allowed).toBe(true)
    expect(res.balanceKopecks).toBe(5000)
  })

  it('обычный юзер с нулевым балансом — НЕ allowed', async () => {
    mockDb.user.findUnique.mockResolvedValue({ balanceKopecks: 0 })
    const res = await canAfford('u-1', 'EDITOR')
    expect(res.allowed).toBe(false)
  })

  it('несуществующий юзер — баланс 0, не allowed', async () => {
    mockDb.user.findUnique.mockResolvedValue(null)
    const res = await canAfford('ghost', 'EDITOR')
    expect(res.allowed).toBe(false)
    expect(res.balanceKopecks).toBe(0)
  })
})

// ============================================================
// chargeUser — списание (критичный путь ДЕНЕГ)
// ============================================================
describe('chargeUser', () => {
  it('ADMIN НЕ списывается (безлимит), но сумма посчитана', async () => {
    mockDb.appConfig.findUnique.mockResolvedValue({ value: '95' })
    const res = await chargeUser({
      userId: 'admin-1', role: 'ADMIN', costUsd: 1, markupPercent: 50,
      aiUsageLogId: 'log-1', description: 'test',
    })
    expect(res.chargedKopecks).toBe(14250)
    expect(res.chargedRub).toBe(142.5)
    expect(mockDb.$transaction).not.toHaveBeenCalled()
    expect(mockDb.user.updateMany).not.toHaveBeenCalled()
  })

  it('обычный юзер: атомарное списание + запись в BalanceTransaction', async () => {
    mockDb.appConfig.findUnique.mockResolvedValue({ value: '95' })
    mockDb.user.updateMany.mockResolvedValue({ count: 1 })
    mockDb.user.findUnique.mockResolvedValue({ balanceKopecks: 100000 })

    const res = await chargeUser({
      userId: 'u-1', role: 'EDITOR', costUsd: 1, markupPercent: 50,
      aiUsageLogId: 'log-1', description: 'AI text',
    })

    expect(res.chargedKopecks).toBe(14250)
    // updateMany с WHERE-гардом (gte) — защита от гонки/отрицательного баланса
    expect(mockDb.user.updateMany).toHaveBeenCalledWith({
      where: { id: 'u-1', balanceKopecks: { gte: 14250 } },
      data: { balanceKopecks: { decrement: 14250 } },
    })
    // аудит-запись: сумма отрицательная, тип charge, привязка к aiUsageLogId
    expect(mockDb.balanceTransaction.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        userId: 'u-1',
        amountKopecks: -14250,
        type: 'charge',
        aiUsageLogId: 'log-1',
        balanceAfter: 100000,
      }),
    })
  })

  it('недостаточно средств → выбрасывает ошибку (count=0, WHERE-гард не сработал)', async () => {
    mockDb.appConfig.findUnique.mockResolvedValue({ value: '95' })
    mockDb.user.updateMany.mockResolvedValue({ count: 0 })

    await expect(chargeUser({
      userId: 'u-1', role: 'EDITOR', costUsd: 1, markupPercent: 50,
      aiUsageLogId: 'log-1', description: 'AI text',
    })).rejects.toThrow('Недостаточно средств')

    // списания не было — баланс не тронут, аудит не записан
    expect(mockDb.balanceTransaction.create).not.toHaveBeenCalled()
  })
})

// ============================================================
// topUpBalance — пополнение
// ============================================================
describe('topUpBalance', () => {
  it('конвертирует рубли в копейки и инкрементит баланс + аудит topup', async () => {
    mockDb.user.update.mockResolvedValue({ balanceKopecks: 50000 })

    const res = await topUpBalance({
      userId: 'u-1', amountRub: 500, adminId: 'admin-1',
    })

    expect(mockDb.user.update).toHaveBeenCalledWith({
      where: { id: 'u-1' },
      data: { balanceKopecks: { increment: 50000 } },
      select: { balanceKopecks: true },
    })
    expect(mockDb.balanceTransaction.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        userId: 'u-1',
        amountKopecks: 50000,
        type: 'topup',
        adminId: 'admin-1',
        balanceAfter: 50000,
      }),
    })
    expect(res.newBalanceKopecks).toBe(50000)
  })

  it('округляет дробные рубли до копеек', async () => {
    mockDb.user.update.mockResolvedValue({ balanceKopecks: 12345 })
    await topUpBalance({ userId: 'u-1', amountRub: 123.45, adminId: 'a-1' })
    expect(mockDb.user.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { balanceKopecks: { increment: 12345 } } }),
    )
  })
})
