import { Hono } from 'hono'
import { z } from 'zod'
import { randomBytes, createHash } from 'crypto'
import { Prisma } from '@prisma/client'
import { db } from '../db'
import { requireRole, type AuthUser } from '../middleware/auth'
import { SECTIONS } from '../shared/section-access'

export const apiKeys = new Hono()

// All routes require ADMIN
apiKeys.use('*', requireRole('ADMIN'))

const levelSchema = z.enum(['none', 'view', 'full'])
const scopeSchema = z.record(z.enum(SECTIONS as unknown as [string, ...string[]]), levelSchema)

const createSchema = z.object({
  name: z.string().min(1).max(100),
  userId: z.string().optional(), // defaults to current user
  // Белый список разделов для ключа. Пусто = права владельца целиком (как раньше).
  sectionAccess: scopeSchema.optional(),
})

// POST /api/api-keys — create key (returns plain key ONCE)
apiKeys.post('/', async (c) => {
  const body = await c.req.json()
  const { name, userId, sectionAccess } = createSchema.parse(body)
  const user = c.get('user') as AuthUser

  const plainKey = `cf_${randomBytes(32).toString('hex')}`
  const keyHash = createHash('sha256').update(plainKey).digest('hex')

  const apiKey = await db.apiKey.create({
    data: {
      keyHash,
      name,
      userId: userId ?? user.userId,
      sectionAccess: sectionAccess && Object.keys(sectionAccess).length ? sectionAccess : undefined,
    },
    select: { id: true, name: true, createdAt: true, sectionAccess: true },
  })

  return c.json({ ...apiKey, key: plainKey }, 201)
})

// PATCH /api/api-keys/:id — изменить область действия без перевыпуска ключа
apiKeys.patch('/:id', async (c) => {
  const { id } = c.req.param()
  const { sectionAccess } = z
    .object({ sectionAccess: scopeSchema.nullable() })
    .parse(await c.req.json())

  const existing = await db.apiKey.findUnique({ where: { id }, select: { id: true } })
  if (!existing) return c.json({ error: 'Ключ не найден' }, 404)

  const updated = await db.apiKey.update({
    where: { id },
    // Prisma.DbNull, а не null: для Json-поля обычный null означает «не менять».
    data: {
      sectionAccess:
        sectionAccess && Object.keys(sectionAccess).length ? sectionAccess : Prisma.DbNull,
    },
    select: { id: true, name: true, sectionAccess: true },
  })
  return c.json(updated)
})

// GET /api/api-keys — list keys (without actual key)
apiKeys.get('/', async (c) => {
  const keys = await db.apiKey.findMany({
    orderBy: { createdAt: 'desc' },
    select: {
      id: true,
      name: true,
      isActive: true,
      lastUsed: true,
      createdAt: true,
      sectionAccess: true,
      user: { select: { id: true, name: true, role: true } },
    },
  })
  return c.json(keys)
})

// DELETE /api/api-keys/:id — deactivate
apiKeys.delete('/:id', async (c) => {
  const { id } = c.req.param()
  await db.apiKey.update({
    where: { id },
    data: { isActive: false },
  })
  return c.json({ ok: true })
})
