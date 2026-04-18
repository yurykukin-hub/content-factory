/**
 * Background generation poller — checks KIE.ai task status every 10 seconds.
 * Handles both video (Seedance 2) and music (Suno) tasks.
 *
 * Reads pending tasks from PostgreSQL (not memory) → survives restarts.
 * On success: downloads result, creates MediaFile, updates session, emits SSE.
 * On failure: marks session as failed, emits SSE.
 */

import { db } from '../db'
import { checkVideoTaskStatus, processVideoTaskResult, checkPhotoTaskStatus, processPhotoTaskResult } from './ai/kie'
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
      const isPhoto = session.type === 'photo'
      const logPrefix = isPhoto ? '[PhotoPoller]' : isMusic ? '[MusicPoller]' : '[VideoPoller]'

      try {
        // --- Photo batch handling ---
        if (isPhoto) {
          await pollPhotoSession(session)
          return
        }

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

            // Build new results — split cost evenly between all tracks
            const totalTracks = 1 + result.extraTracks.length
            const perTrackCost = (session.costUsd || MUSIC_COST_DEFAULT) / totalTracks
            const now = new Date().toISOString()

            // Snapshot generation params (frozen at generation time)
            const genSnapshot = {
              musicStyle: session.musicStyle || '',
              lyrics: session.lyrics || '',
              prompt: session.prompt || '',
              sunoModel: session.sunoModel || '',
              instrumental: session.instrumental ?? false,
              vocalGender: session.vocalGender || null,
            }

            const newResults = [
              {
                resultUrl: result.audioUrl,
                coverImageUrl: result.coverImageUrl,
                mediaFileId: result.mediaFileId,
                kieAudioId: kieAudioId || null,
                title: result.title || session.musicTitle,
                duration: result.duration,
                costUsd: perTrackCost,
                createdAt: now,
                ...genSnapshot,
              },
              ...result.extraTracks.map(t => ({
                resultUrl: t.audioUrl,
                coverImageUrl: t.coverImageUrl,
                mediaFileId: t.mediaFileId,
                kieAudioId: t.kieAudioId || null,
                title: t.title || session.musicTitle,
                duration: t.duration,
                costUsd: perTrackCost,
                createdAt: now,
                ...genSnapshot,
              })),
            ]

            // Append to existing results (don't overwrite previous generations)
            const existingResults = Array.isArray(session.results) ? session.results as any[] : []
            const allResults = [...existingResults, ...newResults]

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
          const errMsg = data?._extractedError || data?.failMsg || data?.errorMessage || data?.error || data?.message || 'KIE.ai: генерация не удалась'
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

// ---------------------------------------------------------------------------
// Photo batch poller — checks ALL tasks in batchTaskIds
// ---------------------------------------------------------------------------

async function pollPhotoSession(session: any) {
  const taskIds: string[] = Array.isArray(session.batchTaskIds)
    ? session.batchTaskIds
    : session.kieTaskId ? [session.kieTaskId] : []

  if (taskIds.length === 0) {
    await db.generationSession.update({
      where: { id: session.id },
      data: { status: 'failed', errorMessage: 'Нет задач для проверки', kieTaskId: null },
    })
    emitEvent({ type: 'session_updated', tabId: '', sessionId: session.id, status: 'failed' })
    return
  }

  // Check all tasks in parallel
  const checks = await Promise.allSettled(
    taskIds.map(async (taskId) => {
      const { state, data } = await checkPhotoTaskStatus(taskId)
      return { taskId, state, data }
    })
  )

  const results = checks
    .filter((r): r is PromiseFulfilledResult<{ taskId: string; state: string; data: any }> => r.status === 'fulfilled')
    .map(r => r.value)

  // Count states
  const completed = results.filter(r => r.state === 'success' || r.state === 'completed')
  const failed = results.filter(r => r.state === 'fail' || r.state === 'failed')
  const pending = results.filter(r => r.state !== 'success' && r.state !== 'completed' && r.state !== 'fail' && r.state !== 'failed')

  // If any failed — mark whole session as failed
  if (failed.length > 0) {
    const errMsg = failed[0].data?.failMsg || failed[0].data?.errorMessage || 'Генерация фото не удалась'
    await db.generationSession.update({
      where: { id: session.id },
      data: { status: 'failed', errorMessage: errMsg, kieTaskId: null },
    })
    emitEvent({ type: 'session_updated', tabId: '', sessionId: session.id, status: 'failed' })
    log.warn('[PhotoPoller] failed', { sessionId: session.id, error: errMsg })
    return
  }

  // If still pending — check timeout
  if (pending.length > 0) {
    const age = session.kieTaskCreatedAt
      ? Date.now() - new Date(session.kieTaskCreatedAt).getTime()
      : 0
    if (age > TASK_TIMEOUT) {
      await db.generationSession.update({
        where: { id: session.id },
        data: { status: 'failed', errorMessage: 'Таймаут генерации (>15 мин)', kieTaskId: null },
      })
      emitEvent({ type: 'session_updated', tabId: '', sessionId: session.id, status: 'failed' })
      log.warn('[PhotoPoller] timeout', { sessionId: session.id })
    }
    return // Not all done yet
  }

  // ALL completed — process each result
  const now = new Date().toISOString()
  const perImageCost = (session.costUsd || 0) / completed.length
  const newResults: any[] = []

  for (const item of completed) {
    try {
      const result = await processPhotoTaskResult(item.data, {
        businessId: session.businessId,
        prompt: session.prompt || '',
        costUsd: perImageCost,
        model: session.photoModel || session.model,
        userId: session.userId || undefined,
      })
      newResults.push({
        resultUrl: result.resultUrl,
        thumbUrl: result.thumbUrl,
        mediaFileId: result.mediaFileId,
        costUsd: perImageCost,
        createdAt: now,
        prompt: session.prompt || '',
        photoModel: session.photoModel || '',
        photoResolution: session.photoResolution || '2K',
        photoAspectRatio: session.photoAspectRatio || '1:1',
      })
    } catch (err: any) {
      log.error('[PhotoPoller] processPhotoTaskResult error', { sessionId: session.id, taskId: item.taskId, error: err.message })
    }
  }

  if (newResults.length === 0) {
    await db.generationSession.update({
      where: { id: session.id },
      data: { status: 'failed', errorMessage: 'Не удалось скачать изображения', kieTaskId: null },
    })
    emitEvent({ type: 'session_updated', tabId: '', sessionId: session.id, status: 'failed' })
    return
  }

  // Append to existing results (don't overwrite previous generations)
  const existingResults = Array.isArray(session.results) ? session.results as any[] : []
  const allResults = [...existingResults, ...newResults]

  await db.generationSession.update({
    where: { id: session.id },
    data: {
      status: 'completed',
      mediaFileId: newResults[0].mediaFileId,
      resultUrl: newResults[0].resultUrl,
      kieTaskId: null,
      batchTaskIds: null,
      results: allResults,
    },
  })

  emitEvent({ type: 'session_updated', tabId: '', sessionId: session.id, status: 'completed' })
  log.info('[PhotoPoller] completed', { sessionId: session.id, imageCount: newResults.length })
}

const MUSIC_COST_DEFAULT = 0.11

// Keep old export name for backward compat (index.ts imports startVideoPoller)
export function startVideoPoller(): ReturnType<typeof setInterval> {
  log.info('[GenerationPoller] started (interval: 10s, types: video + music + photo)')
  // Run immediately on startup to pick up tasks from before restart
  pollPendingTasks().catch(e => log.error('[GenerationPoller] initial poll error', { error: e.message }))
  // Then every 10 seconds
  return setInterval(() => {
    pollPendingTasks().catch(e => log.error('[GenerationPoller] poll error', { error: e.message }))
  }, POLL_INTERVAL)
}
