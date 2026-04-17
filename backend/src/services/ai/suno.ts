/**
 * Suno AI music generation via KIE.ai API.
 *
 * Async pattern: createMusicTask() returns quickly with kieTaskId,
 * generation-poller.ts handles polling + download + billing.
 */

import { config } from '../../config'
import { db } from '../../db'
import { getMarkupPercent, calculateChargedRub, chargeUser } from '../billing'
import { nanoid } from 'nanoid'
import { join } from 'path'
import { mkdir } from 'fs/promises'
import { getModuleDir } from '../../utils/paths'
import { log } from '../../utils/logger'

const UPLOAD_DIR = join(getModuleDir(import.meta), '../../../uploads')
const KIE_BASE = 'https://api.kie.ai'

/** Fixed cost per song via KIE.ai (~8 credits) */
const MUSIC_COST_USD = 0.11

// --- KIE.ai REST helpers (same as kie.ts) ---

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

// =====================
// Create Music Task (async, returns quickly with kieTaskId)
// =====================

export interface CreateMusicTaskParams {
  prompt: string              // description (Simple) or lyrics (Custom)
  customMode: boolean
  instrumental: boolean
  style?: string              // "indie rock, melancholic, 120 bpm" (up to 1000 chars)
  title?: string              // song title (up to 80 chars)
  negativeTags?: string       // "metal, screaming" — exclude these styles
  vocalGender?: 'f' | 'm'
  styleWeight?: number        // 0-1, how strongly style influences result
  weirdnessConstraint?: number // 0-1, creativity/weirdness
  audioWeight?: number        // 0-1, influence of audio characteristics
  sunoModel?: string          // "suno/v4" | "suno/v4.5" | "suno/v5.5"
  personaId?: string          // Suno persona ID for voice clone (V5.5)
  businessId: string
  userId?: string
}

export interface CreateMusicTaskResult {
  kieTaskId: string
  costUsd: number
  model: string
}

export async function createMusicTask(params: CreateMusicTaskParams): Promise<CreateMusicTaskResult> {
  const {
    prompt, customMode, instrumental,
    style, title, negativeTags, vocalGender,
    styleWeight, weirdnessConstraint, audioWeight,
    sunoModel = 'suno/v4.5', personaId,
    businessId,
  } = params

  const model = sunoModel

  log.info('[Suno] createMusicTask', {
    businessId, model, customMode, instrumental,
    prompt: prompt.slice(0, 80),
  })

  const input: Record<string, any> = {
    prompt,
    customMode,
    instrumental,
  }

  // Custom mode: add extended parameters
  if (customMode) {
    if (style) input.style = style.slice(0, 1000)
    if (title) input.title = title.slice(0, 80)
    if (negativeTags) input.negativeTags = negativeTags
    if (vocalGender) input.vocalGender = vocalGender
    if (styleWeight !== undefined && styleWeight !== null) {
      input.styleWeight = Math.max(0, Math.min(1, styleWeight))
    }
    if (weirdnessConstraint !== undefined && weirdnessConstraint !== null) {
      input.weirdnessConstraint = Math.max(0, Math.min(1, weirdnessConstraint))
    }
    if (audioWeight !== undefined && audioWeight !== null) {
      input.audioWeight = Math.max(0, Math.min(1, audioWeight))
    }
  }

  // Voice persona (V5.5 voice clone)
  if (personaId) {
    input.personaId = personaId
  }

  const response = await kiePost('/api/v1/jobs/createTask', { model, input })
  const kieTaskId = response?.data?.taskId || response?.taskId
  if (!kieTaskId) throw new Error('KIE.ai не вернул taskId для музыки')

  log.info('[Suno] task created', { kieTaskId, model })
  return { kieTaskId, costUsd: MUSIC_COST_USD, model }
}

// =====================
// Check Music Task Status (called by poller)
// =====================

export async function checkMusicTaskStatus(kieTaskId: string): Promise<{ state: string; data?: any }> {
  const result = await kieGet(`/api/v1/jobs/recordInfo?taskId=${kieTaskId}`)
  const d = result?.data || result
  const state = d?.state || d?.status || 'pending'
  return { state, data: d }
}

// =====================
// Process Music Task Result (called by poller on success)
// =====================

/** Download audio from KIE CDN (URLs expire!) and save locally */
async function downloadAudio(
  audioUrl: string,
  businessId: string,
): Promise<{ filename: string; audioBuffer: Buffer }> {
  const response = await fetch(audioUrl)
  if (!response.ok) throw new Error(`Ошибка загрузки аудио с KIE CDN: ${response.status}`)
  const arrayBuffer = await response.arrayBuffer()
  const audioBuffer = Buffer.from(arrayBuffer)

  const fileId = nanoid(12)
  const filename = `suno_${fileId}.mp3`

  const bizDir = join(UPLOAD_DIR, businessId)
  await mkdir(bizDir, { recursive: true })
  await Bun.write(join(bizDir, filename), audioBuffer)

  return { filename, audioBuffer }
}

/** Download cover image from Suno (best-effort, optional) */
async function downloadCoverImage(
  imageUrl: string,
  businessId: string,
): Promise<{ filename: string } | null> {
  try {
    const response = await fetch(imageUrl)
    if (!response.ok) return null
    const arrayBuffer = await response.arrayBuffer()
    const imageBuffer = Buffer.from(arrayBuffer)

    const fileId = nanoid(12)
    const filename = `suno_cover_${fileId}.jpg`

    const bizDir = join(UPLOAD_DIR, businessId)
    await mkdir(bizDir, { recursive: true })
    await Bun.write(join(bizDir, filename), imageBuffer)

    return { filename }
  } catch {
    return null
  }
}

export interface ProcessMusicResultParams {
  businessId: string
  prompt: string
  costUsd: number
  model: string
  userId?: string
  title?: string
}

/** Download audio + cover, create MediaFile + AiUsageLog, charge user */
export async function processMusicTaskResult(
  kieData: any,
  params: ProcessMusicResultParams,
): Promise<{ mediaFileId: string; audioUrl: string; coverImageUrl: string | null }> {
  // Extract URLs from KIE response (multiple possible formats)
  let audioOutputUrl: string | undefined
  let imageOutputUrl: string | undefined

  if (kieData?.resultJson) {
    try {
      const parsed = typeof kieData.resultJson === 'string'
        ? JSON.parse(kieData.resultJson)
        : kieData.resultJson
      audioOutputUrl = parsed?.audio_url || parsed?.resultUrls?.[0]
      imageOutputUrl = parsed?.image_url
    } catch {}
  }
  if (!audioOutputUrl) {
    audioOutputUrl = kieData?.audio_url || kieData?.resultVideoUrl || kieData?.output?.audio_url
  }
  if (!imageOutputUrl) {
    imageOutputUrl = kieData?.image_url || kieData?.output?.image_url
  }
  if (!audioOutputUrl) throw new Error('KIE.ai не вернул audio URL')

  // Download audio immediately (CDN URLs expire in ~10 min)
  const { filename: audioFilename, audioBuffer } = await downloadAudio(audioOutputUrl, params.businessId)

  // Download cover image (optional, best-effort)
  let coverFilename: string | null = null
  if (imageOutputUrl) {
    const cover = await downloadCoverImage(imageOutputUrl, params.businessId)
    if (cover) coverFilename = cover.filename
  }

  // Create MediaFile for the audio track
  const displayName = params.title
    ? `AI Music: ${params.title.slice(0, 50)}`
    : `AI Music: ${params.prompt.slice(0, 50).replace(/[\r\n\t]/g, ' ')}`

  const mediaFile = await db.mediaFile.create({
    data: {
      businessId: params.businessId,
      filename: displayName,
      url: `/uploads/${params.businessId}/${audioFilename}`,
      thumbUrl: coverFilename ? `/uploads/${params.businessId}/${coverFilename}` : null,
      mimeType: 'audio/mpeg',
      sizeBytes: audioBuffer.length,
      altText: params.prompt.slice(0, 500),
      aiModel: params.model,
      aiCostUsd: params.costUsd,
    },
  })

  // Billing: create AiUsageLog + charge user
  const markup = await getMarkupPercent()
  const aiLog = await db.aiUsageLog.create({
    data: {
      businessId: params.businessId,
      userId: params.userId || null,
      action: 'generate_music',
      model: params.model,
      tokensIn: 0,
      tokensOut: 0,
      cachedTokens: 0,
      costUsd: params.costUsd,
      markupPercent: markup,
      chargedRub: calculateChargedRub(params.costUsd, markup),
      status: 'success',
      prompt: (params.prompt || '').slice(0, 2000),
      durationMs: null,
    },
  })

  if (params.userId) {
    const u = await db.user.findUnique({ where: { id: params.userId }, select: { role: true } })
    if (u) {
      await chargeUser({
        userId: params.userId,
        role: u.role,
        costUsd: params.costUsd,
        markupPercent: markup,
        aiUsageLogId: aiLog.id,
        description: 'generate_music',
      })
    }
  }

  const localAudioUrl = `/uploads/${params.businessId}/${audioFilename}`
  const localCoverUrl = coverFilename ? `/uploads/${params.businessId}/${coverFilename}` : null

  log.info('[Suno] music saved', { businessId: params.businessId, mediaId: mediaFile.id })
  return { mediaFileId: mediaFile.id, audioUrl: localAudioUrl, coverImageUrl: localCoverUrl }
}
