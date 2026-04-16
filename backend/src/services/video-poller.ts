/**
 * Background video poller — checks KIE.ai task status every 10 seconds.
 *
 * Reads pending tasks from PostgreSQL (not memory) → survives restarts.
 * On success: downloads video, creates MediaFile, updates session, emits SSE.
 * On failure: marks session as failed, emits SSE.
 */

import { db } from '../db'
import { checkVideoTaskStatus, processVideoTaskResult } from './ai/kie'
import { emitEvent } from '../eventBus'
import { log } from '../utils/logger'

const POLL_INTERVAL = 10_000   // 10 seconds
const TASK_TIMEOUT = 15 * 60 * 1000  // 15 minutes

async function pollPendingVideos() {
  // Find all sessions with active KIE tasks
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
      try {
        const { state, data } = await checkVideoTaskStatus(session.kieTaskId!)

        if (state === 'success' || state === 'completed') {
          // Download video + save to DB
          const { mediaFileId, resultUrl } = await processVideoTaskResult(data, {
            businessId: session.businessId,
            postId: null,
            prompt: session.prompt || '',
            duration: session.duration,
            costUsd: session.costUsd || 0,
            model: session.model,
          })

          // Update session → completed
          await db.generationSession.update({
            where: { id: session.id },
            data: { status: 'completed', resultUrl, mediaFileId, kieTaskId: null },
          })

          emitEvent({ type: 'session_updated', tabId: '', sessionId: session.id, status: 'completed' })
          log.info('[VideoPoller] completed', { sessionId: session.id, mediaFileId })

        } else if (state === 'fail' || state === 'failed') {
          const errMsg = data?.failMsg || data?.errorMessage || 'KIE.ai: генерация не удалась'
          await db.generationSession.update({
            where: { id: session.id },
            data: { status: 'failed', errorMessage: errMsg, kieTaskId: null },
          })
          emitEvent({ type: 'session_updated', tabId: '', sessionId: session.id, status: 'failed' })
          log.warn('[VideoPoller] failed', { sessionId: session.id, error: errMsg })

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
            log.warn('[VideoPoller] timeout', { sessionId: session.id })
          }
        }
      } catch (err: any) {
        // Network error or CDN expired — mark as failed
        log.error('[VideoPoller] error', { sessionId: session.id, error: err.message })
        await db.generationSession.update({
          where: { id: session.id },
          data: { status: 'failed', errorMessage: `Ошибка: ${err.message?.slice(0, 200)}`, kieTaskId: null },
        }).catch(() => {})
        emitEvent({ type: 'session_updated', tabId: '', sessionId: session.id, status: 'failed' })
      }
    })
  )
}

export function startVideoPoller() {
  log.info('[VideoPoller] started (interval: 10s)')
  // Run immediately on startup to pick up tasks from before restart
  pollPendingVideos().catch(e => log.error('[VideoPoller] initial poll error', { error: e.message }))
  // Then every 10 seconds
  setInterval(() => {
    pollPendingVideos().catch(e => log.error('[VideoPoller] poll error', { error: e.message }))
  }, POLL_INTERVAL)
}
