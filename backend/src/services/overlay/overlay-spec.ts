/**
 * OverlaySpec — единый источник правды запекания текста на медиа (Фаза B).
 * Хранится в Post.overlaySpec (Json?). ОДИН spec → ОДИН рендерер (satori) → «что вижу = что публикуется».
 * ВСЕГДА бейкаем из sourceMediaId (исходное фото/видео), никогда design-over-design.
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

const TEMPLATES: OverlayTemplate[] = ['story', 'clean', 'bold']
const FONTS: OverlayFont[] = ['montserrat', 'cormorant']

function str(v: any): string | null {
  if (v === null || v === undefined) return null
  const s = String(v).trim()
  return s.length ? s : null
}

/** Лёгкая рантайм-валидация/нормализация входа в корректный OverlaySpec. */
export function normalizeOverlaySpec(input: any): OverlaySpec {
  const src = input && typeof input === 'object' ? input : {}
  const template: OverlayTemplate = TEMPLATES.includes(src.template) ? src.template : 'story'
  const font: OverlayFont = FONTS.includes(src.font) ? src.font : 'montserrat'
  const sourceMediaId = str(src.sourceMediaId) || ''
  const photoPosition = str(src.photoPosition) || '50% 50%'

  let weather: OverlayWeather | null = null
  if (src.weather && typeof src.weather === 'object') {
    weather = {
      temp: str(src.weather.temp) || undefined,
      desc: str(src.weather.desc) || undefined,
      show: src.weather.show !== false, // default true если объект передан
    }
  }

  return {
    version: 1,
    template,
    sourceMediaId,
    photoPosition,
    font,
    topText: str(src.topText),
    bottomText: str(src.bottomText),
    weather,
    cta: str(src.cta),
    promo: str(src.promo),
  }
}
