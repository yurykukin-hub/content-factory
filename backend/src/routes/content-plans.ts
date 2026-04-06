import { Hono } from 'hono'
import { z } from 'zod'
import { db } from '../db'
import { emitEvent } from '../eventBus'

const contentPlans = new Hono()

// GET /api/businesses/:bizId/plans
contentPlans.get('/:bizId/plans', async (c) => {
  const { bizId } = c.req.param()
  const plans = await db.contentPlan.findMany({
    where: { businessId: bizId },
    include: { _count: { select: { items: true } } },
    orderBy: { startDate: 'desc' },
  })
  return c.json(plans)
})

// GET /api/plans/:id
contentPlans.get('/plans/:id', async (c) => {
  const { id } = c.req.param()
  const plan = await db.contentPlan.findUnique({
    where: { id },
    include: {
      items: {
        include: { post: { select: { id: true, status: true, title: true } } },
        orderBy: { date: 'asc' },
      },
    },
  })
  if (!plan) return c.json({ error: 'План не найден' }, 404)
  return c.json(plan)
})

const createSchema = z.object({
  businessId: z.string(),
  title: z.string().min(1),
  startDate: z.string().transform((s) => new Date(s)),
  endDate: z.string().transform((s) => new Date(s)),
})

// POST /api/plans
contentPlans.post('/plans', async (c) => {
  const data = createSchema.parse(await c.req.json())
  const plan = await db.contentPlan.create({ data })
  emitEvent({ type: 'plan_created', tabId: c.req.header('X-Tab-ID') || '', planId: plan.id })
  return c.json(plan, 201)
})

// PUT /api/plans/:id
contentPlans.put('/plans/:id', async (c) => {
  const { id } = c.req.param()
  const data = await c.req.json()
  const plan = await db.contentPlan.update({ where: { id }, data })
  emitEvent({ type: 'plan_updated', tabId: c.req.header('X-Tab-ID') || '', planId: plan.id })
  return c.json(plan)
})

// PUT /api/plan-items/:id
contentPlans.put('/plan-items/:id', async (c) => {
  const { id } = c.req.param()
  const data = await c.req.json()
  const item = await db.contentPlanItem.update({ where: { id }, data })
  return c.json(item)
})

export { contentPlans }
