/**
 * Tests for igFeedTargetSize — чистая crop-математика для Instagram-ленты.
 *
 * IG требует соотношение сторон 0.8 (4:5) … 1.91 (1.91:1). Функция считает
 * целевой размер кропа. Ошибка здесь = кривой кроп/отказ публикации в IG.
 */

import { describe, it, expect } from 'vitest'
import { igFeedTargetSize } from '../postmypost'

describe('igFeedTargetSize', () => {
  it('null если ширина или высота нулевые', () => {
    expect(igFeedTargetSize(0, 100)).toBeNull()
    expect(igFeedTargetSize(100, 0)).toBeNull()
  })

  it('null если соотношение уже в допустимом диапазоне (0.8…1.91)', () => {
    expect(igFeedTargetSize(1000, 1000)).toBeNull() // 1:1
    expect(igFeedTargetSize(1080, 1350)).toBeNull() // 0.8 ровно
    expect(igFeedTargetSize(1910, 1000)).toBeNull() // 1.91 ровно
  })

  it('слишком высокое (ratio<0.8) → режет высоту до 4:5', () => {
    const r = igFeedTargetSize(800, 1200) // ratio 0.666
    expect(r).toEqual({ outW: 800, outH: 1000 }) // 800/1000 = 0.8
  })

  it('слишком широкое (ratio>1.91) → режет ширину до 1.91:1', () => {
    const r = igFeedTargetSize(2000, 1000) // ratio 2.0
    expect(r).toEqual({ outW: 1910, outH: 1000 }) // 1910/1000 = 1.91
  })

  it('forceRatio 0.8 (карусель): квадрат → режется до 4:5', () => {
    const r = igFeedTargetSize(1000, 1000, 0.8)
    expect(r).toEqual({ outW: 800, outH: 1000 })
  })

  it('forceRatio 0.8: очень высокое → режет высоту', () => {
    const r = igFeedTargetSize(1000, 2000, 0.8) // ratio 0.5 < 0.8
    expect(r).toEqual({ outW: 1000, outH: 1250 }) // 1000/1250 = 0.8
  })
})
