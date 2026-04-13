import { Hono } from 'hono'
import { z } from 'zod'
import { db } from '../db'
import type { AuthUser } from '../middleware/auth'
import { requireRole } from '../middleware/auth'

const promptTemplates = new Hono()

// GET /api/prompt-templates?type=video&businessId=
promptTemplates.get('/', async (c) => {
  const type = c.req.query('type')
  const businessId = c.req.query('businessId')

  const where: any = {}
  if (type) where.type = type

  // Глобальные (businessId=null) + бизнес-специфичные
  if (businessId) {
    where.OR = [{ businessId: null }, { businessId }]
  }

  const templates = await db.promptTemplate.findMany({
    where,
    orderBy: [{ sortOrder: 'asc' }, { createdAt: 'desc' }],
  })
  return c.json(templates)
})

const templateSchema = z.object({
  businessId: z.string().optional().nullable(),
  type: z.enum(['video', 'image', 'text']).default('video'),
  name: z.string().min(1).max(100),
  emoji: z.string().max(4).default(''),
  prompt: z.string().min(1),
  tags: z.array(z.string()).default([]),
  sortOrder: z.number().int().default(0),
})

// POST /api/prompt-templates (ADMIN only)
promptTemplates.post('/', requireRole('ADMIN'), async (c) => {
  const data = templateSchema.parse(await c.req.json())
  const template = await db.promptTemplate.create({ data })
  return c.json(template, 201)
})

// PUT /api/prompt-templates/:id (ADMIN only)
promptTemplates.put('/:id', requireRole('ADMIN'), async (c) => {
  const { id } = c.req.param()
  const existing = await db.promptTemplate.findUnique({ where: { id } })
  if (!existing) return c.json({ error: 'Не найден' }, 404)
  if (existing.isSystem) return c.json({ error: 'Системный шаблон нельзя редактировать' }, 403)

  const data = templateSchema.partial().parse(await c.req.json())
  const updated = await db.promptTemplate.update({ where: { id }, data })
  return c.json(updated)
})

// DELETE /api/prompt-templates/:id (ADMIN only)
promptTemplates.delete('/:id', requireRole('ADMIN'), async (c) => {
  const { id } = c.req.param()
  const existing = await db.promptTemplate.findUnique({ where: { id } })
  if (!existing) return c.json({ error: 'Не найден' }, 404)
  if (existing.isSystem) return c.json({ error: 'Системный шаблон нельзя удалить' }, 403)

  await db.promptTemplate.delete({ where: { id } })
  return c.json({ ok: true })
})

export { promptTemplates }
