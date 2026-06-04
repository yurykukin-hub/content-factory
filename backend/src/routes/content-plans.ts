import { Hono } from 'hono'
import { z } from 'zod'
import { db } from '../db'
import { emitEvent } from '../eventBus'
import type { AuthUser } from '../middleware/auth'
import { verifyPlanAccess, verifyPlanItemAccess, assertBusinessAccess } from '../middleware/resource-access'

const contentPlans = new Hono()

// D1: краткие сводки недавних постов (чтобы AI не повторялся)
async function getRecentPostSummaries(businessId: string, take = 8): Promise<string[]> {
  const posts = await db.post.findMany({
    where: { businessId },
    orderBy: { createdAt: 'desc' },
    take,
    select: { title: true, body: true },
  })
  return posts
    .map(p => ((p.title ? p.title + ': ' : '') + (p.body || '').replace(/\s+/g, ' ').slice(0, 80)).trim())
    .filter(Boolean)
}

// POST /api/plans/import — импорт плана с готовыми items (без AI)
const importSchema = z.object({
  businessId: z.string(),
  title: z.string().min(1),
  startDate: z.string().transform((s) => new Date(s)),
  endDate: z.string().transform((s) => new Date(s)),
  items: z.array(z.object({
    date: z.string(),
    dayOfWeek: z.string(),
    topic: z.string(),
    postType: z.enum(['TEXT', 'PHOTO', 'VIDEO', 'REELS', 'CLIPS', 'STORIES']).default('PHOTO'),
    description: z.string().optional(),
  })).min(1).max(100),
  skipPastDates: z.boolean().default(true),
})

contentPlans.post('/plans/import', async (c) => {
  const data = importSchema.parse(await c.req.json())
  const user = c.get('user') as AuthUser
  try {
    await assertBusinessAccess(user, data.businessId)
  } catch (e: any) {
    if (e.message === 'FORBIDDEN') return c.json({ error: 'Нет доступа' }, 403)
    throw e
  }

  const today = new Date().toISOString().slice(0, 10)

  const plan = await db.contentPlan.create({
    data: {
      businessId: data.businessId,
      title: data.title,
      startDate: data.startDate,
      endDate: data.endDate,
      generatedBy: 'import',
      items: {
        create: data.items.map((item) => ({
          date: new Date(item.date),
          dayOfWeek: item.dayOfWeek,
          topic: item.topic,
          postType: item.postType,
          description: item.description || null,
          status: data.skipPastDates && item.date < today ? 'SKIPPED' : 'PLANNED',
        })),
      },
    },
    include: {
      items: { orderBy: { date: 'asc' } },
    },
  })

  emitEvent({ type: 'plan_created', tabId: c.req.header('X-Tab-ID') || '', planId: plan.id })
  return c.json({ plan }, 201)
})

// GET /api/businesses/:bizId/plans
contentPlans.get('/:bizId/plans', async (c) => {
  const { bizId } = c.req.param()
  const plans = await db.contentPlan.findMany({
    where: { businessId: bizId },
    include: { _count: { select: { items: true } } },
    orderBy: { startDate: 'desc' },
  })
  return c.json(plans)
})

// GET /api/plans/:id
contentPlans.get('/plans/:id', async (c) => {
  const { id } = c.req.param()
  const user = c.get('user') as AuthUser
  try {
    await verifyPlanAccess(user, id)
  } catch (e: any) {
    if (e.message === 'NOT_FOUND') return c.json({ error: 'Не найдено' }, 404)
    if (e.message === 'FORBIDDEN') return c.json({ error: 'Нет доступа' }, 403)
    throw e
  }
  const plan = await db.contentPlan.findUnique({
    where: { id },
    include: {
      items: {
        include: { post: { select: { id: true, status: true, title: true } } },
        orderBy: { date: 'asc' },
      },
    },
  })
  if (!plan) return c.json({ error: 'План не найден' }, 404)
  return c.json(plan)
})

const createSchema = z.object({
  businessId: z.string(),
  title: z.string().min(1),
  startDate: z.string().transform((s) => new Date(s)),
  endDate: z.string().transform((s) => new Date(s)),
})

// POST /api/plans
contentPlans.post('/plans', async (c) => {
  const data = createSchema.parse(await c.req.json())
  const user = c.get('user') as AuthUser
  try {
    await assertBusinessAccess(user, data.businessId)
  } catch (e: any) {
    if (e.message === 'FORBIDDEN') return c.json({ error: 'Нет доступа' }, 403)
    throw e
  }
  const plan = await db.contentPlan.create({ data })
  emitEvent({ type: 'plan_created', tabId: c.req.header('X-Tab-ID') || '', planId: plan.id })
  return c.json(plan, 201)
})

// PUT /api/plans/:id
contentPlans.put('/plans/:id', async (c) => {
  const { id } = c.req.param()
  const user = c.get('user') as AuthUser
  try {
    await verifyPlanAccess(user, id)
  } catch (e: any) {
    if (e.message === 'NOT_FOUND') return c.json({ error: 'Не найдено' }, 404)
    if (e.message === 'FORBIDDEN') return c.json({ error: 'Нет доступа' }, 403)
    throw e
  }
  const data = await c.req.json()
  const plan = await db.contentPlan.update({ where: { id }, data })
  emitEvent({ type: 'plan_updated', tabId: c.req.header('X-Tab-ID') || '', planId: plan.id })
  return c.json(plan)
})

// PUT /api/plan-items/:id
contentPlans.put('/plan-items/:id', async (c) => {
  const { id } = c.req.param()
  const user = c.get('user') as AuthUser
  try {
    await verifyPlanItemAccess(user, id)
  } catch (e: any) {
    if (e.message === 'NOT_FOUND') return c.json({ error: 'Не найдено' }, 404)
    if (e.message === 'FORBIDDEN') return c.json({ error: 'Нет доступа' }, 403)
    throw e
  }
  const data = await c.req.json()
  const item = await db.contentPlanItem.update({ where: { id }, data })
  return c.json(item)
})

// DELETE /api/plans/:id
contentPlans.delete('/plans/:id', async (c) => {
  const { id } = c.req.param()
  const user = c.get('user') as AuthUser
  try {
    await verifyPlanAccess(user, id)
  } catch (e: any) {
    if (e.message === 'NOT_FOUND') return c.json({ error: 'Не найдено' }, 404)
    if (e.message === 'FORBIDDEN') return c.json({ error: 'Нет доступа' }, 403)
    throw e
  }
  await db.contentPlan.delete({ where: { id } }) // cascade deletes items
  return c.json({ success: true })
})

// POST /api/plan-items/:id/create-post — создать пустой пост из элемента плана
contentPlans.post('/plan-items/:id/create-post', async (c) => {
  const { id } = c.req.param()
  const user = c.get('user') as AuthUser
  try {
    await verifyPlanItemAccess(user, id)
  } catch (e: any) {
    if (e.message === 'NOT_FOUND') return c.json({ error: 'Не найдено' }, 404)
    if (e.message === 'FORBIDDEN') return c.json({ error: 'Нет доступа' }, 403)
    throw e
  }
  const item = await db.contentPlanItem.findUnique({
    where: { id },
    include: { contentPlan: true },
  })
  if (!item) return c.json({ error: 'Элемент плана не найден' }, 404)

  // Создать пост с темой из плана
  const post = await db.post.create({
    data: {
      businessId: item.contentPlan.businessId,
      title: item.topic,
      body: item.description || item.topic,
      postType: item.postType,
      createdBy: 'manual',
    },
  })

  // Привязать пост к элементу плана
  await db.contentPlanItem.update({
    where: { id },
    data: { postId: post.id, status: 'IN_PROGRESS' },
  })

  return c.json(post, 201)
})

// POST /api/plan-items/:id/ai-generate — AI-написать пост из элемента плана
contentPlans.post('/plan-items/:id/ai-generate', async (c) => {
  const { id } = c.req.param()
  const user = c.get('user') as AuthUser
  try {
    await verifyPlanItemAccess(user, id)
  } catch (e: any) {
    if (e.message === 'NOT_FOUND') return c.json({ error: 'Не найдено' }, 404)
    if (e.message === 'FORBIDDEN') return c.json({ error: 'Нет доступа' }, 403)
    throw e
  }
  const item = await db.contentPlanItem.findUnique({
    where: { id },
    include: { contentPlan: true },
  })
  if (!item) return c.json({ error: 'Элемент плана не найден' }, 404)

  const { buildBrandContext, buildPostPrompt } = await import('../services/ai/prompt-builder')
  const { aiComplete } = await import('../services/ai/openrouter')
  const { config } = await import('../config')

  // Генерировать текст поста по теме из плана
  const brandContext = await buildBrandContext(item.contentPlan.businessId)
  const recentPosts = await getRecentPostSummaries(item.contentPlan.businessId)
  const rubricMatch = item.description?.match(/^\[(.+?)\]/)
  const rubric = rubricMatch?.[1] || undefined
  const systemPrompt = buildPostPrompt(brandContext, { rubric, recentPosts })
  const result = await aiComplete({
    systemPrompt,
    userPrompt: `Тема поста: ${item.topic}. ${item.description || ''}`,
    model: config.models.sonnet,
    businessId: item.contentPlan.businessId,
    action: 'generate_post',
  })

  // Создать пост
  const post = await db.post.create({
    data: {
      businessId: item.contentPlan.businessId,
      title: item.topic,
      body: result.content,
      postType: item.postType,
      createdBy: 'ai',
      aiModel: result.model,
      aiPromptUsed: item.topic,
    },
  })

  // Привязать к элементу плана
  await db.contentPlanItem.update({
    where: { id },
    data: { postId: post.id, status: 'IN_PROGRESS' },
  })

  return c.json({
    post,
    usage: { tokensIn: result.tokensIn, tokensOut: result.tokensOut },
  }, 201)
})

// POST /api/plans/:id/generate-all — AI-сгенерировать все посты для плана (batch)
contentPlans.post('/plans/:id/generate-all', async (c) => {
  const { id } = c.req.param()
  const user = c.get('user') as AuthUser
  try {
    await verifyPlanAccess(user, id)
  } catch (e: any) {
    if (e.message === 'NOT_FOUND') return c.json({ error: 'Не найдено' }, 404)
    if (e.message === 'FORBIDDEN') return c.json({ error: 'Нет доступа' }, 403)
    throw e
  }
  const plan = await db.contentPlan.findUnique({
    where: { id },
    include: { items: { where: { postId: null, status: 'PLANNED' }, orderBy: { date: 'asc' } } },
  })
  if (!plan) return c.json({ error: 'План не найден' }, 404)
  if (!plan.items.length) return c.json({ error: 'Все посты уже созданы' }, 400)

  const { buildBrandContext, buildPostPrompt } = await import('../services/ai/prompt-builder')
  const { aiComplete } = await import('../services/ai/openrouter')
  const { config } = await import('../config')

  const brandContext = await buildBrandContext(plan.businessId)
  const recentPosts = await getRecentPostSummaries(plan.businessId)
  const posts = []

  for (const item of plan.items) {
    try {
      const rubricMatch = item.description?.match(/^\[(.+?)\]/)
      const rubric = rubricMatch?.[1] || undefined
      const systemPrompt = buildPostPrompt(brandContext, { rubric, recentPosts })
      const result = await aiComplete({
        systemPrompt,
        userPrompt: `Тема поста: ${item.topic}. ${item.description || ''}`,
        model: config.models.sonnet,
        businessId: plan.businessId,
        action: 'generate_post',
      })

      const post = await db.post.create({
        data: {
          businessId: plan.businessId,
          title: item.topic,
          body: result.content,
          postType: item.postType,
          createdBy: 'ai',
          aiModel: result.model,
          aiPromptUsed: item.topic,
        },
      })

      await db.contentPlanItem.update({
        where: { id: item.id },
        data: { postId: post.id, status: 'IN_PROGRESS' },
      })

      posts.push({ itemId: item.id, postId: post.id, topic: item.topic })
    } catch (err) {
      console.error(`[BatchGenerate] Failed for item ${item.id}:`, err)
      posts.push({ itemId: item.id, error: String(err), topic: item.topic })
    }
  }

  return c.json({ generated: posts.filter(p => !('error' in p)).length, total: plan.items.length, posts }, 201)
})

// POST /api/plan-items/:id/regenerate — переписать ячейку плана по направлению (D2)
const regenerateSchema = z.object({ direction: z.string().max(500).optional() })
contentPlans.post('/plan-items/:id/regenerate', async (c) => {
  const { id } = c.req.param()
  const user = c.get('user') as AuthUser
  try {
    await verifyPlanItemAccess(user, id)
  } catch (e: any) {
    if (e.message === 'NOT_FOUND') return c.json({ error: 'Не найдено' }, 404)
    if (e.message === 'FORBIDDEN') return c.json({ error: 'Нет доступа' }, 403)
    throw e
  }
  const item = await db.contentPlanItem.findUnique({ where: { id }, include: { contentPlan: true } })
  if (!item) return c.json({ error: 'Элемент плана не найден' }, 404)

  const { direction } = regenerateSchema.parse(await c.req.json().catch(() => ({})))
  const { buildBrandContext } = await import('../services/ai/prompt-builder')
  const { aiComplete } = await import('../services/ai/openrouter')
  const { config } = await import('../config')

  const brandContext = await buildBrandContext(item.contentPlan.businessId)
  const recent = await getRecentPostSummaries(item.contentPlan.businessId, 6)
  const systemPrompt = `Ты — SMM-стратег. Перепиши ОДНУ ячейку контент-плана (тема + тип + краткое описание).
${brandContext}
${recent.length ? '\nНедавние посты (не повторяйся):\n' + recent.map(r => '- ' + r).join('\n') : ''}
Ответь СТРОГО JSON без markdown: {"topic":"тема 2-5 слов","postType":"TEXT|PHOTO|VIDEO|REELS|CLIPS|STORIES","description":"1 предложение"}`
  const userPrompt = `Текущая ячейка: тема «${item.topic}», тип ${item.postType}, описание «${item.description || ''}». ${direction ? 'Направление переделки: ' + direction : 'Предложи свежий альтернативный вариант на ту же дату.'}`

  const result = await aiComplete({
    systemPrompt,
    userPrompt,
    model: config.models.haiku,
    businessId: item.contentPlan.businessId,
    action: 'regenerate_plan_item',
    userId: user.userId,
  })

  let parsed: any
  try {
    parsed = JSON.parse(result.content.replace(/```json?/gi, '').replace(/```/g, '').trim())
  } catch {
    return c.json({ error: 'AI вернул некорректный ответ', raw: result.content }, 422)
  }
  const allowed = ['TEXT', 'PHOTO', 'VIDEO', 'REELS', 'CLIPS', 'STORIES']
  const updated = await db.contentPlanItem.update({
    where: { id },
    data: {
      topic: parsed.topic || item.topic,
      postType: (allowed.includes(parsed.postType) ? parsed.postType : item.postType) as any,
      description: parsed.description ?? item.description,
    },
  })
  return c.json(updated)
})

export { contentPlans }
