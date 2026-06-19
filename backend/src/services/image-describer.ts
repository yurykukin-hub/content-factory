/**
 * Авто-описание фото для галереи (Ф0.2) — фоновый поллер.
 *
 * Берёт MediaFile с флагом aiModel='describe_pending' (ставится при загрузке + batch-прогоном),
 * описывает через vision-модель галерейным промптом → пишет altText (для семантического поиска).
 * Паттерн — как video-poller: читает из БД (переживает рестарт), параллельно пачкой.
 *
 * Состояния флага aiModel:
 *   'describe_pending'  → в очереди на описание
 *   'describe_failed'   → не удалось (не ретраим автоматически; можно перепоставить вручную/batch)
 *   null + altText set  → описано
 */

import { db } from '../db'
import { config } from '../config'
import { aiVision } from './ai/openrouter'
import { buildGalleryVisionPrompt } from './ai/prompt-builder'
import { log } from '../utils/logger'

const POLL_INTERVAL = 15_000 // 15 сек
const BATCH_SIZE = 4         // фото за тик (бережём rate limit + равномерная нагрузка)

function toPublicUrl(url: string): string {
  if (!url.startsWith('/uploads/')) return url
  const base = config.isProd ? 'https://content.yurykukin.ru' : `http://localhost:${config.PORT}`
  return base + url
}

/**
 * Описать одно фото и сохранить altText. true при успехе.
 * Переиспользуется поллером (авто) и batch-скриптом (Ф0.3).
 */
export async function describeMediaFile(file: { id: string; url: string; businessId: string }): Promise<boolean> {
  const { system, user } = buildGalleryVisionPrompt()
  const result = await aiVision({
    systemPrompt: system,
    userPrompt: user,
    imageUrls: [toPublicUrl(file.url)],
    model: config.models.vision,
    maxTokens: 400,
    businessId: file.businessId,
    action: 'describe_reference',
  })
  const text = (result.content || '').trim()
  if (!text) return false
  await db.mediaFile.update({ where: { id: file.id }, data: { altText: text, aiModel: null } })
  return true
}

async function pollPendingDescriptions() {
  const files = await db.mediaFile.findMany({
    where: { aiModel: 'describe_pending', mimeType: { startsWith: 'image/' } },
    take: BATCH_SIZE,
    select: { id: true, url: true, businessId: true },
  })
  if (!files.length) return

  await Promise.allSettled(
    files.map(async (f) => {
      try {
        const ok = await describeMediaFile(f)
        if (!ok) {
          await db.mediaFile.update({ where: { id: f.id }, data: { aiModel: 'describe_failed' } })
          log.warn('[ImageDescriber] empty description', { id: f.id })
        }
      } catch (err: any) {
        await db.mediaFile.update({ where: { id: f.id }, data: { aiModel: 'describe_failed' } }).catch(() => {})
        log.warn('[ImageDescriber] failed', { id: f.id, error: err.message })
      }
    })
  )
  log.info('[ImageDescriber] processed batch', { count: files.length })
}

export function startImageDescriber(): ReturnType<typeof setInterval> {
  log.info('[ImageDescriber] started (interval: 15s)')
  pollPendingDescriptions().catch(e => log.error('[ImageDescriber] initial poll error', { error: e.message }))
  return setInterval(() => {
    pollPendingDescriptions().catch(e => log.error('[ImageDescriber] poll error', { error: e.message }))
  }, POLL_INTERVAL)
}
