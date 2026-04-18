/**
 * OpenAI Whisper transcription service.
 *
 * API key: AppConfig `openai_api_key` (DB) → .env OPENAI_API_KEY fallback.
 * Model: whisper-1, language: ru, response_format: verbose_json (for duration).
 * Cost: ~$0.006/min.
 */

import { config } from '../../config'
import { db } from '../../db'

/** Get OpenAI API key: DB first, then .env fallback */
export async function getOpenAiKey(): Promise<string> {
  try {
    const row = await db.appConfig.findUnique({ where: { key: 'openai_api_key' } })
    if (row?.value) return row.value
  } catch {
    console.warn('[Whisper] Failed to read API key from DB, using env fallback')
  }
  return config.OPENAI_API_KEY
}

/** Check if Whisper is available (API key configured) */
export async function isWhisperAvailable(): Promise<boolean> {
  const key = await getOpenAiKey()
  return !!key
}

interface TranscribeResult {
  text: string
  durationSeconds: number
  costUsd: number
}

/**
 * Transcribe audio via OpenAI Whisper API.
 *
 * @param audioBuffer - raw audio bytes
 * @param mimeType - e.g. 'audio/webm', 'audio/mp4', 'audio/ogg'
 * @param filename - original filename for the FormData blob
 */
export async function transcribeAudio(
  audioBuffer: ArrayBuffer,
  mimeType: string,
  filename = 'voice.webm',
): Promise<TranscribeResult> {
  const apiKey = await getOpenAiKey()
  if (!apiKey) {
    throw new Error('OPENAI_API_KEY not configured — voice transcription unavailable')
  }

  const formData = new FormData()
  formData.append('file', new Blob([audioBuffer], { type: mimeType }), filename)
  formData.append('model', 'whisper-1')
  formData.append('language', 'ru')
  formData.append('response_format', 'verbose_json')

  const response = await fetch('https://api.openai.com/v1/audio/transcriptions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}` },
    body: formData,
  })

  if (!response.ok) {
    const errText = await response.text().catch(() => 'Unknown error')
    throw new Error(`Whisper API error ${response.status}: ${errText}`)
  }

  const data = await response.json() as { text: string; duration?: number }
  const durationSeconds = data.duration ?? 0
  const costUsd = (durationSeconds / 60) * 0.006

  return {
    text: data.text?.trim() || '',
    durationSeconds,
    costUsd,
  }
}
