import { Hono } from 'hono'
import { z } from 'zod'
import { db } from '../db'
import { emitEvent } from '../eventBus'
import type { AuthUser } from '../middleware/auth'
import { getUserBusinessIds } from '../middleware/business-access'
import { getBookingLinks, isNawodeDataAvailable, DEFAULT_BOOKING_BASE_URL } from '../services/nawode-data'

const businesses = new Hono()

// GET /api/businesses — filtered by user access
// ADMIN видит все (включая неактивные), остальные — только active
businesses.get('/', async (c) => {
  const user = c.get('user') as AuthUser
  const accessibleIds = await getUserBusinessIds(user)
  const isAdmin = user.role === 'ADMIN'

  const list = await db.business.findMany({
    where: {
      ...(!isAdmin ? { isActive: true } : {}),
      ...(accessibleIds ? { id: { in: accessibleIds } } : {}),
    },
    include: { brandProfile: true, platformAccounts: { where: { isActive: true } } },
    orderBy: { name: 'asc' },
  })
  // Не отдаём accessToken платформ клиенту — только признак hasToken
  return c.json(list.map(b => ({
    ...b,
    platformAccounts: (b.platformAccounts ?? []).map(({ accessToken, ...p }) => ({ ...p, hasToken: !!accessToken })),
  })))
})

// GET /api/businesses/:id — with business access check
businesses.get('/:id', async (c) => {
  const { id } = c.req.param()
  const user = c.get('user') as AuthUser
  const accessibleIds = await getUserBusinessIds(user)

  // EDITOR/VIEWER can only see businesses they have access to
  if (accessibleIds && !accessibleIds.includes(id)) {
    return c.json({ error: 'Нет доступа' }, 403)
  }

  const isAdmin = user.role === 'ADMIN'
  const biz = await db.business.findUnique({
    where: {
      id,
      // EDITOR/VIEWER cannot see inactive businesses
      ...(!isAdmin ? { isActive: true } : {}),
    },
    include: {
      brandProfile: true,
      platformAccounts: { where: { isActive: true } },
      _count: { select: { posts: true, contentPlans: true } },
    },
  })
  if (!biz) return c.json({ error: 'Бизнес не найден' }, 404)
  // Не отдаём accessToken платформ клиенту — только признак hasToken
  return c.json({
    ...biz,
    platformAccounts: (biz.platformAccounts ?? []).map(({ accessToken, ...p }) => ({ ...p, hasToken: !!accessToken })),
  })
})

const createSchema = z.object({
  slug: z.string().min(2).max(50).regex(/^[a-z0-9-]+$/),
  name: z.string().min(1).max(100),
  description: z.string().max(500).optional(),
  erpType: z.string().optional(),
  erpBaseUrl: z.string().url().optional(),
  erpApiKey: z.string().optional(),
  // Яндекс.Метрика per-business (счётчик/цели — не секрет; токен задаётся отдельно в AppConfig metrika_token_{id})
  metrikaCounterId: z.string().max(20).optional(),
  metrikaGoalIds: z.array(z.string().max(20)).max(50).optional(),
})

// POST /api/businesses — ADMIN only (создание сущности бизнеса)
businesses.post('/', async (c) => {
  const user = c.get('user') as AuthUser
  if (user.role !== 'ADMIN') {
    return c.json({ error: 'Нет доступа' }, 403)
  }
  const data = createSchema.parse(await c.req.json())
  const biz = await db.business.create({
    data: {
      ...data,
      brandProfile: { create: {} }, // создаём пустой профиль сразу
    },
    include: { brandProfile: true },
  })

  emitEvent({ type: 'business_updated', tabId: c.req.header('X-Tab-ID') || '', businessId: biz.id })
  return c.json(biz, 201)
})

const updateSchema = createSchema.partial().extend({
  isActive: z.boolean().optional(),
})

// PUT /api/businesses/:id — with business access check
businesses.put('/:id', async (c) => {
  const { id } = c.req.param()
  const user = c.get('user') as AuthUser
  const accessibleIds = await getUserBusinessIds(user)
  if (accessibleIds && !accessibleIds.includes(id)) {
    return c.json({ error: 'Нет доступа' }, 403)
  }
  const data = updateSchema.parse(await c.req.json())
  const biz = await db.business.update({
    where: { id },
    data,
    include: { brandProfile: true },
  })
  emitEvent({ type: 'business_updated', tabId: c.req.header('X-Tab-ID') || '', businessId: biz.id })
  return c.json(biz)
})

// DELETE /api/businesses/:id (soft delete) — ADMIN only
businesses.delete('/:id', async (c) => {
  const user = c.get('user') as AuthUser
  if (user.role !== 'ADMIN') {
    return c.json({ error: 'Нет доступа' }, 403)
  }
  const { id } = c.req.param()
  await db.business.update({ where: { id }, data: { isActive: false } })
  emitEvent({ type: 'business_updated', tabId: c.req.header('X-Tab-ID') || '', businessId: id })
  return c.json({ success: true })
})

// Zod schema for brand profile updates (only allowed fields)
const brandProfileSchema = z.object({
  tone: z.string().max(500).optional(),
  targetAudience: z.string().max(500).optional(),
  brandVoice: z.string().max(1000).optional(),
  hashtags: z.array(z.string()).optional(),
  keyTopics: z.array(z.string()).optional(),
  doNotMention: z.array(z.string()).optional(),
  examplePosts: z.any().optional(),
  postsPerWeek: z.number().min(1).max(14).optional(),
  links: z.any().optional(),
})

// PUT /api/businesses/:id/brand-profile — with business access check
businesses.put('/:id/brand-profile', async (c) => {
  const { id } = c.req.param()
  const user = c.get('user') as AuthUser
  const accessibleIds = await getUserBusinessIds(user)
  if (accessibleIds && !accessibleIds.includes(id)) {
    return c.json({ error: 'Нет доступа' }, 403)
  }

  const data = brandProfileSchema.parse(await c.req.json())
  const profile = await db.brandProfile.upsert({
    where: { businessId: id },
    update: data,
    create: { businessId: id, ...data },
  })
  return c.json(profile)
})

// GET /api/businesses/:id/brand-profile — with business access check
businesses.get('/:id/brand-profile', async (c) => {
  const { id } = c.req.param()
  const user = c.get('user') as AuthUser
  const accessibleIds = await getUserBusinessIds(user)
  if (accessibleIds && !accessibleIds.includes(id)) {
    return c.json({ error: 'Нет доступа' }, 403)
  }

  const profile = await db.brandProfile.findUnique({ where: { businessId: id } })
  return c.json(profile)
})

// GET /api/businesses/:id/booking-links — готовые ссылки для кнопки в редакторе.
// Источник 1: НаWоде ERP booking_links (если у бизнеса настроен erpType). Источник 2 (fallback): BrandProfile.links.
businesses.get('/:id/booking-links', async (c) => {
  const { id } = c.req.param()
  const user = c.get('user') as AuthUser
  const accessibleIds = await getUserBusinessIds(user)
  if (accessibleIds && !accessibleIds.includes(id)) {
    return c.json({ error: 'Нет доступа' }, 403)
  }

  // 1) ERP-ссылки (НаWоде) — если у бизнеса есть источник данных
  const biz = await db.business.findUnique({ where: { id }, select: { erpType: true } })
  if (biz?.erpType && isNawodeDataAvailable()) {
    const cfg = await db.appConfig.findUnique({ where: { key: 'nawode_booking_base_url' } })
    const links = await getBookingLinks(cfg?.value || DEFAULT_BOOKING_BASE_URL)
    if (links.length) return c.json(links)
  }

  // 2) Fallback: ссылки из BrandProfile.links ([{label,url}])
  const bp = await db.brandProfile.findUnique({ where: { businessId: id }, select: { links: true } })
  const raw = Array.isArray(bp?.links) ? (bp!.links as any[]) : []
  const fallback = raw
    .filter(l => l && typeof l === 'object' && l.url)
    .map(l => ({ label: String(l.label || l.url), ref: '', url: String(l.url), scope: [] as string[] }))
  return c.json(fallback)
})

export { businesses }
