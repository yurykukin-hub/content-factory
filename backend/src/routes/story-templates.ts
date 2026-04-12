import { Hono } from 'hono'
import { z } from 'zod'
import { db } from '../db'
import type { AuthUser } from '../middleware/auth'
import { assertBusinessAccess } from '../middleware/resource-access'

const storyTemplates = new Hono()

const templateSchema = z.object({
  name: z.string().min(1).max(50),
  emoji: z.string().max(4).default(''),
  overlayText: z.string().max(500).default(''),
  textPosition: z.enum(['top', 'center', 'bottom']).default('bottom'),
  textColor: z.string().max(20).default('#ffffff'),
  fontSize: z.enum(['S', 'M', 'L']).default('M'),
  bgStyle: z.enum(['dark', 'light', 'none']).default('dark'),
  linkType: z.string().max(20).default(''),
  sortOrder: z.number().int().default(0),
})

// GET /api/businesses/:bizId/story-templates
storyTemplates.get('/businesses/:bizId/story-templates', async (c) => {
  const bizId = c.req.param('bizId')
  const user = c.get('user') as AuthUser
  try { await assertBusinessAccess(user, bizId) } catch (e: any) {
    if (e.message === 'FORBIDDEN') return c.json({ error: 'Нет доступа' }, 403); throw e
  }

  const templates = await db.storyTemplate.findMany({
    where: { businessId: bizId },
    orderBy: { sortOrder: 'asc' },
  })
  return c.json(templates)
})

// POST /api/businesses/:bizId/story-templates
storyTemplates.post('/businesses/:bizId/story-templates', async (c) => {
  const bizId = c.req.param('bizId')
  const user = c.get('user') as AuthUser
  try { await assertBusinessAccess(user, bizId) } catch (e: any) {
    if (e.message === 'FORBIDDEN') return c.json({ error: 'Нет доступа' }, 403); throw e
  }

  const data = templateSchema.parse(await c.req.json())
  const template = await db.storyTemplate.create({
    data: { ...data, businessId: bizId },
  })
  return c.json(template, 201)
})

// PUT /api/story-templates/:id
storyTemplates.put('/story-templates/:id', async (c) => {
  const { id } = c.req.param()
  const user = c.get('user') as AuthUser
  const existing = await db.storyTemplate.findUnique({ where: { id } })
  if (!existing) return c.json({ error: 'Не найден' }, 404)

  try { await assertBusinessAccess(user, existing.businessId) } catch (e: any) {
    if (e.message === 'FORBIDDEN') return c.json({ error: 'Нет доступа' }, 403); throw e
  }

  const data = templateSchema.partial().parse(await c.req.json())
  const updated = await db.storyTemplate.update({ where: { id }, data })
  return c.json(updated)
})

// DELETE /api/story-templates/:id
storyTemplates.delete('/story-templates/:id', async (c) => {
  const { id } = c.req.param()
  const user = c.get('user') as AuthUser
  const existing = await db.storyTemplate.findUnique({ where: { id } })
  if (!existing) return c.json({ error: 'Не найден' }, 404)

  try { await assertBusinessAccess(user, existing.businessId) } catch (e: any) {
    if (e.message === 'FORBIDDEN') return c.json({ error: 'Нет доступа' }, 403); throw e
  }

  await db.storyTemplate.delete({ where: { id } })
  return c.json({ ok: true })
})

export { storyTemplates }
