import { Hono } from 'hono'
import { z } from 'zod'
import { db } from '../db'
import type { AuthUser } from '../middleware/auth'
import { assertBusinessAccess } from '../middleware/resource-access'

const sessions = new Hono()

// GET /api/sessions?businessId=X&status=completed — список сессий
sessions.get('/sessions', async (c) => {
  const user = c.get('user') as AuthUser
  const businessId = c.req.query('businessId')
  const status = c.req.query('status')

  if (!businessId) return c.json({ error: 'businessId required' }, 400)
  try { await assertBusinessAccess(user, businessId) } catch { return c.json({ error: 'Нет доступа' }, 403) }

  const where: any = { businessId }
  if (status) where.status = status

  const list = await db.generationSession.findMany({
    where,
    orderBy: { updatedAt: 'desc' },
    take: 50,
    include: {
      mediaFile: { select: { id: true, url: true, thumbUrl: true, filename: true, durationSec: true } },
    },
  })
  return c.json(list)
})

// GET /api/sessions/draft?businessId=X — получить текущий draft (или null)
sessions.get('/sessions/draft', async (c) => {
  const user = c.get('user') as AuthUser
  const businessId = c.req.query('businessId')
  if (!businessId) return c.json(null)
  try { await assertBusinessAccess(user, businessId) } catch { return c.json(null) }

  const draft = await db.generationSession.findFirst({
    where: { businessId, userId: user.id, status: 'draft' },
    orderBy: { updatedAt: 'desc' },
  })
  return c.json(draft)
})

// POST /api/sessions — создать сессию
const createSchema = z.object({
  businessId: z.string(),
  prompt: z.string().default(''),
  duration: z.number().int().min(4).max(15).default(4),
  aspectRatio: z.enum(['9:16', '1:1', '16:9']).default('9:16'),
  resolution: z.enum(['480p', '720p']).default('480p'),
  generateAudio: z.boolean().default(false),
  inputMode: z.enum(['text', 'frames', 'references']).default('references'),
  referenceImages: z.any().optional(),
  firstFrameUrl: z.string().optional().nullable(),
  lastFrameUrl: z.string().optional().nullable(),
})

sessions.post('/sessions', async (c) => {
  const user = c.get('user') as AuthUser
  const data = createSchema.parse(await c.req.json())
  try { await assertBusinessAccess(user, data.businessId) } catch { return c.json({ error: 'Нет доступа' }, 403) }

  const { businessId, ...rest } = data
  const session = await db.generationSession.create({
    data: {
      ...rest,
      business: { connect: { id: businessId } },
      user: { connect: { id: user.id } },
      status: 'draft',
    },
  })
  return c.json(session, 201)
})

// PUT /api/sessions/:id — обновить сессию (auto-save)
const updateSchema = z.object({
  prompt: z.string().optional(),
  duration: z.number().int().min(4).max(15).optional(),
  aspectRatio: z.enum(['9:16', '1:1', '16:9']).optional(),
  resolution: z.enum(['480p', '720p']).optional(),
  generateAudio: z.boolean().optional(),
  inputMode: z.enum(['text', 'frames', 'references']).optional(),
  referenceImages: z.any().optional(),
  firstFrameUrl: z.string().optional().nullable(),
  lastFrameUrl: z.string().optional().nullable(),
  status: z.enum(['draft', 'generating', 'completed', 'failed']).optional(),
  mediaFileId: z.string().optional().nullable(),
  resultUrl: z.string().optional().nullable(),
  errorMessage: z.string().optional().nullable(),
  costUsd: z.number().optional().nullable(),
})

sessions.put('/sessions/:id', async (c) => {
  const { id } = c.req.param()
  const user = c.get('user') as AuthUser
  const data = updateSchema.parse(await c.req.json())

  const existing = await db.generationSession.findUnique({ where: { id } })
  if (!existing) return c.json({ error: 'Не найдена' }, 404)
  if (existing.userId !== user.id && (user as any).role !== 'ADMIN') {
    return c.json({ error: 'Нет доступа' }, 403)
  }

  const updated = await db.generationSession.update({ where: { id }, data })
  return c.json(updated)
})

// DELETE /api/sessions/:id
sessions.delete('/sessions/:id', async (c) => {
  const { id } = c.req.param()
  const user = c.get('user') as AuthUser

  const existing = await db.generationSession.findUnique({ where: { id } })
  if (!existing) return c.json({ error: 'Не найдена' }, 404)
  if (existing.userId !== user.id && (user as any).role !== 'ADMIN') {
    return c.json({ error: 'Нет доступа' }, 403)
  }

  await db.generationSession.delete({ where: { id } })
  return c.json({ ok: true })
})

export { sessions }
