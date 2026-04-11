import { Hono } from 'hono'
import { db } from '../db'
import type { AuthUser } from '../middleware/auth'
import { getUserBusinessIds } from '../middleware/business-access'

const dashboard = new Hono()

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

export { dashboard }
