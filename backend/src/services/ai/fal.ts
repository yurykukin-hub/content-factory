import { fal } from '@fal-ai/client'
import { config } from '../../config'
import { db } from '../../db'
import { nanoid } from 'nanoid'
import sharp from 'sharp'
import { join } from 'path'
import { mkdir } from 'fs/promises'
import { getModuleDir } from '../../utils/paths'
import { log } from '../../utils/logger'

const UPLOAD_DIR = join(getModuleDir(import.meta), '../../../uploads')

// --- Init FAL SDK ---
function initFal() {
  if (!config.FAL_API_KEY) throw new Error('FAL_API_KEY не настроен. Укажите в Settings → AI или .env')
  fal.config({ credentials: config.FAL_API_KEY })
}

// --- Resolve image URL for FAL (needs public HTTP URL) ---
async function getImageUrlForFal(localPath: string): Promise<string> {
  if (config.isProd) {
    return `https://content.yurykukin.ru${localPath}`
  }
  // Dev: upload to FAL temporary storage
  const filePath = join(UPLOAD_DIR, localPath.replace('/uploads/', ''))
  const file = Bun.file(filePath)
  const arrayBuffer = await file.arrayBuffer()
  const uploaded = await fal.storage.upload(new Blob([arrayBuffer]))
  return uploaded
}

// --- Download from FAL CDN and save locally ---
async function downloadAndSave(
  imageUrl: string,
  businessId: string,
  prefix: string,
): Promise<{ filename: string; thumbFilename: string; pngBuffer: Buffer }> {
  const response = await fetch(imageUrl)
  if (!response.ok) throw new Error(`Ошибка загрузки с FAL CDN: ${response.status}`)
  const arrayBuffer = await response.arrayBuffer()
  const imageBuffer = Buffer.from(arrayBuffer)

  const fileId = nanoid(12)
  const filename = `${prefix}_${fileId}.png`
  const thumbFilename = `${prefix}_${fileId}_thumb.webp`

  const bizDir = join(UPLOAD_DIR, businessId)
  await mkdir(bizDir, { recursive: true })

  // Convert to PNG and save
  const pngBuffer = await sharp(imageBuffer).png().toBuffer()
  await Bun.write(join(bizDir, filename), pngBuffer)

  // Generate thumbnail
  await sharp(pngBuffer)
    .resize(200, 200, { fit: 'cover' })
    .webp({ quality: 80 })
    .toFile(join(bizDir, thumbFilename))

  return { filename, thumbFilename, pngBuffer }
}

// =====================
// Edit Image (FLUX Kontext Pro)
// =====================

interface EditImageParams {
  imageUrl: string       // local path: /uploads/bizId/file.png
  prompt: string
  businessId: string
  postId?: string | null
}

interface FalImageResult {
  mediaFile: {
    id: string
    url: string
    thumbUrl: string | null
    filename: string
    mimeType: string
    sizeBytes: number
  }
}

export async function editImage(params: EditImageParams): Promise<FalImageResult> {
  initFal()
  const { imageUrl, prompt, businessId, postId } = params

  log.info('[FAL] editImage', { businessId, prompt: prompt.slice(0, 80) })

  // Resolve public URL for FAL
  const publicUrl = await getImageUrlForFal(imageUrl)

  // Call FAL.ai FLUX Kontext Pro
  const result = await fal.subscribe(config.models.falEditImage, {
    input: {
      image_url: publicUrl,
      prompt,
    },
  }) as any

  const outputUrl = result.data?.images?.[0]?.url
  if (!outputUrl) throw new Error('FAL.ai не вернул изображение. Попробуйте другой промпт.')

  // Download and save
  const { filename, thumbFilename, pngBuffer } = await downloadAndSave(outputUrl, businessId, 'fal_edit')

  // Create MediaFile
  const mediaFile = await db.mediaFile.create({
    data: {
      businessId,
      postId: postId || null,
      filename: `AI Edit: ${prompt.slice(0, 50).replace(/[\r\n\t]/g, ' ')}`,
      url: `/uploads/${businessId}/${filename}`,
      thumbUrl: `/uploads/${businessId}/${thumbFilename}`,
      mimeType: 'image/png',
      sizeBytes: pngBuffer.length,
      altText: prompt,
    },
  })

  // Log AI usage
  await db.aiUsageLog.create({
    data: {
      businessId,
      action: 'edit_image',
      model: config.models.falEditImage,
      tokensIn: 0,
      tokensOut: 0,
      cachedTokens: 0,
      costUsd: 0.04, // FLUX Kontext Pro ~$0.04/request
    },
  })

  log.info('[FAL] editImage complete', { businessId, mediaId: mediaFile.id })

  return {
    mediaFile: {
      id: mediaFile.id,
      url: mediaFile.url,
      thumbUrl: mediaFile.thumbUrl,
      filename: mediaFile.filename,
      mimeType: mediaFile.mimeType,
      sizeBytes: mediaFile.sizeBytes,
    },
  }
}

// =====================
// Remove Background (rembg)
// =====================

interface RemoveBgParams {
  imageUrl: string       // local path: /uploads/bizId/file.png
  businessId: string
  postId?: string | null
}

export async function removeBackground(params: RemoveBgParams): Promise<FalImageResult> {
  initFal()
  const { imageUrl, businessId, postId } = params

  log.info('[FAL] removeBackground', { businessId })

  const publicUrl = await getImageUrlForFal(imageUrl)

  const result = await fal.subscribe(config.models.falRemoveBg, {
    input: { image_url: publicUrl },
  }) as any

  // rembg returns result.data.image.url (not images[])
  const outputUrl = result.data?.image?.url
  if (!outputUrl) throw new Error('FAL.ai rembg не вернул изображение')

  const { filename, thumbFilename, pngBuffer } = await downloadAndSave(outputUrl, businessId, 'fal_rembg')

  const mediaFile = await db.mediaFile.create({
    data: {
      businessId,
      postId: postId || null,
      filename: 'Без фона',
      url: `/uploads/${businessId}/${filename}`,
      thumbUrl: `/uploads/${businessId}/${thumbFilename}`,
      mimeType: 'image/png',
      sizeBytes: pngBuffer.length,
    },
  })

  await db.aiUsageLog.create({
    data: {
      businessId,
      action: 'remove_background',
      model: config.models.falRemoveBg,
      tokensIn: 0,
      tokensOut: 0,
      cachedTokens: 0,
      costUsd: 0.01,
    },
  })

  log.info('[FAL] removeBackground complete', { businessId, mediaId: mediaFile.id })

  return {
    mediaFile: {
      id: mediaFile.id,
      url: mediaFile.url,
      thumbUrl: mediaFile.thumbUrl,
      filename: mediaFile.filename,
      mimeType: mediaFile.mimeType,
      sizeBytes: mediaFile.sizeBytes,
    },
  }
}
