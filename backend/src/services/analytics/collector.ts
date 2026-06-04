/**
 * Коллектор метрик — оркестрация адаптеров + запись snapshots.
 *
 * Для бизнеса: берём опубликованные PostVersion с external_post_id, группируем
 * по площадке, зовём адаптеры (VK / Postmypost), пишем SocialPostMetricSnapshot
 * (append-only с дедупом по окну). Account-level (stats.get) и веб-трафик (Метрика)
 * — upsert. Деньги (брони) остаются в ERP/Метрике, джойн по utm_content=postId.
 */
import { db } from '../../db'
import { log } from '../../utils/logger'
import { ensureValidToken } from '../vk-oauth'
import { fetchVkPostMetrics, fetchVkStoryMetrics, fetchVkAccountMetrics } from './vk-adapter'
import { fetchPostmypostPostMetrics } from './postmypost-adapter'
import { fetchMetrikaTraffic } from './metrika-adapter'
import type { CollectedPostMetric, CollectedAccountMetric, CollectedSiteTraffic, PublishedRef } from './types'

export interface CollectResult {
  businessId: string
  postSnapshots: number
  accountSnapshots: number
  siteSnapshots: number
  skippedRecent: number
  errors: string[]
}

const DEFAULT_WINDOW_DAYS = 120        // как далеко назад смотреть публикации/трафик
const MIN_INTERVAL_HOURS = 6           // не плодить post-снимки чаще, чем раз в N часов (если не force)

/** Post.postType → publicationType снапшота */
function pubType(postType: string): string {
  if (postType === 'STORIES') return 'STORY'
  if (postType === 'REELS' || postType === 'CLIPS') return 'REELS'
  return 'POST'
}

/** Собрать метрики для одного бизнеса. */
export async function collectBusinessMetrics(
  businessId: string,
  opts: { force?: boolean; windowDays?: number } = {},
): Promise<CollectResult> {
  const result: CollectResult = { businessId, postSnapshots: 0, accountSnapshots: 0, siteSnapshots: 0, skippedRecent: 0, errors: [] }

  const business = await db.business.findUnique({
    where: { id: businessId },
    include: { platformAccounts: { where: { isActive: true } } },
  })
  if (!business) {
    result.errors.push('business not found')
    return result
  }

  const windowDays = opts.windowDays ?? DEFAULT_WINDOW_DAYS
  const now = new Date()
  const dateFrom = new Date(now.getTime() - windowDays * 24 * 60 * 60 * 1000)

  // Опубликованные версии с external id
  const versions = await db.postVersion.findMany({
    where: {
      status: 'PUBLISHED',
      externalPostId: { not: null },
      publishedAt: { gte: dateFrom },
      post: { businessId },
    },
    include: { post: { select: { id: true, postType: true } }, platformAccount: true },
    orderBy: { publishedAt: 'desc' },
    take: 1000,
  })

  // Дедуп: какие (source:externalId) уже снимали недавно
  const recentSet = new Set<string>()
  if (!opts.force) {
    const since = new Date(now.getTime() - MIN_INTERVAL_HOURS * 60 * 60 * 1000)
    const recent = await db.socialPostMetricSnapshot.findMany({
      where: { businessId, capturedAt: { gte: since } },
      select: { source: true, externalId: true },
    })
    for (const r of recent) recentSet.add(`${r.source}:${r.externalId}`)
  }

  const allPostMetrics: CollectedPostMetric[] = []
  const allAccountMetrics: CollectedAccountMetric[] = []

  // --- VK ---
  // Чтение постов (wall.getById) — per-channel токен (community = не истекает), иначе app-level.
  // Охваты (stats.get) — ТОЛЬКО app-level admin user-токен со scope `stats` (community не годится).
  const vkAccounts = business.platformAccounts.filter(p => p.platform === 'VK')
  if (vkAccounts.length) {
    let userToken: string | null = null
    try { userToken = await ensureValidToken() } catch { userToken = null }
    for (const acc of vkAccounts) {
      // wall.getById и stories.getStats требуют USER-токен (community-токен → error 27).
      const readToken = userToken || (acc.accessToken && acc.accessToken !== '' ? acc.accessToken : null)
      if (!readToken) { result.errors.push(`VK ${acc.accountName}: нет user-токена (подключите VK OAuth)`); continue }
      const ownerId = acc.accountType === 'GROUP' ? `-${acc.accountId}` : acc.accountId
      const refs = refsFor(versions, acc.id, 'VK')
      const storyRefs = refs.filter(r => r.publicationType === 'STORY')
      const postRefs = refs.filter(r => r.publicationType !== 'STORY')
      try {
        if (postRefs.length) allPostMetrics.push(...await fetchVkPostMetrics(readToken, ownerId, postRefs))
        // Сторис: stories.getStats (только пока активны ~24ч, нужен scope `stats`)
        if (storyRefs.length) allPostMetrics.push(...await fetchVkStoryMetrics(readToken, ownerId, storyRefs))
        // Охват сообщества: stats.get (scope `stats`)
        if (acc.accountType === 'GROUP') {
          allAccountMetrics.push(...await fetchVkAccountMetrics(readToken, acc.accountId, dateFrom, now))
        }
      } catch (err: any) {
        result.errors.push(`VK ${acc.accountName}: ${err?.message}`)
      }
    }
  }

  // --- Instagram (Postmypost) ---
  const igAccounts = business.platformAccounts.filter(p => p.platform === 'INSTAGRAM')
  for (const acc of igAccounts) {
    const cfg = (acc.config ?? {}) as Record<string, unknown>
    const token = acc.accessToken && acc.accessToken !== '' ? acc.accessToken : (process.env.POSTMYPOST_API_TOKEN || '')
    const projectId = Number(cfg.postmypostProjectId ?? process.env.POSTMYPOST_PROJECT_ID)
    const accountId = Number(acc.accountId)
    if (!token || !Number.isFinite(projectId) || !Number.isFinite(accountId)) {
      result.errors.push(`IG ${acc.accountName}: не настроен токен/project_id/account_id`)
      continue
    }
    const refs = refsFor(versions, acc.id, 'INSTAGRAM')
    try {
      allPostMetrics.push(...await fetchPostmypostPostMetrics(token, projectId, accountId, refs, dateFrom, now))
    } catch (err: any) {
      result.errors.push(`IG ${acc.accountName}: ${err?.message}`)
    }
  }

  // --- Запись post-снимков (append-only с дедупом) ---
  for (const m of allPostMetrics) {
    const key = `${m.source}:${m.externalId}`
    if (!opts.force && recentSet.has(key)) { result.skippedRecent++; continue }
    recentSet.add(key)
    try {
      await db.socialPostMetricSnapshot.create({
        data: {
          businessId,
          postId: m.postId ?? null,
          postVersionId: m.postVersionId ?? null,
          platform: m.platform,
          source: m.source,
          publicationType: m.publicationType,
          externalId: m.externalId,
          externalUrl: m.externalUrl ?? null,
          impressions: m.impressions ?? null,
          reach: m.reach ?? null,
          views: m.views ?? null,
          likes: m.likes ?? null,
          comments: m.comments ?? null,
          shares: m.shares ?? null,
          saves: m.saves ?? null,
          storyExits: m.storyExits ?? null,
          storyReplies: m.storyReplies ?? null,
          engagementRate: m.engagementRate ?? null,
          raw: m.raw as any,
        },
      })
      result.postSnapshots++
    } catch (err: any) {
      result.errors.push(`post snapshot ${key}: ${err?.message}`)
    }
  }

  // --- Запись account-снимков (upsert) ---
  for (const a of allAccountMetrics) {
    try {
      await db.socialAccountMetricSnapshot.upsert({
        where: {
          businessId_accountExternalId_metricCode_metricDate: {
            businessId,
            accountExternalId: a.accountExternalId,
            metricCode: a.metricCode,
            metricDate: new Date(a.metricDate),
          },
        },
        create: {
          businessId, platform: a.platform, source: a.source,
          accountExternalId: a.accountExternalId, metricCode: a.metricCode,
          value: a.value, metricDate: new Date(a.metricDate), raw: a.raw as any,
        },
        update: { value: a.value, capturedAt: new Date(), raw: a.raw as any },
      })
      result.accountSnapshots++
    } catch (err: any) {
      result.errors.push(`account snapshot ${a.metricCode}: ${err?.message}`)
    }
  }

  // --- Веб-трафик из Метрики (upsert) ---
  let site: CollectedSiteTraffic[] = []
  try {
    site = await fetchMetrikaTraffic(business, dateFrom, now)
  } catch (err: any) {
    result.errors.push(`Metrika: ${err?.message}`)
  }
  if (site.length) {
    // Резолвим postId из utm_content (только посты этого бизнеса)
    const candidateIds = [...new Set(site.map(s => s.utmContent).filter(Boolean) as string[])]
    const posts = candidateIds.length
      ? await db.post.findMany({ where: { id: { in: candidateIds }, businessId }, select: { id: true } })
      : []
    const validPostIds = new Set(posts.map(p => p.id))

    for (const s of site) {
      const postId = s.utmContent && validPostIds.has(s.utmContent) ? s.utmContent : null
      try {
        await db.siteTrafficSnapshot.upsert({
          where: {
            businessId_counterId_utmContent_utmSource_metricDate: {
              businessId,
              counterId: s.counterId,
              utmContent: s.utmContent ?? '',
              utmSource: s.utmSource ?? '',
              metricDate: new Date(s.metricDate),
            },
          },
          create: {
            businessId, counterId: s.counterId, source: 'METRIKA',
            utmSource: s.utmSource ?? null, utmMedium: s.utmMedium ?? null,
            utmCampaign: s.utmCampaign ?? null, utmContent: s.utmContent ?? null,
            postId, metricDate: new Date(s.metricDate),
            visits: s.visits, users: s.users ?? null, bounceRate: s.bounceRate ?? null,
            goalReaches: (s.goalReaches ?? undefined) as any, raw: s.raw as any,
          },
          update: {
            postId, visits: s.visits, users: s.users ?? null, bounceRate: s.bounceRate ?? null,
            goalReaches: (s.goalReaches ?? undefined) as any, capturedAt: new Date(), raw: s.raw as any,
          },
        })
        result.siteSnapshots++
      } catch (err: any) {
        result.errors.push(`site snapshot: ${err?.message}`)
      }
    }
  }

  log.info('[Collector] done', {
    business: business.slug, posts: result.postSnapshots, accounts: result.accountSnapshots,
    site: result.siteSnapshots, skipped: result.skippedRecent, errors: result.errors.length,
  })
  return result
}

/** Собрать метрики для всех активных бизнесов с площадками. */
export async function collectAllBusinesses(opts: { force?: boolean } = {}): Promise<CollectResult[]> {
  const businesses = await db.business.findMany({
    where: { isActive: true, platformAccounts: { some: { isActive: true } } },
    select: { id: true },
  })
  const results: CollectResult[] = []
  for (const b of businesses) {
    results.push(await collectBusinessMetrics(b.id, opts))
  }
  return results
}

function refsFor(versions: any[], platformAccountId: string, platform: string): PublishedRef[] {
  return versions
    .filter(v => v.platformAccountId === platformAccountId)
    .map(v => ({
      postId: v.post.id,
      postVersionId: v.id,
      externalPostId: String(v.externalPostId),
      publicationType: pubType(v.post.postType),
      externalUrl: v.externalUrl,
    }))
}
