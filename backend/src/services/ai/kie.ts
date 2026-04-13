import { config } from '../../config'
import { db } from '../../db'
import { aiComplete } from './openrouter'
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
  const json = await res.json()
  if (json.code && json.code !== 200) {
    if (json.code === 402) throw new Error('Недостаточно кредитов KIE.ai. Пополните баланс на kie.ai')
    throw new Error(`KIE.ai: ${json.msg || 'Ошибка ' + json.code}`)
  }
  return json
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
    const d = result?.data || result
    const state = d?.state || d?.status

    if (state === 'success' || state === 'completed') {
      return d
    }
    if (state === 'fail' || state === 'failed') {
      throw new Error(`KIE.ai: ${d?.failMsg || d?.errorMessage || 'Генерация не удалась'}`)
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
// Auto-translate prompt to English for better image generation
// =====================

async function translatePrompt(prompt: string, businessId: string): Promise<string> {
  // Skip if already English (simple heuristic: mostly ASCII)
  const nonAscii = prompt.replace(/[\x00-\x7F]/g, '').length
  if (nonAscii < prompt.length * 0.2) return prompt

  try {
    const result = await aiComplete({
      systemPrompt: 'Translate the following image generation prompt to English. Keep it as a prompt for AI image generation - concise, descriptive. Return ONLY the translated prompt, nothing else.',
      userPrompt: prompt,
      model: config.models.haiku,
      maxTokens: 200,
      businessId,
      action: 'translate_prompt',
    })
    return result.content.trim()
  } catch {
    return prompt // fallback: send as-is
  }
}

// =====================
// Generate Image (text2img via KIE.ai Nano Banana 2)
// =====================

interface GenerateImageParams {
  prompt: string
  businessId: string
  postId?: string | null
  aspectRatio?: '1:1' | '16:9' | '9:16'
  characterId?: string | null
}

interface GenerateImageResult {
  mediaFile: {
    id: string; url: string; thumbUrl: string | null
    filename: string; mimeType: string; sizeBytes: number
  }
  usage: { tokensIn: number; tokensOut: number; model: string }
}

export async function generateImage(params: GenerateImageParams): Promise<GenerateImageResult> {
  const { prompt: rawPrompt, businessId, postId, aspectRatio = '1:1', characterId } = params
  const model = 'nano-banana-2'

  // If character provided, enrich prompt with character description and use reference image
  let enrichedPrompt = rawPrompt
  let referenceImageUrl: string | undefined

  if (characterId) {
    const character = await db.character.findUnique({
      where: { id: characterId },
      include: { referenceMedia: { select: { url: true } } },
    })
    if (character) {
      // Add character context to prompt
      const charContext = character.description
        ? `${character.name} (${character.description})`
        : character.name
      enrichedPrompt = `${rawPrompt}. Главный персонаж: ${charContext}`
      if (character.style) enrichedPrompt += `. Стиль: ${character.style}`

      // Set reference image for img2img
      if (character.referenceMedia?.url) {
        referenceImageUrl = resolvePublicUrl(character.referenceMedia.url)
      }
    }
  }

  // Auto-translate to English for better quality
  const prompt = await translatePrompt(enrichedPrompt, businessId)

  log.info('[KIE] generateImage', { businessId, model, prompt: prompt.slice(0, 80), hasCharacter: !!characterId })

  const input: any = {
    prompt,
    aspect_ratio: aspectRatio,
    resolution: '2K',
    output_format: 'png',
  }

  // If character has reference image, use img2img mode
  if (referenceImageUrl) {
    input.image_input = [referenceImageUrl]
  }

  const response = await kiePost('/api/v1/jobs/createTask', {
    model,
    input,
  })

  const taskId = response?.data?.taskId || response?.taskId
  if (!taskId) throw new Error('KIE.ai не вернул taskId')

  log.info('[KIE] generateImage polling', { taskId })
  const result = await pollTask(taskId)

  let outputUrl: string | undefined
  if (result?.resultJson) {
    try {
      const parsed = typeof result.resultJson === 'string' ? JSON.parse(result.resultJson) : result.resultJson
      outputUrl = parsed?.resultUrls?.[0] || parsed?.resultImageUrl
    } catch {}
  }
  if (!outputUrl) {
    outputUrl = result?.resultImageUrl || result?.image_url || result?.output?.image_url
  }
  if (!outputUrl) throw new Error('KIE.ai не вернул изображение')

  const { filename, thumbFilename, pngBuffer } = await downloadAndSave(outputUrl, businessId, 'kie_gen')

  const mediaFile = await db.mediaFile.create({
    data: {
      businessId,
      postId: postId || null,
      filename: `AI: ${prompt.slice(0, 50).replace(/[\r\n\t]/g, ' ')}`,
      url: `/uploads/${businessId}/${filename}`,
      thumbUrl: `/uploads/${businessId}/${thumbFilename}`,
      mimeType: 'image/png',
      sizeBytes: pngBuffer.length,
      altText: prompt,
      aiModel: model,
      aiCostUsd: 0.06,
    },
  })

  await db.aiUsageLog.create({
    data: {
      businessId,
      action: 'generate_image',
      model,
      tokensIn: 0, tokensOut: 0, cachedTokens: 0,
      costUsd: 0.06,
    },
  })

  log.info('[KIE] generateImage complete', { businessId, mediaId: mediaFile.id })

  return {
    mediaFile: {
      id: mediaFile.id, url: mediaFile.url, thumbUrl: mediaFile.thumbUrl,
      filename: mediaFile.filename, mimeType: mediaFile.mimeType, sizeBytes: mediaFile.sizeBytes,
    },
    usage: { tokensIn: 0, tokensOut: 0, model },
  }
}

// =====================
// Edit Image (FLUX Kontext Pro via KIE.ai)
// =====================

// Available edit models
export const EDIT_MODELS = {
  'flux-kontext-pro': { label: 'FLUX Kontext', cost: 0.04 },
  'nano-banana-2': { label: 'Nano Banana 2', cost: 0.06 },
} as const

export type EditModelId = keyof typeof EDIT_MODELS

interface EditImageParams {
  imageUrl: string       // local path: /uploads/bizId/file.png
  prompt: string
  businessId: string
  postId?: string | null
  model?: EditModelId
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
  const { imageUrl, prompt: rawPrompt, businessId, postId, model: modelId } = params
  const model = modelId || config.models.kieEditImage
  const modelInfo = EDIT_MODELS[model as EditModelId] || EDIT_MODELS['flux-kontext-pro']

  // Auto-translate to English
  const prompt = await translatePrompt(rawPrompt, businessId)

  log.info('[KIE] editImage', { businessId, model, prompt: prompt.slice(0, 80) })

  const publicUrl = resolvePublicUrl(imageUrl)

  // Different endpoints for different models
  let response: any
  if (model === 'nano-banana-2') {
    // Nano Banana 2 uses /api/v1/jobs/createTask
    response = await kiePost('/api/v1/jobs/createTask', {
      model,
      input: {
        prompt,
        image_input: [publicUrl],
        resolution: '2K',
        output_format: 'png',
      },
    })
  } else {
    // FLUX Kontext uses /api/v1/flux/kontext/generate
    response = await kiePost('/api/v1/flux/kontext/generate', {
      prompt,
      model,
      inputImage: publicUrl,
      outputFormat: 'png',
    })
  }

  const taskId = response?.data?.taskId || response?.taskId
  if (!taskId) throw new Error('KIE.ai не вернул taskId')

  log.info('[KIE] editImage polling', { taskId })

  // Poll until complete
  const result = await pollTask(taskId)

  // Extract image URL from result
  // KIE returns resultJson as a JSON string: {"resultUrls":["https://..."]}
  let outputUrl: string | undefined
  if (result?.resultJson) {
    try {
      const parsed = typeof result.resultJson === 'string' ? JSON.parse(result.resultJson) : result.resultJson
      outputUrl = parsed?.resultUrls?.[0] || parsed?.resultImageUrl
    } catch {}
  }
  if (!outputUrl) {
    outputUrl = result?.resultImageUrl || result?.image_url || result?.output?.image_url
  }
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
      aiModel: model,
      aiCostUsd: modelInfo.cost,
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
      costUsd: modelInfo.cost,
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

  let outputUrl: string | undefined
  if (result?.resultJson) {
    try {
      const parsed = typeof result.resultJson === 'string' ? JSON.parse(result.resultJson) : result.resultJson
      outputUrl = parsed?.resultUrls?.[0] || parsed?.resultImageUrl
    } catch {}
  }
  if (!outputUrl) {
    outputUrl = result?.resultImageUrl || result?.image_url || result?.output?.image_url
  }
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
      aiModel: model,
      aiCostUsd: 0.01,
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

// =====================
// Generate Video (Seedance 2 via KIE.ai)
// =====================

interface GenerateVideoParams {
  prompt: string
  businessId: string
  postId?: string | null
  duration?: number            // 4-15 сек
  aspectRatio?: '1:1' | '16:9' | '9:16'
  generateAudio?: boolean      // генерировать звук (Seedance 2 native audio)
  firstFrameUrl?: string | null  // URL первого кадра (image-to-video)
  lastFrameUrl?: string | null   // URL последнего кадра (interpolation)
}

interface GenerateVideoResult {
  mediaFile: {
    id: string; url: string; thumbUrl: string | null
    filename: string; mimeType: string; sizeBytes: number; durationSec: number | null
  }
  usage: { tokensIn: number; tokensOut: number; model: string }
}

async function downloadAndSaveVideo(
  videoUrl: string,
  businessId: string,
  prefix: string,
): Promise<{ filename: string; videoBuffer: Buffer }> {
  const response = await fetch(videoUrl)
  if (!response.ok) throw new Error(`Ошибка загрузки видео с KIE CDN: ${response.status}`)
  const arrayBuffer = await response.arrayBuffer()
  const videoBuffer = Buffer.from(arrayBuffer)

  const fileId = nanoid(12)
  const filename = `${prefix}_${fileId}.mp4`

  const bizDir = join(UPLOAD_DIR, businessId)
  await mkdir(bizDir, { recursive: true })
  await Bun.write(join(bizDir, filename), videoBuffer)

  return { filename, videoBuffer }
}

export async function generateVideo(params: GenerateVideoParams): Promise<GenerateVideoResult> {
  const { prompt: rawPrompt, businessId, postId, duration = 5, aspectRatio = '9:16', generateAudio = true, firstFrameUrl, lastFrameUrl } = params
  const model = 'bytedance/seedance-2'

  const hasImageInput = !!firstFrameUrl
  // Ценообразование: text-to-video 41 cr/s, image-to-video 25 cr/s (720p), audio ~2x
  const creditsPerSec = hasImageInput ? 25 : 41
  const audioMultiplier = generateAudio ? 2.0 : 1.0
  const videoCostUsd = creditsPerSec * duration * 0.005 * audioMultiplier

  const prompt = await translatePrompt(rawPrompt, businessId)

  // Resolve image URLs to public
  const resolvedFirstFrame = firstFrameUrl ? resolvePublicUrl(firstFrameUrl) : undefined
  const resolvedLastFrame = lastFrameUrl ? resolvePublicUrl(lastFrameUrl) : undefined

  log.info('[KIE] generateVideo', { businessId, model, duration, generateAudio, hasFirstFrame: !!resolvedFirstFrame, hasLastFrame: !!resolvedLastFrame, prompt: prompt.slice(0, 80) })

  const input: any = {
    prompt,
    duration,
    aspect_ratio: aspectRatio,
    output_format: 'mp4',
    generate_audio: generateAudio,
  }

  // Image-to-video: first frame (+ optional last frame)
  if (resolvedFirstFrame) {
    input.first_frame_url = resolvedFirstFrame
    if (resolvedLastFrame) {
      input.last_frame_url = resolvedLastFrame
    }
  }

  const response = await kiePost('/api/v1/jobs/createTask', {
    model,
    input,
  })

  const taskId = response?.data?.taskId || response?.taskId
  if (!taskId) throw new Error('KIE.ai не вернул taskId для видео')

  log.info('[KIE] generateVideo polling', { taskId })

  // Видео дольше — увеличиваем таймаут (120 попыток × 5с = 10 мин)
  const result = await pollTask(taskId, 120, 5000)

  let outputUrl: string | undefined
  if (result?.resultJson) {
    try {
      const parsed = typeof result.resultJson === 'string' ? JSON.parse(result.resultJson) : result.resultJson
      outputUrl = parsed?.resultUrls?.[0] || parsed?.resultVideoUrl || parsed?.resultImageUrl
    } catch {}
  }
  if (!outputUrl) {
    outputUrl = result?.resultVideoUrl || result?.resultImageUrl || result?.video_url || result?.output?.video_url
  }
  if (!outputUrl) throw new Error('KIE.ai не вернул видео')

  const { filename, videoBuffer } = await downloadAndSaveVideo(outputUrl, businessId, 'kie_video')

  const mediaFile = await db.mediaFile.create({
    data: {
      businessId,
      postId: postId || null,
      filename: `AI Video: ${prompt.slice(0, 50).replace(/[\r\n\t]/g, ' ')}`,
      url: `/uploads/${businessId}/${filename}`,
      thumbUrl: null,
      mimeType: 'video/mp4',
      sizeBytes: videoBuffer.length,
      durationSec: duration,
      altText: prompt,
      aiModel: model,
      aiCostUsd: videoCostUsd,
    },
  })

  await db.aiUsageLog.create({
    data: {
      businessId,
      action: 'generate_video',
      model,
      tokensIn: 0, tokensOut: 0, cachedTokens: 0,
      costUsd: videoCostUsd,
    },
  })

  log.info('[KIE] generateVideo complete', { businessId, mediaId: mediaFile.id })

  return {
    mediaFile: {
      id: mediaFile.id, url: mediaFile.url, thumbUrl: mediaFile.thumbUrl,
      filename: mediaFile.filename, mimeType: mediaFile.mimeType,
      sizeBytes: mediaFile.sizeBytes, durationSec: mediaFile.durationSec,
    },
    usage: { tokensIn: 0, tokensOut: 0, model },
  }
}
