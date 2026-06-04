/**
 * Metrics poller — периодический сбор статистики площадок (Эпик B).
 *
 * Вызывается каждые 60с из scheduler.ts (как digest). Запускается в окна
 * `metrics_times_utc` (по умолчанию 2×/день), дедуп по слоту за день.
 * Источники обновляются медленно (Postmypost ~4ч) → 1–2×/день достаточно.
 * Сторис у IG живут ~14д — ежедневный pull их застаёт.
 *
 * Deploy-safe: состояние (last-run по слотам) в AppConfig.
 */
import { db } from '../db'
import { log } from '../utils/logger'
import { collectAllBusinesses } from './analytics/collector'

async function getConfig(key: string): Promise<string | null> {
  const row = await db.appConfig.findUnique({ where: { key } })
  return row?.value ?? null
}
async function setConfig(key: string, value: string): Promise<void> {
  await db.appConfig.upsert({ where: { key }, create: { key, value }, update: { value } })
}

/** Проверка по расписанию (каждые 60с). */
export async function checkAndRunMetricsCollection(): Promise<void> {
  const enabled = await getConfig('metrics_enabled')
  if (enabled === 'false') return // default ON

  const times = ((await getConfig('metrics_times_utc')) || '05:00,15:00')
    .split(',').map(s => s.trim()).filter(Boolean)

  const now = new Date()
  const hh = String(now.getUTCHours()).padStart(2, '0')
  const mm = String(now.getUTCMinutes()).padStart(2, '0')
  const slot = `${hh}:${mm}`
  if (!times.includes(slot)) return

  const lastKey = `metrics_last_run_${slot}`
  const last = await getConfig(lastKey)
  if (last && new Date(last).toDateString() === now.toDateString()) return // уже в этот слот сегодня
  await setConfig(lastKey, now.toISOString())

  log.info('[MetricsPoller] scheduled run starting', { slot })
  try {
    const results = await collectAllBusinesses()
    const totals = results.reduce(
      (a, r) => ({ posts: a.posts + r.postSnapshots, accounts: a.accounts + r.accountSnapshots, site: a.site + r.siteSnapshots }),
      { posts: 0, accounts: 0, site: 0 },
    )
    log.info('[MetricsPoller] done', totals)
  } catch (err: any) {
    log.error('[MetricsPoller] run failed', { error: err?.message })
  }
}
