import { describe, it, expect } from 'vitest'
import { buildPromoBlock, formatDiscountLine } from '../promo-block'
import type { ActiveDiscount } from '../../datasource/types'

const disc = (over: Partial<ActiveDiscount> = {}): ActiveDiscount => ({
  source: 'day_of_week', serviceType: 'RENTAL', productId: 'cmnmf7e4o0001p6014289w64v',
  label: 'Прокат в Выборге', basePriceKopecks: 100000, discountPriceKopecks: 90000,
  percentOff: 10, date: null, startTime: null, code: null, note: null, ...over,
})

describe('formatDiscountLine', () => {
  it('скидка дня: процент + цена (вместо базовой)', () => {
    expect(formatDiscountLine(disc())).toBe('- Прокат в Выборге −10% (900₽ вместо 1000₽)')
  })

  it('разовая спеццена слота: цена + время, без процента', () => {
    const line = formatDiscountLine(disc({
      source: 'slot_override', label: 'Тур Место силы', percentOff: null,
      basePriceKopecks: null, discountPriceKopecks: 200000, startTime: '18:00',
    }))
    expect(line).toBe('- Тур Место силы (спеццена 2000₽) в 18:00')
  })

  it('промокод', () => {
    const line = formatDiscountLine(disc({ source: 'promo_code', label: 'Промокод ЙОГА5', code: 'ЙОГА5', percentOff: 5, basePriceKopecks: null, discountPriceKopecks: null }))
    expect(line).toContain('Промокод ЙОГА5')
    expect(line).toContain('−5%')
  })

  it('sanity: глубже массового потолка (−40%) → пометка ⚠', () => {
    expect(formatDiscountLine(disc({ percentOff: 60 }))).toContain('⚠')
    expect(formatDiscountLine(disc({ percentOff: 30 }))).not.toContain('⚠') // 30 ≤ 40 — норма
  })
})

describe('buildPromoBlock', () => {
  it('собирает блок с заголовком и датой', () => {
    const out = buildPromoBlock([disc()], { dateLabel: 'на сегодня' })
    expect(out).toContain('ДЕЙСТВУЮЩИЕ СКИДКИ (на сегодня):')
    expect(out).toContain('Прокат в Выборге −10%')
  })

  it('по умолчанию промокоды НЕ анонсирует (партнёрские/реферальные)', () => {
    const promo = disc({ source: 'promo_code', label: 'Промокод ЙОГА5', code: 'ЙОГА5' })
    expect(buildPromoBlock([promo])).toBe('') // только промокод → нечего анонсировать
  })

  it('includePromoCodes=true — включает промокоды', () => {
    const promo = disc({ source: 'promo_code', label: 'Промокод ЙОГА5', code: 'ЙОГА5' })
    expect(buildPromoBlock([promo], { includePromoCodes: true })).toContain('ЙОГА5')
  })

  it('day_of_week + slot_override проходят, промокод отсекается', () => {
    const out = buildPromoBlock([
      disc(),
      disc({ source: 'slot_override', label: 'Тур', percentOff: null, basePriceKopecks: null, discountPriceKopecks: 200000 }),
      disc({ source: 'promo_code', label: 'Промокод X', code: 'X' }),
    ])
    expect(out).toContain('Прокат в Выборге')
    expect(out).toContain('Тур')
    expect(out).not.toContain('Промокод X')
  })

  it('пустой вход → ""', () => {
    expect(buildPromoBlock([])).toBe('')
    expect(buildPromoBlock(null as any)).toBe('')
  })
})
