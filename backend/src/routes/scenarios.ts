import { Hono } from 'hono'
import { z } from 'zod'
import { db } from '../db'
import type { AuthUser } from '../middleware/auth'
import { assertBusinessAccess } from '../middleware/resource-access'

const scenarios = new Hono()

const sceneSchema = z.object({
  sceneNumber: z.number().int().min(1),
  description: z.string().max(1000),
  voiceover: z.string().max(2000).default(''),
  durationSec: z.number().int().min(1).max(300).default(5),
  imagePrompt: z.string().max(500).default(''),
})

const scenarioSchema = z.object({
  title: z.string().min(1).max(200),
  description: z.string().max(2000).default(''),
  scenes: z.array(sceneSchema).default([]),
  status: z.enum(['DRAFT', 'READY', 'IN_PRODUCTION', 'COMPLETED']).default('DRAFT'),
})

// GET /api/scenarios?businessId= — список сценариев
scenarios.get('/', async (c) => {
  const user = c.get('user') as AuthUser
  const businessId = c.req.query('businessId')

  if (businessId) {
    try { await assertBusinessAccess(user, businessId) } catch (e: any) {
      if (e.message === 'FORBIDDEN') return c.json({ error: 'Нет доступа' }, 403); throw e
    }
  }

  // Для ADMIN — все или по бизнесу, для EDITOR — только привязанные бизнесы
  let where: any = {}
  if (businessId) {
    where.businessId = businessId
  } else if (user.role !== 'ADMIN') {
    const userBizIds = await db.userBusiness.findMany({
      where: { userId: user.userId },
      select: { businessId: true },
    })
    where.businessId = { in: userBizIds.map(ub => ub.businessId) }
  }

  const list = await db.scenario.findMany({
    where,
    include: {
      business: { select: { id: true, name: true, slug: true } },
    },
    orderBy: { updatedAt: 'desc' },
  })
  return c.json(list)
})

// GET /api/scenarios/:id — получить сценарий
scenarios.get('/:id', async (c) => {
  const { id } = c.req.param()
  const user = c.get('user') as AuthUser

  const scenario = await db.scenario.findUnique({
    where: { id },
    include: {
      business: { select: { id: true, name: true, slug: true } },
    },
  })
  if (!scenario) return c.json({ error: 'Не найден' }, 404)

  try { await assertBusinessAccess(user, scenario.businessId) } catch (e: any) {
    if (e.message === 'FORBIDDEN') return c.json({ error: 'Нет доступа' }, 403); throw e
  }

  return c.json(scenario)
})

// POST /api/scenarios — создать сценарий
scenarios.post('/', async (c) => {
  const user = c.get('user') as AuthUser
  const body = await c.req.json()
  const businessId = z.string().parse(body.businessId)

  try { await assertBusinessAccess(user, businessId) } catch (e: any) {
    if (e.message === 'FORBIDDEN') return c.json({ error: 'Нет доступа' }, 403); throw e
  }

  const data = scenarioSchema.parse(body)
  const scenario = await db.scenario.create({
    data: {
      ...data,
      scenes: data.scenes as any,
      businessId,
    },
    include: {
      business: { select: { id: true, name: true, slug: true } },
    },
  })
  return c.json(scenario, 201)
})

// PUT /api/scenarios/:id — обновить сценарий
scenarios.put('/:id', async (c) => {
  const { id } = c.req.param()
  const user = c.get('user') as AuthUser

  const existing = await db.scenario.findUnique({ where: { id } })
  if (!existing) return c.json({ error: 'Не найден' }, 404)

  try { await assertBusinessAccess(user, existing.businessId) } catch (e: any) {
    if (e.message === 'FORBIDDEN') return c.json({ error: 'Нет доступа' }, 403); throw e
  }

  const data = scenarioSchema.partial().parse(await c.req.json())
  const updated = await db.scenario.update({
    where: { id },
    data: {
      ...data,
      scenes: data.scenes as any,
    },
    include: {
      business: { select: { id: true, name: true, slug: true } },
    },
  })
  return c.json(updated)
})

// DELETE /api/scenarios/:id — удалить сценарий
scenarios.delete('/:id', async (c) => {
  const { id } = c.req.param()
  const user = c.get('user') as AuthUser

  const existing = await db.scenario.findUnique({ where: { id } })
  if (!existing) return c.json({ error: 'Не найден' }, 404)

  try { await assertBusinessAccess(user, existing.businessId) } catch (e: any) {
    if (e.message === 'FORBIDDEN') return c.json({ error: 'Нет доступа' }, 403); throw e
  }

  await db.scenario.delete({ where: { id } })
  return c.json({ ok: true })
})

export { scenarios }
