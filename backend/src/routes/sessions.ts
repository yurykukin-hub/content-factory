import { Hono } from 'hono'
import { z } from 'zod'
import { db } from '../db'
import type { AuthUser } from '../middleware/auth'
import { assertBusinessAccess } from '../middleware/resource-access'

const sessions = new Hono()

// GET /api/sessions?businessId=X&status=completed&type=video — список сессий
sessions.get('/sessions', async (c) => {
  const user = c.get('user') as AuthUser
  const businessId = c.req.query('businessId')
  const status = c.req.query('status')
  const type = c.req.query('type') // "video" | "music"

  if (!businessId) return c.json({ error: 'businessId required' }, 400)
  try { await assertBusinessAccess(user, businessId) } catch { return c.json({ error: 'Нет доступа' }, 403) }

  const where: any = { businessId }
  if (status) where.status = status
  if (type) where.type = type

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

// GET /api/sessions/draft?businessId=X&type=video — получить текущий draft (или null)
// IMPORTANT: must be before :id route
sessions.get('/sessions/draft', async (c) => {
  const user = c.get('user') as AuthUser
  const businessId = c.req.query('businessId')
  const type = c.req.query('type') || 'video' // default to video for backward compat
  if (!businessId) return c.json(null)
  try { await assertBusinessAccess(user, businessId) } catch { return c.json(null) }

  const draft = await db.generationSession.findFirst({
    where: { businessId, userId: user.userId, status: 'draft', type },
    orderBy: { updatedAt: 'desc' },
  })
  return c.json(draft)
})

// GET /api/sessions/:id — одна сессия
sessions.get('/sessions/:id', async (c) => {
  const { id } = c.req.param()
  const user = c.get('user') as AuthUser
  const session = await db.generationSession.findUnique({
    where: { id },
    include: { mediaFile: { select: { id: true, url: true, thumbUrl: true, filename: true, durationSec: true } } },
  })
  if (!session) return c.json({ error: 'Не найдена' }, 404)
  if (session.userId !== user.userId && (user as any).role !== 'ADMIN') {
    return c.json({ error: 'Нет доступа' }, 403)
  }
  return c.json(session)
})

// POST /api/sessions — создать сессию
const createSchema = z.object({
  businessId: z.string(),
  type: z.enum(['video', 'music', 'photo']).default('video'),
  prompt: z.string().default(''),
  // Video settings
  duration: z.number().int().min(4).max(15).default(4),
  aspectRatio: z.enum(['9:16', '1:1', '16:9']).default('9:16'),
  resolution: z.enum(['480p', '720p']).default('480p'),
  generateAudio: z.boolean().default(false),
  inputMode: z.enum(['text', 'frames', 'references']).default('references'),
  referenceImages: z.any().optional(),
  firstFrameUrl: z.string().optional().nullable(),
  lastFrameUrl: z.string().optional().nullable(),
  // Music settings
  customMode: z.boolean().optional(),
  instrumental: z.boolean().optional(),
  lyrics: z.string().optional(),
  musicStyle: z.string().max(1000).optional(),
  musicTitle: z.string().max(80).optional(),
  negativeTags: z.string().optional(),
  vocalGender: z.enum(['f', 'm']).optional().nullable(),
  styleWeight: z.number().min(0).max(1).optional(),
  weirdnessConstraint: z.number().min(0).max(1).optional(),
  audioWeight: z.number().min(0).max(1).optional(),
  personaId: z.string().optional().nullable(),
  sunoModel: z.string().optional(),
  // Photo settings
  photoModel: z.enum(['nano-banana-2', 'nano-banana-pro']).optional(),
  photoResolution: z.enum(['1K', '2K', '4K']).optional(),
  batchSize: z.number().int().min(1).max(4).optional(),
  photoAspectRatio: z.string().optional(),
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
      user: { connect: { id: user.userId } },
      status: 'draft',
    },
  })
  return c.json(session, 201)
})

// PUT /api/sessions/:id — обновить сессию (auto-save)
const updateSchema = z.object({
  title: z.string().optional(),
  prompt: z.string().optional(),
  promptHistory: z.any().optional(),
  chatHistory: z.any().optional(),
  // Video settings
  duration: z.number().int().min(4).max(15).optional(),
  aspectRatio: z.enum(['9:16', '1:1', '16:9']).optional(),
  resolution: z.enum(['480p', '720p']).optional(),
  generateAudio: z.boolean().optional(),
  inputMode: z.enum(['text', 'frames', 'references']).optional(),
  referenceImages: z.any().optional(),
  firstFrameUrl: z.string().optional().nullable(),
  lastFrameUrl: z.string().optional().nullable(),
  // Music settings
  customMode: z.boolean().optional(),
  instrumental: z.boolean().optional(),
  lyrics: z.string().optional(),
  musicStyle: z.string().max(1000).optional(),
  musicTitle: z.string().max(80).optional(),
  negativeTags: z.string().optional(),
  vocalGender: z.enum(['f', 'm']).optional().nullable(),
  styleWeight: z.number().min(0).max(1).optional(),
  weirdnessConstraint: z.number().min(0).max(1).optional(),
  audioWeight: z.number().min(0).max(1).optional(),
  personaId: z.string().optional().nullable(),
  sunoModel: z.string().optional(),
  // Photo settings
  photoModel: z.enum(['nano-banana-2', 'nano-banana-pro']).optional(),
  photoResolution: z.enum(['1K', '2K', '4K']).optional(),
  batchSize: z.number().int().min(1).max(4).optional(),
  photoAspectRatio: z.string().optional(),
  // Common
  status: z.enum(['draft', 'generating', 'completed', 'failed']).optional(),
  mediaFileId: z.string().optional().nullable(),
  resultUrl: z.string().optional().nullable(),
  results: z.any().optional(),
  errorMessage: z.string().optional().nullable(),
  costUsd: z.number().optional().nullable(),
})

sessions.put('/sessions/:id', async (c) => {
  const { id } = c.req.param()
  const user = c.get('user') as AuthUser
  const data = updateSchema.parse(await c.req.json())

  const existing = await db.generationSession.findUnique({ where: { id } })
  if (!existing) return c.json({ error: 'Не найдена' }, 404)
  if (existing.userId !== user.userId && (user as any).role !== 'ADMIN') {
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
  if (existing.userId !== user.userId && (user as any).role !== 'ADMIN') {
    return c.json({ error: 'Нет доступа' }, 403)
  }

  await db.generationSession.delete({ where: { id } })
  return c.json({ ok: true })
})

export { sessions }
