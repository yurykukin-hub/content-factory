import { Hono } from 'hono'
import { z } from 'zod'
import { db } from '../db'
import { config } from '../config'
import { aiComplete } from '../services/ai/openrouter'
import { buildBrandContext, buildPlanPrompt, buildPostPrompt, buildAdaptPrompt, buildHashtagPrompt } from '../services/ai/prompt-builder'
import { generateImage } from '../services/ai/image-generation'
import { emitEvent } from '../eventBus'

const ai = new Hono()

// POST /api/ai/generate-plan — AI-генерация контент-плана
const generatePlanSchema = z.object({
  businessId: z.string(),
  startDate: z.string(),   // "2026-06-01"
  endDate: z.string(),     // "2026-06-30"
  postsPerWeek: z.number().min(1).max(14).default(3),
  focus: z.string().optional(),
  rubrics: z.array(z.string()).optional(),
})

ai.post('/generate-plan', async (c) => {
  const data = generatePlanSchema.parse(await c.req.json())

  // 1. Загрузить контекст бренда
  const brandContext = await buildBrandContext(data.businessId)

  // 2. Собрать промпт с параметрами
  const systemPrompt = buildPlanPrompt(brandContext, {
    postsPerWeek: data.postsPerWeek,
    focus: data.focus,
    rubrics: data.rubrics,
  })

  const startDate = new Date(data.startDate)
  const endDate = new Date(data.endDate)
  const weeks = Math.ceil((endDate.getTime() - startDate.getTime()) / (7 * 24 * 60 * 60 * 1000))

  // 3. Вызвать AI
  const result = await aiComplete({
    systemPrompt,
    userPrompt: `Период: с ${data.startDate} по ${data.endDate} (${weeks} недель). Сгенерируй ${weeks * data.postsPerWeek} постов.`,
    model: config.models.haiku,
    maxTokens: 4000,
    businessId: data.businessId,
    action: 'generate_plan',
  })

  // 4. Парсить JSON (защита от markdown ```json```)
  let items: any[]
  try {
    let json = result.content.trim()
    // Убрать markdown обёртку если есть
    json = json.replace(/^```json?\s*/i, '').replace(/\s*```$/i, '')
    items = JSON.parse(json)
  } catch {
    return c.json({ error: 'AI вернул некорректный JSON. Попробуйте ещё раз.', raw: result.content }, 422)
  }

  if (!Array.isArray(items) || items.length === 0) {
    return c.json({ error: 'AI вернул пустой план.' }, 422)
  }

  // 5. Сгенерировать короткое название для плана
  const monthNames = ['Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь',
    'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь']
  const startMonth = monthNames[startDate.getMonth()]
  const endMonth = monthNames[endDate.getMonth()]
  const year = startDate.getFullYear()

  let title: string
  if (data.focus) {
    // AI-стиль: короткое название из фокуса
    const shortFocus = data.focus.split(/[.,;]/).map(s => s.trim()).filter(Boolean)[0] || data.focus
    title = shortFocus.length > 40 ? shortFocus.slice(0, 40) + '...' : shortFocus
  } else if (startMonth === endMonth) {
    title = `${startMonth} ${year}`
  } else {
    title = `${startMonth} — ${endMonth} ${year}`
  }

  // Создать ContentPlan + Items в БД
  const plan = await db.contentPlan.create({
    data: {
      businessId: data.businessId,
      title,
      startDate,
      endDate,
      generatedBy: 'ai',
      aiPromptUsed: data.focus || null,
    },
  })

  // Создать items
  const planItems = items.map((item: any, i: number) => ({
    contentPlanId: plan.id,
    date: new Date(item.date),
    dayOfWeek: item.dayOfWeek || '',
    topic: item.topic || `Тема ${i + 1}`,
    postType: (['TEXT', 'PHOTO', 'VIDEO'].includes(item.postType) ? item.postType : 'TEXT') as any,
    description: item.description || null,
    status: 'PLANNED',
  }))

  await db.contentPlanItem.createMany({ data: planItems })

  // 6. Вернуть план с items
  const fullPlan = await db.contentPlan.findUnique({
    where: { id: plan.id },
    include: {
      items: { orderBy: { date: 'asc' } },
    },
  })

  emitEvent({ type: 'plan_created', tabId: c.req.header('X-Tab-ID') || '', planId: plan.id })

  return c.json({
    plan: fullPlan,
    usage: { tokensIn: result.tokensIn, tokensOut: result.tokensOut, model: result.model },
  }, 201)
})

// POST /api/ai/generate-post — AI-генерация текста поста
const generatePostSchema = z.object({
  businessId: z.string(),
  topic: z.string().min(1),
  postType: z.enum(['TEXT', 'PHOTO', 'VIDEO', 'REELS', 'STORIES']).default('TEXT'),
})

ai.post('/generate-post', async (c) => {
  const data = generatePostSchema.parse(await c.req.json())

  // 1. Загрузить контекст бренда (Business + BrandProfile)
  const brandContext = await buildBrandContext(data.businessId)

  // 2. Собрать system prompt
  const systemPrompt = buildPostPrompt(brandContext)

  // 3. Вызвать AI (Sonnet для креатива)
  const result = await aiComplete({
    systemPrompt,
    userPrompt: `Тема поста: ${data.topic}`,
    model: config.models.sonnet,
    businessId: data.businessId,
    action: 'generate_post',
  })

  // 4. Создать Post в БД
  const post = await db.post.create({
    data: {
      businessId: data.businessId,
      title: data.topic,
      body: result.content,
      postType: data.postType,
      createdBy: 'ai',
      aiModel: result.model,
      aiPromptUsed: data.topic,
    },
  })

  emitEvent({ type: 'post_created', tabId: c.req.header('X-Tab-ID') || '', postId: post.id })

  return c.json({
    post,
    usage: {
      tokensIn: result.tokensIn,
      tokensOut: result.tokensOut,
      model: result.model,
    },
  }, 201)
})

// POST /api/ai/generate-image — AI-генерация изображения
const generateImageSchema = z.object({
  businessId: z.string(),
  postId: z.string().optional(),
  prompt: z.string().min(1),
  aspectRatio: z.enum(['1:1', '16:9', '9:16']).default('1:1'),
})

ai.post('/generate-image', async (c) => {
  const data = generateImageSchema.parse(await c.req.json())

  const result = await generateImage({
    prompt: data.prompt,
    businessId: data.businessId,
    postId: data.postId || null,
    aspectRatio: data.aspectRatio,
  })

  return c.json(result, 201)
})

// POST /api/ai/adapt — адаптация мастер-текста под платформы
const adaptSchema = z.object({
  postId: z.string(),
  platformAccountIds: z.array(z.string()).min(1),
})

ai.post('/adapt', async (c) => {
  const data = adaptSchema.parse(await c.req.json())

  const post = await db.post.findUnique({
    where: { id: data.postId },
    include: { business: { include: { brandProfile: true } } },
  })
  if (!post) return c.json({ error: 'Пост не найден' }, 404)

  const brandContext = await buildBrandContext(post.businessId)
  const versions = []

  for (const paId of data.platformAccountIds) {
    const pa = await db.platformAccount.findUnique({ where: { id: paId } })
    if (!pa) continue

    // Адаптировать текст
    const adaptPrompt = buildAdaptPrompt(pa.platform, brandContext)
    const result = await aiComplete({
      systemPrompt: adaptPrompt,
      userPrompt: post.body,
      model: config.models.haiku,
      businessId: post.businessId,
      action: 'adapt_platform',
    })

    // Сгенерировать хештеги
    const hashtagPrompt = buildHashtagPrompt(pa.platform, brandContext)
    const hashtagResult = await aiComplete({
      systemPrompt: hashtagPrompt,
      userPrompt: post.body,
      model: config.models.haiku,
      businessId: post.businessId,
      action: 'generate_hashtags',
    })
    const hashtags = hashtagResult.content
      .split('\n')
      .map(h => h.trim().replace(/^#/, ''))
      .filter(Boolean)

    // Создать PostVersion (или обновить если есть)
    const existing = await db.postVersion.findFirst({
      where: { postId: post.id, platformAccountId: paId },
    })

    let version
    if (existing) {
      version = await db.postVersion.update({
        where: { id: existing.id },
        data: { body: result.content, hashtags, status: 'DRAFT' },
        include: { platformAccount: { select: { platform: true, accountName: true } } },
      })
    } else {
      version = await db.postVersion.create({
        data: {
          postId: post.id,
          platformAccountId: paId,
          body: result.content,
          hashtags,
          status: 'DRAFT',
        },
        include: { platformAccount: { select: { platform: true, accountName: true } } },
      })
    }

    versions.push(version)
  }

  return c.json({ versions }, 201)
})

// POST /api/ai/hashtags — генерация хештегов
ai.post('/hashtags', async (c) => {
  // TODO: реализовать генерацию хештегов
  return c.json({ error: 'TODO: AI hashtags' }, 501)
})

// POST /api/ai/rewrite — перефразирование текста
ai.post('/rewrite', async (c) => {
  // TODO: реализовать перефразирование
  return c.json({ error: 'TODO: AI rewrite' }, 501)
})

export { ai }
