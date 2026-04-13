import { Hono } from 'hono'
import { z } from 'zod'
import { db } from '../db'
import type { AuthUser } from '../middleware/auth'
import { assertBusinessAccess } from '../middleware/resource-access'
import { getUserBusinessIds } from '../middleware/business-access'

const characters = new Hono()

const characterInclude = {
  referenceMedia: { select: { id: true, url: true, thumbUrl: true } },
  businesses: {
    select: {
      business: { select: { id: true, name: true, slug: true } },
    },
  },
} as const

// Helper: преобразовать Prisma результат в плоский формат для фронтенда
function formatCharacter(char: any) {
  return {
    ...char,
    businessIds: char.businesses?.map((b: any) => b.business.id) || [],
    businessNames: char.businesses?.map((b: any) => b.business.name) || [],
    businesses: undefined, // убрать вложенную структуру
  }
}

const characterSchema = z.object({
  name: z.string().min(1).max(100),
  description: z.string().max(1000).default(''),
  type: z.enum(['person', 'mascot', 'avatar']).default('person'),
  style: z.string().max(50).default(''),
  referenceMediaId: z.string().optional().nullable(),
  isActive: z.boolean().default(true),
  businessIds: z.array(z.string()).min(1, 'Выберите хотя бы 1 бизнес'),
})

// --- Глобальный CRUD ---

// GET /api/characters — все персонажи (опциональный ?businessId=X фильтр)
characters.get('/characters', async (c) => {
  const user = c.get('user') as AuthUser
  const filterBizId = c.req.query('businessId')

  let where: any = {}
  if (filterBizId) {
    // Фильтр по конкретному бизнесу
    try { await assertBusinessAccess(user, filterBizId) } catch (e: any) {
      if (e.message === 'FORBIDDEN') return c.json({ error: 'Нет доступа' }, 403); throw e
    }
    where = { businesses: { some: { businessId: filterBizId } } }
  } else if (user.role !== 'ADMIN') {
    // Все доступные
    const bizIds = await getUserBusinessIds(user)
    where = { businesses: { some: { businessId: { in: bizIds } } } }
  }

  const list = await db.character.findMany({
    where,
    include: characterInclude,
    orderBy: { createdAt: 'desc' },
  })
  return c.json(list.map(formatCharacter))
})

// GET /api/businesses/:bizId/characters — персонажи конкретного бизнеса
characters.get('/businesses/:bizId/characters', async (c) => {
  const bizId = c.req.param('bizId')
  const user = c.get('user') as AuthUser
  try { await assertBusinessAccess(user, bizId) } catch (e: any) {
    if (e.message === 'FORBIDDEN') return c.json({ error: 'Нет доступа' }, 403); throw e
  }

  const list = await db.character.findMany({
    where: { businesses: { some: { businessId: bizId } } },
    include: characterInclude,
    orderBy: { createdAt: 'desc' },
  })
  return c.json(list.map(formatCharacter))
})

// POST /api/characters — создать персонажа + привязать к бизнесам
characters.post('/characters', async (c) => {
  const user = c.get('user') as AuthUser
  const body = await c.req.json()
  const { businessIds, ...data } = characterSchema.parse(body)

  // Проверить доступ хотя бы к одному бизнесу
  for (const bizId of businessIds) {
    try { await assertBusinessAccess(user, bizId) } catch (e: any) {
      if (e.message === 'FORBIDDEN') return c.json({ error: `Нет доступа к бизнесу ${bizId}` }, 403); throw e
    }
  }

  const character = await db.character.create({
    data: {
      ...data,
      businesses: {
        create: businessIds.map(bizId => ({ businessId: bizId })),
      },
    },
    include: characterInclude,
  })
  return c.json(formatCharacter(character), 201)
})

// Обратная совместимость: POST /api/businesses/:bizId/characters
characters.post('/businesses/:bizId/characters', async (c) => {
  const bizId = c.req.param('bizId')
  const user = c.get('user') as AuthUser
  try { await assertBusinessAccess(user, bizId) } catch (e: any) {
    if (e.message === 'FORBIDDEN') return c.json({ error: 'Нет доступа' }, 403); throw e
  }

  const body = await c.req.json()
  const data = characterSchema.omit({ businessIds: true }).parse(body)

  const character = await db.character.create({
    data: {
      ...data,
      businesses: { create: [{ businessId: bizId }] },
    },
    include: characterInclude,
  })
  return c.json(formatCharacter(character), 201)
})

// GET /api/characters/:id — получить персонажа
characters.get('/characters/:id', async (c) => {
  const { id } = c.req.param()
  const user = c.get('user') as AuthUser

  const character = await db.character.findUnique({
    where: { id },
    include: characterInclude,
  })
  if (!character) return c.json({ error: 'Не найден' }, 404)

  // Проверить доступ хотя бы к одному привязанному бизнесу
  if (user.role !== 'ADMIN') {
    const bizIds = await getUserBusinessIds(user)
    const hasAccess = character.businesses.some(b => bizIds.includes(b.business.id))
    if (!hasAccess) return c.json({ error: 'Нет доступа' }, 403)
  }

  return c.json(formatCharacter(character))
})

// PUT /api/characters/:id — обновить персонажа (+ пересоздать привязки)
characters.put('/characters/:id', async (c) => {
  const { id } = c.req.param()
  const user = c.get('user') as AuthUser

  const existing = await db.character.findUnique({
    where: { id },
    include: { businesses: true },
  })
  if (!existing) return c.json({ error: 'Не найден' }, 404)

  // Проверить доступ хотя бы к одному текущему бизнесу
  if (user.role !== 'ADMIN') {
    const bizIds = await getUserBusinessIds(user)
    const hasAccess = existing.businesses.some(b => bizIds.includes(b.businessId))
    if (!hasAccess) return c.json({ error: 'Нет доступа' }, 403)
  }

  const body = await c.req.json()
  const { businessIds, ...data } = characterSchema.partial().extend({
    businessIds: z.array(z.string()).optional(),
  }).parse(body)

  // Если передали businessIds — пересоздать привязки
  const updateData: any = { ...data }
  if (businessIds) {
    for (const bizId of businessIds) {
      try { await assertBusinessAccess(user, bizId) } catch (e: any) {
        if (e.message === 'FORBIDDEN') return c.json({ error: `Нет доступа к бизнесу ${bizId}` }, 403); throw e
      }
    }
    // Удалить старые + создать новые в транзакции
    await db.$transaction([
      db.characterBusiness.deleteMany({ where: { characterId: id } }),
      ...businessIds.map(bizId =>
        db.characterBusiness.create({ data: { characterId: id, businessId: bizId } })
      ),
    ])
  }

  const updated = await db.character.update({
    where: { id },
    data: updateData,
    include: characterInclude,
  })
  return c.json(formatCharacter(updated))
})

// DELETE /api/characters/:id — удалить персонажа глобально
characters.delete('/characters/:id', async (c) => {
  const { id } = c.req.param()
  const user = c.get('user') as AuthUser

  const existing = await db.character.findUnique({
    where: { id },
    include: { businesses: true },
  })
  if (!existing) return c.json({ error: 'Не найден' }, 404)

  // ADMIN или доступ хотя бы к одному бизнесу
  if (user.role !== 'ADMIN') {
    const bizIds = await getUserBusinessIds(user)
    const hasAccess = existing.businesses.some(b => bizIds.includes(b.businessId))
    if (!hasAccess) return c.json({ error: 'Нет доступа' }, 403)
  }

  await db.character.delete({ where: { id } })
  return c.json({ ok: true })
})

// DELETE /api/businesses/:bizId/characters/:charId — отвязать от бизнеса (не удаляет)
characters.delete('/businesses/:bizId/characters/:charId', async (c) => {
  const bizId = c.req.param('bizId')
  const charId = c.req.param('charId')
  const user = c.get('user') as AuthUser

  try { await assertBusinessAccess(user, bizId) } catch (e: any) {
    if (e.message === 'FORBIDDEN') return c.json({ error: 'Нет доступа' }, 403); throw e
  }

  await db.characterBusiness.deleteMany({
    where: { characterId: charId, businessId: bizId },
  })
  return c.json({ ok: true })
})

export { characters }
