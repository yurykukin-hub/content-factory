import { config } from '../../config'
import { db } from '../../db'
import { nanoid } from 'nanoid'
import sharp from 'sharp'
import { join } from 'path'
import { mkdir } from 'fs/promises'
import { getModuleDir } from '../../utils/paths'
import { log } from '../../utils/logger'

const UPLOAD_DIR = join(getModuleDir(import.meta), '../../../uploads')
const KIE_BASE = 'https://api.kie.ai'

// --- KIE.ai REST client ---

function getKieKey(): string {
  if (!config.KIE_API_KEY) throw new Error('KIE_API_KEY не настроен. Укажите в .env')
  return config.KIE_API_KEY
}

async function kiePost(endpoint: string, body: object): Promise<any> {
  const res = await fetch(`${KIE_BASE}${endpoint}`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${getKieKey()}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  })
  if (!res.ok) {
    const text = await res.text()
    throw new Error(`KIE.ai error ${res.status}: ${text}`)
  }
  return res.json()
}

async function kieGet(endpoint: string): Promise<any> {
  const res = await fetch(`${KIE_BASE}${endpoint}`, {
    headers: { 'Authorization': `Bearer ${getKieKey()}` },
  })
  if (!res.ok) {
    const text = await res.text()
    throw new Error(`KIE.ai error ${res.status}: ${text}`)
  }
  return res.json()
}

// --- Poll task until completion ---

async function pollTask(taskId: string, maxAttempts = 60, initialDelay = 3000): Promise<any> {
  let delay = initialDelay
  for (let i = 0; i < maxAttempts; i++) {
    await new Promise(r => setTimeout(r, delay))

    const result = await kieGet(`/api/v1/jobs/recordInfo?taskId=${taskId}`)
    const status = result?.data?.status || result?.status

    if (status === 'success' || status === 'completed') {
      return result.data || result
    }
    if (status === 'fail' || status === 'failed') {
      const errMsg = result?.data?.errorMessage || result?.error || 'Генерация не удалась'
      throw new Error(`KIE.ai: ${errMsg}`)
    }

    // Exponential backoff: 3s → 4.5s → 6.75s → max 10s
    delay = Math.min(delay * 1.5, 10000)
  }
  throw new Error('KIE.ai: таймаут ожидания результата')
}

// --- Resolve public URL for KIE (needs HTTP URL) ---

function resolvePublicUrl(localPath: string): string {
  if (config.isProd) {
    return `https://content.yurykukin.ru${localPath}`
  }
  return `http://localhost:${config.PORT}${localPath}`
}

// --- Download from KIE CDN and save locally ---
// IMPORTANT: KIE image URLs expire in 10 minutes!

async function downloadAndSave(
  imageUrl: string,
  businessId: string,
  prefix: string,
): Promise<{ filename: string; thumbFilename: string; pngBuffer: Buffer }> {
  const response = await fetch(imageUrl)
  if (!response.ok) throw new Error(`Ошибка загрузки с KIE CDN: ${response.status}`)
  const arrayBuffer = await response.arrayBuffer()
  const imageBuffer = Buffer.from(arrayBuffer)

  const fileId = nanoid(12)
  const filename = `${prefix}_${fileId}.png`
  const thumbFilename = `${prefix}_${fileId}_thumb.webp`

  const bizDir = join(UPLOAD_DIR, businessId)
  await mkdir(bizDir, { recursive: true })

  const pngBuffer = await sharp(imageBuffer).png().toBuffer()
  await Bun.write(join(bizDir, filename), pngBuffer)

  await sharp(pngBuffer)
    .resize(200, 200, { fit: 'cover' })
    .webp({ quality: 80 })
    .toFile(join(bizDir, thumbFilename))

  return { filename, thumbFilename, pngBuffer }
}

// =====================
// Edit Image (FLUX Kontext Pro via KIE.ai)
// =====================

interface EditImageParams {
  imageUrl: string       // local path: /uploads/bizId/file.png
  prompt: string
  businessId: string
  postId?: string | null
}

interface KieImageResult {
  mediaFile: {
    id: string
    url: string
    thumbUrl: string | null
    filename: string
    mimeType: string
    sizeBytes: number
  }
}

export async function editImage(params: EditImageParams): Promise<KieImageResult> {
  const { imageUrl, prompt, businessId, postId } = params
  const model = config.models.kieEditImage

  log.info('[KIE] editImage', { businessId, prompt: prompt.slice(0, 80) })

  const publicUrl = resolvePublicUrl(imageUrl)

  // POST to Flux Kontext API
  const response = await kiePost('/api/v1/flux/kontext/generate', {
    prompt,
    model,
    inputImage: publicUrl,
    outputFormat: 'png',
  })

  const taskId = response?.data?.taskId || response?.taskId
  if (!taskId) throw new Error('KIE.ai не вернул taskId')

  log.info('[KIE] editImage polling', { taskId })

  // Poll until complete
  const result = await pollTask(taskId)

  // Extract image URL from result
  const outputUrl = result?.resultImageUrl || result?.image_url || result?.output?.image_url
  if (!outputUrl) throw new Error('KIE.ai не вернул изображение')

  // Download immediately (URLs expire in 10 min!)
  const { filename, thumbFilename, pngBuffer } = await downloadAndSave(outputUrl, businessId, 'kie_edit')

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

  await db.aiUsageLog.create({
    data: {
      businessId,
      action: 'edit_image',
      model,
      tokensIn: 0,
      tokensOut: 0,
      cachedTokens: 0,
      costUsd: 0.04,
    },
  })

  log.info('[KIE] editImage complete', { businessId, mediaId: mediaFile.id })

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
// Remove Background (Recraft via KIE.ai)
// =====================

interface RemoveBgParams {
  imageUrl: string
  businessId: string
  postId?: string | null
}

export async function removeBackground(params: RemoveBgParams): Promise<KieImageResult> {
  const { imageUrl, businessId, postId } = params
  const model = config.models.kieRemoveBg

  log.info('[KIE] removeBackground', { businessId })

  const publicUrl = resolvePublicUrl(imageUrl)

  // POST to Jobs API
  const response = await kiePost('/api/v1/jobs/createTask', {
    model,
    input: { image: publicUrl },
  })

  const taskId = response?.data?.taskId || response?.taskId
  if (!taskId) throw new Error('KIE.ai не вернул taskId')

  log.info('[KIE] removeBackground polling', { taskId })

  const result = await pollTask(taskId)

  const outputUrl = result?.resultImageUrl || result?.image_url || result?.output?.image_url
  if (!outputUrl) throw new Error('KIE.ai rembg не вернул изображение')

  const { filename, thumbFilename, pngBuffer } = await downloadAndSave(outputUrl, businessId, 'kie_rembg')

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
      model,
      tokensIn: 0,
      tokensOut: 0,
      cachedTokens: 0,
      costUsd: 0.01,
    },
  })

  log.info('[KIE] removeBackground complete', { businessId, mediaId: mediaFile.id })

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
