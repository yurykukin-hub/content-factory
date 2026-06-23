import { describe, it, expect } from 'vitest'
import { igFeedTargetSize } from '../postmypost'

// IG-лента допускает соотношение сторон (w/h) только 0.8 (4:5) … 1.91 (1.91:1).
// Вне диапазона IG добавляет белые поля — igFeedTargetSize считает кроп к ближайшей границе.
describe('igFeedTargetSize — нормализация фото под IG-ленту', () => {
  it('фото уже в допустимом диапазоне → null (не трогаем)', () => {
    expect(igFeedTargetSize(1080, 1350)).toBeNull() // 4:5 = 0.8 (граница включительно)
    expect(igFeedTargetSize(1080, 1080)).toBeNull() // 1:1
    expect(igFeedTargetSize(1920, 1080)).toBeNull() // 16:9 ≈ 1.78 < 1.91
  })

  it('слишком высокое (9:16) → кроп до 4:5: держим ширину, режем высоту', () => {
    const r = igFeedTargetSize(1080, 1920) // ratio 0.5625 < 0.8
    expect(r).toEqual({ outW: 1080, outH: Math.round(1080 / 0.8) }) // 1080 × 1350
  })

  it('слишком широкое (21:9) → кроп до 1.91:1: держим высоту, режем ширину', () => {
    const r = igFeedTargetSize(2100, 900) // ratio 2.33 > 1.91
    expect(r).toEqual({ outW: Math.round(900 * 1.91), outH: 900 }) // 1719 × 900
  })

  it('forceRatio (карусель 4:5) приводит ЛЮБОЕ фото к общему соотношению', () => {
    expect(igFeedTargetSize(1920, 1080, 0.8)).toEqual({ outW: Math.round(1080 * 0.8), outH: 1080 }) // 864 × 1080
    expect(igFeedTargetSize(1080, 1920, 0.8)).toEqual({ outW: 1080, outH: Math.round(1080 / 0.8) }) // 1080 × 1350
  })

  it('битые/нулевые размеры → null (fail-safe)', () => {
    expect(igFeedTargetSize(0, 1000)).toBeNull()
    expect(igFeedTargetSize(1000, 0)).toBeNull()
  })

  it('никогда не апскейлит — обе стороны не больше исходных', () => {
    const r = igFeedTargetSize(800, 2000)! // очень высокое
    expect(r.outW).toBeLessThanOrEqual(800)
    expect(r.outH).toBeLessThanOrEqual(2000)
  })
})
