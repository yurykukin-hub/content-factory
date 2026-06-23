import { describe, it, expect } from 'vitest'
import {
  dayOfWeekOf,
  mapDayDiscount,
  mapSlotOverrideDiscount,
  mapPromoCodeDiscount,
  buildActiveDiscounts,
} from '../nawode-data'

// Чистые мапперы скидок (SQL не мокаем — тестируем логику маппинга + dow-фильтр + сортировку).
// Даты-якоря (сверено с postgres dow): 22.06.2026=пн(1), 23.06=вт(2), 26.06=пт(5), 21.06=вс(0).
const TUE = '2026-06-23'
const MON = '2026-06-22'
const FRI = '2026-06-26'

// Реальная строка проката из ERP (деньги в копейках): 1000₽ → 900₽ по вт/пт.
const rentalDay = (over: Record<string, any> = {}) => ({
  id: 'price-rental', service_type: 'RENTAL', name: 'Прокат в Выборге',
  product_id: 'cmnmf7e4o0001p6014289w64v', price_weekday: 100000, price_discount: 90000,
  discount_days: [5, 2], ...over,
})

describe('dayOfWeekOf — конвенция JS getDay (0=вс..6=сб), == postgres dow', () => {
  it('сопоставляет даты с днями недели в UTC (без зависимости от TZ сервера)', () => {
    expect(dayOfWeekOf('2026-06-21')).toBe(0) // вс
    expect(dayOfWeekOf(MON)).toBe(1)          // пн
    expect(dayOfWeekOf(TUE)).toBe(2)          // вт
    expect(dayOfWeekOf(FRI)).toBe(5)          // пт
    expect(dayOfWeekOf('2026-06-27')).toBe(6) // сб
  })
})

describe('mapDayDiscount — скидка по дням недели', () => {
  it('возвращает скидку, если onDate попадает в discount_days (вт)', () => {
    const d = mapDayDiscount(rentalDay(), TUE)
    expect(d).not.toBeNull()
    expect(d).toMatchObject({
      source: 'day_of_week', serviceType: 'RENTAL', label: 'Прокат в Выборге',
      basePriceKopecks: 100000, discountPriceKopecks: 90000, percentOff: 10, code: null, note: null,
    })
  })

  it('работает и в пятницу (тоже в discount_days)', () => {
    expect(mapDayDiscount(rentalDay(), FRI)?.percentOff).toBe(10)
  })

  it('возвращает null, если день НЕ в discount_days (пн)', () => {
    expect(mapDayDiscount(rentalDay(), MON)).toBeNull()
  })

  it('возвращает null при пустых discount_days (скидка «настроена, но выключена»)', () => {
    // как price-vyborg-walk в ERP: price_discount задан, но discount_days=[]
    expect(mapDayDiscount(rentalDay({ discount_days: [] }), TUE)).toBeNull()
  })

  it('возвращает null без price_discount', () => {
    expect(mapDayDiscount(rentalDay({ price_discount: null }), TUE)).toBeNull()
  })

  it('возвращает null, если «скидка» не ниже базы (disc >= base)', () => {
    expect(mapDayDiscount(rentalDay({ price_discount: 100000 }), TUE)).toBeNull()
    expect(mapDayDiscount(rentalDay({ price_discount: 120000 }), TUE)).toBeNull()
  })

  it('считает процент корректно (−25%)', () => {
    expect(mapDayDiscount(rentalDay({ price_weekday: 200000, price_discount: 150000 }), TUE)?.percentOff).toBe(25)
  })
})

describe('mapSlotOverrideDiscount — разовая спец-цена слота', () => {
  it('маппит разовую скидку с датой/временем/названием продукта', () => {
    const d = mapSlotOverrideDiscount({
      id: 'ov1', date: '2026-06-23', discount_price: 50000, reason: 'погода',
      product_id: 'tour-sila', service_type: 'TOUR', start_time: '18:00', product_name: 'Тур Место силы',
    })
    expect(d).toMatchObject({
      source: 'slot_override', serviceType: 'TOUR', label: 'Тур Место силы',
      discountPriceKopecks: 50000, basePriceKopecks: null, percentOff: null,
      date: '2026-06-23', startTime: '18:00', note: 'погода',
    })
  })

  it('фолбэк label на serviceType, note=null без reason (прокат без product_id)', () => {
    const d = mapSlotOverrideDiscount({
      id: 'ov2', date: '2026-06-23', discount_price: 100000, reason: null,
      product_id: null, service_type: 'RENTAL', start_time: '16:00', product_name: null,
    })
    expect(d.label).toBe('RENTAL')
    expect(d.note).toBeNull()
  })
})

describe('mapPromoCodeDiscount — активный промокод', () => {
  it('PERCENT: percentOff=value, discountPriceKopecks=null, note про анонс по решению', () => {
    const d = mapPromoCodeDiscount({ code: 'ЙОГА5', type: 'PERCENT', value: 5, service_type: null, product_id: null })
    expect(d).toMatchObject({
      source: 'promo_code', label: 'Промокод ЙОГА5', code: 'ЙОГА5',
      percentOff: 5, discountPriceKopecks: null,
    })
    expect(d.note).toContain('по решению')
  })

  it('FIXED: discountPriceKopecks=value (копейки), percentOff=null', () => {
    const d = mapPromoCodeDiscount({ code: 'MINUS300', type: 'FIXED', value: 30000 })
    expect(d.discountPriceKopecks).toBe(30000)
    expect(d.percentOff).toBeNull()
  })
})

describe('buildActiveDiscounts — сборка + сортировка из 3 источников', () => {
  it('порядок: slot_override → day_of_week → promo_code', () => {
    const out = buildActiveDiscounts({
      dayRows: [rentalDay()],
      overrideRows: [{ id: 'ov', date: TUE, discount_price: 50000, service_type: 'TOUR', product_name: 'Тур', start_time: '18:00' }],
      promoRows: [{ code: 'ЙОГА5', type: 'PERCENT', value: 5 }],
    }, TUE)
    expect(out.map(d => d.source)).toEqual(['slot_override', 'day_of_week', 'promo_code'])
  })

  it('отфильтровывает day-скидку, если дата не скидочный день (пн)', () => {
    const out = buildActiveDiscounts({ dayRows: [rentalDay()] }, MON)
    expect(out).toEqual([])
  })

  it('внутри одного источника — бОльшая скидка первой', () => {
    const out = buildActiveDiscounts({
      promoRows: [
        { code: 'SMALL', type: 'PERCENT', value: 5 },
        { code: 'BIG', type: 'PERCENT', value: 30 },
      ],
    }, TUE)
    expect(out.map(d => d.code)).toEqual(['BIG', 'SMALL'])
  })

  it('грейсфул на пустом входе', () => {
    expect(buildActiveDiscounts({}, TUE)).toEqual([])
    expect(buildActiveDiscounts({ dayRows: [], overrideRows: [], promoRows: [] }, TUE)).toEqual([])
  })
})
