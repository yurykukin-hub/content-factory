import { Hono } from 'hono'
import { z } from 'zod'
import { db } from '../db'
import type { AuthUser } from '../middleware/auth'
import { ACTION_CATEGORIES, getActionCategory, getActionLabel, CATEGORY_LABELS, getApiService, type ActionCategory, type ApiService } from '../shared/ai-actions'
import { fetchOpenRouterBalance } from '../services/ai/openrouter'
import { getUsdRubRate, KIE_CREDIT_PRICE } from '../services/billing'
import { Prisma } from '@prisma/client'

const aiLogs = new Hono()

// --- Shared filter builder ---

const filtersSchema = z.object({
  businessId: z.string().optional(),
  userId: z.string().optional(),
  category: z.enum(['text', 'image', 'video', 'music', 'vision', 'voice']).optional(),
  apiService: z.enum(['OpenRouter', 'OpenAI', 'KIE.ai']).optional(),
  action: z.string().optional(),
  model: z.string().optional(),
  status: z.enum(['success', 'error']).optional(),
  dateFrom: z.string().optional(),
  dateTo: z.string().optional(),
})

function buildWhere(filters: z.infer<typeof filtersSchema>, user: AuthUser) {
  const where: any = {}

  // Access control: non-admin can only see own logs
  if (user.role !== 'ADMIN') {
    where.userId = user.userId
  } else if (filters.userId) {
    where.userId = filters.userId
  }

  if (filters.businessId) where.businessId = filters.businessId
  if (filters.status) where.status = filters.status
  if (filters.action) where.action = filters.action
  if (filters.model) where.model = filters.model

  if (filters.category) {
    const actions = ACTION_CATEGORIES[filters.category as ActionCategory]
    if (actions) {
      // Include dynamic prefix variants for text category
      if (filters.category === 'text') {
        where.OR = [
          { action: { in: [...actions] } },
          { action: { startsWith: 'enhance_video_prompt_' } },
          { action: { startsWith: 'enhance_music_prompt_' } },
          { action: { startsWith: 'agent_chat_' } },
        ]
      } else {
        where.action = { in: [...actions] }
      }
    }
  }

  // API service filter
  if (filters.apiService) {
    const kieActions = ['edit_image', 'remove_background', 'generate_video', 'generate_music']
    if (filters.apiService === 'OpenAI') {
      where.action = 'transcribe_voice'
    } else if (filters.apiService === 'KIE.ai') {
      where.OR = [
        { action: { in: kieActions } },
        { action: 'generate_image', model: { not: { startsWith: 'google/' } } },
      ]
    } else {
      // OpenRouter: exclude KIE and OpenAI actions
      where.action = { notIn: [...kieActions, 'transcribe_voice'] }
    }
  }

  if (filters.dateFrom || filters.dateTo) {
    where.createdAt = {}
    if (filters.dateFrom) where.createdAt.gte = new Date(filters.dateFrom)
    if (filters.dateTo) {
      const to = new Date(filters.dateTo)
      to.setHours(23, 59, 59, 999)
      where.createdAt.lte = to
    }
  }

  return where
}

// --- 1. GET /ai-logs — paginated list ---

const listSchema = filtersSchema.extend({
  page: z.coerce.number().min(1).default(1),
  limit: z.coerce.number().min(1).max(100).default(50),
})

aiLogs.get('/', async (c) => {
  const user = c.get('user') as AuthUser
  const query = listSchema.parse(c.req.query())
  const { page, limit, ...filters } = query
  const where = buildWhere(filters, user)
  const skip = (page - 1) * limit

  const [logs, total] = await Promise.all([
    db.aiUsageLog.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip,
      take: limit,
      include: {
        business: { select: { id: true, name: true } },
        user: { select: { id: true, name: true } },
      },
    }),
    db.aiUsageLog.count({ where }),
  ])

  // Add computed apiService field
  const enrichedLogs = logs.map(log => ({
    ...log,
    apiService: getApiService(log.action, log.model),
  }))

  return c.json({
    logs: enrichedLogs,
    total,
    page,
    limit,
    totalPages: Math.ceil(total / limit),
  })
})

// --- 2. GET /ai-logs/stats — summary stats + trend ---

aiLogs.get('/stats', async (c) => {
  const user = c.get('user') as AuthUser
  const filters = filtersSchema.parse(c.req.query())
  const where = buildWhere(filters, user)
  const usdRub = await getUsdRubRate()

  const [totals, errorCount, byAction, byModel] = await Promise.all([
    db.aiUsageLog.aggregate({
      where,
      _count: true,
      _sum: { costUsd: true, tokensIn: true, tokensOut: true, cachedTokens: true },
    }),
    db.aiUsageLog.count({ where: { ...where, status: 'error' } }),
    db.aiUsageLog.groupBy({
      by: ['action'],
      where,
      _sum: { costUsd: true },
      _count: true,
    }),
    db.aiUsageLog.groupBy({
      by: ['model'],
      where,
      _sum: { costUsd: true },
      _count: true,
    }),
  ])

  // Aggregate by category from byAction
  const categoryMap: Record<string, { count: number; costUsd: number }> = {}
  for (const row of byAction) {
    const cat = getActionCategory(row.action)
    if (!categoryMap[cat]) categoryMap[cat] = { count: 0, costUsd: 0 }
    categoryMap[cat].count += row._count
    categoryMap[cat].costUsd += row._sum.costUsd || 0
  }
  const byCategory = Object.entries(categoryMap).map(([category, data]) => ({
    category,
    label: CATEGORY_LABELS[category as ActionCategory] || category,
    ...data,
  }))

  // By user (admin only)
  let byUser = null
  if (user.role === 'ADMIN') {
    const userGroups = await db.aiUsageLog.groupBy({
      by: ['userId'],
      where,
      _sum: { costUsd: true },
      _count: true,
    })
    const userIds = userGroups.map(g => g.userId).filter(Boolean) as string[]
    const users = userIds.length > 0
      ? await db.user.findMany({ where: { id: { in: userIds } }, select: { id: true, name: true } })
      : []
    const userMap = new Map(users.map(u => [u.id, u.name]))
    byUser = userGroups
      .filter(g => g.userId)
      .map(g => ({
        userId: g.userId!,
        userName: userMap.get(g.userId!) || 'Unknown',
        count: g._count,
        costUsd: g._sum.costUsd || 0,
      }))
  }

  // Daily trend via raw SQL
  const whereConditions: string[] = []
  const params: any[] = []
  let paramIdx = 1

  if (where.userId) {
    whereConditions.push(`user_id = $${paramIdx++}`)
    params.push(where.userId)
  }
  if (where.businessId) {
    whereConditions.push(`business_id = $${paramIdx++}`)
    params.push(where.businessId)
  }
  if (where.status) {
    whereConditions.push(`status = $${paramIdx++}`)
    params.push(where.status)
  }
  if (where.createdAt?.gte) {
    whereConditions.push(`created_at >= $${paramIdx++}`)
    params.push(where.createdAt.gte)
  }
  if (where.createdAt?.lte) {
    whereConditions.push(`created_at <= $${paramIdx++}`)
    params.push(where.createdAt.lte)
  }
  // Handle action filters
  if (where.action) {
    if (typeof where.action === 'string') {
      whereConditions.push(`action = $${paramIdx++}`)
      params.push(where.action)
    } else if (where.action?.in) {
      const placeholders = where.action.in.map((_: string, i: number) => `$${paramIdx + i}`).join(',')
      paramIdx += where.action.in.length
      whereConditions.push(`action IN (${placeholders})`)
      params.push(...where.action.in)
    }
  }
  if (where.model) {
    whereConditions.push(`model = $${paramIdx++}`)
    params.push(where.model)
  }

  const whereClause = whereConditions.length > 0 ? `WHERE ${whereConditions.join(' AND ')}` : ''
  const dailyTrend = await db.$queryRawUnsafe<{ date: string; count: number; cost_usd: number }[]>(
    `SELECT DATE(created_at) as date, COUNT(*)::int as count, COALESCE(SUM(cost_usd), 0)::float as cost_usd
     FROM ai_usage_logs ${whereClause}
     GROUP BY DATE(created_at) ORDER BY date`,
    ...params,
  )

  // API balances (admin only, cached in dashboard)
  let balances = null
  if (user.role === 'ADMIN') {
    const orBalance = await fetchOpenRouterBalance()
    const kieSpent = await db.aiUsageLog.aggregate({
      where: { action: { in: ['generate_image', 'edit_image', 'remove_background', 'generate_video', 'generate_music'] } },
      _sum: { costUsd: true },
    })
    const kieInitialConfig = await db.appConfig.findUnique({ where: { key: 'kie_initial_credits' } })
    const kieInitial = kieInitialConfig ? parseFloat(kieInitialConfig.value) : 0
    const kieTotalSpentUsd = kieSpent._sum.costUsd || 0
    const kieCreditsRemaining = Math.max(0, kieInitial - kieTotalSpentUsd / KIE_CREDIT_PRICE)

    balances = {
      openRouter: orBalance ? { balanceUsd: orBalance.balanceUsd } : null,
      kie: { creditsRemaining: Math.round(kieCreditsRemaining), balanceUsd: kieCreditsRemaining * KIE_CREDIT_PRICE },
    }
  }

  return c.json({
    totals: {
      count: totals._count,
      costUsd: totals._sum.costUsd || 0,
      costRub: Math.round((totals._sum.costUsd || 0) * usdRub * 100) / 100,
      tokensIn: totals._sum.tokensIn || 0,
      tokensOut: totals._sum.tokensOut || 0,
      cachedTokens: totals._sum.cachedTokens || 0,
      errorCount,
    },
    byCategory,
    byModel: byModel.map(m => ({ model: m.model, count: m._count, costUsd: m._sum.costUsd || 0 })),
    byUser,
    dailyTrend: dailyTrend.map(d => ({ date: String(d.date), count: d.count, costUsd: d.cost_usd })),
    balances,
  })
})

// --- 3. GET /ai-logs/summary — grouped summary table ---

const summarySchema = filtersSchema.extend({
  groupBy: z.enum(['action', 'model', 'user']).default('action'),
})

aiLogs.get('/summary', async (c) => {
  const user = c.get('user') as AuthUser
  const query = summarySchema.parse(c.req.query())
  const { groupBy: groupField, ...filters } = query
  const where = buildWhere(filters, user)

  // Block user groupBy for non-admins
  if (groupField === 'user' && user.role !== 'ADMIN') {
    return c.json({ error: 'Нет доступа' }, 403)
  }

  const byField = groupField === 'user' ? 'userId' : groupField
  const groups = await db.aiUsageLog.groupBy({
    by: [byField],
    where,
    _sum: { costUsd: true, tokensIn: true, tokensOut: true },
    _count: true,
  })

  // Count errors per group
  const errorGroups = await db.aiUsageLog.groupBy({
    by: [byField],
    where: { ...where, status: 'error' },
    _count: true,
  })
  const errorMap = new Map(errorGroups.map(g => [(g as any)[byField], g._count]))

  // Get total for percent calculation
  const totalCost = groups.reduce((sum, g) => sum + (g._sum.costUsd || 0), 0)

  // Get user names for user groupBy
  let userMap = new Map<string, string>()
  if (groupField === 'user') {
    const userIds = groups.map(g => (g as any).userId).filter(Boolean)
    if (userIds.length > 0) {
      const users = await db.user.findMany({ where: { id: { in: userIds } }, select: { id: true, name: true } })
      userMap = new Map(users.map(u => [u.id, u.name]))
    }
  }

  const rows = groups.map(g => {
    const key = (g as any)[byField] || '—'
    let label = key
    if (groupField === 'action') label = getActionLabel(key)
    else if (groupField === 'user') label = userMap.get(key) || 'Unknown'
    else if (groupField === 'model') label = key.split('/').pop() || key

    const costUsd = g._sum.costUsd || 0
    return {
      key,
      label,
      count: g._count,
      tokensIn: g._sum.tokensIn || 0,
      tokensOut: g._sum.tokensOut || 0,
      costUsd,
      errorCount: errorMap.get(key) || 0,
      percent: totalCost > 0 ? Math.round((costUsd / totalCost) * 1000) / 10 : 0,
    }
  }).sort((a, b) => b.costUsd - a.costUsd)

  const totalsRow = {
    count: rows.reduce((s, r) => s + r.count, 0),
    tokensIn: rows.reduce((s, r) => s + r.tokensIn, 0),
    tokensOut: rows.reduce((s, r) => s + r.tokensOut, 0),
    costUsd: totalCost,
    errorCount: rows.reduce((s, r) => s + r.errorCount, 0),
  }

  return c.json({ rows, totals: totalsRow })
})

// --- 4. GET /ai-logs/error-count — sidebar badge ---

aiLogs.get('/error-count', async (c) => {
  const user = c.get('user') as AuthUser
  const dayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000)
  const where: any = { status: 'error', createdAt: { gte: dayAgo } }

  if (user.role !== 'ADMIN') {
    where.userId = user.userId
  }

  const count = await db.aiUsageLog.count({ where })
  return c.json({ count })
})

// --- 5. GET /ai-logs/export — CSV export ---

aiLogs.get('/export', async (c) => {
  const user = c.get('user') as AuthUser
  const filters = filtersSchema.parse(c.req.query())
  const where = buildWhere(filters, user)

  const logs = await db.aiUsageLog.findMany({
    where,
    orderBy: { createdAt: 'desc' },
    include: {
      business: { select: { name: true } },
      user: { select: { name: true } },
    },
  })

  const isAdmin = user.role === 'ADMIN'
  const header = isAdmin
    ? 'Дата,Пользователь,Проект,Действие,Категория,Модель,Токены вход,Токены выход,Кэш,Стоимость USD,Статус,Длительность мс'
    : 'Дата,Проект,Действие,Категория,Модель,Токены вход,Токены выход,Кэш,Стоимость USD,Статус,Длительность мс'

  const rows = logs.map(log => {
    const date = new Date(log.createdAt).toLocaleString('ru-RU', { timeZone: 'Europe/Moscow' })
    const category = CATEGORY_LABELS[getActionCategory(log.action) as ActionCategory] || ''
    const actionLabel = getActionLabel(log.action)
    const model = log.model.split('/').pop() || log.model

    const cols = isAdmin
      ? [date, log.user?.name || '—', log.business?.name || '—', actionLabel, category, model,
         log.tokensIn, log.tokensOut, log.cachedTokens, log.costUsd.toFixed(6), log.status, log.durationMs ?? '']
      : [date, log.business?.name || '—', actionLabel, category, model,
         log.tokensIn, log.tokensOut, log.cachedTokens, log.costUsd.toFixed(6), log.status, log.durationMs ?? '']

    return cols.map(v => `"${String(v).replace(/"/g, '""')}"`).join(',')
  })

  const csv = '\uFEFF' + header + '\n' + rows.join('\n')

  c.header('Content-Type', 'text/csv; charset=utf-8')
  c.header('Content-Disposition', 'attachment; filename=ai-logs.csv')
  return c.body(csv)
})

export { aiLogs }
