/**
 * Competitor poller — ежедневный сбор постов конкурентов из VK (модуль «Конкуренты»).
 *
 * Вызывается каждые 60с из scheduler.ts. Раз в день в окно `competitor_monitor_time_utc`
 * (по умолчанию 03:30 UTC = 06:30 МСК — ДО утреннего дайджеста, чтобы он увидел свежие
 * «залетевшие» посты). Дедуп по дню через AppConfig.
 *
 * Источник — VK wall.get по публичным пабликам тем же app-токеном (scope не нужен —
 * читаем публичную стену). 8–10 пабликов раз в день = нулевая нагрузка. Deploy-safe:
 * состояние (last-run) в AppConfig.
 */
import { db } from '../db'
import { log } from '../utils/logger'
import { ensureValidToken } from './vk-oauth'

const VK_API = 'https://api.vk.com/method'
const VK_V = '5.199'
const VIRAL_THRESHOLD = 2.0 // «залетел» = ER ≥ медиана паблика × threshold

function round2(n: number): number {
  return Math.round(n * 100) / 100
}

async function vkCall(method: string, params: Record<string, string>): Promise<any> {
  const res = await fetch(`${VK_API}/${method}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ ...params, v: VK_V }),
  })
  try {
    return (await res.json()) as any
  } catch {
    // VK при rate-limit/5xx может вернуть HTML — не роняем, отдаём error-форму
    return { error: { error_msg: `non-JSON response (HTTP ${res.status})` } }
  }
}

async function getConfig(key: string): Promise<string | null> {
  const row = await db.appConfig.findUnique({ where: { key } })
  return row?.value ?? null
}
async function setConfig(key: string, value: string): Promise<void> {
  await db.appConfig.upsert({ where: { key }, create: { key, value }, update: { value } })
}

/** Проверка по расписанию (каждые 60с из scheduler). */
export async function checkAndRunCompetitorCollection(): Promise<void> {
  const enabled = await getConfig('competitor_monitor_enabled')
  if (enabled !== 'true') return // opt-in (включается при сидинге пабликов)

  const timeUtc = (await getConfig('competitor_monitor_time_utc')) || '03:30' // 06:30 МСК, до дайджеста
  const [h, m] = timeUtc.split(':').map(Number)
  const now = new Date()
  if (now.getUTCHours() !== h || now.getUTCMinutes() !== m) return

  const last = await getConfig('competitor_last_run')
  // Дедуп по UTC-дню (консистентно с UTC-окном запуска выше)
  if (last && new Date(last).toISOString().slice(0, 10) === now.toISOString().slice(0, 10)) return
  await setConfig('competitor_last_run', now.toISOString())

  log.info('[Competitor] scheduled run starting')
  await runCompetitorCollection().catch((e: any) =>
    log.error('[Competitor] run failed', { error: e?.message }),
  )
}

/** Собрать посты всех активных VK-конкурентов. Для ручного запуска тоже. */
export async function runCompetitorCollection(): Promise<{ accounts: number; posts: number; viral: number }> {
  const token = await ensureValidToken()
  if (!token) {
    log.warn('[Competitor] no VK token — skip')
    return { accounts: 0, posts: 0, viral: 0 }
  }

  const accounts = await db.competitorAccount.findMany({ where: { isActive: true, platform: 'VK' } })
  let totalPosts = 0
  let totalViral = 0

  for (const acc of accounts) {
    try {
      // handle: domain ("supway") либо owner_id ("-12345678")
      const isOwnerId = /^-?\d+$/.test(acc.handle)
      const params: Record<string, string> = {
        count: '30',
        filter: 'owner', // только посты самого сообщества (без репостов от подписчиков)
        access_token: token,
        ...(isOwnerId ? { owner_id: acc.handle } : { domain: acc.handle }),
      }
      const data = await vkCall('wall.get', params)
      if (data.error) {
        log.warn('[Competitor] vk error', { handle: acc.handle, error: data.error?.error_msg })
        continue
      }
      const items: any[] = data.response?.items || []
      for (const item of items) {
        if (item.is_pinned) continue // закреп искажает метрики виральности
        const likes = item.likes?.count ?? 0
        const reposts = item.reposts?.count ?? 0
        const views = item.views?.count ?? 0
        const comments = item.comments?.count ?? 0
        const er = views > 0 ? round2(((likes + reposts + comments) / views) * 100) : null
        const ownerId = item.owner_id ?? item.from_id ?? (isOwnerId ? acc.handle : null)
        if (ownerId == null) {
          log.warn('[Competitor] no owner_id, skip post', { handle: acc.handle, postId: item.id })
          continue
        }
        await db.competitorPost.upsert({
          where: { accountId_externalId: { accountId: acc.id, externalId: String(item.id) } },
          create: {
            accountId: acc.id,
            externalId: String(item.id),
            externalUrl: `https://vk.com/wall${ownerId}_${item.id}`,
            publishedAt: new Date((item.date ?? 0) * 1000),
            text: item.text || '',
            mediaType: item.attachments?.[0]?.type || null,
            likes, reposts, views, comments,
            engagementRate: er,
            raw: item,
          },
          update: { likes, reposts, views, comments, engagementRate: er, raw: item },
        })
        totalPosts++
      }
      totalViral += await markViralPosts(acc.id)
      await db.competitorAccount.update({ where: { id: acc.id }, data: { lastFetchedAt: new Date() } })
    } catch (err: any) {
      log.warn('[Competitor] fetch failed', { handle: acc.handle, error: err?.message })
    }
  }

  log.info('[Competitor] done', { accounts: accounts.length, posts: totalPosts, viral: totalViral })
  return { accounts: accounts.length, posts: totalPosts, viral: totalViral }
}

/** Пересчитать isViral для паблика: ER ≥ медиана × threshold. Возвращает число виральных. */
async function markViralPosts(accountId: string): Promise<number> {
  const posts = await db.competitorPost.findMany({
    where: { accountId, views: { gt: 0 }, engagementRate: { not: null } },
    select: { id: true, engagementRate: true },
  })
  // Сброс перед пересчётом
  await db.competitorPost.updateMany({ where: { accountId }, data: { isViral: false } })
  if (posts.length < 4) return 0 // мало данных для устойчивой медианы

  const rates = posts.map(p => p.engagementRate ?? 0).sort((a, b) => a - b)
  // Истинная медиана: при чётной длине — среднее двух центральных (иначе порог смещается вверх)
  const mid = Math.floor(rates.length / 2)
  const median = rates.length % 2 === 0 ? (rates[mid - 1] + rates[mid]) / 2 : rates[mid]
  if (median <= 0) return 0
  const threshold = median * VIRAL_THRESHOLD
  const viralIds = posts.filter(p => (p.engagementRate ?? 0) >= threshold).map(p => p.id)
  if (viralIds.length) {
    await db.competitorPost.updateMany({ where: { id: { in: viralIds } }, data: { isViral: true } })
  }
  return viralIds.length
}

/** Топ «залетевших» постов конкурентов бизнеса за N дней — для обогащения дайджеста. */
export async function getViralCompetitorPosts(businessId: string, days = 7, limit = 5) {
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000)
  return db.competitorPost.findMany({
    where: { isViral: true, publishedAt: { gte: since }, account: { businessId } },
    include: { account: { select: { displayName: true } } },
    orderBy: { engagementRate: 'desc' },
    take: limit,
  })
}
