import { describe, it, expect } from 'vitest'
import { evaluateWeatherFlash } from '../weather-flash'

const goodWeather = { tempMax: 24, windMax: 3, precipMm: 0, label: 'ясно' }

describe('evaluateWeatherFlash', () => {
  it('срабатывает: тепло + штиль + сухо + день свободен', () => {
    const s = evaluateWeatherFlash({ weatherToday: goodWeather, bookingsToday: 1 })
    expect(s.triggered).toBe(true)
    expect(s.suggestedPercent).toBe(25)
    expect(s.serviceLabel).toBe('прокат')
    expect(s.reason).toContain('flash')
  })

  it('НЕ срабатывает: холодно', () => {
    const s = evaluateWeatherFlash({ weatherToday: { ...goodWeather, tempMax: 14 }, bookingsToday: 0 })
    expect(s.triggered).toBe(false)
    expect(s.reason).toContain('прохладно')
  })

  it('НЕ срабатывает: ветрено', () => {
    expect(evaluateWeatherFlash({ weatherToday: { ...goodWeather, windMax: 12 }, bookingsToday: 0 }).triggered).toBe(false)
  })

  it('НЕ срабатывает: осадки', () => {
    expect(evaluateWeatherFlash({ weatherToday: { ...goodWeather, precipMm: 5 }, bookingsToday: 0 }).triggered).toBe(false)
  })

  it('НЕ срабатывает: день уже загружен (броней больше порога)', () => {
    const s = evaluateWeatherFlash({ weatherToday: goodWeather, bookingsToday: 8 })
    expect(s.triggered).toBe(false)
    expect(s.reason).toContain('загружен')
  })

  it('НЕ срабатывает: нет данных о погоде', () => {
    expect(evaluateWeatherFlash({ weatherToday: null, bookingsToday: 0 }).triggered).toBe(false)
    expect(evaluateWeatherFlash({ weatherToday: { tempMax: null, windMax: 2, precipMm: 0 }, bookingsToday: 0 }).triggered).toBe(false)
  })

  it('глубина скидки обрезается красной линией (mass cap −40%)', () => {
    const s = evaluateWeatherFlash({ weatherToday: goodWeather, bookingsToday: 0, conditions: { percent: 90 } })
    expect(s.suggestedPercent).toBe(40) // 90 → обрезано до массового потолка
  })

  it('кастомные пороги работают (minTemp/maxBookings)', () => {
    // при пороге 26° погода 24° уже «прохладно»
    expect(evaluateWeatherFlash({ weatherToday: goodWeather, bookingsToday: 0, conditions: { minTemp: 26 } }).triggered).toBe(false)
    // при пороге maxBookings=10 день с 8 бронями ещё «свободен»
    expect(evaluateWeatherFlash({ weatherToday: goodWeather, bookingsToday: 8, conditions: { maxBookings: 10 } }).triggered).toBe(true)
  })
})
