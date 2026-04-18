/**
 * Composable for voice input via browser MediaRecorder + Whisper transcription.
 *
 * Usage:
 *   const { recording, transcribing, elapsedSeconds, isSupported, toggleRecording } = useVoiceInput()
 *   const text = await toggleRecording() // start or stop recording
 */

import { ref, computed, onBeforeUnmount } from 'vue'
import { TAB_ID } from '../api/client'

const MAX_RECORDING_SEC = 120
const MIN_RECORDING_SEC = 0.5

/** Detect best supported audio MIME type */
function getSupportedMimeType(): string {
  if (typeof MediaRecorder === 'undefined') return 'audio/webm'
  const types = [
    'audio/webm;codecs=opus',
    'audio/webm',
    'audio/mp4',
    'audio/ogg;codecs=opus',
  ]
  for (const type of types) {
    if (MediaRecorder.isTypeSupported(type)) return type
  }
  return 'audio/webm'
}

export function useVoiceInput() {
  const recording = ref(false)
  const transcribing = ref(false)
  const elapsedSeconds = ref(0)
  const error = ref<string | null>(null)

  const isSupported = computed(() =>
    typeof navigator !== 'undefined' &&
    !!navigator.mediaDevices?.getUserMedia &&
    typeof MediaRecorder !== 'undefined',
  )

  let mediaRecorder: MediaRecorder | null = null
  let audioChunks: Blob[] = []
  let stream: MediaStream | null = null
  let timerInterval: ReturnType<typeof setInterval> | null = null
  let recordingStartTime = 0

  function cleanup() {
    if (timerInterval) {
      clearInterval(timerInterval)
      timerInterval = null
    }
    if (stream) {
      stream.getTracks().forEach(t => t.stop())
      stream = null
    }
    mediaRecorder = null
    audioChunks = []
  }

  async function startRecording(): Promise<void> {
    error.value = null

    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true })
    } catch (err: any) {
      if (err.name === 'NotAllowedError' || err.name === 'PermissionDeniedError') {
        error.value = 'Разрешите доступ к микрофону в настройках браузера'
      } else {
        error.value = 'Не удалось получить доступ к микрофону'
      }
      throw new Error(error.value)
    }

    const mimeType = getSupportedMimeType()
    audioChunks = []

    mediaRecorder = new MediaRecorder(stream, { mimeType })
    mediaRecorder.ondataavailable = (e) => {
      if (e.data.size > 0) audioChunks.push(e.data)
    }

    mediaRecorder.start(250) // collect chunks every 250ms
    recording.value = true
    recordingStartTime = Date.now()
    elapsedSeconds.value = 0

    timerInterval = setInterval(() => {
      elapsedSeconds.value = Math.floor((Date.now() - recordingStartTime) / 1000)
      if (elapsedSeconds.value >= MAX_RECORDING_SEC) {
        // Auto-stop after max duration
        stopRecording().catch(() => {})
      }
    }, 200)
  }

  async function stopRecording(): Promise<string> {
    if (!mediaRecorder || mediaRecorder.state === 'inactive') {
      cleanup()
      recording.value = false
      return ''
    }

    return new Promise<string>((resolve, reject) => {
      mediaRecorder!.onstop = async () => {
        recording.value = false
        const duration = (Date.now() - recordingStartTime) / 1000

        if (timerInterval) {
          clearInterval(timerInterval)
          timerInterval = null
        }

        // Release mic
        if (stream) {
          stream.getTracks().forEach(t => t.stop())
          stream = null
        }

        if (duration < MIN_RECORDING_SEC) {
          error.value = 'Запись слишком короткая'
          cleanup()
          resolve('')
          return
        }

        const mimeType = getSupportedMimeType()
        const audioBlob = new Blob(audioChunks, { type: mimeType })
        audioChunks = []
        mediaRecorder = null

        // Send to backend
        transcribing.value = true
        error.value = null

        try {
          const formData = new FormData()
          const ext = mimeType.includes('mp4') ? 'mp4' : mimeType.includes('ogg') ? 'ogg' : 'webm'
          formData.append('file', audioBlob, `voice.${ext}`)

          const res = await fetch('/api/ai/transcribe', {
            method: 'POST',
            credentials: 'include',
            headers: { 'X-Tab-ID': TAB_ID },
            body: formData,
          })

          if (!res.ok) {
            const data = await res.json().catch(() => ({ error: 'Transcription failed' }))
            throw new Error(data.error || `HTTP ${res.status}`)
          }

          const data = await res.json() as { text: string }
          resolve(data.text || '')
        } catch (err: any) {
          error.value = err.message || 'Ошибка транскрипции'
          reject(err)
        } finally {
          transcribing.value = false
        }
      }

      mediaRecorder!.stop()
    })
  }

  /**
   * Toggle: start recording → return void, stop recording → return transcribed text.
   * Returns empty string if recording was too short or no speech detected.
   */
  async function toggleRecording(): Promise<string | void> {
    if (recording.value) {
      return stopRecording()
    }
    return startRecording()
  }

  onBeforeUnmount(() => {
    cleanup()
    recording.value = false
    transcribing.value = false
  })

  return {
    recording,
    transcribing,
    elapsedSeconds,
    error,
    isSupported,
    toggleRecording,
  }
}
