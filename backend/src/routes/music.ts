/**
 * Music API routes — Sound Studio backend.
 * Pattern mirrors routes/ai.ts (video generation).
 */

import { Hono } from 'hono'
import { z } from 'zod'
import { db } from '../db'
import type { AuthUser } from '../middleware/auth'
import { assertBusinessAccess } from '../middleware/resource-access'
import { canAfford } from '../services/billing'
import { createMusicTask } from '../services/ai/suno'
import { aiComplete, aiChat } from '../services/ai/openrouter'
import {
  buildBrandContext,
  buildMusicPromptEnhancer, buildMusicLyricsGenerator, buildMusicLyricsImprover,
  buildMusicStyleSuggester, buildMusicStructureHelper, buildMusicRhymeHelper,
  buildMusicTranslate, buildMusicPromptSimplify,
  buildMusicAgentSystemPrompt, analyzeLyrics,
  type MusicEnhanceMode, type MusicAgentContext,
} from '../services/ai/prompt-builder'
import { config } from '../config'
import { log } from '../utils/logger'

const music = new Hono()

// =====================
// POST /generate — async music generation (returns 202)
// =====================

const generateSchema = z.object({
  businessId: z.string(),
  sessionId: z.string().optional(),
  prompt: z.string().min(1),
  customMode: z.boolean().default(false),
  instrumental: z.boolean().default(false),
  style: z.string().max(1000).optional(),
  title: z.string().max(80).optional(),
  negativeTags: z.string().optional(),
  vocalGender: z.enum(['f', 'm']).optional(),
  styleWeight: z.number().min(0).max(1).optional(),
  weirdnessConstraint: z.number().min(0).max(1).optional(),
  audioWeight: z.number().min(0).max(1).optional(),
  sunoModel: z.string().default('suno/v4.5'),
  personaId: z.string().optional(),
})

music.post('/generate', async (c) => {
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
    // Resolve persona sunoPersonaId if persona selected
    let sunoPersonaId: string | undefined
    if (data.personaId) {
      const persona = await db.musicPersona.findUnique({ where: { id: data.personaId } })
      if (persona?.sunoPersonaId) sunoPersonaId = persona.sunoPersonaId
    }

    const task = await createMusicTask({
      ...data,
      personaId: sunoPersonaId,
      userId: user.userId,
    })

    // Update session with KIE task info
    if (data.sessionId) {
      await db.generationSession.update({
        where: { id: data.sessionId },
        data: {
          status: 'generating',
          kieTaskId: task.kieTaskId,
          kieTaskCreatedAt: new Date(),
          costUsd: task.costUsd,
          model: task.model,
          sunoModel: data.sunoModel,
        },
      })
    }

    return c.json({
      sessionId: data.sessionId,
      kieTaskId: task.kieTaskId,
      status: 'generating',
      costUsd: task.costUsd,
    }, 202)
  } catch (err: any) {
    // Rollback session status on error
    if (data.sessionId) {
      await db.generationSession.update({
        where: { id: data.sessionId },
        data: { status: 'failed', errorMessage: err.message?.slice(0, 300) },
      }).catch(() => {})
    }
    log.error('[Music] generate error', { error: err.message })
    return c.json({ error: err.message || 'Ошибка генерации музыки' }, 500)
  }
})

// =====================
// POST /enhance-prompt — 8 music enhance modes
// =====================

const enhanceSchema = z.object({
  prompt: z.string().min(1),
  businessId: z.string(),
  mode: z.enum(['enhance', 'lyrics', 'improve', 'style', 'structure', 'rhyme', 'translate', 'simplify']),
  lyrics: z.string().optional(), // for modes that work on lyrics
})

music.post('/enhance-prompt', async (c) => {
  const user = c.get('user') as AuthUser
  const data = enhanceSchema.parse(await c.req.json())

  try { await assertBusinessAccess(user, data.businessId) } catch {
    return c.json({ error: 'Нет доступа' }, 403)
  }

  const brandContext = await buildBrandContext(data.businessId)
  const input = data.lyrics || data.prompt

  // Select system prompt based on mode
  let systemPrompt: string
  let model = config.models.haiku // default to Haiku
  const mode = data.mode as MusicEnhanceMode

  switch (mode) {
    case 'enhance':
      systemPrompt = buildMusicPromptEnhancer(brandContext)
      break
    case 'lyrics':
      systemPrompt = buildMusicLyricsGenerator(brandContext)
      model = config.models.sonnet // Sonnet for creative writing
      break
    case 'improve':
      systemPrompt = buildMusicLyricsImprover()
      model = config.models.sonnet
      break
    case 'style':
      systemPrompt = buildMusicStyleSuggester()
      break
    case 'structure':
      systemPrompt = buildMusicStructureHelper()
      break
    case 'rhyme':
      systemPrompt = buildMusicRhymeHelper()
      break
    case 'translate':
      systemPrompt = buildMusicTranslate()
      break
    case 'simplify':
      systemPrompt = buildMusicPromptSimplify()
      break
    default:
      return c.json({ error: 'Unknown mode' }, 400)
  }

  const result = await aiComplete({
    systemPrompt,
    userPrompt: input,
    model,
    maxTokens: mode === 'lyrics' || mode === 'improve' ? 2000 : 500,
    businessId: data.businessId,
    action: `music_enhance_${mode}`,
    userId: user.userId,
  })

  // Analyze lyrics if the result contains section markers
  const analysis = result.content.includes('[Verse]') || result.content.includes('[Chorus]')
    ? analyzeLyrics(result.content)
    : null

  return c.json({
    enhancedPrompt: result.content.trim(),
    mode,
    analysis,
    debug: {
      model: result.model,
      tokensIn: result.tokensIn,
      tokensOut: result.tokensOut,
      costUsd: result.costUsd,
    },
  })
})

// =====================
// POST /agent-chat — AI Agent for music (multi-turn)
// =====================

const agentChatSchema = z.object({
  messages: z.array(z.object({
    role: z.enum(['user', 'assistant']),
    content: z.string(),
  })).min(1),
  context: z.object({
    customMode: z.boolean().default(false),
    instrumental: z.boolean().default(false),
    currentPrompt: z.string().default(''),
    lyrics: z.string().default(''),
    musicStyle: z.string().default(''),
    musicTitle: z.string().default(''),
    sunoModel: z.string().default('suno/v4.5'),
    vocalGender: z.enum(['f', 'm']).nullable().default(null),
    styleWeight: z.number().default(0.7),
    weirdnessConstraint: z.number().default(0.3),
  }),
  mode: z.enum(['simple', 'advanced']).default('simple'),
  businessId: z.string(),
})

music.post('/agent-chat', async (c) => {
  const user = c.get('user') as AuthUser
  const data = agentChatSchema.parse(await c.req.json())

  try { await assertBusinessAccess(user, data.businessId) } catch {
    return c.json({ error: 'Нет доступа' }, 403)
  }

  const brandContext = await buildBrandContext(data.businessId)

  const agentContext: MusicAgentContext = {
    ...data.context,
    vocalGender: data.context.vocalGender,
  }

  const systemPrompt = buildMusicAgentSystemPrompt(agentContext, data.mode, brandContext)
  const model = data.mode === 'advanced' ? config.models.sonnet : config.models.haiku

  // Keep last 20 messages to cap token usage
  const recentMessages = data.messages.slice(-20)

  const result = await aiChat({
    systemPrompt,
    messages: recentMessages,
    model,
    maxTokens: 2000,
    businessId: data.businessId,
    action: `music_agent_chat_${data.mode}`,
    userId: user.userId,
  })

  return c.json({ content: result.content })
})

// =====================
// POST /suggest-templates — AI-generated music prompt templates
// =====================

const suggestSchema = z.object({
  businessId: z.string(),
  count: z.number().int().min(1).max(10).default(5),
})

music.post('/suggest-templates', async (c) => {
  const user = c.get('user') as AuthUser
  const data = suggestSchema.parse(await c.req.json())

  try { await assertBusinessAccess(user, data.businessId) } catch {
    return c.json({ error: 'Нет доступа' }, 403)
  }

  const brandContext = await buildBrandContext(data.businessId)

  const result = await aiComplete({
    systemPrompt: `Ты — музыкальный продюсер. Предложи ${data.count} шаблонов промптов для AI-генерации музыки.
Учитывай контекст бренда для релевантности.

${brandContext}

## Формат ответа — строго JSON массив:
[
  {"emoji": "🎸", "name": "Энергичный инди-рок", "prompt": "An energetic indie rock anthem..."},
  ...
]

Промпты на английском. Имена на русском. Только JSON.`,
    userPrompt: `Предложи ${data.count} разнообразных шаблонов музыкальных промптов.`,
    model: config.models.haiku,
    maxTokens: 1500,
    businessId: data.businessId,
    action: 'music_suggest_templates',
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
// Personas CRUD
// =====================

// GET /personas — list active personas
music.get('/personas', async (c) => {
  const personas = await db.musicPersona.findMany({
    where: { isActive: true },
    orderBy: { createdAt: 'desc' },
    include: {
      sampleMedia: { select: { id: true, url: true, filename: true, mimeType: true } },
    },
  })
  return c.json(personas)
})

// POST /personas — create persona
const personaCreateSchema = z.object({
  name: z.string().min(1).max(100),
  description: z.string().max(500).default(''),
  gender: z.enum(['m', 'f', 'neutral']).optional().nullable(),
  sampleMediaId: z.string().optional().nullable(),
})

music.post('/personas', async (c) => {
  const user = c.get('user') as AuthUser
  if ((user as any).role !== 'ADMIN') return c.json({ error: 'ADMIN only' }, 403)

  const data = personaCreateSchema.parse(await c.req.json())
  const persona = await db.musicPersona.create({ data })
  return c.json(persona, 201)
})

// PUT /personas/:id — update persona
const personaUpdateSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  description: z.string().max(500).optional(),
  gender: z.enum(['m', 'f', 'neutral']).optional().nullable(),
  sampleMediaId: z.string().optional().nullable(),
  sunoPersonaId: z.string().optional().nullable(),
  isActive: z.boolean().optional(),
})

music.put('/personas/:id', async (c) => {
  const user = c.get('user') as AuthUser
  if ((user as any).role !== 'ADMIN') return c.json({ error: 'ADMIN only' }, 403)

  const { id } = c.req.param()
  const data = personaUpdateSchema.parse(await c.req.json())
  const persona = await db.musicPersona.update({ where: { id }, data })
  return c.json(persona)
})

// DELETE /personas/:id
music.delete('/personas/:id', async (c) => {
  const user = c.get('user') as AuthUser
  if ((user as any).role !== 'ADMIN') return c.json({ error: 'ADMIN only' }, 403)

  const { id } = c.req.param()
  await db.musicPersona.delete({ where: { id } })
  return c.json({ ok: true })
})

export { music }
