/**
 * Background generation poller — checks KIE.ai task status every 10 seconds.
 * Handles both video (Seedance 2) and music (Suno) tasks.
 *
 * Reads pending tasks from PostgreSQL (not memory) → survives restarts.
 * On success: downloads result, creates MediaFile, updates session, emits SSE.
 * On failure: marks session as failed, emits SSE.
 */

import { db } from '../db'
import { checkVideoTaskStatus, processVideoTaskResult } from './ai/kie'
import { checkMusicTaskStatus, processMusicTaskResult } from './ai/suno'
import { emitEvent } from '../eventBus'
import { log } from '../utils/logger'

const POLL_INTERVAL = 10_000   // 10 seconds
const TASK_TIMEOUT = 15 * 60 * 1000  // 15 minutes

async function pollPendingTasks() {
  // Find all sessions with active KIE tasks (both video and music)
  const sessions = await db.generationSession.findMany({
    where: {
      status: 'generating',
      kieTaskId: { not: null },
    },
  })

  if (!sessions.length) return

  // Check each task in parallel
  await Promise.allSettled(
    sessions.map(async (session) => {
      const isMusic = session.type === 'music'
      const logPrefix = isMusic ? '[MusicPoller]' : '[VideoPoller]'

      try {
        // Check task status (same KIE API for both types)
        const { state, data } = isMusic
          ? await checkMusicTaskStatus(session.kieTaskId!)
          : await checkVideoTaskStatus(session.kieTaskId!)

        if (state === 'success' || state === 'completed') {
          if (isMusic) {
            // Download audio + cover, create MediaFile, charge user
            const result = await processMusicTaskResult(data, {
              businessId: session.businessId,
              prompt: session.prompt || '',
              costUsd: session.costUsd || MUSIC_COST_DEFAULT,
              model: session.sunoModel || session.model,
              userId: session.userId || undefined,
              title: session.musicTitle || undefined,
            })

            // Use audioId extracted by processMusicTaskResult (new API v2 format)
            let kieAudioId = result.kieAudioId

            // Fallback: try extracting from raw KIE response
            if (!kieAudioId) {
              const sunoData = data?.response?.sunoData
              if (Array.isArray(sunoData) && sunoData.length > 0) {
                kieAudioId = sunoData.find((t: any) => t.audioUrl)?.id || sunoData[0]?.id
              }
            }
            // Legacy fallback
            if (!kieAudioId) {
              if (data?.resultJson) {
                try {
                  const parsed = typeof data.resultJson === 'string' ? JSON.parse(data.resultJson) : data.resultJson
                  kieAudioId = parsed?.audioId || parsed?.audio_id || parsed?.id
                } catch {}
              }
              if (!kieAudioId) kieAudioId = data?.audioId || data?.audio_id || data?.id
            }

            // Build results array with all variants (primary + extras)
            const allResults = [
              {
                resultUrl: result.audioUrl,
                coverImageUrl: result.coverImageUrl,
                mediaFileId: result.mediaFileId,
                kieAudioId: kieAudioId || null,
                title: result.title || session.musicTitle,
                duration: result.duration,
                costUsd: session.costUsd || MUSIC_COST_DEFAULT,
                createdAt: new Date().toISOString(),
              },
              ...result.extraTracks.map(t => ({
                resultUrl: t.audioUrl,
                coverImageUrl: t.coverImageUrl,
                mediaFileId: t.mediaFileId,
                kieAudioId: t.kieAudioId || null,
                title: t.title || session.musicTitle,
                duration: t.duration,
                costUsd: 0,
                createdAt: new Date().toISOString(),
              })),
            ]

            await db.generationSession.update({
              where: { id: session.id },
              data: {
                status: 'completed',
                audioUrl: result.audioUrl,
                coverImageUrl: result.coverImageUrl,
                mediaFileId: result.mediaFileId,
                resultUrl: result.audioUrl,
                completedTaskId: session.kieTaskId,  // preserve for Generate Persona
                kieAudioId: kieAudioId || null,
                kieTaskId: null,
                results: allResults,
              },
            })
          } else {
            // Download video + save to DB
            const { mediaFileId, resultUrl } = await processVideoTaskResult(data, {
              businessId: session.businessId,
              postId: null,
              prompt: session.prompt || '',
              duration: session.duration,
              costUsd: session.costUsd || 0,
              model: session.model,
              userId: session.userId || undefined,
            })

            await db.generationSession.update({
              where: { id: session.id },
              data: { status: 'completed', resultUrl, mediaFileId, kieTaskId: null },
            })
          }

          emitEvent({ type: 'session_updated', tabId: '', sessionId: session.id, status: 'completed' })
          log.info(`${logPrefix} completed`, { sessionId: session.id })

        } else if (state === 'fail' || state === 'failed') {
          const errMsg = data?.failMsg || data?.errorMessage || 'KIE.ai: генерация не удалась'
          await db.generationSession.update({
            where: { id: session.id },
            data: { status: 'failed', errorMessage: errMsg, kieTaskId: null },
          })
          emitEvent({ type: 'session_updated', tabId: '', sessionId: session.id, status: 'failed' })
          log.warn(`${logPrefix} failed`, { sessionId: session.id, error: errMsg })

        } else {
          // Still pending/processing — check timeout
          const age = session.kieTaskCreatedAt
            ? Date.now() - new Date(session.kieTaskCreatedAt).getTime()
            : 0
          if (age > TASK_TIMEOUT) {
            await db.generationSession.update({
              where: { id: session.id },
              data: { status: 'failed', errorMessage: 'Таймаут генерации (>15 мин)', kieTaskId: null },
            })
            emitEvent({ type: 'session_updated', tabId: '', sessionId: session.id, status: 'failed' })
            log.warn(`${logPrefix} timeout`, { sessionId: session.id })
          }
        }
      } catch (err: any) {
        // Network error or CDN expired — mark as failed
        log.error(`${logPrefix} error`, { sessionId: session.id, error: err.message })
        await db.generationSession.update({
          where: { id: session.id },
          data: { status: 'failed', errorMessage: `Ошибка: ${err.message?.slice(0, 200)}`, kieTaskId: null },
        }).catch(() => {})
        emitEvent({ type: 'session_updated', tabId: '', sessionId: session.id, status: 'failed' })
      }
    })
  )
}

const MUSIC_COST_DEFAULT = 0.11

// Keep old export name for backward compat (index.ts imports startVideoPoller)
export function startVideoPoller(): ReturnType<typeof setInterval> {
  log.info('[GenerationPoller] started (interval: 10s, types: video + music)')
  // Run immediately on startup to pick up tasks from before restart
  pollPendingTasks().catch(e => log.error('[GenerationPoller] initial poll error', { error: e.message }))
  // Then every 10 seconds
  return setInterval(() => {
    pollPendingTasks().catch(e => log.error('[GenerationPoller] poll error', { error: e.message }))
  }, POLL_INTERVAL)
}
