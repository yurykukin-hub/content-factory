/**
 * Шаблоны дизайн-слоя соцсетей (Ф2) — строят satori-узлы для рендера в PNG.
 * Бренд НаWоде: teal #217D8C, шрифты Montserrat/Cormorant (из src/assets/fonts).
 */
import { el } from './html-render'
import { cleanStoryTitle } from '../utils/story-title'

export const STORY_W = 1080
export const STORY_H = 1920

const BRAND = { teal: '#217D8C', navy: '#162336' }

/** Убрать эмодзи — satori без emoji-шрифта рисует их как ▯. */
function stripEmoji(s: string): string {
  return (s || '')
    .replace(/[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{2190}-\u{21FF}\u{2B00}-\u{2BFF}\u{FE00}-\u{FE0F}\u{1F1E6}-\u{1F1FF}\u{200D}\u{20E3}\u{2122}\u{2139}]/gu, '')
    .replace(/\s{2,}/g, ' ')
    .trim()
}

export type StoryTemplate = 'story' | 'clean' | 'bold'
export type StoryFont = 'montserrat' | 'cormorant'

/** Семейство satori-шрифта по имени из OverlaySpec. */
export function fontFamilyOf(font?: StoryFont | null): 'Montserrat' | 'Cormorant' {
  return font === 'cormorant' ? 'Cormorant' : 'Montserrat'
}

export interface StoryDesignOpts {
  photoUri?: string | null  // data URI фото-фона (null/undefined = прозрачный слой для видео)
  title: string             // заголовок-оверлей (короткий, для сторис) = низ
  topText?: string | null   // редактируемый верхний заголовок (над/вместо погоды)
  temp?: string | null      // "+21°"
  weather?: string | null   // "тепло · слабый ветер"
  weatherShow?: boolean     // показывать погодный виджет (default: показывать если есть temp/weather)
  cta?: string | null       // "Записаться · nawode.ru"
  promo?: string | null     // "Прокат −10% · 900₽" — плашка действующей скидки (Фаза 3)
  brandInitial?: string     // буква бренда в кружке (если нет лого)
  logoUri?: string          // data URI лого (приоритет над буквой)
  photoPosition?: string    // objectPosition фото '50% 50%' (вертикальный фокус кадра — чтобы объект не обрезался)
  font?: StoryFont          // семейство заголовков (montserrat=Montserrat / cormorant=Cormorant)
  template?: StoryTemplate  // пресет раскладки: story (текущий) / clean (минимал) / bold (крупный низ)
}

/**
 * Сторис 9:16: фото-фон + погодный виджет + верхний/нижний заголовок + CTA. Эмодзи убираются (satori их не рисует).
 * Обратная совместимость: без новых полей (topText/font/template/weatherShow) вывод идентичен прежнему.
 * Видео: photoUri пустой → прозрачный слой (без фото), градиенты сохраняются для читаемости.
 */
export function buildStoryDesign(o: StoryDesignOpts): any {
  const template: StoryTemplate = o.template || 'story'
  const isClean = template === 'clean'
  const isBold = template === 'bold'
  const headFamily = fontFamilyOf(o.font)

  const title = cleanStoryTitle(stripEmoji(o.title)) // чистим температуру/день/«температура» — единая утилита
  const topText = o.topText ? cleanStoryTitle(stripEmoji(o.topText)) : null
  const weather = o.weather ? stripEmoji(o.weather) : null
  const cta = o.cta ? stripEmoji(o.cta) : null
  const promo = o.promo ? stripEmoji(o.promo) : null
  const weatherShow = o.weatherShow !== false // погода видна, если явно не скрыта
  const hasPhoto = !!o.photoUri

  const children: any[] = []
  if (hasPhoto) {
    children.push({ type: 'img', props: { src: o.photoUri, style: { position: 'absolute', top: 0, left: 0, width: STORY_W, height: STORY_H, objectFit: 'cover', objectPosition: o.photoPosition || '50% 50%' } } })
  }
  // Градиенты для читаемости текста (и на фото, и на прозрачном видео-слое)
  children.push(el('div', { position: 'absolute', top: 0, left: 0, width: STORY_W, height: 520, display: 'flex', backgroundImage: 'linear-gradient(to bottom, rgba(0,0,0,0.55), rgba(0,0,0,0))' }))
  children.push(el('div', { position: 'absolute', bottom: 0, left: 0, width: STORY_W, height: 980, display: 'flex', backgroundImage: 'linear-gradient(to top, rgba(0,0,0,0.9), rgba(0,0,0,0))' }))

  // Верхняя зона: погодный виджет (если показан и есть данные) + редактируемый topText
  const topZone: any[] = []
  if (weatherShow && (o.temp || weather)) {
    if (o.temp) topZone.push(el('div', { display: 'flex', fontFamily: 'Cormorant', fontWeight: 700, fontSize: 130, color: 'white', lineHeight: 1 }, o.temp))
    if (weather) topZone.push(el('div', { display: 'flex', fontFamily: 'Montserrat', fontWeight: 600, fontSize: 36, color: 'white', marginTop: 6 }, weather))
  }
  if (topText) topZone.push(el('div', { display: 'flex', fontFamily: headFamily, fontWeight: 700, fontSize: 56, color: 'white', lineHeight: 1.1, marginTop: topZone.length ? 18 : 0 }, topText))
  if (topZone.length) {
    // top:230 — ниже шапки соцсети (аватар/название/время занимают верхние ~200px), чтобы виджет не залезал под UI
    children.push(el('div', { position: 'absolute', top: 230, left: 64, width: 952, display: 'flex', flexDirection: 'column' }, topZone))
  }

  // Лого НЕ рисуем: сторис идут в собственные аккаунты НаWоде (и так брендировано) — лишний шум.
  // logoUri/brandInitial оставлены в opts для обратной совместимости (можно вернуть при желании).

  // Нижняя зона: плашка скидки + заголовок + CTA (clean — без плашки/CTA, bold — крупнее заголовок)
  const bottom: any[] = []
  if (promo && !isClean) bottom.push(el('div', { display: 'flex', alignSelf: 'flex-start', marginBottom: 22, paddingTop: 14, paddingBottom: 14, paddingLeft: 30, paddingRight: 30, backgroundColor: 'white', borderRadius: 14, fontFamily: 'Montserrat', fontWeight: 700, fontSize: 46, color: BRAND.teal }, promo))
  bottom.push(el('div', { display: 'flex', fontFamily: headFamily, fontWeight: 700, fontSize: isBold ? 104 : 78, color: 'white', lineHeight: 1.12 }, title))
  if (cta && !isClean) bottom.push(el('div', { display: 'flex', marginTop: 36, paddingTop: 22, paddingBottom: 22, paddingLeft: 44, paddingRight: 44, backgroundColor: BRAND.teal, borderRadius: 18, fontFamily: 'Montserrat', fontWeight: 700, fontSize: 38, color: 'white' }, cta))
  children.push(el('div', { position: 'absolute', bottom: 130, left: 64, width: 952, display: 'flex', flexDirection: 'column' }, bottom))

  // Прозрачный root для видео-слоя (без фото), непрозрачный fallback-фон для фото.
  return el('div', { display: 'flex', position: 'relative', width: STORY_W, height: STORY_H, ...(hasPhoto ? { backgroundColor: '#1a1a1a' } : {}) }, children)
}

// ─── Карусель (4:5 слайды) ───
export const CAROUSEL_W = 1080
export const CAROUSEL_H = 1350

export interface CarouselSlideOpts {
  photoUri?: string | null  // фото-фон (если нет — цветной бренд-фон)
  heading: string
  body?: string | null
  index: number             // номер слайда (1-based)
  total: number
  kind?: 'cover' | 'content' | 'cta'
  cta?: string | null
  logoUri?: string
}

/** Один слайд карусели 4:5: фото-фон или бренд-фон + заголовок + текст + номер + лого. */
export function buildCarouselSlide(o: CarouselSlideOpts): any {
  const heading = stripEmoji(o.heading)
  const body = o.body ? stripEmoji(o.body) : null
  const cta = o.cta ? stripEmoji(o.cta) : null
  const hasPhoto = !!o.photoUri
  const isCover = o.kind === 'cover'

  const children: any[] = []
  if (hasPhoto) {
    children.push({ type: 'img', props: { src: o.photoUri, style: { position: 'absolute', top: 0, left: 0, width: CAROUSEL_W, height: CAROUSEL_H, objectFit: 'cover' } } })
    children.push(el('div', { position: 'absolute', bottom: 0, left: 0, width: CAROUSEL_W, height: 820, display: 'flex', backgroundImage: 'linear-gradient(to top, rgba(0,0,0,0.9), rgba(0,0,0,0))' }))
  } else {
    children.push(el('div', { position: 'absolute', top: 0, left: 0, width: CAROUSEL_W, height: CAROUSEL_H, display: 'flex', backgroundColor: BRAND.navy }))
  }

  // Номер слайда + лого
  children.push(el('div', { position: 'absolute', top: 48, left: 56, display: 'flex', fontFamily: 'Montserrat', fontWeight: 700, fontSize: 32, color: 'white' }, `${o.index} / ${o.total}`))
  if (o.logoUri) children.push({ type: 'img', props: { src: o.logoUri, style: { position: 'absolute', top: 44, right: 56, width: 150, height: 54, objectFit: 'contain' } } })

  // Контент внизу
  const content: any[] = [el('div', { display: 'flex', fontFamily: isCover ? 'Cormorant' : 'Montserrat', fontWeight: 700, fontSize: isCover ? 92 : 62, color: 'white', lineHeight: 1.1 }, heading)]
  if (body) content.push(el('div', { display: 'flex', fontFamily: 'Montserrat', fontWeight: 600, fontSize: 40, color: 'white', marginTop: 26, lineHeight: 1.3 }, body))
  if (cta) content.push(el('div', { display: 'flex', marginTop: 34, paddingTop: 22, paddingBottom: 22, paddingLeft: 44, paddingRight: 44, backgroundColor: BRAND.teal, borderRadius: 18, fontFamily: 'Montserrat', fontWeight: 700, fontSize: 40, color: 'white' }, cta))
  children.push(el('div', { position: 'absolute', bottom: 90, left: 64, width: 952, display: 'flex', flexDirection: 'column' }, content))

  return el('div', { display: 'flex', position: 'relative', width: CAROUSEL_W, height: CAROUSEL_H, backgroundColor: '#1a1a1a' }, children)
}
