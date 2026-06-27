import { Hono } from 'hono'
import { z } from 'zod'
import { Prisma } from '@prisma/client'
import { db } from '../db'
import type { AuthUser } from '../middleware/auth'
import { assertBusinessAccess } from '../middleware/resource-access'
import { getUserBusinessIds } from '../middleware/business-access'
import { requireSection } from '../middleware/section-access'

const characters = new Hono()

// Section-level access: все character-маршруты требуют доступ к разделу "characters"
characters.use('/characters/*', requireSection('characters'))
characters.use('/businesses/*/characters', requireSection('characters'))
characters.use('/businesses/*/characters/*', requireSection('characters'))

// --- Includes & formatting ---

const characterInclude = {
  // Legacy field (backward compat) — will be removed after migration
  referenceMedia: { select: { id: true, url: true, thumbUrl: true } },
  // New: gallery of images
  images: {
    select: {
      id: true, description: true, isMain: true, sortOrder: true, source: true,
      mediaFile: { select: { id: true, url: true, thumbUrl: true, filename: true } },
    },
    orderBy: { sortOrder: 'asc' as const },
  },
  businesses: {
    select: {
      business: { select: { id: true, name: true, slug: true } },
    },
  },
} as const

function formatImage(img: any) {
  return {
    id: img.id,
    url: img.mediaFile?.url,
    thumbUrl: img.mediaFile?.thumbUrl,
    filename: img.mediaFile?.filename,
    mediaFileId: img.mediaFile?.id,
    description: img.description,
    isMain: img.isMain,
    sortOrder: img.sortOrder,
    source: img.source,
  }
}

// Helper: преобразовать Prisma результат в плоский формат для фронтенда
function formatCharacter(char: any) {
  const mainImage = char.images?.find((i: any) => i.isMain)
  return {
    ...char,
    // Backward compat: referenceMedia computed from images
    referenceMedia: mainImage?.mediaFile || char.referenceMedia || null,
    // New: full image gallery
    images: char.images?.map(formatImage) || [],
    businessIds: char.businesses?.map((b: any) => b.business.id) || [],
    businessNames: char.businesses?.map((b: any) => b.business.name) || [],
    businesses: undefined, // убрать вложенную структуру
  }
}

// --- Access check helper ---

async function assertCharacterAccess(user: AuthUser, characterId: string) {
  const character = await db.character.findUnique({
    where: { id: characterId },
    include: { businesses: true },
  })
  if (!character) return null

  if (user.role !== 'ADMIN') {
    const bizIds = (await getUserBusinessIds(user)) ?? []
    const hasAccess = character.businesses.some(b => bizIds.includes(b.businessId))
    if (!hasAccess) return null
  }

  return character
}

// --- Schemas ---

const characterSchema = z.object({
  name: z.string().min(1).max(100),
  description: z.string().max(1000).default(''),
  type: z.enum(['person', 'mascot', 'avatar', 'object', 'location']).default('person'),
  style: z.string().max(50).default(''),
  // Legacy fields — kept for backward compat during migration
  referenceMediaId: z.string().optional().nullable(),
  additionalAngles: z.array(z.object({
    url: z.string(), thumbUrl: z.string().nullable(), filename: z.string(),
  })).max(3).optional().nullable(),
  isActive: z.boolean().default(true),
  businessIds: z.array(z.string()).min(1, 'Выберите хотя бы 1 бизнес'),
})

const imageSchema = z.object({
  mediaFileId: z.string().min(1),
  description: z.string().max(500).default(''),
  isMain: z.boolean().default(false),
})

const imageUpdateSchema = z.object({
  description: z.string().max(500).optional(),
  isMain: z.boolean().optional(),
})

const reorderSchema = z.object({
  items: z.array(z.object({
    id: z.string(),
    sortOrder: z.number().int().min(0),
  })),
})

// ============================================================
// CHARACTER CRUD
// ============================================================

// GET /api/characters — все персонажи (опциональный ?businessId=X фильтр)
characters.get('/characters', async (c) => {
  const user = c.get('user') as AuthUser
  const filterBizId = c.req.query('businessId')

  let where: any = {}
  if (filterBizId) {
    try { await assertBusinessAccess(user, filterBizId) } catch (e: any) {
      if (e.message === 'FORBIDDEN') return c.json({ error: 'Нет доступа' }, 403); throw e
    }
    where = { businesses: { some: { businessId: filterBizId } } }
  } else if (user.role !== 'ADMIN') {
    const bizIds = (await getUserBusinessIds(user)) ?? []
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
    } as Prisma.CharacterUncheckedCreateInput,
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
    } as Prisma.CharacterUncheckedCreateInput,
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

  if (user.role !== 'ADMIN') {
    const bizIds = (await getUserBusinessIds(user)) ?? []
    const hasAccess = character.businesses.some(b => bizIds.includes(b.business.id))
    if (!hasAccess) return c.json({ error: 'Нет доступа' }, 403)
  }

  return c.json(formatCharacter(character))
})

// PUT /api/characters/:id — обновить персонажа (+ пересоздать привязки)
characters.put('/characters/:id', async (c) => {
  const { id } = c.req.param()
  const user = c.get('user') as AuthUser

  const existing = await assertCharacterAccess(user, id)
  if (!existing) return c.json({ error: 'Не найден или нет доступа' }, 404)

  const body = await c.req.json()
  const { businessIds, ...data } = characterSchema.partial().extend({
    businessIds: z.array(z.string()).optional(),
  }).parse(body)

  if (businessIds) {
    for (const bizId of businessIds) {
      try { await assertBusinessAccess(user, bizId) } catch (e: any) {
        if (e.message === 'FORBIDDEN') return c.json({ error: `Нет доступа к бизнесу ${bizId}` }, 403); throw e
      }
    }
    await db.$transaction([
      db.characterBusiness.deleteMany({ where: { characterId: id } }),
      ...businessIds.map(bizId =>
        db.characterBusiness.create({ data: { characterId: id, businessId: bizId } })
      ),
    ])
  }

  const updated = await db.character.update({
    where: { id },
    data: data as Prisma.CharacterUncheckedUpdateInput,
    include: characterInclude,
  })
  return c.json(formatCharacter(updated))
})

// DELETE /api/characters/:id — удалить персонажа глобально
characters.delete('/characters/:id', async (c) => {
  const { id } = c.req.param()
  const user = c.get('user') as AuthUser

  const existing = await assertCharacterAccess(user, id)
  if (!existing) return c.json({ error: 'Не найден или нет доступа' }, 404)

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

// ============================================================
// CHARACTER IMAGES CRUD
// ============================================================

// POST /api/characters/:id/images — добавить фото к персонажу
characters.post('/characters/:id/images', async (c) => {
  const { id } = c.req.param()
  const user = c.get('user') as AuthUser

  const existing = await assertCharacterAccess(user, id)
  if (!existing) return c.json({ error: 'Не найден или нет доступа' }, 404)

  const body = await c.req.json()
  const data = imageSchema.parse(body)

  // If setting as main, unset other main images
  if (data.isMain) {
    await db.characterImage.updateMany({
      where: { characterId: id, isMain: true },
      data: { isMain: false },
    })
  }

  // Auto sortOrder: max + 1
  const maxSort = await db.characterImage.aggregate({
    where: { characterId: id },
    _max: { sortOrder: true },
  })
  const sortOrder = (maxSort._max.sortOrder ?? -1) + 1

  // If first image, auto-set as main
  const count = await db.characterImage.count({ where: { characterId: id } })
  const isMain = data.isMain || count === 0

  const image = await db.characterImage.create({
    data: {
      characterId: id,
      mediaFileId: data.mediaFileId,
      description: data.description,
      isMain,
      sortOrder,
    },
    include: {
      mediaFile: { select: { id: true, url: true, thumbUrl: true, filename: true } },
    },
  })

  return c.json(formatImage(image), 201)
})

// PUT /api/characters/:id/images/:imgId — обновить описание/isMain
characters.put('/characters/:id/images/:imgId', async (c) => {
  const { id, imgId } = c.req.param()
  const user = c.get('user') as AuthUser

  const existing = await assertCharacterAccess(user, id)
  if (!existing) return c.json({ error: 'Не найден или нет доступа' }, 404)

  const body = await c.req.json()
  const data = imageUpdateSchema.parse(body)

  // If setting as main, unset other main images
  if (data.isMain) {
    await db.characterImage.updateMany({
      where: { characterId: id, isMain: true },
      data: { isMain: false },
    })
  }

  const image = await db.characterImage.update({
    where: { id: imgId },
    data,
    include: {
      mediaFile: { select: { id: true, url: true, thumbUrl: true, filename: true } },
    },
  })

  return c.json(formatImage(image))
})

// DELETE /api/characters/:id/images/:imgId — удалить фото
characters.delete('/characters/:id/images/:imgId', async (c) => {
  const { id, imgId } = c.req.param()
  const user = c.get('user') as AuthUser

  const existing = await assertCharacterAccess(user, id)
  if (!existing) return c.json({ error: 'Не найден или нет доступа' }, 404)

  const image = await db.characterImage.findUnique({ where: { id: imgId } })
  if (!image || image.characterId !== id) return c.json({ error: 'Фото не найдено' }, 404)

  await db.characterImage.delete({ where: { id: imgId } })

  // If deleted image was main, promote next one
  if (image.isMain) {
    const next = await db.characterImage.findFirst({
      where: { characterId: id },
      orderBy: { sortOrder: 'asc' },
    })
    if (next) {
      await db.characterImage.update({ where: { id: next.id }, data: { isMain: true } })
    }
  }

  return c.json({ ok: true })
})

// POST /api/characters/:id/images/reorder — batch reorder
characters.post('/characters/:id/images/reorder', async (c) => {
  const { id } = c.req.param()
  const user = c.get('user') as AuthUser

  const existing = await assertCharacterAccess(user, id)
  if (!existing) return c.json({ error: 'Не найден или нет доступа' }, 404)

  const body = await c.req.json()
  const { items } = reorderSchema.parse(body)

  await db.$transaction(
    items.map(item =>
      db.characterImage.updateMany({
        where: { id: item.id, characterId: id },
        data: { sortOrder: item.sortOrder },
      })
    )
  )

  return c.json({ ok: true })
})

// ============================================================
// CHARACTER SHEET GENERATION
// ============================================================

// POST /api/characters/:id/generate-sheet — AI character sheet generation
characters.post('/characters/:id/generate-sheet', async (c) => {
  const { id } = c.req.param()
  const user = c.get('user') as AuthUser

  const character = await db.character.findUnique({
    where: { id },
    include: {
      images: {
        include: { mediaFile: { select: { url: true } } },
        orderBy: { sortOrder: 'asc' },
      },
      businesses: { select: { businessId: true } },
    },
  })
  if (!character) return c.json({ error: 'Не найден' }, 404)

  if (user.role !== 'ADMIN') {
    const bizIds = (await getUserBusinessIds(user)) ?? []
    const hasAccess = character.businesses.some(b => bizIds.includes(b.businessId))
    if (!hasAccess) return c.json({ error: 'Нет доступа' }, 403)
  }

  if (character.images.length === 0) {
    return c.json({ error: 'Загрузите хотя бы 1 фото персонажа' }, 400)
  }

  const businessId = character.businesses[0]?.businessId
  if (!businessId) return c.json({ error: 'Персонаж не привязан к бизнесу' }, 400)

  // Dynamic import to avoid circular dependencies
  const { createPhotoTask } = await import('../services/ai/kie')

  // Build prompt for character sheet
  const charDesc = character.description
    ? `${character.name} — ${character.description}`
    : character.name
  const styleNote = character.style ? `. Style: ${character.style}` : ''
  const prompt = `Photorealistic reference sheet of ${charDesc}${styleNote}. Professional photography quality, studio lighting, highly detailed, real photo. Show 8 views on clean white background arranged in 2 rows of 4: Top row — full body front view, full body 3/4 left view, full body 3/4 right view, full body back view. Bottom row — close-up face front, close-up face 3/4 left, close-up face 3/4 right, close-up face profile. The person must look exactly the same in every view. NOT illustration, NOT cartoon, NOT anime — photorealistic only.`

  // Use character images as reference
  const referenceImageUrls = character.images
    .filter(img => img.mediaFile?.url)
    .map(img => img.mediaFile!.url)

  const result = await createPhotoTask({
    prompt,
    businessId,
    model: 'nano-banana-pro', // Pro for quality
    resolution: '2K',
    aspectRatio: '16:9', // Landscape for 4-view layout
    referenceImageUrls,
    userId: user.userId,
  })

  // Create a photo session to track the generation
  const session = await db.generationSession.create({
    data: {
      business: { connect: { id: businessId } },
      user: { connect: { id: user.userId } },
      type: 'photo',
      title: `Character Sheet: ${character.name}`,
      prompt,
      photoModel: 'nano-banana-pro',
      photoResolution: '2K',
      photoAspectRatio: '16:9',
      batchSize: 1,
      status: 'generating',
      kieTaskId: result.kieTaskId,
      kieTaskCreatedAt: new Date(),
      // Store characterId in metadata for the poller to find
      referenceImages: JSON.parse(JSON.stringify({
        characterSheetFor: id,
        characterName: character.name,
      })),
    },
  })

  return c.json({
    sessionId: session.id,
    kieTaskId: result.kieTaskId,
    message: 'Генерация карты персонажа запущена',
  }, 202)
})

export { characters }
