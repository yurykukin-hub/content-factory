import { Hono } from 'hono'
import { z } from 'zod'
import { db } from '../db'
import type { AuthUser } from '../middleware/auth'

const ideas = new Hono()

// GET /api/ideas — list all ideas for current user
ideas.get('/', async (c) => {
  const user = c.get('user') as AuthUser
  const list = await db.idea.findMany({
    where: { userId: user.userId },
    orderBy: { updatedAt: 'desc' },
  })
  return c.json(list)
})

const createSchema = z.object({
  title: z.string().max(500).default(''),
  body: z.string().max(10000).default(''),
})

// POST /api/ideas — create a new idea
ideas.post('/', async (c) => {
  const user = c.get('user') as AuthUser
  const data = createSchema.parse(await c.req.json())
  const idea = await db.idea.create({
    data: { ...data, userId: user.userId },
  })
  return c.json(idea, 201)
})

const updateSchema = z.object({
  title: z.string().max(500).optional(),
  body: z.string().max(10000).optional(),
})

// PUT /api/ideas/:id — update idea (ownership check)
ideas.put('/:id', async (c) => {
  const { id } = c.req.param()
  const user = c.get('user') as AuthUser
  const data = updateSchema.parse(await c.req.json())

  const existing = await db.idea.findFirst({
    where: { id, userId: user.userId },
  })
  if (!existing) return c.json({ error: 'Не найдено' }, 404)

  const idea = await db.idea.update({
    where: { id },
    data,
  })
  return c.json(idea)
})

// DELETE /api/ideas/:id — delete idea (ownership check)
ideas.delete('/:id', async (c) => {
  const { id } = c.req.param()
  const user = c.get('user') as AuthUser

  const existing = await db.idea.findFirst({
    where: { id, userId: user.userId },
  })
  if (!existing) return c.json({ error: 'Не найдено' }, 404)

  await db.idea.delete({ where: { id } })
  return c.json({ success: true })
})

export { ideas }
