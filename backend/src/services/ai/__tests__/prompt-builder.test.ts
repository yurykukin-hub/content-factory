import { describe, it, expect } from 'vitest'
import {
  PLATFORM_RULES,
  buildPlanPrompt,
  buildPostPrompt,
  buildAdaptPrompt,
  buildHashtagPrompt,
} from '../prompt-builder'

// ============================================================
// Pure function tests — no mocks needed
// ============================================================

describe('PLATFORM_RULES', () => {
  it('has rules for VK, TELEGRAM, INSTAGRAM', () => {
    expect(PLATFORM_RULES).toHaveProperty('VK')
    expect(PLATFORM_RULES).toHaveProperty('TELEGRAM')
    expect(PLATFORM_RULES).toHaveProperty('INSTAGRAM')
  })

  it('VK rules mention 4000 chars limit', () => {
    expect(PLATFORM_RULES.VK).toContain('4000')
  })

  it('TELEGRAM rules mention short format', () => {
    expect(PLATFORM_RULES.TELEGRAM).toContain('1000')
  })

  it('INSTAGRAM rules mention hashtags', () => {
    expect(PLATFORM_RULES.INSTAGRAM.toLowerCase()).toContain('хештеги')
  })
})

describe('buildPlanPrompt', () => {
  const brandContext = '## Бренд: Test\nТон коммуникации: дружелюбный'

  it('includes brand context', () => {
    const result = buildPlanPrompt(brandContext)
    expect(result).toContain('Test')
    expect(result).toContain('дружелюбный')
  })

  it('includes JSON format requirements', () => {
    const result = buildPlanPrompt(brandContext)
    expect(result).toContain('JSON')
    expect(result).toContain('"date"')
    expect(result).toContain('"topic"')
  })

  it('defaults to 3-5 posts per week', () => {
    const result = buildPlanPrompt(brandContext)
    expect(result).toContain('3-5 постов в неделю')
  })

  it('uses custom postsPerWeek', () => {
    const result = buildPlanPrompt(brandContext, { postsPerWeek: 7 })
    expect(result).toContain('7 постов в неделю')
    expect(result).not.toContain('3-5')
  })

  it('includes focus when provided', () => {
    const result = buildPlanPrompt(brandContext, { focus: 'SUP-прогулки' })
    expect(result).toContain('SUP-прогулки')
  })

  it('includes rubrics when provided', () => {
    const result = buildPlanPrompt(brandContext, {
      rubrics: ['Обзоры', 'Новости', 'Советы'],
    })
    expect(result).toContain('Обзоры')
    expect(result).toContain('Чередуй рубрики')
  })

  it('allows REELS in post type options (Epic B/D)', () => {
    const result = buildPlanPrompt(brandContext)
    expect(result).toContain('REELS')
  })

  it('includes mandatory ERP events when provided (Epic D)', () => {
    const result = buildPlanPrompt(brandContext, {
      events: [{ date: '2026-06-12', topic: 'День России', rubric: 'Погода и вода' }],
    })
    expect(result).toContain('2026-06-12')
    expect(result).toContain('День России')
    expect(result).toMatch(/обязательно/i)
  })

  it('includes bookings note when provided (Epic D)', () => {
    const result = buildPlanPrompt(brandContext, { bookingsNote: '2026-06-15: 3 брони, 9 чел' })
    expect(result).toContain('3 брони')
  })
})

describe('buildPostPrompt', () => {
  const brandContext = '## Бренд: НаWоде\nЦА: молодежь 20-35'

  it('includes brand context', () => {
    const result = buildPostPrompt(brandContext)
    expect(result).toContain('НаWоде')
    expect(result).toContain('молодежь 20-35')
  })

  it('specifies character limits', () => {
    const result = buildPostPrompt(brandContext)
    expect(result).toContain('500-1500')
  })

  it('asks for call-to-action', () => {
    const result = buildPostPrompt(brandContext)
    expect(result).toContain('call-to-action')
  })

  it('says no hashtags in master text', () => {
    const result = buildPostPrompt(brandContext)
    expect(result).toMatch(/хештеги.*не/i)
  })

  it('includes rubric instruction when provided', () => {
    const result = buildPostPrompt(brandContext, { rubric: 'Выборг с воды' })
    expect(result).toContain('Выборг с воды')
  })

  it('includes recent-posts anti-repetition block when provided (D1)', () => {
    const result = buildPostPrompt(brandContext, {
      recentPosts: ['Пост про закат над заливом', 'Знакомство с инструктором Алексеем'],
    })
    expect(result).toMatch(/не повтор/i)
    expect(result).toContain('Пост про закат над заливом')
    expect(result).toContain('Знакомство с инструктором Алексеем')
  })

  it('omits recent-posts block when none provided', () => {
    const result = buildPostPrompt(brandContext)
    expect(result).not.toMatch(/Недавние посты/i)
  })
})

describe('buildAdaptPrompt', () => {
  const brandContext = '## Бренд: Test'

  it('includes platform name', () => {
    const result = buildAdaptPrompt('VK', brandContext)
    expect(result).toContain('VK')
  })

  it('includes VK rules for VK platform', () => {
    const result = buildAdaptPrompt('VK', brandContext)
    expect(result).toContain('4000')
  })

  it('includes TG rules for TELEGRAM platform', () => {
    const result = buildAdaptPrompt('TELEGRAM', brandContext)
    expect(result).toContain('1000')
  })

  it('includes IG rules for INSTAGRAM platform', () => {
    const result = buildAdaptPrompt('INSTAGRAM', brandContext)
    expect(result).toContain('2200')
  })

  it('handles unknown platform gracefully', () => {
    const result = buildAdaptPrompt('TIKTOK', brandContext)
    expect(result).toContain('TIKTOK')
    // No rules, but shouldn't crash
  })
})

describe('buildHashtagPrompt', () => {
  const brandContext = '## Бренд: Test'

  it('specifies 5-10 hashtags for VK', () => {
    const result = buildHashtagPrompt('VK', brandContext)
    expect(result).toContain('5-10')
  })

  it('caps Instagram hashtags at 5 (2025 limit)', () => {
    const result = buildHashtagPrompt('INSTAGRAM', brandContext)
    expect(result).toContain('до 5')
  })

  it('specifies 0 hashtags for Telegram', () => {
    const result = buildHashtagPrompt('TELEGRAM', brandContext)
    expect(result).toContain('0')
  })

  it('includes brand context', () => {
    const result = buildHashtagPrompt('VK', brandContext)
    expect(result).toContain('Test')
  })
})
