/**
 * OverlaySpec — единый источник правды запекания текста на медиа (Фаза B).
 * Зеркало backend/src/services/overlay/overlay-spec.ts — держать в синхроне вручную
 * (фронт не импортирует напрямую из backend/src, отдельного shared-пакета нет).
 */

export type OverlayTemplate = 'story' | 'clean' | 'bold'
export type OverlayFont = 'montserrat' | 'cormorant'

export interface OverlayWeather {
  temp?: string       // "+21°"
  desc?: string       // "тепло · слабый ветер"
  show: boolean       // показывать погодный виджет
}

export interface OverlaySpec {
  version: 1
  template: OverlayTemplate     // layout-пресет
  sourceMediaId: string         // ИСХОДНОЕ фото/видео — всегда бейкаем из него
  photoPosition: string         // objectPosition кадра, напр. '50% 40%'
  font: OverlayFont             // семейство заголовка
  topText?: string | null       // редактируемый верх (над/вместо погоды)
  bottomText?: string | null    // главный заголовок (низ)
  weather?: OverlayWeather | null
  cta?: string | null           // «Записаться · nawode.ru»
  promo?: string | null         // плашка скидки
}

/** Дефолтный spec при создании из медиа. */
export function defaultOverlaySpec(sourceMediaId: string): OverlaySpec {
  return {
    version: 1,
    template: 'story',
    sourceMediaId,
    photoPosition: '50% 50%',
    font: 'montserrat',
    topText: null,
    bottomText: null,
    weather: null,
    cta: null,
    promo: null,
  }
}
