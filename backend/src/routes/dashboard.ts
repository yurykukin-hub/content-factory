import { Hono } from 'hono'
import { db } from '../db'
import type { AuthUser } from '../middleware/auth'
import { getUserBusinessIds } from '../middleware/business-access'
import { fetchOpenRouterBalance } from '../services/ai/openrouter'

const dashboard = new Hono()

const USD_RUB = 95
const IMAGE_ACTIONS = ['generate_image', 'edit_image', 'remove_background']
const VIDEO_ACTIONS = ['generate_video']

// Simple in-memory cache (60s TTL)
let aiStatsCache: { data: any; ts: number } | null = null
const CACHE_TTL = 60_000

// GET /api/dashboard
dashboard.get('/', async (c) => {
  const user = c.get('user') as AuthUser
  const bizIds = await getUserBusinessIds(user)

  // Фильтр: null = ADMIN (все бизнесы), массив = EDITOR (только доступные)
  const bizFilter = bizIds ? { businessId: { in: bizIds } } : {}

  const now = new Date()
  const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000)
  const monthAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000)

  const [
    totalBusinesses,
    totalPosts,
    postsThisWeek,
    publishedThisWeek,
    scheduledPosts,
    aiUsageMonth,
  ] = await Promise.all([
    db.business.count({ where: { isActive: true, ...(bizIds ? { id: { in: bizIds } } : {}) } }),
    db.post.count({ where: bizFilter }),
    db.post.count({ where: { ...bizFilter, createdAt: { gte: weekAgo } } }),
    db.postVersion.count({ where: { status: 'PUBLISHED', publishedAt: { gte: weekAgo }, post: bizFilter } }),
    db.postVersion.count({ where: { status: 'SCHEDULED', post: bizFilter } }),
    db.aiUsageLog.aggregate({
      where: { createdAt: { gte: monthAgo }, ...bizFilter },
      _sum: { costUsd: true, tokensIn: true, tokensOut: true },
      _count: true,
    }),
  ])

  return c.json({
    totalBusinesses,
    totalPosts,
    postsThisWeek,
    publishedThisWeek,
    scheduledPosts,
    aiUsage: {
      calls: aiUsageMonth._count,
      costUsd: aiUsageMonth._sum.costUsd || 0,
      tokensIn: aiUsageMonth._sum.tokensIn || 0,
      tokensOut: aiUsageMonth._sum.tokensOut || 0,
    },
  })
})

// GET /api/dashboard/ai-stats — usage + balance (ADMIN only)
dashboard.get('/ai-stats', async (c) => {
  const user = c.get('user') as AuthUser
  if (user.role !== 'ADMIN') return c.json({ error: 'Forbidden' }, 403)

  // Return cached if fresh
  if (aiStatsCache && Date.now() - aiStatsCache.ts < CACHE_TTL) {
    return c.json(aiStatsCache.data)
  }

  const now = new Date()
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1)
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate())

  const [openrouter, monthTotal, monthByAction, todayTotal] = await Promise.all([
    fetchOpenRouterBalance(),
    db.aiUsageLog.aggregate({
      where: { createdAt: { gte: monthStart } },
      _sum: { costUsd: true },
      _count: true,
    }),
    db.aiUsageLog.groupBy({
      by: ['action'],
      where: { createdAt: { gte: monthStart } },
      _sum: { costUsd: true },
    }),
    db.aiUsageLog.aggregate({
      where: { createdAt: { gte: todayStart } },
      _sum: { costUsd: true },
      _count: true,
    }),
  ])

  // Calculate breakdown
  let imageCost = 0, videoCost = 0, textCost = 0
  for (const row of monthByAction) {
    const cost = row._sum.costUsd || 0
    if (IMAGE_ACTIONS.includes(row.action)) imageCost += cost
    else if (VIDEO_ACTIONS.includes(row.action)) videoCost += cost
    else textCost += cost
  }

  const totalUsd = monthTotal._sum.costUsd || 0

  const result = {
    openrouter,
    month: {
      totalUsd: Math.round(totalUsd * 10000) / 10000,
      totalRub: Math.round(totalUsd * USD_RUB),
      calls: monthTotal._count,
      breakdown: {
        text: Math.round(textCost * 10000) / 10000,
        image: Math.round(imageCost * 10000) / 10000,
        video: Math.round(videoCost * 10000) / 10000,
      },
    },
    today: {
      totalUsd: Math.round((todayTotal._sum.costUsd || 0) * 10000) / 10000,
      calls: todayTotal._count,
    },
  }

  aiStatsCache = { data: result, ts: Date.now() }
  return c.json(result)
})

export { dashboard }
