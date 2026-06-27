/**
 * Tests for calculateCost — стоимость AI-вызова в USD по тарифам моделей.
 * Это база для биллинга (наценка считается поверх). Неверный тариф = неверное списание.
 * Только чистая функция, без сети/БД.
 */

import { describe, it, expect, vi } from 'vitest'

// openrouter.ts тянет config/db/billing на верхнем уровне — мокаем, чтобы тест был изолирован.
vi.mock('../../../db', () => ({ db: {} }))
vi.mock('../../billing', () => ({
  getMarkupPercent: vi.fn(),
  getChargedRub: vi.fn(),
  chargeUser: vi.fn(),
}))

import { calculateCost } from '../openrouter'

describe('calculateCost', () => {
  it('Haiku 4.5: $1/M in, $5/M out', () => {
    // 1M in + 1M out = (1e6*1 + 1e6*5)/1e6 = 6 USD
    expect(calculateCost('anthropic/claude-haiku-4.5', 1_000_000, 1_000_000)).toBeCloseTo(6, 6)
  })

  it('Sonnet 4.6: $3/M in, $15/M out', () => {
    expect(calculateCost('anthropic/claude-sonnet-4.6', 1_000_000, 1_000_000)).toBeCloseTo(18, 6)
  })

  it('небольшое число токенов считается пропорционально', () => {
    // 1000 in Haiku = 1000 * 1.00 / 1e6 = 0.001 USD
    expect(calculateCost('anthropic/claude-haiku-4.5', 1000, 0)).toBeCloseTo(0.001, 9)
  })

  it('неизвестная модель → 0 (не падаем, не списываем мусор)', () => {
    expect(calculateCost('unknown/model-x', 1_000_000, 1_000_000)).toBe(0)
  })

  it('ноль токенов → 0', () => {
    expect(calculateCost('anthropic/claude-haiku-4.5', 0, 0)).toBe(0)
  })
})
