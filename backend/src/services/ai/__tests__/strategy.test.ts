/**
 * strategy-as-data (Эпик B Phase 3): generic чтение рубрик/поводов/стратегии из БД.
 * Ключевой тест — ЭКВИВАЛЕНТНОСТЬ коду: при seed=константы вывод идентичен прежним
 * хардкод-функциям (getEventsInRange / getSeasonHint), т.е. дайджест/план не меняют поведение.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

const { mockDb } = vi.hoisted(() => ({
  mockDb: {
    rubric: { findMany: vi.fn() },
    occasion: { findMany: vi.fn() },
    brandProfile: { findUnique: vi.fn() },
  },
}))
vi.mock('../../../db', () => ({ db: mockDb }))

import { getRubricNames, getOccasionsInRange, getStrategyBlock, getSeasonHint } from '../strategy'
import {
  NAWODE_RUBRICS,
  NAWODE_EVENTS,
  NAWODE_SEASON_HINTS,
  getEventsInRange,
  getSeasonHint as codeSeasonHint,
} from '../nawode-strategy'

beforeEach(() => vi.clearAllMocks())

describe('strategy-as-data — эквивалентность коду (seed = константы)', () => {
  it('getSeasonHint(seasonHints, m) === код getSeasonHint(m) для всех 12 месяцев', () => {
    for (let m = 0; m < 12; m++) {
      expect(getSeasonHint(NAWODE_SEASON_HINTS, m)).toBe(codeSeasonHint(m))
    }
  })

  it('getOccasionsInRange (БД) === getEventsInRange (код) на тех же данных', async () => {
    mockDb.occasion.findMany.mockResolvedValue(
      NAWODE_EVENTS.map((e) => ({ monthDay: e.md, topic: e.topic, rubric: e.rubric, postType: e.postType ?? null })),
    )
    const start = new Date('2026-06-01')
    const end = new Date('2026-09-30')
    const fromDb = await getOccasionsInRange('biz', start, end)
    const fromCode = getEventsInRange(start, end)
    expect(fromDb).toEqual(fromCode)
    expect(fromDb.length).toBeGreaterThan(0)
  })

  it('getRubricNames возвращает имена активных рубрик (по sortOrder)', async () => {
    mockDb.rubric.findMany.mockResolvedValue(NAWODE_RUBRICS.map((name) => ({ name })))
    expect(await getRubricNames('biz')).toEqual(NAWODE_RUBRICS)
  })

  it('getStrategyBlock читает contentStrategy + seasonHints', async () => {
    mockDb.brandProfile.findUnique.mockResolvedValue({ contentStrategy: 'X', seasonHints: NAWODE_SEASON_HINTS })
    const block = await getStrategyBlock('biz')
    expect(block.strategyText).toBe('X')
    expect(block.seasonHints).toEqual(NAWODE_SEASON_HINTS)
  })

  it('getStrategyBlock graceful без профиля', async () => {
    mockDb.brandProfile.findUnique.mockResolvedValue(null)
    const block = await getStrategyBlock('biz')
    expect(block.strategyText).toBe('')
    expect(block.seasonHints).toEqual([])
  })
})
