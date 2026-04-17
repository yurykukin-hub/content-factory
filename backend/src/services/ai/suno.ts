/**
 * Suno AI music generation via KIE.ai API.
 *
 * Async pattern: createMusicTask() returns quickly with kieTaskId,
 * generation-poller.ts handles polling + download + billing.
 *
 * API v2 (April 2026): KIE.ai updated endpoints and model names.
 * - Endpoint: POST /api/v1/generate (was /api/v1/jobs/createTask)
 * - Status:   GET /api/v1/generate/record-info (was /api/v1/jobs/recordInfo)
 * - Models:   V4, V4_5, V5_5 (was suno/v4, suno/v4.5, suno/v5.5)
 * - Payload:  top-level params, callBackUrl required (was input wrapper)
 * - Response: sunoData[] array with 2 variants (was resultJson)
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

/** Callback URL for KIE.ai (required by new API, we still use polling) */
const CALLBACK_URL = 'https://content.yurykukin.ru/api/webhooks/kie'

/**
 * Model name mapping: old format → new KIE.ai format.
 * Keeps backward compat with existing sessions that stored old names.
 */
const MODEL_MAP: Record<string, string> = {
  // Old format → new
  'suno/v4': 'V4',
  'suno/v4.5': 'V4_5',
  'suno/v5.5': 'V5_5',
  // New format passthrough
  'V3_5': 'V3_5',
  'V4': 'V4',
  'V4_5': 'V4_5',
  'V4_5PLUS': 'V4_5PLUS',
  'V5': 'V5',
  'V5_5': 'V5_5',
}

function resolveModel(sunoModel: string): string {
  return MODEL_MAP[sunoModel] || 'V4_5'
}

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
  sunoModel?: string          // "V4" | "V4_5" | "V5_5" (or legacy "suno/v4" etc.)
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
    sunoModel = 'V4_5', personaId,
    businessId,
  } = params

  const model = resolveModel(sunoModel)

  log.info('[Suno] createMusicTask', {
    businessId, model, customMode, instrumental,
    prompt: prompt.slice(0, 80),
  })

  // New KIE.ai API v2: top-level params (no input wrapper)
  const body: Record<string, any> = {
    model,
    prompt,
    customMode,
    instrumental,
    callBackUrl: CALLBACK_URL,
  }

  // Custom mode: add extended parameters
  if (customMode) {
    if (style) body.style = style.slice(0, 1000)
    if (title) body.title = title.slice(0, 80)
    if (negativeTags) body.negativeTags = negativeTags
    if (vocalGender) body.vocalGender = vocalGender
    if (styleWeight !== undefined && styleWeight !== null) {
      body.styleWeight = Math.max(0, Math.min(1, styleWeight))
    }
    if (weirdnessConstraint !== undefined && weirdnessConstraint !== null) {
      body.weirdnessConstraint = Math.max(0, Math.min(1, weirdnessConstraint))
    }
    if (audioWeight !== undefined && audioWeight !== null) {
      body.audioWeight = Math.max(0, Math.min(1, audioWeight))
    }
  }

  // Voice persona (V5.5 voice clone)
  if (personaId) {
    body.personaId = personaId
  }

  const response = await kiePost('/api/v1/generate', body)
  const kieTaskId = response?.data?.taskId || response?.taskId
  if (!kieTaskId) throw new Error('KIE.ai не вернул taskId для музыки')

  log.info('[Suno] task created', { kieTaskId, model })
  return { kieTaskId, costUsd: MUSIC_COST_USD, model }
}

// =====================
// Check Music Task Status (called by poller)
// =====================

export async function checkMusicTaskStatus(kieTaskId: string): Promise<{ state: string; data?: any }> {
  // New KIE.ai API v2 endpoint
  const result = await kieGet(`/api/v1/generate/record-info?taskId=${kieTaskId}`)
  const d = result?.data || result

  // Normalize status: KIE v2 uses uppercase (PENDING, FIRST_SUCCESS, SUCCESS, FAILURE)
  const rawStatus = (d?.status || d?.state || 'PENDING').toUpperCase()
  let state = 'pending'
  if (rawStatus === 'SUCCESS' || rawStatus === 'FIRST_SUCCESS') state = 'success'
  else if (rawStatus === 'FAILURE' || rawStatus === 'FAILED') state = 'fail'

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

export interface MusicTrackResult {
  mediaFileId: string
  audioUrl: string
  coverImageUrl: string | null
  kieAudioId?: string
  title?: string
  duration?: number
}

/** Download audio + cover, create MediaFile + AiUsageLog, charge user.
 *  Also downloads second variant if available (stored in extraTracks). */
export async function processMusicTaskResult(
  kieData: any,
  params: ProcessMusicResultParams,
): Promise<MusicTrackResult & { extraTracks: MusicTrackResult[] }> {
  // Extract URLs from KIE response — new API v2 format (sunoData array)
  let audioOutputUrl: string | undefined
  let imageOutputUrl: string | undefined
  let extractedAudioId: string | undefined
  let trackTitle: string | undefined
  let trackDuration: number | undefined

  // Collect ALL variants from sunoData for multi-track support
  const sunoData = kieData?.response?.sunoData
  const allVariants: Array<{ audioUrl: string; imageUrl?: string; id?: string; title?: string; duration?: number }> = []

  if (Array.isArray(sunoData) && sunoData.length > 0) {
    for (const t of sunoData) {
      const url = t.audioUrl || t.sourceAudioUrl
      if (url) {
        allVariants.push({
          audioUrl: url,
          imageUrl: t.imageUrl || t.sourceImageUrl,
          id: t.id,
          title: t.title,
          duration: t.duration ? Math.round(t.duration) : undefined,
        })
      }
    }
    // Primary track = first variant
    if (allVariants.length > 0) {
      audioOutputUrl = allVariants[0].audioUrl
      imageOutputUrl = allVariants[0].imageUrl
      extractedAudioId = allVariants[0].id
      trackTitle = allVariants[0].title
      trackDuration = allVariants[0].duration
    }
  }

  // Fallback: old format (resultJson) for backward compat with existing tasks
  if (!audioOutputUrl && kieData?.resultJson) {
    try {
      const parsed = typeof kieData.resultJson === 'string'
        ? JSON.parse(kieData.resultJson)
        : kieData.resultJson
      audioOutputUrl = parsed?.audio_url || parsed?.resultUrls?.[0]
      imageOutputUrl = parsed?.image_url
      extractedAudioId = parsed?.audioId || parsed?.audio_id || parsed?.id
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

  // Download second variant (if available) — best effort, no billing
  const extraTracks: MusicTrackResult[] = []
  for (let i = 1; i < allVariants.length; i++) {
    try {
      const v = allVariants[i]
      const { filename: extraAudioFile, audioBuffer: extraBuf } = await downloadAudio(v.audioUrl, params.businessId)
      let extraCoverFile: string | null = null
      if (v.imageUrl) {
        const c = await downloadCoverImage(v.imageUrl, params.businessId)
        if (c) extraCoverFile = c.filename
      }
      const extraName = params.title
        ? `AI Music: ${params.title.slice(0, 45)} (${i + 1})`
        : `AI Music: ${params.prompt.slice(0, 45).replace(/[\r\n\t]/g, ' ')} (${i + 1})`
      const extraMedia = await db.mediaFile.create({
        data: {
          businessId: params.businessId,
          filename: extraName,
          url: `/uploads/${params.businessId}/${extraAudioFile}`,
          thumbUrl: extraCoverFile ? `/uploads/${params.businessId}/${extraCoverFile}` : null,
          mimeType: 'audio/mpeg',
          sizeBytes: extraBuf.length,
          altText: params.prompt.slice(0, 500),
          aiModel: params.model,
          aiCostUsd: 0, // no extra charge for second variant
        },
      })
      extraTracks.push({
        mediaFileId: extraMedia.id,
        audioUrl: `/uploads/${params.businessId}/${extraAudioFile}`,
        coverImageUrl: extraCoverFile ? `/uploads/${params.businessId}/${extraCoverFile}` : null,
        kieAudioId: v.id,
        title: v.title,
        duration: v.duration,
      })
      log.info('[Suno] extra track saved', { businessId: params.businessId, variant: i + 1 })
    } catch (err: any) {
      log.warn('[Suno] extra track download failed', { variant: i + 1, error: err.message })
    }
  }

  log.info('[Suno] music saved', { businessId: params.businessId, mediaId: mediaFile.id, extraTracks: extraTracks.length })
  return {
    mediaFileId: mediaFile.id, audioUrl: localAudioUrl, coverImageUrl: localCoverUrl,
    kieAudioId: extractedAudioId, title: trackTitle, duration: trackDuration,
    extraTracks,
  }
}

// =====================
// Generate Persona (Voice Clone via Suno V5.5)
// =====================

export interface GeneratePersonaParams {
  taskId: string        // completedTaskId from GenerationSession
  audioId: string       // kieAudioId from GenerationSession
  name: string          // persona name, e.g. "Female Indie Vocal"
  description: string   // detailed voice description
  vocalStart?: number   // start of vocal segment (sec), default 0
  vocalEnd?: number     // end of vocal segment (sec), default 30
  style?: string        // style tags
}

export interface GeneratePersonaResult {
  personaId: string
  name: string
  description: string
}

/**
 * Create a voice persona from a completed music track.
 * Requires: taskId + audioId from a completed Suno generation (V4+).
 * Vocal segment must be 10-30 seconds.
 */
export async function generatePersona(params: GeneratePersonaParams): Promise<GeneratePersonaResult> {
  const {
    taskId, audioId, name, description,
    vocalStart = 0, vocalEnd = 30, style,
  } = params

  // Validate vocal segment length (10-30 sec required by API)
  const segmentLength = vocalEnd - vocalStart
  if (segmentLength < 10 || segmentLength > 30) {
    throw new Error(`Вокальный сегмент должен быть 10-30 секунд (текущий: ${segmentLength}с)`)
  }

  log.info('[Suno] generatePersona', { taskId, audioId, name, vocalStart, vocalEnd })

  const body: Record<string, any> = {
    taskId,
    audioId,
    name,
    description,
    vocalStart,
    vocalEnd,
  }
  if (style) body.style = style

  const response = await kiePost('/api/v1/generate/generate-persona', body)

  const personaId = response?.data?.personaId
  if (!personaId) {
    throw new Error('KIE.ai не вернул personaId. Возможно, из этого трека уже создана персона.')
  }

  log.info('[Suno] persona created', { personaId, name })
  return {
    personaId,
    name: response.data.name || name,
    description: response.data.description || description,
  }
}
