import { describe, it, expect } from 'vitest'
import {
  redLineCategoryOf,
  getRedLine,
  isDiscountWithinRedLine,
  clampDiscountToRedLine,
  MASS_MAX_PERCENT,
} from '../red-lines'

describe('redLineCategoryOf — категория по productId / label / serviceType', () => {
  it('точно по productId (закат/завтрак/прогулка/урок/туры)', () => {
    expect(redLineCategoryOf('WALK', 'tour-sunset')).toBe('SUNSET')
    expect(redLineCategoryOf('WALK', 'tour-aroma')).toBe('BREAKFAST')
    expect(redLineCategoryOf('WALK', 'tour-vyborg-walk')).toBe('WALK')
    expect(redLineCategoryOf('LESSON', 'tour-fountain-lesson')).toBe('LESSON')
    expect(redLineCategoryOf('TOUR', 'tour-monrepo')).toBe('TOUR')
    expect(redLineCategoryOf('TOUR', 'tour-sila')).toBe('TOUR')
  })

  it('по label, когда productId нет (важно: WALK ≠ закат ≠ завтрак)', () => {
    expect(redLineCategoryOf('WALK', null, 'Прогулка на закат «Белые ночи»')).toBe('SUNSET')
    expect(redLineCategoryOf('WALK', null, 'Арома SUP-завтрак')).toBe('BREAKFAST')
    expect(redLineCategoryOf('WALK', null, 'Прогулка «Выборг с воды»')).toBe('WALK')
    expect(redLineCategoryOf('TOUR', null, 'Тур Беличьи скалы')).toBe('TOUR')
    expect(redLineCategoryOf('RENTAL', null, 'Прокат в Выборге')).toBe('RENTAL')
  })

  it('фолбэк на serviceType / дефолт RENTAL', () => {
    expect(redLineCategoryOf('TOUR')).toBe('TOUR')
    expect(redLineCategoryOf('LESSON')).toBe('LESSON')
    expect(redLineCategoryOf('RENTAL')).toBe('RENTAL')
    expect(redLineCategoryOf(null, null, null)).toBe('RENTAL')
  })
})

describe('getRedLine — mass (массовая акция)', () => {
  it('потолок −40% для любой категории', () => {
    for (const st of ['RENTAL', 'WALK', 'TOUR', 'LESSON']) {
      expect(getRedLine({ serviceType: st, mode: 'mass' }).maxPercentOff).toBe(MASS_MAX_PERCENT)
    }
  })

  it('mass — режим по умолчанию (самый строгий)', () => {
    expect(getRedLine({ serviceType: 'RENTAL' }).maxPercentOff).toBe(40)
  })
})

describe('getRedLine — fill (добивка идущего слота)', () => {
  it('линии по категориям из плейбука', () => {
    expect(getRedLine({ productId: 'tour-sunset', mode: 'fill' }).maxPercentOff).toBe(88)   // закат
    expect(getRedLine({ serviceType: 'RENTAL', mode: 'fill' }).maxPercentOff).toBe(75)      // прокат
    expect(getRedLine({ productId: 'tour-aroma', mode: 'fill' }).maxPercentOff).toBe(70)    // завтрак (еда)
    expect(getRedLine({ productId: 'tour-vyborg-walk', mode: 'fill' }).maxPercentOff).toBe(80) // прогулка
    expect(getRedLine({ serviceType: 'LESSON', mode: 'fill' }).maxPercentOff).toBe(50)      // урок
  })

  it('тур ВНУТРИ ступени → −87%', () => {
    expect(getRedLine({ productId: 'tour-monrepo', mode: 'fill', currentBooked: 1 }).maxPercentOff).toBe(87)
    expect(getRedLine({ productId: 'tour-monrepo', mode: 'fill', currentBooked: 4 }).maxPercentOff).toBe(87) // next=5, внутри 4-7
  })

  it('тур на ПЕРЕХОДЕ ступени (4-й и 8-й гость) → −75%', () => {
    expect(getRedLine({ productId: 'tour-monrepo', mode: 'fill', currentBooked: 3 }).maxPercentOff).toBe(75) // next=4
    expect(getRedLine({ productId: 'tour-monrepo', mode: 'fill', currentBooked: 7 }).maxPercentOff).toBe(75) // next=8
  })
})

describe('isDiscountWithinRedLine / clampDiscountToRedLine', () => {
  it('пропускает скидку в пределах линии, режет лишнее', () => {
    expect(isDiscountWithinRedLine(30, { serviceType: 'RENTAL', mode: 'mass' })).toBe(true)  // 30 ≤ 40
    expect(isDiscountWithinRedLine(50, { serviceType: 'RENTAL', mode: 'mass' })).toBe(false) // 50 > 40
  })

  it('clamp обрезает до линии и не уходит в минус', () => {
    expect(clampDiscountToRedLine(90, { serviceType: 'RENTAL', mode: 'mass' })).toBe(40)
    expect(clampDiscountToRedLine(60, { productId: 'tour-sunset', mode: 'fill' })).toBe(60) // ≤ 88
    expect(clampDiscountToRedLine(-5, { serviceType: 'RENTAL' })).toBe(0)
  })

  it('защита: −30% массовой акции на завтрак ок, −60% — нет', () => {
    expect(isDiscountWithinRedLine(30, { productId: 'tour-aroma', mode: 'mass' })).toBe(true)
    expect(isDiscountWithinRedLine(60, { productId: 'tour-aroma', mode: 'mass' })).toBe(false)
  })
})
