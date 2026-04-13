import { Hono } from 'hono'
import { z } from 'zod'
import { db } from '../db'
import type { AuthUser } from '../middleware/auth'
import { assertBusinessAccess } from '../middleware/resource-access'

const promptLibrary = new Hono()

const createSchema = z.object({
  businessId: z.string(),
  type: z.enum(['video', 'image', 'text']).default('video'),
  prompt: z.string().min(1),
  resultUrl: z.string().optional().nullable(),
  rating: z.number().int().min(1).max(5).optional().nullable(),
  tags: z.array(z.string()).default([]),
  metadata: z.any().optional(),
})

// GET /api/prompt-library?businessId=&type=video
promptLibrary.get('/', async (c) => {
  const user = c.get('user') as AuthUser
  const businessId = c.req.query('businessId')
  const type = c.req.query('type')

  if (businessId) {
    try { await assertBusinessAccess(user, businessId) } catch (e: any) {
      if (e.message === 'FORBIDDEN') return c.json({ error: 'Нет доступа' }, 403); throw e
    }
  }

  const where: any = {}
  if (businessId) where.businessId = businessId
  if (type) where.type = type

  const entries = await db.promptEntry.findMany({
    where,
    orderBy: [{ rating: 'desc' }, { createdAt: 'desc' }],
    take: 100,
  })
  return c.json(entries)
})

// POST /api/prompt-library
promptLibrary.post('/', async (c) => {
  const user = c.get('user') as AuthUser
  const data = createSchema.parse(await c.req.json())

  try { await assertBusinessAccess(user, data.businessId) } catch (e: any) {
    if (e.message === 'FORBIDDEN') return c.json({ error: 'Нет доступа' }, 403); throw e
  }

  const entry = await db.promptEntry.create({ data })
  return c.json(entry, 201)
})

// PUT /api/prompt-library/:id — обновить рейтинг/теги
promptLibrary.put('/:id', async (c) => {
  const { id } = c.req.param()
  const user = c.get('user') as AuthUser
  const existing = await db.promptEntry.findUnique({ where: { id } })
  if (!existing) return c.json({ error: 'Не найден' }, 404)

  try { await assertBusinessAccess(user, existing.businessId) } catch (e: any) {
    if (e.message === 'FORBIDDEN') return c.json({ error: 'Нет доступа' }, 403); throw e
  }

  const data = z.object({
    rating: z.number().int().min(1).max(5).optional().nullable(),
    tags: z.array(z.string()).optional(),
  }).parse(await c.req.json())

  const updated = await db.promptEntry.update({ where: { id }, data })
  return c.json(updated)
})

// DELETE /api/prompt-library/:id
promptLibrary.delete('/:id', async (c) => {
  const { id } = c.req.param()
  const user = c.get('user') as AuthUser
  const existing = await db.promptEntry.findUnique({ where: { id } })
  if (!existing) return c.json({ error: 'Не найден' }, 404)

  try { await assertBusinessAccess(user, existing.businessId) } catch (e: any) {
    if (e.message === 'FORBIDDEN') return c.json({ error: 'Нет доступа' }, 403); throw e
  }

  await db.promptEntry.delete({ where: { id } })
  return c.json({ ok: true })
})

export { promptLibrary }
