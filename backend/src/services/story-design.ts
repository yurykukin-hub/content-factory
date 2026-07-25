/**
 * Рендер дизайн-картинок соцсетей (satori → PNG) + сохранение MediaFile.
 * Сторис (renderAndSaveStoryDesign) и карусель (renderAndSaveCarousel). Общий для endpoint и дайджеста.
 */
import { db } from '../db'
import { nanoid } from 'nanoid'
import sharp from 'sharp'
import { join } from 'path'
import { readFile } from 'fs/promises'
import { getModuleDir } from '../utils/paths'
import { getStorage, makeKey } from './storage'
import { config } from '../config'
import { renderToPng, imageToDataUri } from './html-render'
import { buildStoryDesign, STORY_W, STORY_H, buildCarouselSlide, CAROUSEL_W, CAROUSEL_H, type CarouselSlideOpts } from './design-templates'

const LOGO_PATH = join(getModuleDir(import.meta), '../assets/logo-white.png')

let logoUriCache: string | null = null
async function getLogoUri(): Promise<string | undefined> {
  if (logoUriCache) return logoUriCache
  try {
    const buf = await readFile(LOGO_PATH)
    logoUriCache = `data:image/png;base64,${buf.toString('base64')}`
    return logoUriCache
  } catch {
    return undefined
  }
}

export interface SavedDesign { id: string; url: string; thumbUrl: string; tags: string[] }

/** Сохранить PNG-буфер как MediaFile (+ webp-thumb). Общий helper для сторис, карусели и overlay. */
export async function savePngAsMedia(businessId: string, png: Buffer, filenameLabel: string, tags: string[], sourceMediaId?: string): Promise<SavedDesign> {
  const fileId = nanoid(12)
  const storage = getStorage()
  const saved = await storage.put(makeKey(businessId, `design_${fileId}.png`), png, { contentType: 'image/png' })
  // Thumb через буфер, а не .toFile() — единственная форма, переносимая на объектное хранилище.
  const thumbBuf = await sharp(png).resize(200, 200, { fit: 'cover' }).webp({ quality: 80 }).toBuffer()
  const savedThumb = await storage.put(makeKey(businessId, `${fileId}_thumb.webp`), thumbBuf, { contentType: 'image/webp' })
  const mf = await db.mediaFile.create({
    data: {
      businessId,
      filename: filenameLabel,
      url: saved.url,
      thumbUrl: savedThumb.url,
      mimeType: 'image/png',
      sizeBytes: png.length,
      tags,
      sortOrder: 0,
      sourceMediaId: sourceMediaId || null,
    },
  })
  return { id: mf.id, url: mf.url, thumbUrl: mf.thumbUrl!, tags: mf.tags }
}

export interface RenderStoryOpts {
  businessId: string
  photoUrl: string
  title: string
  topText?: string | null                        // редактируемый верх (Фаза B)
  temp?: string | null
  weather?: string | null
  weatherShow?: boolean                          // скрыть погодный виджет (Фаза B)
  cta?: string | null
  promo?: string | null    // "Прокат −10% · 900₽" — плашка действующей скидки (Фаза 3)
  photoPosition?: string   // objectPosition '50% 30%' — вертикальный фокус кадра
  font?: 'montserrat' | 'cormorant'              // семейство заголовка (Фаза B)
  template?: 'story' | 'clean' | 'bold'          // пресет раскладки (Фаза B)
  sourceMediaId?: string   // исходное фото (для переоформления с другой позицией)
  tags?: string[]          // теги MediaFile (default ['story-design','ai-generated'])
}

/** Рендер дизайн-сторис (9:16) → MediaFile. null если фото недоступно. Новые поля опциональны (обратная совместимость дайджеста). */
export async function renderAndSaveStoryDesign(o: RenderStoryOpts): Promise<SavedDesign | null> {
  const photoUri = await imageToDataUri(o.photoUrl, config.isProd, config.PORT)
  if (!photoUri) return null
  const logoUri = await getLogoUri()
  const node = buildStoryDesign({
    photoUri, title: o.title || '', topText: o.topText, temp: o.temp, weather: o.weather,
    weatherShow: o.weatherShow, cta: o.cta, promo: o.promo, logoUri, photoPosition: o.photoPosition,
    font: o.font, template: o.template,
  })
  const png = await renderToPng(node, STORY_W, STORY_H)
  return savePngAsMedia(o.businessId, png, 'Сторис-дизайн', o.tags || ['story-design', 'ai-generated'], o.sourceMediaId)
}

export interface CarouselSlideInput {
  photoUrl?: string | null  // /uploads/... или null (текст-слайд)
  heading: string
  body?: string | null
  kind?: CarouselSlideOpts['kind']
  cta?: string | null
}

/** Рендер карусели (4:5): серия слайдов → массив MediaFile (по порядку). */
export async function renderAndSaveCarousel(businessId: string, slides: CarouselSlideInput[]): Promise<SavedDesign[]> {
  const logoUri = await getLogoUri()
  const out: SavedDesign[] = []
  for (let i = 0; i < slides.length; i++) {
    const s = slides[i]
    const photoUri = s.photoUrl ? await imageToDataUri(s.photoUrl, config.isProd, config.PORT) : undefined
    const node = buildCarouselSlide({ photoUri, heading: s.heading, body: s.body, index: i + 1, total: slides.length, kind: s.kind, cta: s.cta, logoUri })
    const png = await renderToPng(node, CAROUSEL_W, CAROUSEL_H)
    out.push(await savePngAsMedia(businessId, png, `Слайд ${i + 1}/${slides.length}`, ['carousel-slide', 'ai-generated']))
  }
  return out
}
