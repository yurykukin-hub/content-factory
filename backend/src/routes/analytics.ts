import { Hono } from 'hono'
import { z } from 'zod'
import { db } from '../db'
import type { AuthUser } from '../middleware/auth'
import { getUserBusinessIds } from '../middleware/business-access'
import { collectBusinessMetrics, collectAllBusinesses } from '../services/analytics/collector'
import { getMetrikaToken } from '../services/analytics/metrika-adapter'

const analytics = new Hono()

const DAY = 24 * 60 * 60 * 1000

/** Проверка доступа к бизнесу (ADMIN — всё, иначе — по UserBusiness). */
async function assertAccess(user: AuthUser, businessId: string): Promise<boolean> {
  const ids = await getUserBusinessIds(user)
  return ids === null || ids.includes(businessId)
}

function engagementsOf(s: { likes: number | null; comments: number | null; shares: number | null; saves: number | null }): number {
  return (s.likes || 0) + (s.comments || 0) + (s.shares || 0) + (s.saves || 0)
}

// ---------------------------------------------------------------------------
// POST /api/analytics/collect — ручной запуск сбора
//   body: { businessId?, force? }. Без businessId — все бизнесы (ADMIN).
// ---------------------------------------------------------------------------
const collectSchema = z.object({
  businessId: z.string().optional(),
  force: z.boolean().optional(),
})

analytics.post('/collect', async (c) => {
  const user = c.get('user') as AuthUser
  const body = collectSchema.parse(await c.req.json().catch(() => ({})))

  if (body.businessId) {
    if (!(await assertAccess(user, body.businessId))) return c.json({ error: 'FORBIDDEN' }, 403)
    const result = await collectBusinessMetrics(body.businessId, { force: body.force })
    return c.json({ results: [result] })
  }

  // Все бизнесы — только ADMIN
  if (user.role !== 'ADMIN') return c.json({ error: 'FORBIDDEN' }, 403)
  const results = await collectAllBusinesses({ force: body.force })
  return c.json({ results })
})

// ---------------------------------------------------------------------------
// GET /api/analytics/overview?businessId&days=30 — данные дашборда одним вызовом
// ---------------------------------------------------------------------------
analytics.get('/overview', async (c) => {
  const user = c.get('user') as AuthUser
  const businessId = c.req.query('businessId')
  const days = Math.min(Math.max(parseInt(c.req.query('days') || '30', 10) || 30, 1), 365)
  if (!businessId) return c.json({ error: 'businessId required' }, 400)
  if (!(await assertAccess(user, businessId))) return c.json({ error: 'FORBIDDEN' }, 403)

  const now = new Date()
  const since = new Date(now.getTime() - days * DAY)

  // 1. Снимки постов в окне → последний по (source:externalId)
  const snaps = await db.socialPostMetricSnapshot.findMany({
    where: { businessId, capturedAt: { gte: since } },
    orderBy: { capturedAt: 'desc' },
    include: { post: { select: { id: true, title: true, body: true, postType: true } } },
  })
  const latestByKey = new Map<string, typeof snaps[number]>()
  for (const s of snaps) {
    const key = `${s.source}:${s.externalId}`
    if (!latestByKey.has(key)) latestByKey.set(key, s)
  }
  const latest = [...latestByKey.values()]

  // 2. Веб-трафик (Метрика) в окне → агрегаты по постам и источникам
  const traffic = await db.siteTrafficSnapshot.findMany({
    where: { businessId, metricDate: { gte: since } },
  })
  const visitsByPost = new Map<string, number>()
  const convByPost = new Map<string, number>()
  const bySourceRoi = new Map<string, { visits: number; conversions: number }>()
  let totalVisits = 0, totalConversions = 0
  for (const t of traffic) {
    const conv = t.goalReaches ? Object.values(t.goalReaches as Record<string, number>).reduce((a, b) => a + (Number(b) || 0), 0) : 0
    totalVisits += t.visits
    totalConversions += conv
    if (t.postId) {
      visitsByPost.set(t.postId, (visitsByPost.get(t.postId) || 0) + t.visits)
      convByPost.set(t.postId, (convByPost.get(t.postId) || 0) + conv)
    }
    const src = t.utmSource || 'unknown'
    const cur = bySourceRoi.get(src) || { visits: 0, conversions: 0 }
    cur.visits += t.visits; cur.conversions += conv
    bySourceRoi.set(src, cur)
  }

  // 3. Сборка строк постов + агрегаты/разбивка по площадкам
  const byPlatform = new Map<string, { platform: string; posts: number; reach: number; views: number; likes: number; engagements: number }>()
  const totals = { posts: 0, reach: 0, views: 0, likes: 0, comments: 0, shares: 0, engagements: 0 }
  const posts = latest.map((s) => {
    const eng = engagementsOf(s)
    totals.posts++
    totals.reach += s.reach || 0
    totals.views += s.views || 0
    totals.likes += s.likes || 0
    totals.comments += s.comments || 0
    totals.shares += s.shares || 0
    totals.engagements += eng

    const p = byPlatform.get(s.platform) || { platform: s.platform, posts: 0, reach: 0, views: 0, likes: 0, engagements: 0 }
    p.posts++; p.reach += s.reach || 0; p.views += s.views || 0; p.likes += s.likes || 0; p.engagements += eng
    byPlatform.set(s.platform, p)

    return {
      postId: s.postId,
      postVersionId: s.postVersionId,
      platform: s.platform,
      source: s.source,
      publicationType: s.publicationType,
      externalId: s.externalId,
      externalUrl: s.externalUrl,
      title: s.post?.title || null,
      body: (s.post?.body || '').slice(0, 140),
      postType: s.post?.postType || null,
      capturedAt: s.capturedAt,
      reach: s.reach,
      views: s.views,
      likes: s.likes,
      comments: s.comments,
      shares: s.shares,
      saves: s.saves,
      engagements: eng,
      engagementRate: s.engagementRate,
      visits: s.postId ? (visitsByPost.get(s.postId) || 0) : 0,
      conversions: s.postId ? (convByPost.get(s.postId) || 0) : 0,
    }
  })
  posts.sort((a, b) => (b.engagements - a.engagements) || ((b.reach || 0) - (a.reach || 0)))

  const engagementRate = totals.reach > 0 ? Math.round((totals.engagements / totals.reach) * 1000) / 10
    : (totals.views > 0 ? Math.round((totals.engagements / totals.views) * 1000) / 10 : null)

  // 4. Статус адаптеров (для подсказок в UI)
  const hasVkAccountMetrics = await db.socialAccountMetricSnapshot.count({ where: { businessId, source: 'VK', metricDate: { gte: since } } })
  const metrikaToken = await getMetrikaToken()

  return c.json({
    window: { days, from: since.toISOString(), to: now.toISOString() },
    totals: { ...totals, engagementRate },
    byPlatform: [...byPlatform.values()],
    roi: {
      configured: !!metrikaToken,
      visits: totalVisits,
      conversions: totalConversions,
      bySource: [...bySourceRoi.entries()].map(([source, v]) => ({ source, ...v })),
    },
    posts,
    adapters: {
      vkStats: hasVkAccountMetrics > 0,   // охваты VK собираются (есть scope stats)
      metrika: !!metrikaToken,
    },
    lastCapturedAt: latest[0]?.capturedAt || null,
  })
})

// ---------------------------------------------------------------------------
// GET /api/analytics/post/:postId/history — динамика метрик одного поста (time-series)
// ---------------------------------------------------------------------------
analytics.get('/post/:postId/history', async (c) => {
  const user = c.get('user') as AuthUser
  const postId = c.req.param('postId')
  const post = await db.post.findUnique({ where: { id: postId }, select: { businessId: true } })
  if (!post) return c.json({ error: 'not found' }, 404)
  if (!(await assertAccess(user, post.businessId))) return c.json({ error: 'FORBIDDEN' }, 403)

  const snaps = await db.socialPostMetricSnapshot.findMany({
    where: { postId },
    orderBy: { capturedAt: 'asc' },
    select: { capturedAt: true, platform: true, source: true, reach: true, views: true, likes: true, comments: true, shares: true, engagementRate: true },
  })
  return c.json({ postId, snapshots: snaps })
})

export { analytics }
