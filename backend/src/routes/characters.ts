import { Hono } from 'hono'
import { z } from 'zod'
import { db } from '../db'
import type { AuthUser } from '../middleware/auth'
import { assertBusinessAccess } from '../middleware/resource-access'

const characters = new Hono()

const characterSchema = z.object({
  name: z.string().min(1).max(100),
  description: z.string().max(1000).default(''),
  type: z.enum(['person', 'mascot', 'avatar']).default('person'),
  style: z.string().max(50).default(''),
  referenceMediaId: z.string().optional().nullable(),
  isActive: z.boolean().default(true),
})

// GET /api/businesses/:bizId/characters — список персонажей бизнеса
characters.get('/businesses/:bizId/characters', async (c) => {
  const bizId = c.req.param('bizId')
  const user = c.get('user') as AuthUser
  try { await assertBusinessAccess(user, bizId) } catch (e: any) {
    if (e.message === 'FORBIDDEN') return c.json({ error: 'Нет доступа' }, 403); throw e
  }

  const list = await db.character.findMany({
    where: { businessId: bizId },
    include: {
      referenceMedia: { select: { id: true, url: true, thumbUrl: true } },
    },
    orderBy: { createdAt: 'desc' },
  })
  return c.json(list)
})

// POST /api/businesses/:bizId/characters — создать персонажа
characters.post('/businesses/:bizId/characters', async (c) => {
  const bizId = c.req.param('bizId')
  const user = c.get('user') as AuthUser
  try { await assertBusinessAccess(user, bizId) } catch (e: any) {
    if (e.message === 'FORBIDDEN') return c.json({ error: 'Нет доступа' }, 403); throw e
  }

  const data = characterSchema.parse(await c.req.json())
  const character = await db.character.create({
    data: { ...data, businessId: bizId },
    include: {
      referenceMedia: { select: { id: true, url: true, thumbUrl: true } },
    },
  })
  return c.json(character, 201)
})

// GET /api/characters/:id — получить персонажа
characters.get('/characters/:id', async (c) => {
  const { id } = c.req.param()
  const user = c.get('user') as AuthUser

  const character = await db.character.findUnique({
    where: { id },
    include: {
      referenceMedia: { select: { id: true, url: true, thumbUrl: true } },
    },
  })
  if (!character) return c.json({ error: 'Не найден' }, 404)

  try { await assertBusinessAccess(user, character.businessId) } catch (e: any) {
    if (e.message === 'FORBIDDEN') return c.json({ error: 'Нет доступа' }, 403); throw e
  }

  return c.json(character)
})

// PUT /api/characters/:id — обновить персонажа
characters.put('/characters/:id', async (c) => {
  const { id } = c.req.param()
  const user = c.get('user') as AuthUser

  const existing = await db.character.findUnique({ where: { id } })
  if (!existing) return c.json({ error: 'Не найден' }, 404)

  try { await assertBusinessAccess(user, existing.businessId) } catch (e: any) {
    if (e.message === 'FORBIDDEN') return c.json({ error: 'Нет доступа' }, 403); throw e
  }

  const data = characterSchema.partial().parse(await c.req.json())
  const updated = await db.character.update({
    where: { id },
    data,
    include: {
      referenceMedia: { select: { id: true, url: true, thumbUrl: true } },
    },
  })
  return c.json(updated)
})

// DELETE /api/characters/:id — удалить персонажа
characters.delete('/characters/:id', async (c) => {
  const { id } = c.req.param()
  const user = c.get('user') as AuthUser

  const existing = await db.character.findUnique({ where: { id } })
  if (!existing) return c.json({ error: 'Не найден' }, 404)

  try { await assertBusinessAccess(user, existing.businessId) } catch (e: any) {
    if (e.message === 'FORBIDDEN') return c.json({ error: 'Нет доступа' }, 403); throw e
  }

  await db.character.delete({ where: { id } })
  return c.json({ ok: true })
})

export { characters }
