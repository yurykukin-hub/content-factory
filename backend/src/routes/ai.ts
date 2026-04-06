import { Hono } from 'hono'
import { z } from 'zod'
import { db } from '../db'
import { config } from '../config'
import { aiComplete } from '../services/ai/openrouter'
import { buildBrandContext, buildPostPrompt, buildAdaptPrompt, buildHashtagPrompt } from '../services/ai/prompt-builder'
import { generateImage } from '../services/ai/image-generation'
import { emitEvent } from '../eventBus'

const ai = new Hono()

// POST /api/ai/generate-plan — AI-генерация контент-плана
ai.post('/generate-plan', async (c) => {
  // TODO: реализовать AI-генерацию контент-плана
  return c.json({ error: 'TODO: AI generate plan' }, 501)
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
