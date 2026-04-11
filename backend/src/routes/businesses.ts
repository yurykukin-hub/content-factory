import { Hono } from 'hono'
import { z } from 'zod'
import { db } from '../db'
import { emitEvent } from '../eventBus'
import type { AuthUser } from '../middleware/auth'
import { getUserBusinessIds } from '../middleware/business-access'

const businesses = new Hono()

// GET /api/businesses — filtered by user access
businesses.get('/', async (c) => {
  const user = c.get('user') as AuthUser
  const accessibleIds = await getUserBusinessIds(user)

  const list = await db.business.findMany({
    where: {
      isActive: true,
      ...(accessibleIds ? { id: { in: accessibleIds } } : {}),
    },
    include: { brandProfile: true, platformAccounts: { where: { isActive: true } } },
    orderBy: { name: 'asc' },
  })
  return c.json(list)
})

// GET /api/businesses/:id
businesses.get('/:id', async (c) => {
  const { id } = c.req.param()
  const biz = await db.business.findUnique({
    where: { id },
    include: {
      brandProfile: true,
      platformAccounts: { where: { isActive: true } },
      _count: { select: { posts: true, contentPlans: true } },
    },
  })
  if (!biz) return c.json({ error: 'Бизнес не найден' }, 404)
  return c.json(biz)
})

const createSchema = z.object({
  slug: z.string().min(2).max(50).regex(/^[a-z0-9-]+$/),
  name: z.string().min(1).max(100),
  description: z.string().max(500).optional(),
  erpType: z.string().optional(),
  erpBaseUrl: z.string().url().optional(),
  erpApiKey: z.string().optional(),
})

// POST /api/businesses
businesses.post('/', async (c) => {
  const data = createSchema.parse(await c.req.json())
  const biz = await db.business.create({
    data: {
      ...data,
      brandProfile: { create: {} }, // создаём пустой профиль сразу
    },
    include: { brandProfile: true },
  })

  const user = c.get('user') as AuthUser
  emitEvent({ type: 'business_updated', tabId: c.req.header('X-Tab-ID') || '', businessId: biz.id })
  return c.json(biz, 201)
})

// PUT /api/businesses/:id
businesses.put('/:id', async (c) => {
  const { id } = c.req.param()
  const data = createSchema.partial().parse(await c.req.json())
  const biz = await db.business.update({
    where: { id },
    data,
    include: { brandProfile: true },
  })
  emitEvent({ type: 'business_updated', tabId: c.req.header('X-Tab-ID') || '', businessId: biz.id })
  return c.json(biz)
})

// DELETE /api/businesses/:id (soft delete)
businesses.delete('/:id', async (c) => {
  const { id } = c.req.param()
  await db.business.update({ where: { id }, data: { isActive: false } })
  emitEvent({ type: 'business_updated', tabId: c.req.header('X-Tab-ID') || '', businessId: id })
  return c.json({ success: true })
})

// PUT /api/businesses/:id/brand-profile
businesses.put('/:id/brand-profile', async (c) => {
  const { id } = c.req.param()
  const data = await c.req.json()
  const profile = await db.brandProfile.upsert({
    where: { businessId: id },
    update: data,
    create: { businessId: id, ...data },
  })
  return c.json(profile)
})

// GET /api/businesses/:id/brand-profile
businesses.get('/:id/brand-profile', async (c) => {
  const { id } = c.req.param()
  const profile = await db.brandProfile.findUnique({ where: { businessId: id } })
  return c.json(profile)
})

export { businesses }
