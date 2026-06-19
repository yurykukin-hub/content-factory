/**
 * Рендер дизайн-сторис (фото → satori PNG с оверлеем/виджетом/лого) + сохранение MediaFile.
 * Общая логика для endpoint (media.ts /render-design) и авто-генерации в дайджесте (daily-digest.ts).
 */
import { db } from '../db'
import { nanoid } from 'nanoid'
import sharp from 'sharp'
import { join } from 'path'
import { mkdir, readFile } from 'fs/promises'
import { getModuleDir } from '../utils/paths'
import { config } from '../config'
import { renderToPng, imageToDataUri } from './html-render'
import { buildStoryDesign, STORY_W, STORY_H } from './design-templates'

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

export interface RenderStoryOpts {
  businessId: string
  photoUrl: string // /uploads/... исходного фото-фона
  title: string
  temp?: string | null
  weather?: string | null
  cta?: string | null
}

/** Рендерит дизайн-сторис и сохраняет как MediaFile (теги story-design/ai-generated). null если фото недоступно. */
export async function renderAndSaveStoryDesign(o: RenderStoryOpts): Promise<{ id: string; url: string; thumbUrl: string; tags: string[] } | null> {
  const photoUri = await imageToDataUri(o.photoUrl, config.isProd, config.PORT)
  if (!photoUri) return null
  const logoUri = await getLogoUri()

  const node = buildStoryDesign({ photoUri, title: o.title || '', temp: o.temp, weather: o.weather, cta: o.cta, logoUri })
  const png = await renderToPng(node, STORY_W, STORY_H)

  const fileId = nanoid(12)
  const filename = `design_${fileId}.png`
  const thumbName = `${fileId}_thumb.webp`
  const bizDir = join(UPLOAD_DIR, o.businessId)
  await mkdir(bizDir, { recursive: true })
  await Bun.write(join(bizDir, filename), png)
  await sharp(png).resize(200, 200, { fit: 'cover' }).webp({ quality: 80 }).toFile(join(bizDir, thumbName))

  const mf = await db.mediaFile.create({
    data: {
      businessId: o.businessId,
      filename: 'Сторис-дизайн',
      url: `/uploads/${o.businessId}/${filename}`,
      thumbUrl: `/uploads/${o.businessId}/${thumbName}`,
      mimeType: 'image/png',
      sizeBytes: png.length,
      tags: ['story-design', 'ai-generated'],
      sortOrder: 0,
    },
  })
  return { id: mf.id, url: mf.url, thumbUrl: mf.thumbUrl!, tags: mf.tags }
}
