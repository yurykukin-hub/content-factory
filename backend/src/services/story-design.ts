/**
 * Рендер дизайн-картинок соцсетей (satori → PNG) + сохранение MediaFile.
 * Сторис (renderAndSaveStoryDesign) и карусель (renderAndSaveCarousel). Общий для endpoint и дайджеста.
 */
import { db } from '../db'
import { nanoid } from 'nanoid'
import sharp from 'sharp'
import { join } from 'path'
import { mkdir, readFile } from 'fs/promises'
import { getModuleDir } from '../utils/paths'
import { config } from '../config'
import { renderToPng, imageToDataUri } from './html-render'
import { buildStoryDesign, STORY_W, STORY_H, buildCarouselSlide, CAROUSEL_W, CAROUSEL_H, type CarouselSlideOpts } from './design-templates'

const UPLOAD_DIR = join(getModuleDir(import.meta), '../../uploads')
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

/** Сохранить PNG-буфер как MediaFile (+ webp-thumb). Общий helper для сторис и карусели. */
async function savePngAsMedia(businessId: string, png: Buffer, filenameLabel: string, tags: string[]): Promise<SavedDesign> {
  const fileId = nanoid(12)
  const filename = `design_${fileId}.png`
  const thumbName = `${fileId}_thumb.webp`
  const bizDir = join(UPLOAD_DIR, businessId)
  await mkdir(bizDir, { recursive: true })
  await Bun.write(join(bizDir, filename), png)
  await sharp(png).resize(200, 200, { fit: 'cover' }).webp({ quality: 80 }).toFile(join(bizDir, thumbName))
  const mf = await db.mediaFile.create({
    data: {
      businessId,
      filename: filenameLabel,
      url: `/uploads/${businessId}/${filename}`,
      thumbUrl: `/uploads/${businessId}/${thumbName}`,
      mimeType: 'image/png',
      sizeBytes: png.length,
      tags,
      sortOrder: 0,
    },
  })
  return { id: mf.id, url: mf.url, thumbUrl: mf.thumbUrl!, tags: mf.tags }
}

export interface RenderStoryOpts {
  businessId: string
  photoUrl: string
  title: string
  temp?: string | null
  weather?: string | null
  cta?: string | null
}

/** Рендер дизайн-сторис (9:16) → MediaFile. null если фото недоступно. */
export async function renderAndSaveStoryDesign(o: RenderStoryOpts): Promise<SavedDesign | null> {
  const photoUri = await imageToDataUri(o.photoUrl, config.isProd, config.PORT)
  if (!photoUri) return null
  const logoUri = await getLogoUri()
  const node = buildStoryDesign({ photoUri, title: o.title || '', temp: o.temp, weather: o.weather, cta: o.cta, logoUri })
  const png = await renderToPng(node, STORY_W, STORY_H)
  return savePngAsMedia(o.businessId, png, 'Сторис-дизайн', ['story-design', 'ai-generated'])
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
