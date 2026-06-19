/**
 * Шаблоны дизайн-слоя соцсетей (Ф2) — строят satori-узлы для рендера в PNG.
 * Бренд НаWоде: teal #217D8C, шрифты Montserrat/Cormorant (из src/assets/fonts).
 */
import { el } from './html-render'

export const STORY_W = 1080
export const STORY_H = 1920

const BRAND = { teal: '#217D8C', navy: '#162336' }

export interface StoryDesignOpts {
  photoUri: string          // data URI фото-фона
  title: string             // заголовок-оверлей (короткий, для сторис)
  temp?: string | null      // "+21°"
  weather?: string | null   // "тепло · слабый ветер"
  cta?: string | null       // "Записаться · nawode.ru"
  brandInitial?: string     // буква бренда в кружке (если нет лого)
  logoUri?: string          // data URI лого (приоритет над буквой)
}

/** Сторис 9:16: фото-фон + погодный виджет + заголовок-оверлей + CTA. */
export function buildStoryDesign(o: StoryDesignOpts): any {
  const children: any[] = [
    { type: 'img', props: { src: o.photoUri, style: { position: 'absolute', top: 0, left: 0, width: STORY_W, height: STORY_H, objectFit: 'cover' } } },
    el('div', { position: 'absolute', top: 0, left: 0, width: STORY_W, height: 520, display: 'flex', backgroundImage: 'linear-gradient(to bottom, rgba(0,0,0,0.55), rgba(0,0,0,0))' }),
    el('div', { position: 'absolute', bottom: 0, left: 0, width: STORY_W, height: 980, display: 'flex', backgroundImage: 'linear-gradient(to top, rgba(0,0,0,0.9), rgba(0,0,0,0))' }),
  ]

  // Погодный виджет (только если есть данные)
  if (o.temp || o.weather) {
    const widget: any[] = []
    if (o.temp) widget.push(el('div', { display: 'flex', fontFamily: 'Cormorant', fontWeight: 700, fontSize: 130, color: 'white', lineHeight: 1 }, o.temp))
    if (o.weather) widget.push(el('div', { display: 'flex', fontFamily: 'Montserrat', fontWeight: 600, fontSize: 36, color: 'white', marginTop: 6 }, o.weather))
    children.push(el('div', { position: 'absolute', top: 64, left: 64, display: 'flex', flexDirection: 'column' }, widget))
  }

  // Бренд: реальное лого (приоритет) или буква-кружок
  if (o.logoUri) {
    children.push({ type: 'img', props: { src: o.logoUri, style: { position: 'absolute', top: 60, right: 60, width: 180, height: 64, objectFit: 'contain' } } })
  } else {
    children.push(el('div', { position: 'absolute', top: 76, right: 64, display: 'flex', width: 72, height: 72, borderRadius: 36, backgroundColor: BRAND.teal, alignItems: 'center', justifyContent: 'center', fontFamily: 'Montserrat', fontWeight: 700, fontSize: 38, color: 'white' }, o.brandInitial || 'Н'))
  }

  // Заголовок + CTA внизу
  const bottom: any[] = [el('div', { display: 'flex', fontFamily: 'Montserrat', fontWeight: 700, fontSize: 76, color: 'white', lineHeight: 1.12 }, o.title)]
  if (o.cta) bottom.push(el('div', { display: 'flex', marginTop: 32, paddingTop: 20, paddingBottom: 20, paddingLeft: 40, paddingRight: 40, backgroundColor: BRAND.teal, borderRadius: 18, fontFamily: 'Montserrat', fontWeight: 700, fontSize: 36, color: 'white' }, o.cta))
  children.push(el('div', { position: 'absolute', bottom: 130, left: 64, width: 952, display: 'flex', flexDirection: 'column' }, bottom))

  return el('div', { display: 'flex', position: 'relative', width: STORY_W, height: STORY_H, backgroundColor: '#1a1a1a' }, children)
}
