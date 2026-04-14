import { Hono } from 'hono'
import { z } from 'zod'
import { db } from '../db'
import type { AuthUser } from '../middleware/auth'
import { SECTIONS } from '../shared/section-access'

const users = new Hono()

// All users routes require ADMIN role (enforced in app.ts middleware)

// GET /api/users — list all users with their business access
users.get('/', async (c) => {
  const list = await db.user.findMany({
    orderBy: { createdAt: 'desc' },
    select: {
      id: true,
      login: true,
      name: true,
      role: true,
      isActive: true,
      sectionAccess: true,
      createdAt: true,
      businesses: {
        select: {
          businessId: true,
          role: true,
          business: { select: { id: true, name: true, slug: true } },
        },
      },
    },
  })
  return c.json(list)
})

// POST /api/users — create a new user
const sectionAccessSchema = z.record(
  z.enum(SECTIONS as unknown as [string, ...string[]]),
  z.enum(['full', 'view', 'none']),
).nullable().optional()

const createUserSchema = z.object({
  login: z.string().min(2).max(50),
  password: z.string().min(4).max(100),
  name: z.string().min(1).max(100),
  role: z.enum(['ADMIN', 'EDITOR', 'VIEWER']).default('EDITOR'),
  businessIds: z.array(z.string()).default([]),
  sectionAccess: sectionAccessSchema,
})

users.post('/', async (c) => {
  const body = createUserSchema.parse(await c.req.json())

  // Check login uniqueness
  const existing = await db.user.findUnique({ where: { login: body.login } })
  if (existing) {
    return c.json({ error: 'Логин уже занят' }, 409)
  }

  const passwordHash = await Bun.password.hash(body.password)

  const user = await db.user.create({
    data: {
      login: body.login,
      passwordHash,
      name: body.name,
      role: body.role,
      sectionAccess: body.sectionAccess ?? undefined,
      businesses: {
        create: body.businessIds.map((bizId) => ({
          businessId: bizId,
          role: body.role,
        })),
      },
    },
    select: {
      id: true,
      login: true,
      name: true,
      role: true,
      isActive: true,
      sectionAccess: true,
      businesses: {
        select: {
          businessId: true,
          role: true,
          business: { select: { id: true, name: true } },
        },
      },
    },
  })

  return c.json(user, 201)
})

// PUT /api/users/:id — update user (name, role, active, business access)
const updateUserSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  role: z.enum(['ADMIN', 'EDITOR', 'VIEWER']).optional(),
  isActive: z.boolean().optional(),
  password: z.string().min(4).max(100).optional(),
  businessIds: z.array(z.string()).optional(),
  sectionAccess: sectionAccessSchema,
})

users.put('/:id', async (c) => {
  const id = c.req.param('id')
  const body = updateUserSchema.parse(await c.req.json())
  const currentUser = c.get('user') as AuthUser

  // Prevent self-deactivation
  if (id === currentUser.userId && body.isActive === false) {
    return c.json({ error: 'Нельзя деактивировать себя' }, 400)
  }

  const data: Record<string, unknown> = {}
  if (body.name !== undefined) data.name = body.name
  if (body.role !== undefined) data.role = body.role
  if (body.isActive !== undefined) data.isActive = body.isActive
  if (body.password) data.passwordHash = await Bun.password.hash(body.password)
  if (body.sectionAccess !== undefined) data.sectionAccess = body.sectionAccess

  const user = await db.user.update({
    where: { id },
    data,
    select: { id: true, login: true, name: true, role: true, isActive: true },
  })

  // Update business access if provided
  if (body.businessIds !== undefined) {
    // Delete existing and recreate
    await db.userBusiness.deleteMany({ where: { userId: id } })
    if (body.businessIds.length > 0) {
      await db.userBusiness.createMany({
        data: body.businessIds.map((bizId) => ({
          userId: id,
          businessId: bizId,
          role: body.role || user.role,
        })),
      })
    }
  }

  return c.json(user)
})

export { users }
