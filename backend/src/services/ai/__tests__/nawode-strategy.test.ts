import { describe, it, expect } from 'vitest'
import { NAWODE_RUBRICS, NAWODE_STRATEGY_TEXT, getSeasonHint, getEventsInRange } from '../nawode-strategy'

// Pure function tests — no mocks needed (Epic D)

describe('NAWODE_RUBRICS', () => {
  it('has all 10 rubrics', () => {
    expect(NAWODE_RUBRICS).toHaveLength(10)
  })

  it('includes key rubrics', () => {
    expect(NAWODE_RUBRICS).toContain('Выборг с воды')
    expect(NAWODE_RUBRICS).toContain('Погода и вода')
    expect(NAWODE_RUBRICS).toContain('Первый раз на доске')
  })

  it('has no empty rubric names', () => {
    expect(NAWODE_RUBRICS.every((r) => r.trim().length > 0)).toBe(true)
  })
})

describe('NAWODE_STRATEGY_TEXT', () => {
  it('mentions key brand facts and link', () => {
    expect(NAWODE_STRATEGY_TEXT).toContain('Выборг')
    expect(NAWODE_STRATEGY_TEXT).toContain('nawode.ru')
  })
})

describe('getSeasonHint', () => {
  it('June (5) = start of season', () => {
    expect(getSeasonHint(5)).toMatch(/начал/i)
  })

  it('July (6) = peak', () => {
    expect(getSeasonHint(6)).toMatch(/пик/i)
  })

  it('August (7) mentions Pirate Harbour fest', () => {
    expect(getSeasonHint(7)).toMatch(/пиратск/i)
  })

  it('returns a non-empty hint for every month', () => {
    for (let m = 0; m < 12; m++) {
      expect(getSeasonHint(m).length).toBeGreaterThan(0)
    }
  })
})

describe('getEventsInRange (Epic D — ERP events into plan)', () => {
  it('includes День России (06-12) in a June range', () => {
    const evs = getEventsInRange(new Date('2026-06-01'), new Date('2026-06-30'))
    expect(evs.some((e) => e.date === '2026-06-12')).toBe(true)
  })

  it('includes Пиратская гавань (08-22) in August', () => {
    const evs = getEventsInRange(new Date('2026-08-01'), new Date('2026-08-31'))
    expect(evs.some((e) => e.date === '2026-08-22')).toBe(true)
  })

  it('returns empty for a range with no events (January)', () => {
    expect(getEventsInRange(new Date('2026-01-05'), new Date('2026-01-20'))).toHaveLength(0)
  })

  it('returns events sorted by date', () => {
    const evs = getEventsInRange(new Date('2026-06-01'), new Date('2026-09-30'))
    const dates = evs.map((e) => e.date)
    expect(dates).toEqual([...dates].sort())
  })
})
