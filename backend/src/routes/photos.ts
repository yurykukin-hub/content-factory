/**
 * Photo API routes — Photo Studio backend.
 * Pattern mirrors routes/music.ts (sound generation).
 */

import { Hono } from 'hono'
import { z } from 'zod'
import { db } from '../db'
import type { AuthUser } from '../middleware/auth'
import { assertBusinessAccess } from '../middleware/resource-access'
import { canAfford } from '../services/billing'
import { createPhotoTask, editImage, removeBackground, PHOTO_PRICING, type PhotoModelId } from '../services/ai/kie'
import { aiComplete, aiChat } from '../services/ai/openrouter'
import {
  buildBrandContext,
  buildPhotoPromptEnhancer, buildPhotoStyleSuggester, buildPhotoLightingHelper,
  buildPhotoCompositionHelper, buildPhotoMoodHelper, buildPhotoDetailEnhancer,
  buildPhotoPromptTranslate, buildPhotoPromptSimplify,
  buildPhotoAgentSystemPrompt,
  type PhotoEnhanceMode, type PhotoAgentContext,
} from '../services/ai/prompt-builder'
import { config } from '../config'
import { log } from '../utils/logger'

const photos = new Hono()

// =====================
// POST /generate — async photo generation (returns 202)
// =====================

const generateSchema = z.object({
  businessId: z.string(),
  sessionId: z.string().optional(),
  prompt: z.string().min(1),
  model: z.enum(['nano-banana-2', 'nano-banana-pro']).default('nano-banana-2'),
  resolution: z.enum(['1K', '2K', '4K']).default('2K'),
  aspectRatio: z.string().default('1:1'),
  batchSize: z.number().int().min(1).max(4).default(1),
  characterId: z.string().optional(),
  referenceImageUrls: z.array(z.string()).max(14).optional(),
})

photos.post('/generate', async (c) => {
  const user = c.get('user') as AuthUser
  const data = generateSchema.parse(await c.req.json())

  try { await assertBusinessAccess(user, data.businessId) } catch {
    return c.json({ error: 'Нет доступа' }, 403)
  }

  // Balance check (ADMIN exempt)
  const { allowed } = await canAfford(user.userId, (user as any).role)
  if (!allowed) {
    return c.json({ error: 'Недостаточно средств. Пополните баланс.' }, 402)
  }

  // Atomic lock on session (prevent double generation)
  if (data.sessionId) {
    const fifteenMinAgo = new Date(Date.now() - 15 * 60 * 1000)
    const locked = await db.generationSession.updateMany({
      where: {
        id: data.sessionId,
        OR: [
          { status: { not: 'generating' } },
          { updatedAt: { lt: fifteenMinAgo } },
        ],
      },
      data: { status: 'generating' },
    })
    if (locked.count === 0) {
      return c.json({ error: 'Генерация уже запущена' }, 409)
    }
  }

  try {
    // Create N parallel tasks (batch)
    const taskPromises = Array.from({ length: data.batchSize }, () =>
      createPhotoTask({
        prompt: data.prompt,
        businessId: data.businessId,
        model: data.model,
        resolution: data.resolution,
        aspectRatio: data.aspectRatio,
        characterId: data.characterId,
        referenceImageUrls: data.referenceImageUrls,
        userId: user.userId,
      })
    )

    const results = await Promise.allSettled(taskPromises)
    const fulfilled = results
      .filter((r): r is PromiseFulfilledResult<Awaited<ReturnType<typeof createPhotoTask>>> => r.status === 'fulfilled')
      .map(r => r.value)

    if (fulfilled.length === 0) {
      const firstError = results.find(r => r.status === 'rejected') as PromiseRejectedResult | undefined
      throw new Error(firstError?.reason?.message || 'Все задачи провалились')
    }

    const taskIds = fulfilled.map(f => f.kieTaskId)
    const totalCost = fulfilled.reduce((sum, f) => sum + f.costUsd, 0)

    // Update session with KIE task info
    if (data.sessionId) {
      await db.generationSession.update({
        where: { id: data.sessionId },
        data: {
          status: 'generating',
          kieTaskId: taskIds[0], // primary task for poller compat
          kieTaskCreatedAt: new Date(),
          batchTaskIds: taskIds,
          costUsd: totalCost,
          model: data.model,
          photoModel: data.model,
          photoResolution: data.resolution,
          photoAspectRatio: data.aspectRatio,
          batchSize: data.batchSize,
        },
      })
    }

    return c.json({
      sessionId: data.sessionId,
      taskIds,
      status: 'generating',
      costUsd: totalCost,
    }, 202)
  } catch (err: any) {
    // Rollback session status on error
    if (data.sessionId) {
      await db.generationSession.update({
        where: { id: data.sessionId },
        data: { status: 'failed', errorMessage: err.message?.slice(0, 300) },
      }).catch(() => {})
    }
    log.error('[Photo] generate error', { error: err.message })
    return c.json({ error: err.message || 'Ошибка генерации фото' }, 500)
  }
})

// =====================
// POST /enhance-prompt — 8 photo enhance modes
// =====================

const enhanceSchema = z.object({
  prompt: z.string().min(1),
  businessId: z.string(),
  mode: z.enum(['enhance', 'style', 'lighting', 'composition', 'mood', 'detail', 'translate', 'simplify']),
})

photos.post('/enhance-prompt', async (c) => {
  const user = c.get('user') as AuthUser
  const data = enhanceSchema.parse(await c.req.json())

  try { await assertBusinessAccess(user, data.businessId) } catch {
    return c.json({ error: 'Нет доступа' }, 403)
  }

  const brandContext = await buildBrandContext(data.businessId)

  // Select system prompt based on mode
  let systemPrompt: string
  const model = config.models.haiku
  const mode = data.mode as PhotoEnhanceMode

  switch (mode) {
    case 'enhance':
      systemPrompt = buildPhotoPromptEnhancer(brandContext)
      break
    case 'style':
      systemPrompt = buildPhotoStyleSuggester()
      break
    case 'lighting':
      systemPrompt = buildPhotoLightingHelper()
      break
    case 'composition':
      systemPrompt = buildPhotoCompositionHelper()
      break
    case 'mood':
      systemPrompt = buildPhotoMoodHelper()
      break
    case 'detail':
      systemPrompt = buildPhotoDetailEnhancer()
      break
    case 'translate':
      systemPrompt = buildPhotoPromptTranslate()
      break
    case 'simplify':
      systemPrompt = buildPhotoPromptSimplify()
      break
    default:
      return c.json({ error: 'Unknown mode' }, 400)
  }

  const result = await aiComplete({
    systemPrompt,
    userPrompt: data.prompt,
    model,
    maxTokens: 500,
    businessId: data.businessId,
    action: `photo_enhance_${mode}`,
    userId: user.userId,
  })

  return c.json({
    enhancedPrompt: result.content.trim(),
    mode,
    debug: {
      model: result.model,
      tokensIn: result.tokensIn,
      tokensOut: result.tokensOut,
      costUsd: result.costUsd,
    },
  })
})

// =====================
// POST /agent-chat — AI Agent for photos (multi-turn)
// =====================

const agentChatSchema = z.object({
  messages: z.array(z.object({
    role: z.enum(['user', 'assistant']),
    content: z.string(),
  })).min(1),
  context: z.object({
    currentPrompt: z.string().default(''),
    photoModel: z.string().default('nano-banana-2'),
    photoResolution: z.string().default('2K'),
    photoAspectRatio: z.string().default('1:1'),
    characterName: z.string().nullable().default(null),
    batchSize: z.number().default(1),
    referenceImages: z.array(z.object({
      filename: z.string(),
      altText: z.string().nullable().optional(),
    })).default([]),
  }),
  mode: z.enum(['simple', 'advanced']).default('simple'),
  businessId: z.string(),
})

photos.post('/agent-chat', async (c) => {
  const user = c.get('user') as AuthUser
  const data = agentChatSchema.parse(await c.req.json())

  try { await assertBusinessAccess(user, data.businessId) } catch {
    return c.json({ error: 'Нет доступа' }, 403)
  }

  const brandContext = await buildBrandContext(data.businessId)

  const agentContext: PhotoAgentContext = {
    ...data.context,
  }

  const systemPrompt = buildPhotoAgentSystemPrompt(agentContext, data.mode, brandContext)
  const model = data.mode === 'advanced' ? config.models.sonnet : config.models.haiku

  // Keep last 20 messages to cap token usage
  const recentMessages = data.messages.slice(-20)

  const result = await aiChat({
    systemPrompt,
    messages: recentMessages,
    model,
    maxTokens: 2000,
    businessId: data.businessId,
    action: `photo_agent_chat_${data.mode}`,
    userId: user.userId,
  })

  return c.json({ content: result.content })
})

// =====================
// POST /suggest-templates — AI-generated photo prompt templates
// =====================

const suggestSchema = z.object({
  businessId: z.string(),
  count: z.number().int().min(1).max(10).default(5),
})

photos.post('/suggest-templates', async (c) => {
  const user = c.get('user') as AuthUser
  const data = suggestSchema.parse(await c.req.json())

  try { await assertBusinessAccess(user, data.businessId) } catch {
    return c.json({ error: 'Нет доступа' }, 403)
  }

  const brandContext = await buildBrandContext(data.businessId)

  const result = await aiComplete({
    systemPrompt: `Ты — арт-директор. Предложи ${data.count} шаблонов промптов для AI-генерации изображений.
Учитывай контекст бренда для релевантности.

${brandContext}

## Формат ответа — строго JSON массив:
[
  {"emoji": "📸", "name": "Портрет в золотой час", "prompt": "A portrait of a person bathed in golden hour light..."},
  ...
]

Промпты на английском. Имена на русском. Только JSON.`,
    userPrompt: `Предложи ${data.count} разнообразных шаблонов для фото-генерации.`,
    model: config.models.haiku,
    maxTokens: 1500,
    businessId: data.businessId,
    action: 'photo_suggest_templates',
    userId: user.userId,
  })

  try {
    const templates = JSON.parse(result.content)
    return c.json(templates)
  } catch {
    return c.json([])
  }
})

// =====================
// POST /edit-image — img2img (delegates to existing editImage)
// =====================

const editSchema = z.object({
  imageUrl: z.string(),
  prompt: z.string().min(1),
  businessId: z.string(),
  model: z.enum(['nano-banana-2', 'flux-kontext-pro']).default('nano-banana-2'),
})

photos.post('/edit-image', async (c) => {
  const user = c.get('user') as AuthUser
  const data = editSchema.parse(await c.req.json())

  try { await assertBusinessAccess(user, data.businessId) } catch {
    return c.json({ error: 'Нет доступа' }, 403)
  }

  try {
    const result = await editImage({
      imageUrl: data.imageUrl,
      prompt: data.prompt,
      businessId: data.businessId,
      model: data.model,
      userId: user.userId,
    })
    return c.json(result)
  } catch (err: any) {
    log.error('[Photo] edit error', { error: err.message })
    return c.json({ error: err.message || 'Ошибка редактирования' }, 500)
  }
})

// =====================
// POST /remove-background — delegates to existing removeBackground
// =====================

const removeBgSchema = z.object({
  imageUrl: z.string(),
  businessId: z.string(),
})

photos.post('/remove-background', async (c) => {
  const user = c.get('user') as AuthUser
  const data = removeBgSchema.parse(await c.req.json())

  try { await assertBusinessAccess(user, data.businessId) } catch {
    return c.json({ error: 'Нет доступа' }, 403)
  }

  try {
    const result = await removeBackground({
      imageUrl: data.imageUrl,
      businessId: data.businessId,
      userId: user.userId,
    })
    return c.json(result)
  } catch (err: any) {
    log.error('[Photo] remove-bg error', { error: err.message })
    return c.json({ error: err.message || 'Ошибка удаления фона' }, 500)
  }
})

export { photos }
