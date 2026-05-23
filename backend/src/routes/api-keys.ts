import { Hono } from 'hono'
import { z } from 'zod'
import { randomBytes, createHash } from 'crypto'
import { db } from '../db'
import { requireRole, type AuthUser } from '../middleware/auth'

export const apiKeys = new Hono()

// All routes require ADMIN
apiKeys.use('*', requireRole('ADMIN'))

const createSchema = z.object({
  name: z.string().min(1).max(100),
  userId: z.string().optional(), // defaults to current user
})

// POST /api/api-keys — create key (returns plain key ONCE)
apiKeys.post('/', async (c) => {
  const body = await c.req.json()
  const { name, userId } = createSchema.parse(body)
  const user = c.get('user') as AuthUser

  const plainKey = `cf_${randomBytes(32).toString('hex')}`
  const keyHash = createHash('sha256').update(plainKey).digest('hex')

  const apiKey = await db.apiKey.create({
    data: {
      keyHash,
      name,
      userId: userId ?? user.userId,
    },
    select: { id: true, name: true, createdAt: true },
  })

  return c.json({ ...apiKey, key: plainKey }, 201)
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
      user: { select: { id: true, name: true } },
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
