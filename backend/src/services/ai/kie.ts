import { config } from '../../config'
import { db } from '../../db'
import { aiComplete } from './openrouter'
import { getMarkupPercent, getChargedRub, chargeUser } from '../billing'
import { nanoid } from 'nanoid'
import sharp from 'sharp'
import { join } from 'path'
import { getStorage, makeKey, publicUrl, withTempDir } from '../storage'
import { writeStreamedFile } from '../storage/fsio'
import { log } from '../../utils/logger'

const KIE_BASE = 'https://api.kie.ai'

// =====================
// Photo Studio — pricing & models
// =====================

export const PHOTO_PRICING: Record<string, Record<string, number>> = {
  'nano-banana-2':   { '1K': 0.04, '2K': 0.06, '4K': 0.09 },
  'nano-banana-pro': { '1K': 0.07, '2K': 0.09, '4K': 0.12 },
  'gpt-image-2':     { '1K': 0.03, '2K': 0.05, '4K': 0.08 },
}

export const PHOTO_MODELS = {
  'nano-banana-2':   { label: 'Nano Banana 2', speed: '4-6 сек' },
  'nano-banana-pro': { label: 'Nano Banana Pro', speed: '10-20 сек' },
  'gpt-image-2':     { label: 'GPT Image 2', speed: '~3 мин' },
} as const

export type PhotoModelId = keyof typeof PHOTO_MODELS

// --- KIE.ai REST client ---

async function getKieKey(): Promise<string> {
  try {
    const row = await db.appConfig.findUnique({ where: { key: 'kie_api_key' } })
    if (row?.value) return row.value
  } catch {
    // DB unavailable — fallback to env
  }
  if (!config.KIE_API_KEY) throw new Error('KIE_API_KEY не настроен. Укажите в Настройки → AI или .env')
  return config.KIE_API_KEY
}

async function kiePost(endpoint: string, body: object): Promise<any> {
  const res = await fetch(`${KIE_BASE}${endpoint}`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${await getKieKey()}`,
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
    headers: { 'Authorization': `Bearer ${await getKieKey()}` },
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


// --- Download from KIE CDN and save locally ---
// IMPORTANT: KIE image URLs expire in 10 minutes!

async function downloadAndSave(
  imageUrl: string,
  businessId: string,
  prefix: string,
): Promise<{ url: string; thumbUrl: string; pngBuffer: Buffer }> {
  const response = await fetch(imageUrl)
  if (!response.ok) throw new Error(`Ошибка загрузки с KIE CDN: ${response.status}`)
  const arrayBuffer = await response.arrayBuffer()
  const imageBuffer = Buffer.from(arrayBuffer)

  const fileId = nanoid(12)
  const storage = getStorage()

  const pngBuffer = await sharp(imageBuffer).png().toBuffer()
  const saved = await storage.put(makeKey(businessId, `${prefix}_${fileId}.png`), pngBuffer, { contentType: 'image/png' })

  const thumbBuffer = await sharp(pngBuffer)
    .resize(200, 200, { fit: 'cover' })
    .webp({ quality: 80 })
    .toBuffer()
  const savedThumb = await storage.put(makeKey(businessId, `${prefix}_${fileId}_thumb.webp`), thumbBuffer, { contentType: 'image/webp' })

  return { url: saved.url, thumbUrl: savedThumb.url, pngBuffer }
}

// =====================
// Auto-translate prompt to English for better image generation
// =====================

async function translatePrompt(prompt: string, businessId: string, userId?: string): Promise<string> {
  // Skip if already English (simple heuristic: mostly ASCII)
  const nonAscii = prompt.replace(/[\x00-\x7F]/g, '').length
  if (nonAscii < prompt.length * 0.2) return prompt

  try {
    const result = await aiComplete({
      systemPrompt: `Translate the following video generation prompt to English for Seedance 2.0.
Keep it as a prompt for AI video generation - concise, descriptive.
Use proper camera terminology:
  - крупный план → close-up
  - средний план → medium shot
  - общий план → wide shot
  - наезд → dolly in / push forward
  - отъезд → pull back / dolly out
  - панорама → pan
  - следящая → tracking shot
  - ручная камера → handheld
  - дрон → aerial
  - статика → locked-off static camera
  - гимбал → gimbal stabilized
  - орбита → orbital movement
  - золотой час → golden hour
  - контровый свет → backlit / rim lighting
Preserve @Image1, @Image2 tags exactly as-is.
Preserve timeline markers [0s], [3s] etc.
Return ONLY the translated prompt, nothing else.`,
      userPrompt: prompt,
      model: config.models.haiku,
      maxTokens: 400,
      businessId,
      action: 'translate_prompt',
      userId,
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
  userId?: string
}

interface GenerateImageResult {
  mediaFile: {
    id: string; url: string; thumbUrl: string | null
    filename: string; mimeType: string; sizeBytes: number
  }
  usage: { tokensIn: number; tokensOut: number; model: string }
}

export async function generateImage(params: GenerateImageParams): Promise<GenerateImageResult> {
  const start = Date.now()
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
        referenceImageUrl = publicUrl(character.referenceMedia.url)
      }
    }
  }

  // Auto-translate to English for better quality
  const prompt = await translatePrompt(enrichedPrompt, businessId, params.userId)

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

  const { url, thumbUrl, pngBuffer } = await downloadAndSave(outputUrl, businessId, 'kie_gen')

  const mediaFile = await db.mediaFile.create({
    data: {
      businessId,
      postId: postId || null,
      filename: `AI: ${prompt.slice(0, 50).replace(/[\r\n\t]/g, ' ')}`,
      url,
      thumbUrl,
      mimeType: 'image/png',
      sizeBytes: pngBuffer.length,
      altText: prompt,
      aiModel: model,
      aiCostUsd: 0.06,
    },
  })

  const markup = await getMarkupPercent()
  const imgLog = await db.aiUsageLog.create({
    data: {
      businessId,
      userId: params.userId || null,
      action: 'generate_image',
      model,
      tokensIn: 0, tokensOut: 0, cachedTokens: 0,
      costUsd: 0.06,
      markupPercent: markup,
      chargedRub: await getChargedRub(0.06, markup),
      status: 'success',
      prompt: (prompt || '').slice(0, 2000),
      durationMs: Date.now() - start,
    },
  })
  if (params.userId) {
    const u = await db.user.findUnique({ where: { id: params.userId }, select: { role: true } })
    if (u) await chargeUser({ userId: params.userId, role: u.role, costUsd: 0.06, markupPercent: markup, aiUsageLogId: imgLog.id, description: 'generate_image' })
  }

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
// Edit Image (Nano Banana 2 via KIE.ai)
// =====================

// Available edit models
export const EDIT_MODELS = {
  'nano-banana-2': { label: 'Nano Banana 2', cost: 0.06 },
} as const

export type EditModelId = keyof typeof EDIT_MODELS

interface EditImageParams {
  imageUrl: string       // local path: /uploads/bizId/file.png
  prompt: string
  businessId: string
  postId?: string | null
  model?: EditModelId
  userId?: string
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
  const start = Date.now()
  const { imageUrl, prompt: rawPrompt, businessId, postId, model: modelId } = params
  const model = modelId || config.models.kieEditImage
  const modelInfo = EDIT_MODELS[model as EditModelId] || EDIT_MODELS['nano-banana-2']

  // Auto-translate to English
  const prompt = await translatePrompt(rawPrompt, businessId, params.userId)

  log.info('[KIE] editImage', { businessId, model, prompt: prompt.slice(0, 80) })

  const srcPublicUrl = publicUrl(imageUrl)

  // Nano Banana 2 uses /api/v1/jobs/createTask
  const response = await kiePost('/api/v1/jobs/createTask', {
    model,
    input: {
      prompt,
      image_input: [srcPublicUrl],
      resolution: '2K',
      output_format: 'png',
    },
  })

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
  const { url, thumbUrl, pngBuffer } = await downloadAndSave(outputUrl, businessId, 'kie_edit')

  const mediaFile = await db.mediaFile.create({
    data: {
      businessId,
      postId: postId || null,
      filename: `AI Edit: ${prompt.slice(0, 50).replace(/[\r\n\t]/g, ' ')}`,
      url,
      thumbUrl,
      mimeType: 'image/png',
      sizeBytes: pngBuffer.length,
      altText: prompt,
      aiModel: model,
      aiCostUsd: modelInfo.cost,
    },
  })

  const editMarkup = await getMarkupPercent()
  const editLog = await db.aiUsageLog.create({
    data: {
      businessId,
      userId: params.userId || null,
      action: 'edit_image',
      model,
      tokensIn: 0, tokensOut: 0, cachedTokens: 0,
      costUsd: modelInfo.cost,
      markupPercent: editMarkup,
      chargedRub: await getChargedRub(modelInfo.cost, editMarkup),
      status: 'success',
      prompt: (prompt || '').slice(0, 2000),
      durationMs: Date.now() - start,
    },
  })
  if (params.userId) {
    const u = await db.user.findUnique({ where: { id: params.userId }, select: { role: true } })
    if (u) await chargeUser({ userId: params.userId, role: u.role, costUsd: modelInfo.cost, markupPercent: editMarkup, aiUsageLogId: editLog.id, description: 'edit_image' })
  }

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
  userId?: string
}

export async function removeBackground(params: RemoveBgParams): Promise<KieImageResult> {
  const start = Date.now()
  const { imageUrl, businessId, postId } = params
  const model = config.models.kieRemoveBg

  log.info('[KIE] removeBackground', { businessId })

  const srcPublicUrl = publicUrl(imageUrl)

  // POST to Jobs API
  const response = await kiePost('/api/v1/jobs/createTask', {
    model,
    input: { image: srcPublicUrl },
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

  const { url, thumbUrl, pngBuffer } = await downloadAndSave(outputUrl, businessId, 'kie_rembg')

  const mediaFile = await db.mediaFile.create({
    data: {
      businessId,
      postId: postId || null,
      filename: 'Без фона',
      url,
      thumbUrl,
      mimeType: 'image/png',
      sizeBytes: pngBuffer.length,
      aiModel: model,
      aiCostUsd: 0.01,
    },
  })

  const bgMarkup = await getMarkupPercent()
  const bgLog = await db.aiUsageLog.create({
    data: {
      businessId,
      userId: params.userId || null,
      action: 'remove_background',
      model,
      tokensIn: 0, tokensOut: 0, cachedTokens: 0,
      costUsd: 0.01,
      markupPercent: bgMarkup,
      chargedRub: await getChargedRub(0.01, bgMarkup),
      status: 'success',
      prompt: null,
      durationMs: Date.now() - start,
    },
  })
  if (params.userId) {
    const u = await db.user.findUnique({ where: { id: params.userId }, select: { role: true } })
    if (u) await chargeUser({ userId: params.userId, role: u.role, costUsd: 0.01, markupPercent: bgMarkup, aiUsageLogId: bgLog.id, description: 'remove_background' })
  }

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
  resolution?: '480p' | '720p' // Разрешение (влияет на стоимость)
  generateAudio?: boolean      // генерировать звук (Seedance 2 native audio)
  firstFrameUrl?: string | null  // URL первого кадра (image-to-video)
  lastFrameUrl?: string | null   // URL последнего кадра (interpolation)
  referenceImageUrls?: string[] // До 9 reference-изображений (multimodal)
  userId?: string
  model?: string               // модель KIE (опц.) — default seedance-2; невалидная → default
}

// Допустимые видео-модели KIE. UI может прислать выбор; невалидное значение → DEFAULT.
export const VIDEO_MODELS = ['bytedance/seedance-2'] as const
const DEFAULT_VIDEO_MODEL = 'bytedance/seedance-2'

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
): Promise<{ url: string; thumbUrl: string | null; videoBuffer: Buffer }> {
  const response = await fetch(videoUrl)
  if (!response.ok) throw new Error(`Ошибка загрузки видео с KIE CDN: ${response.status}`)
  const arrayBuffer = await response.arrayBuffer()
  const videoBuffer = Buffer.from(arrayBuffer)

  const fileId = nanoid(12)
  const storage = getStorage()
  const videoKey = makeKey(businessId, `${prefix}_${fileId}.mp4`)
  const saved = await storage.put(videoKey, videoBuffer, { contentType: 'video/mp4' })

  // Превью первого кадра: ffmpeg работает только с файлами на диске. Материализуем
  // НЕ объект хранилища (это означало бы скачать только что залитое видео обратно),
  // а тот же буфер, который у нас уже в руках после загрузки с CDN.
  const { extractVideoThumbnail } = await import('../../utils/video-thumbnail')
  const thumbUrl = await withTempDir(async (dir) => {
    const videoPath = join(dir, `${prefix}_${fileId}.mp4`)
    await writeStreamedFile(videoPath, videoBuffer)
    const thumbFile = await extractVideoThumbnail(videoPath, dir, `${prefix}_${fileId}`)
    if (!thumbFile) return null
    const savedThumb = await storage.putFromLocalFile(
      makeKey(businessId, thumbFile),
      join(dir, thumbFile),
      { contentType: 'image/webp' },
    )
    return savedThumb.url
  }, { estimatedBytes: videoBuffer.length })

  return { url: saved.url, thumbUrl, videoBuffer }
}

// =====================
// Async Video Generation — Step 1: Create task (fast, 2-5 sec)
// =====================

export interface CreateVideoTaskResult {
  kieTaskId: string
  translatedPrompt: string
  costUsd: number
  model: string
}

export async function createVideoTask(params: GenerateVideoParams): Promise<CreateVideoTaskResult> {
  const { prompt: rawPrompt, businessId, duration = 5, aspectRatio = '9:16', resolution = '720p', generateAudio = true, firstFrameUrl, lastFrameUrl, referenceImageUrls } = params
  const model = params.model && (VIDEO_MODELS as readonly string[]).includes(params.model)
    ? params.model
    : DEFAULT_VIDEO_MODEL

  const hasImageInput = !!firstFrameUrl || (referenceImageUrls && referenceImageUrls.length > 0)
  const PRICING: Record<string, { withImage: number; textOnly: number }> = {
    '480p': { withImage: 11.5, textOnly: 19 },
    '720p': { withImage: 25,   textOnly: 41 },
  }
  const tier = PRICING[resolution] || PRICING['720p']
  const creditsPerSec = hasImageInput ? tier.withImage : tier.textOnly
  const audioMultiplier = generateAudio ? 2.0 : 1.0
  const costUsd = creditsPerSec * duration * 0.005 * audioMultiplier

  const prompt = await translatePrompt(rawPrompt, businessId, params.userId)

  log.info('[KIE] createVideoTask', { businessId, model, duration, prompt: prompt.slice(0, 80) })

  const input: any = {
    prompt, duration,
    aspect_ratio: aspectRatio,
    resolution: resolution || '720p',
    output_format: 'mp4',
    generate_audio: generateAudio,
  }

  if (referenceImageUrls && referenceImageUrls.length > 0) {
    input.reference_image_urls = referenceImageUrls.map(u => publicUrl(u))
  } else if (firstFrameUrl) {
    input.first_frame_url = publicUrl(firstFrameUrl)
    if (lastFrameUrl) input.last_frame_url = publicUrl(lastFrameUrl)
  }

  const response = await kiePost('/api/v1/jobs/createTask', { model, input })
  const kieTaskId = response?.data?.taskId || response?.taskId
  if (!kieTaskId) throw new Error('KIE.ai не вернул taskId для видео')

  log.info('[KIE] task created', { kieTaskId })
  return { kieTaskId, translatedPrompt: prompt, costUsd, model }
}

// =====================
// Async Video Generation — Step 2: Check result + download (called by poller)
// =====================

/** Check KIE task status. Returns 'pending' | 'success' | 'fail' */
export async function checkVideoTaskStatus(kieTaskId: string): Promise<{ state: string; data?: any }> {
  const result = await kieGet(`/api/v1/jobs/recordInfo?taskId=${kieTaskId}`)
  const d = result?.data || result
  const state = d?.state || d?.status || 'pending'
  return { state, data: d }
}

/** Download completed video, save to disk, create MediaFile + AiUsageLog */
export async function processVideoTaskResult(
  kieData: any,
  params: { businessId: string; postId?: string | null; prompt: string; duration: number; costUsd: number; model: string; userId?: string },
): Promise<{ mediaFileId: string; resultUrl: string }> {
  let outputUrl: string | undefined
  if (kieData?.resultJson) {
    try {
      const parsed = typeof kieData.resultJson === 'string' ? JSON.parse(kieData.resultJson) : kieData.resultJson
      outputUrl = parsed?.resultUrls?.[0] || parsed?.resultVideoUrl || parsed?.resultImageUrl
    } catch {}
  }
  if (!outputUrl) {
    outputUrl = kieData?.resultVideoUrl || kieData?.resultImageUrl || kieData?.video_url || kieData?.output?.video_url
  }
  if (!outputUrl) throw new Error('KIE.ai не вернул видео URL')

  const { url, thumbUrl, videoBuffer } = await downloadAndSaveVideo(outputUrl, params.businessId, 'kie_video')

  const mediaFile = await db.mediaFile.create({
    data: {
      businessId: params.businessId,
      postId: params.postId || null,
      filename: `AI Video: ${params.prompt.slice(0, 50).replace(/[\r\n\t]/g, ' ')}`,
      url,
      thumbUrl,
      mimeType: 'video/mp4',
      sizeBytes: videoBuffer.length,
      durationSec: params.duration,
      altText: params.prompt,
      aiModel: params.model,
      aiCostUsd: params.costUsd,
    },
  })

  const vidMarkup = await getMarkupPercent()
  const vidLog = await db.aiUsageLog.create({
    data: {
      businessId: params.businessId,
      userId: params.userId || null,
      action: 'generate_video',
      model: params.model,
      tokensIn: 0, tokensOut: 0, cachedTokens: 0,
      costUsd: params.costUsd,
      markupPercent: vidMarkup,
      chargedRub: await getChargedRub(params.costUsd, vidMarkup),
      status: 'success',
      prompt: (params.prompt || '').slice(0, 2000),
      durationMs: null,
    },
  })
  if (params.userId) {
    const u = await db.user.findUnique({ where: { id: params.userId }, select: { role: true } })
    if (u) await chargeUser({ userId: params.userId, role: u.role, costUsd: params.costUsd, markupPercent: vidMarkup, aiUsageLogId: vidLog.id, description: 'generate_video' })
  }

  log.info('[KIE] video saved', { businessId: params.businessId, mediaId: mediaFile.id })
  return { mediaFileId: mediaFile.id, resultUrl: mediaFile.url }
}

// =====================
// Async Photo Generation (Photo Studio)
// =====================

export interface CreatePhotoTaskResult {
  kieTaskId: string
  translatedPrompt: string
  costUsd: number
  model: string
}

export async function createPhotoTask(params: {
  prompt: string
  businessId: string
  model?: string           // 'nano-banana-2' | 'nano-banana-pro' | 'gpt-image-2'
  resolution?: string      // '1K' | '2K' | '4K'
  aspectRatio?: string     // '1:1' | '2:3' | '3:2' | '3:4' | '4:3' | '4:5' | '5:4' | '9:16' | '16:9' | '21:9'
  characterId?: string | null
  referenceImageUrls?: string[]  // Direct reference images (up to 14 for NB2, 8 for Pro, 16 for GPT)
  userId?: string
}): Promise<CreatePhotoTaskResult> {
  const { prompt: rawPrompt, businessId, model = 'nano-banana-2', resolution = '2K', aspectRatio = '1:1', characterId, referenceImageUrls } = params

  const pricing = PHOTO_PRICING[model] || PHOTO_PRICING['nano-banana-2']
  const costUsd = pricing[resolution] || pricing['2K']

  // Enrich prompt with character context (reuse pattern from generateImage)
  let enrichedPrompt = rawPrompt
  let referenceImageUrl: string | undefined

  if (characterId) {
    const character = await db.character.findUnique({
      where: { id: characterId },
      include: { referenceMedia: { select: { url: true } } },
    })
    if (character) {
      const charContext = character.description
        ? `${character.name} (${character.description})`
        : character.name
      enrichedPrompt = `${rawPrompt}. Главный персонаж: ${charContext}`
      if (character.style) enrichedPrompt += `. Стиль: ${character.style}`

      if (character.referenceMedia?.url) {
        referenceImageUrl = publicUrl(character.referenceMedia.url)
      }
    }
  }

  // Auto-translate to English for better quality
  const prompt = await translatePrompt(enrichedPrompt, businessId, params.userId)

  const isGptImage = model === 'gpt-image-2'

  log.info('[KIE] createPhotoTask', { businessId, model, resolution, aspectRatio, prompt: prompt.slice(0, 80) })

  // Collect all reference images: character + direct refs
  const allRefs: string[] = []
  if (referenceImageUrl) allRefs.push(referenceImageUrl)
  if (referenceImageUrls?.length) {
    const maxRefs = isGptImage ? 16 : model === 'nano-banana-pro' ? 8 : 14
    for (const url of referenceImageUrls.slice(0, maxRefs)) {
      allRefs.push(publicUrl(url))
    }
  }

  // GPT Image 2 uses different model names and input_urls instead of image_input
  const kieModel = isGptImage
    ? (allRefs.length > 0 ? 'gpt-image-2-image-to-image' : 'gpt-image-2-text-to-image')
    : model

  const input: any = {
    prompt,
    aspect_ratio: aspectRatio,
    resolution: resolution,
  }

  if (!isGptImage) {
    input.output_format = 'png'
  }

  if (allRefs.length > 0) {
    if (isGptImage) {
      input.input_urls = allRefs
    } else {
      input.image_input = allRefs
    }
  }

  const response = await kiePost('/api/v1/jobs/createTask', { model: kieModel, input })
  const kieTaskId = response?.data?.taskId || response?.taskId
  if (!kieTaskId) throw new Error('KIE.ai не вернул taskId для фото')

  log.info('[KIE] photo task created', { kieTaskId, costUsd, refCount: allRefs.length })
  return { kieTaskId, translatedPrompt: prompt, costUsd, model }
}

/** Check photo task status (same as video — uses Jobs API) */
export async function checkPhotoTaskStatus(kieTaskId: string): Promise<{ state: string; data?: any }> {
  const result = await kieGet(`/api/v1/jobs/recordInfo?taskId=${kieTaskId}`)
  const d = result?.data || result
  const state = d?.state || d?.status || 'pending'
  return { state, data: d }
}

/** Download completed photo, save to disk, create MediaFile + AiUsageLog */
export async function processPhotoTaskResult(
  kieData: any,
  params: { businessId: string; prompt: string; costUsd: number; model: string; userId?: string },
): Promise<{ mediaFileId: string; resultUrl: string; thumbUrl: string | null }> {
  let outputUrl: string | undefined
  if (kieData?.resultJson) {
    try {
      const parsed = typeof kieData.resultJson === 'string' ? JSON.parse(kieData.resultJson) : kieData.resultJson
      outputUrl = parsed?.resultUrls?.[0] || parsed?.resultImageUrl
    } catch {}
  }
  if (!outputUrl) {
    outputUrl = kieData?.resultImageUrl || kieData?.image_url || kieData?.output?.image_url
  }
  if (!outputUrl) throw new Error('KIE.ai не вернул изображение')

  const { url, thumbUrl, pngBuffer } = await downloadAndSave(outputUrl, params.businessId, 'kie_photo')

  const mediaFile = await db.mediaFile.create({
    data: {
      businessId: params.businessId,
      filename: `AI Photo: ${params.prompt.slice(0, 50).replace(/[\r\n\t]/g, ' ')}`,
      url,
      thumbUrl,
      mimeType: 'image/png',
      sizeBytes: pngBuffer.length,
      altText: params.prompt,
      aiModel: params.model,
      aiCostUsd: params.costUsd,
    },
  })

  const markup = await getMarkupPercent()
  const photoLog = await db.aiUsageLog.create({
    data: {
      businessId: params.businessId,
      userId: params.userId || null,
      action: 'generate_photo',
      model: params.model,
      tokensIn: 0, tokensOut: 0, cachedTokens: 0,
      costUsd: params.costUsd,
      markupPercent: markup,
      chargedRub: await getChargedRub(params.costUsd, markup),
      status: 'success',
      prompt: (params.prompt || '').slice(0, 2000),
      durationMs: null,
    },
  })
  if (params.userId) {
    const u = await db.user.findUnique({ where: { id: params.userId }, select: { role: true } })
    if (u) await chargeUser({ userId: params.userId, role: u.role, costUsd: params.costUsd, markupPercent: markup, aiUsageLogId: photoLog.id, description: 'generate_photo' })
  }

  log.info('[KIE] photo saved', { businessId: params.businessId, mediaId: mediaFile.id })
  return { mediaFileId: mediaFile.id, resultUrl: mediaFile.url, thumbUrl: mediaFile.thumbUrl }
}

// Legacy sync wrapper (kept for generateImage compatibility)
export async function generateVideo(params: GenerateVideoParams): Promise<GenerateVideoResult> {
  const task = await createVideoTask(params)
  const result = await pollTask(task.kieTaskId, 120, 5000)
  const { mediaFileId, resultUrl } = await processVideoTaskResult(result, {
    businessId: params.businessId,
    postId: params.postId,
    prompt: task.translatedPrompt,
    duration: params.duration || 5,
    costUsd: task.costUsd,
    model: task.model,
    userId: params.userId,
  })
  const mediaFile = await db.mediaFile.findUniqueOrThrow({ where: { id: mediaFileId } })
  return {
    mediaFile: {
      id: mediaFile.id, url: mediaFile.url, thumbUrl: mediaFile.thumbUrl,
      filename: mediaFile.filename, mimeType: mediaFile.mimeType,
      sizeBytes: mediaFile.sizeBytes, durationSec: mediaFile.durationSec,
    },
    usage: { tokensIn: 0, tokensOut: 0, model: task.model },
  }
}
