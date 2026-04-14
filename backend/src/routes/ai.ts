import { Hono } from 'hono'
import { z } from 'zod'
import { db } from '../db'
import { config } from '../config'
import { aiComplete, aiVision } from '../services/ai/openrouter'
import { buildBrandContext, buildPlanPrompt, buildPostPrompt, buildAdaptPrompt, buildHashtagPrompt, buildImageEnhancerPrompt, buildEditEnhancerPrompt, buildStoryTitlePrompt, buildScenarioPrompt, buildVideoPromptEnhancer } from '../services/ai/prompt-builder'
import { generateImage, editImage, removeBackground, generateVideo, EDIT_MODELS } from '../services/ai/kie'
import { emitEvent } from '../eventBus'
import type { AuthUser } from '../middleware/auth'
import { verifyPostAccess, assertBusinessAccess } from '../middleware/resource-access'

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
  const user = c.get('user') as AuthUser
  try {
    await assertBusinessAccess(user, data.businessId)
  } catch (e: any) {
    if (e.message === 'FORBIDDEN') return c.json({ error: 'Нет доступа' }, 403)
    throw e
  }

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
  const user = c.get('user') as AuthUser
  try {
    await assertBusinessAccess(user, data.businessId)
  } catch (e: any) {
    if (e.message === 'FORBIDDEN') return c.json({ error: 'Нет доступа' }, 403)
    throw e
  }

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
  characterId: z.string().optional(),
})

ai.post('/generate-image', async (c) => {
  const data = generateImageSchema.parse(await c.req.json())
  const user = c.get('user') as AuthUser
  try {
    await assertBusinessAccess(user, data.businessId)
  } catch (e: any) {
    if (e.message === 'FORBIDDEN') return c.json({ error: 'Нет доступа' }, 403)
    throw e
  }

  const result = await generateImage({
    prompt: data.prompt,
    businessId: data.businessId,
    postId: data.postId || null,
    aspectRatio: data.aspectRatio,
    characterId: data.characterId || null,
  })

  return c.json(result, 201)
})

// POST /api/ai/enhance-image-prompt — улучшение промпта для генерации картинки
const enhanceImagePromptSchema = z.object({
  prompt: z.string().min(1).max(2000),
  aspectRatio: z.enum(['1:1', '16:9', '9:16']).default('1:1'),
  businessId: z.string(),
  mode: z.enum(['generate', 'edit']).default('generate'),
})

ai.post('/enhance-image-prompt', async (c) => {
  const data = enhanceImagePromptSchema.parse(await c.req.json())
  const user = c.get('user') as AuthUser
  try {
    await assertBusinessAccess(user, data.businessId)
  } catch (e: any) {
    if (e.message === 'FORBIDDEN') return c.json({ error: 'Нет доступа' }, 403)
    throw e
  }

  // edit mode: только инструкции изменения, без описания сцены
  // generate mode: полный промпт с композицией, освещением и т.д.
  const systemPrompt = data.mode === 'edit'
    ? buildEditEnhancerPrompt()
    : buildImageEnhancerPrompt(await buildBrandContext(data.businessId))

  const result = await aiComplete({
    systemPrompt,
    userPrompt: data.mode === 'edit'
      ? `Инструкция: ${data.prompt}`
      : `Описание: ${data.prompt}\nФормат: ${data.aspectRatio}`,
    model: config.models.haiku,
    maxTokens: data.mode === 'edit' ? 100 : 500,
    businessId: data.businessId,
    action: 'enhance_image_prompt',
  })

  return c.json({ enhancedPrompt: result.content.trim() })
})

// POST /api/ai/suggest-image-templates — AI генерирует шаблоны промптов для картинок
const suggestTemplatesSchema = z.object({
  businessId: z.string(),
  storyTitle: z.string().default(''),
  storyText: z.string().default(''),
})

ai.post('/suggest-image-templates', async (c) => {
  const data = suggestTemplatesSchema.parse(await c.req.json())
  const user = c.get('user') as AuthUser
  try {
    await assertBusinessAccess(user, data.businessId)
  } catch (e: any) {
    if (e.message === 'FORBIDDEN') return c.json({ error: 'Нет доступа' }, 403)
    throw e
  }

  const brandContext = await buildBrandContext(data.businessId)
  const storyContext = data.storyTitle || data.storyText
    ? `\nТекущая история: "${data.storyTitle}" / "${data.storyText}"`
    : ''

  const result = await aiComplete({
    systemPrompt: `Ты — AI-помощник для генерации изображений.
${brandContext}
${storyContext}

Сгенерируй 5 шаблонов промптов для AI-генерации картинок в формате Stories (9:16).
Каждый шаблон — это краткий промпт для генерации фотореалистичного изображения.
Учитывай бренд, тематику и целевую аудиторию.

Верни JSON-массив:
[{"emoji": "📸", "name": "Краткое название (2-3 слова)", "prompt": "Детальное описание сцены для генерации изображения, 1-2 предложения"}]

ТОЛЬКО JSON-массив, без пояснений и markdown.`,
    userPrompt: 'Сгенерируй 5 шаблонов промптов для картинок',
    model: config.models.haiku,
    maxTokens: 800,
    businessId: data.businessId,
    action: 'suggest_image_templates',
  })

  try {
    const jsonMatch = result.content.match(/\[[\s\S]*\]/)
    const suggestions = jsonMatch ? JSON.parse(jsonMatch[0]) : []
    return c.json({ suggestions })
  } catch {
    return c.json({ suggestions: [] })
  }
})

// POST /api/ai/suggest-video-templates — AI генерирует шаблоны промптов для видео
ai.post('/suggest-video-templates', async (c) => {
  const data = suggestTemplatesSchema.parse(await c.req.json())
  const user = c.get('user') as AuthUser
  try {
    await assertBusinessAccess(user, data.businessId)
  } catch (e: any) {
    if (e.message === 'FORBIDDEN') return c.json({ error: 'Нет доступа' }, 403)
    throw e
  }

  const brandContext = await buildBrandContext(data.businessId)
  const storyContext = data.storyTitle || data.storyText
    ? `\nТекущая история: "${data.storyTitle}" / "${data.storyText}"`
    : ''

  const result = await aiComplete({
    systemPrompt: `Ты — AI-помощник для генерации видео.
${brandContext}
${storyContext}

Сгенерируй 5 шаблонов промптов для AI-генерации коротких видео (5-10 сек, Stories 9:16).
Описывай движение камеры, динамику, атмосферу. Учитывай бренд и ЦА.

Верни JSON-массив:
[{"emoji": "🎬", "name": "Краткое название (2-3 слова)", "prompt": "Описание сцены с движением камеры, 1-2 предложения"}]

ТОЛЬКО JSON-массив, без пояснений и markdown.`,
    userPrompt: 'Сгенерируй 5 шаблонов промптов для видео',
    model: config.models.haiku,
    maxTokens: 800,
    businessId: data.businessId,
    action: 'suggest_video_templates',
  })

  try {
    const jsonMatch = result.content.match(/\[[\s\S]*\]/)
    const suggestions = jsonMatch ? JSON.parse(jsonMatch[0]) : []
    return c.json({ suggestions })
  } catch {
    return c.json({ suggestions: [] })
  }
})

// POST /api/ai/adapt — адаптация мастер-текста под платформы
const adaptSchema = z.object({
  postId: z.string(),
  platformAccountIds: z.array(z.string()).min(1),
})

ai.post('/adapt', async (c) => {
  const data = adaptSchema.parse(await c.req.json())
  const user = c.get('user') as AuthUser
  try {
    await verifyPostAccess(user, data.postId)
  } catch (e: any) {
    if (e.message === 'NOT_FOUND') return c.json({ error: 'Не найдено' }, 404)
    if (e.message === 'FORBIDDEN') return c.json({ error: 'Нет доступа' }, 403)
    throw e
  }

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

// GET /api/ai/edit-models — список доступных моделей редактирования
ai.get('/edit-models', (c) => {
  const models = Object.entries(EDIT_MODELS).map(([id, info]) => ({ id, ...info }))
  return c.json({ models })
})

// POST /api/ai/edit-image — редактирование фото через KIE.ai
const editImageSchema = z.object({
  businessId: z.string(),
  mediaId: z.string(),
  prompt: z.string().min(1).max(2000),
  postId: z.string().optional(),
  model: z.enum(['flux-kontext-pro', 'nano-banana-2'] as const).default('flux-kontext-pro'),
})

ai.post('/edit-image', async (c) => {
  const data = editImageSchema.parse(await c.req.json())
  const user = c.get('user') as AuthUser
  try {
    await assertBusinessAccess(user, data.businessId)
  } catch (e: any) {
    if (e.message === 'FORBIDDEN') return c.json({ error: 'Нет доступа' }, 403)
    throw e
  }

  const sourceMedia = await db.mediaFile.findUnique({ where: { id: data.mediaId } })
  if (!sourceMedia) return c.json({ error: 'Исходный файл не найден' }, 404)
  if (sourceMedia.businessId !== data.businessId) return c.json({ error: 'Нет доступа' }, 403)

  const result = await editImage({
    imageUrl: sourceMedia.url,
    prompt: data.prompt,
    businessId: data.businessId,
    postId: data.postId || null,
    model: data.model,
  })

  return c.json(result, 201)
})

// POST /api/ai/remove-background — удаление фона через FAL.ai rembg
const removeBgSchema = z.object({
  businessId: z.string(),
  mediaId: z.string(),
  postId: z.string().optional(),
})

ai.post('/remove-background', async (c) => {
  const data = removeBgSchema.parse(await c.req.json())
  const user = c.get('user') as AuthUser
  try {
    await assertBusinessAccess(user, data.businessId)
  } catch (e: any) {
    if (e.message === 'FORBIDDEN') return c.json({ error: 'Нет доступа' }, 403)
    throw e
  }

  const sourceMedia = await db.mediaFile.findUnique({ where: { id: data.mediaId } })
  if (!sourceMedia) return c.json({ error: 'Файл не найден' }, 404)
  if (sourceMedia.businessId !== data.businessId) return c.json({ error: 'Нет доступа' }, 403)

  const result = await removeBackground({
    imageUrl: sourceMedia.url,
    businessId: data.businessId,
    postId: data.postId || null,
  })

  return c.json(result, 201)
})

// POST /api/ai/generate-edit-prompt — генерация промпта по шаблону + сохранение в историю
const generateEditPromptSchema = z.object({
  businessId: z.string(),
  postId: z.string(),
  template: z.string().min(1).max(500),
})

ai.post('/generate-edit-prompt', async (c) => {
  const data = generateEditPromptSchema.parse(await c.req.json())
  const user = c.get('user') as AuthUser
  try { await assertBusinessAccess(user, data.businessId) } catch (e: any) {
    if (e.message === 'FORBIDDEN') return c.json({ error: 'Нет доступа' }, 403); throw e
  }

  const brandContext = await buildBrandContext(data.businessId)
  const systemPrompt = buildImageEnhancerPrompt(brandContext)

  const result = await aiComplete({
    systemPrompt,
    userPrompt: `Шаблон: ${data.template}\nФормат: 9:16 (Stories вертикальный)`,
    model: config.models.haiku,
    maxTokens: 500,
    businessId: data.businessId,
    action: 'generate_edit_prompt',
  })

  const prompt = result.content.trim()

  // Append to Post.aiPromptHistory
  const post = await db.post.findUnique({ where: { id: data.postId }, select: { aiPromptHistory: true } })
  const history = Array.isArray(post?.aiPromptHistory) ? (post.aiPromptHistory as any[]) : []
  history.push({ type: 'image', prompt, template: data.template, createdAt: new Date().toISOString() })

  await db.post.update({
    where: { id: data.postId },
    data: { aiPromptHistory: history },
  })

  return c.json({ prompt, historyIndex: history.filter((h: any) => h.type === 'image').length - 1 })
})

// GET /api/ai/prompt-history/:postId — получить историю промптов
ai.get('/prompt-history/:postId', async (c) => {
  const postId = c.req.param('postId')
  const post = await db.post.findUnique({ where: { id: postId }, select: { aiPromptHistory: true, businessId: true } })
  if (!post) return c.json({ error: 'Не найдено' }, 404)

  const user = c.get('user') as AuthUser
  try { await assertBusinessAccess(user, post.businessId) } catch (e: any) {
    if (e.message === 'FORBIDDEN') return c.json({ error: 'Нет доступа' }, 403); throw e
  }

  const history = Array.isArray(post.aiPromptHistory) ? post.aiPromptHistory : []
  return c.json({ history })
})

// POST /api/ai/generate-story-text — генерация заголовка + текста для Stories
const generateStoryTextSchema = z.object({
  businessId: z.string(),
  postId: z.string().optional(),
  topic: z.string().max(500).optional(),
})

ai.post('/generate-story-text', async (c) => {
  const data = generateStoryTextSchema.parse(await c.req.json())
  const user = c.get('user') as AuthUser
  try { await assertBusinessAccess(user, data.businessId) } catch (e: any) {
    if (e.message === 'FORBIDDEN') return c.json({ error: 'Нет доступа' }, 403); throw e
  }

  const brandContext = await buildBrandContext(data.businessId)
  const topic = data.topic || 'Интересная тема для Stories'

  // 1. Title (Haiku — быстро и дёшево)
  const titlePrompt = buildStoryTitlePrompt(brandContext)
  const titleResult = await aiComplete({
    systemPrompt: titlePrompt,
    userPrompt: `Тема: ${topic}`,
    model: config.models.haiku,
    maxTokens: 50,
    businessId: data.businessId,
    action: 'generate_story_title',
  })

  // 2. Body (Haiku — короткий текст, Sonnet overkill)
  const bodyResult = await aiComplete({
    systemPrompt: buildPostPrompt(brandContext),
    userPrompt: `Напиши ОЧЕНЬ короткий текст для Stories (2-3 предложения, до 80 символов). Тема: ${topic}. Кратко и цепляюще. Без хештегов.`,
    model: config.models.haiku,
    maxTokens: 150,
    businessId: data.businessId,
    action: 'generate_story_text',
  })

  const title = titleResult.content.trim()
  const body = bodyResult.content.trim()

  // Save to history if postId provided
  if (data.postId) {
    const post = await db.post.findUnique({ where: { id: data.postId }, select: { aiPromptHistory: true } })
    const history = Array.isArray(post?.aiPromptHistory) ? (post.aiPromptHistory as any[]) : []
    history.push({ type: 'text', title, body, topic, createdAt: new Date().toISOString() })
    await db.post.update({ where: { id: data.postId }, data: { aiPromptHistory: history } })
  }

  return c.json({ title, body })
})

// POST /api/ai/generate-scenario — AI-генерация сценария
const generateScenarioSchema = z.object({
  businessId: z.string(),
  topic: z.string().min(1).max(500),
  sceneCount: z.number().int().min(2).max(20).default(5),
  style: z.string().max(200).optional(),
})

ai.post('/generate-scenario', async (c) => {
  const data = generateScenarioSchema.parse(await c.req.json())
  const user = c.get('user') as AuthUser
  try {
    await assertBusinessAccess(user, data.businessId)
  } catch (e: any) {
    if (e.message === 'FORBIDDEN') return c.json({ error: 'Нет доступа' }, 403)
    throw e
  }

  const brandContext = await buildBrandContext(data.businessId)
  const systemPrompt = buildScenarioPrompt(brandContext, {
    sceneCount: data.sceneCount,
    style: data.style,
  })

  const result = await aiComplete({
    systemPrompt,
    userPrompt: `Тема сценария: ${data.topic}. Количество сцен: ${data.sceneCount}.`,
    model: config.models.sonnet,
    maxTokens: 3000,
    businessId: data.businessId,
    action: 'generate_scenario',
  })

  // Парсить JSON (защита от markdown ```json```)
  let scenes: any[]
  try {
    let raw = result.content.trim()
    const jsonMatch = raw.match(/\[[\s\S]*\]/)
    if (jsonMatch) raw = jsonMatch[0]
    scenes = JSON.parse(raw)
  } catch {
    return c.json({ error: 'AI вернул некорректный JSON', raw: result.content }, 422)
  }

  // Генерируем заголовок из темы
  const title = data.topic.length > 50 ? data.topic.slice(0, 50) + '...' : data.topic

  return c.json({ title, scenes, usage: result.usage })
})

// POST /api/ai/enhance-video-prompt — улучшение промпта для видео
const enhanceVideoPromptSchema = z.object({
  prompt: z.string().min(1),
  businessId: z.string(),
  duration: z.number().optional(),
})

ai.post('/enhance-video-prompt', async (c) => {
  const data = enhanceVideoPromptSchema.parse(await c.req.json())
  const user = c.get('user') as AuthUser
  try {
    await assertBusinessAccess(user, data.businessId)
  } catch (e: any) {
    if (e.message === 'FORBIDDEN') return c.json({ error: 'Нет доступа' }, 403)
    throw e
  }

  const brandContext = await buildBrandContext(data.businessId)
  const systemPrompt = buildVideoPromptEnhancer(brandContext)

  const durationHint = data.duration ? ` Видео длительностью ${data.duration} секунд.` : ''

  const result = await aiComplete({
    systemPrompt,
    userPrompt: data.prompt + durationHint,
    model: config.models.haiku,
    maxTokens: 500,
    businessId: data.businessId,
    action: 'enhance_video_prompt',
  })

  return c.json({ enhancedPrompt: result.content.trim() })
})

// POST /api/ai/generate-video — AI-генерация видео (Seedance 2)
const generateVideoSchema = z.object({
  businessId: z.string(),
  postId: z.string().optional(),
  prompt: z.string().min(1).max(2000),
  duration: z.number().int().min(4).max(15).default(5),
  aspectRatio: z.enum(['1:1', '16:9', '9:16']).default('9:16'),
  resolution: z.enum(['480p', '720p']).default('720p'),
  generateAudio: z.boolean().default(true),
  firstFrameUrl: z.string().optional().nullable(),
  lastFrameUrl: z.string().optional().nullable(),
  referenceImageUrls: z.array(z.string()).max(9).optional(),
})

ai.post('/generate-video', async (c) => {
  const data = generateVideoSchema.parse(await c.req.json())
  const user = c.get('user') as AuthUser
  try {
    await assertBusinessAccess(user, data.businessId)
  } catch (e: any) {
    if (e.message === 'FORBIDDEN') return c.json({ error: 'Нет доступа' }, 403)
    throw e
  }

  const result = await generateVideo({
    prompt: data.prompt,
    businessId: data.businessId,
    postId: data.postId || null,
    duration: data.duration,
    aspectRatio: data.aspectRatio,
    resolution: data.resolution,
    generateAudio: data.generateAudio,
    firstFrameUrl: data.firstFrameUrl || null,
    lastFrameUrl: data.lastFrameUrl || null,
    referenceImageUrls: data.referenceImageUrls || undefined,
  })

  return c.json(result, 201)
})

// POST /api/ai/merge-references — AI распознаёт фотки и вставляет @ImageN теги в промпт
const mergeRefsSchema = z.object({
  businessId: z.string(),
  prompt: z.string(),
  imageUrls: z.array(z.string()).min(1).max(9),
})

ai.post('/merge-references', async (c) => {
  const data = mergeRefsSchema.parse(await c.req.json())
  const user = c.get('user') as AuthUser
  try {
    await assertBusinessAccess(user, data.businessId)
  } catch (e: any) {
    if (e.message === 'FORBIDDEN') return c.json({ error: 'Нет доступа' }, 403)
    throw e
  }

  // Resolve URLs to public
  const publicUrls = data.imageUrls.map(u => {
    if (u.startsWith('http')) return u
    const base = config.isProd ? 'https://content.yurykukin.ru' : `http://localhost:${config.PORT}`
    return `${base}${u}`
  })

  const imageLabels = data.imageUrls.map((_, i) => `@Image${i + 1}`).join(', ')

  const systemPrompt = `You are an expert AI video prompt engineer for Seedance 2.
You receive a video generation prompt AND reference images.
Your task: analyze each image, understand what it contains, then rewrite the prompt to intelligently reference the images using @Image1, @Image2, etc.

Rules:
- First, briefly identify what each image contains (face, location, object, style, etc.)
- Then rewrite the prompt to naturally include references like "character from @Image1", "background from @Image2"
- Keep the original prompt's intent, style, camera work, and mood
- Write the final prompt in English
- The prompt should be 100-200 words
- Include camera movement, lighting, and style details
- End with quality constraints: "Smooth motion, high detail, maintain consistency with reference images"
- Do NOT explain your reasoning, return ONLY the final rewritten prompt

Available reference tags: ${imageLabels}`

  const userPrompt = data.prompt
    ? `Current prompt:\n${data.prompt}\n\nRewrite this prompt to reference the uploaded images.`
    : `Create a video prompt based on these reference images. Describe a scene that uses all of them.`

  const result = await aiVision({
    systemPrompt,
    userPrompt,
    imageUrls: publicUrls,
    model: 'google/gemini-2.0-flash-001', // vision model (Haiku не поддерживает image input)
    maxTokens: 800,
    businessId: data.businessId,
    action: 'merge_references',
  })

  return c.json({ mergedPrompt: result.content.trim() })
})

// POST /api/ai/describe-image — AI Vision описывает фото для референса
const describeImageSchema = z.object({
  imageUrl: z.string(),
  type: z.enum(['person', 'mascot', 'avatar', 'object', 'location']).default('person'),
})

ai.post('/describe-image', async (c) => {
  const data = describeImageSchema.parse(await c.req.json())

  const typeHints: Record<string, string> = {
    person: 'Describe this person: appearance, hair, clothing, distinguishing features. Be specific and concise.',
    mascot: 'Describe this mascot/character: visual style, colors, key features, expression.',
    avatar: 'Describe this avatar: visual style, colors, key features.',
    object: 'Describe this object: shape, material, color, size, distinguishing details.',
    location: 'Describe this location/place: setting, atmosphere, key visual elements, lighting.',
  }

  const publicUrl = data.imageUrl.startsWith('/uploads/')
    ? `${config.isProd ? 'https://content.yurykukin.ru' : `http://localhost:${config.port}`}${data.imageUrl}`
    : data.imageUrl

  const result = await aiVision({
    systemPrompt: 'You are a visual description expert for AI video generation. Write descriptions in English, under 100 characters. Focus on visual features only.',
    userPrompt: typeHints[data.type] || typeHints.person,
    imageUrls: [publicUrl],
    model: config.models.vision,
    businessId: null,
    action: 'describe_reference',
  })

  return c.json({ description: result.content.trim() })
})

export { ai }
