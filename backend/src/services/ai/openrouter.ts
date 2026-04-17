import { config } from '../../config'
import { db } from '../../db'
import { getMarkupPercent, calculateChargedRub, chargeUser } from '../billing'

/**
 * Получить OpenRouter API key: сначала из БД (AppConfig), потом fallback на .env
 */
export async function getApiKey(): Promise<string> {
  try {
    const dbKey = await db.appConfig.findUnique({ where: { key: 'openrouter_api_key' } })
    if (dbKey?.value) return dbKey.value
  } catch (err) {
    // DB may be unavailable — fallback to env is fine
    console.warn('[AI] Failed to read API key from DB, using env fallback')
  }
  return config.OPENROUTER_API_KEY
}

/** Approximate pricing per 1M tokens (input/output) */
const MODEL_PRICING: Record<string, { input: number; output: number }> = {
  'anthropic/claude-3.5-haiku': { input: 0.80, output: 4.00 },
  'anthropic/claude-sonnet-4': { input: 3.00, output: 15.00 },
  'google/gemini-2.0-flash-001': { input: 0.10, output: 0.40 },
  'google/gemini-2.5-flash-image': { input: 0.15, output: 0.60 },
}

export function calculateCost(model: string, tokensIn: number, tokensOut: number): number {
  const pricing = MODEL_PRICING[model]
  if (!pricing) return 0
  return (tokensIn * pricing.input + tokensOut * pricing.output) / 1_000_000
}

/**
 * Fetch OpenRouter account balance via /api/v1/credits
 */
export async function fetchOpenRouterBalance(): Promise<{ balanceUsd: number; limitUsd: number | null } | null> {
  try {
    const apiKey = await getApiKey()
    if (!apiKey) return null
    const res = await fetch('https://openrouter.ai/api/v1/credits', {
      headers: { 'Authorization': `Bearer ${apiKey}` },
    })
    if (!res.ok) return null
    const data = await res.json() as any
    const total = data.total_credits ?? 0
    const used = data.total_usage ?? 0
    return { balanceUsd: total - used, limitUsd: data.limit ?? null }
  } catch {
    return null
  }
}

interface AiCompleteParams {
  systemPrompt: string
  userPrompt: string
  model?: string
  maxTokens?: number
  businessId?: string
  action?: string
  userId?: string
}

interface AiCompleteResult {
  content: string
  tokensIn: number
  tokensOut: number
  cachedTokens: number
  costUsd: number
  model: string
}

export interface AiChatParams {
  systemPrompt: string
  messages: Array<{ role: 'user' | 'assistant'; content: string }>
  model?: string
  maxTokens?: number
  businessId?: string
  action?: string
  userId?: string
}

/**
 * Общий блок: запись в AiUsageLog + списание с баланса пользователя.
 * Вызывается только когда params.action задан.
 */
async function logAndCharge(params: {
  businessId?: string | null
  userId?: string
  action: string
  model: string
  result: AiCompleteResult
  prompt: string
  start: number
}): Promise<void> {
  const markup = await getMarkupPercent()
  const chargedRub = calculateChargedRub(params.result.costUsd, markup)

  const log = await db.aiUsageLog.create({
    data: {
      businessId: params.businessId || null,
      userId: params.userId || null,
      action: params.action,
      model: params.model,
      tokensIn: params.result.tokensIn,
      tokensOut: params.result.tokensOut,
      cachedTokens: params.result.cachedTokens,
      costUsd: params.result.costUsd,
      markupPercent: markup,
      chargedRub,
      status: 'success',
      prompt: params.prompt.slice(0, 2000),
      durationMs: Date.now() - params.start,
    },
  })

  // Charge user balance (ADMIN exempt)
  if (params.userId && params.result.costUsd > 0) {
    const user = await db.user.findUnique({ where: { id: params.userId }, select: { role: true } })
    if (user) {
      await chargeUser({
        userId: params.userId, role: user.role, costUsd: params.result.costUsd,
        markupPercent: markup, aiUsageLogId: log.id, description: params.action,
      })
    }
  }
}

/**
 * Вызов OpenRouter API для генерации текста.
 * Трекает использование в AiUsageLog.
 */
export async function aiComplete(params: AiCompleteParams): Promise<AiCompleteResult> {
  const model = params.model || config.models.haiku
  const apiKey = await getApiKey()
  const start = Date.now()

  const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
      'HTTP-Referer': 'https://content.yurykukin.ru',
      'X-Title': 'Content Factory',
    },
    body: JSON.stringify({
      model,
      max_tokens: params.maxTokens || 2000,
      messages: [
        { role: 'system', content: params.systemPrompt },
        { role: 'user', content: params.userPrompt },
      ],
    }),
  })

  if (!response.ok) {
    const err = await response.text()
    throw new Error(`OpenRouter error ${response.status}: ${err}`)
  }

  const data = await response.json() as any
  const content = data.choices?.[0]?.message?.content || ''
  const usage = data.usage || {}

  const result: AiCompleteResult = {
    content,
    tokensIn: usage.prompt_tokens || 0,
    tokensOut: usage.completion_tokens || 0,
    cachedTokens: usage.prompt_tokens_details?.cached_tokens || 0,
    costUsd: calculateCost(model, usage.prompt_tokens || 0, usage.completion_tokens || 0),
    model,
  }

  if (params.action) {
    await logAndCharge({
      businessId: params.businessId,
      userId: params.userId,
      action: params.action,
      model,
      result,
      prompt: params.userPrompt || '',
      start,
    })
  }

  return result
}

/**
 * Vision-вызов OpenRouter: текст + изображения.
 * Отправляет изображения как image_url в multimodal message.
 */
export async function aiVision(params: {
  systemPrompt: string
  userPrompt: string
  imageUrls: string[]
  model?: string
  maxTokens?: number
  businessId?: string | null
  action?: string
  userId?: string
}): Promise<AiCompleteResult> {
  const model = params.model || config.models.haiku
  const apiKey = await getApiKey()
  const start = Date.now()

  // Собрать multimodal content: текст + картинки
  const userContent: any[] = [
    { type: 'text', text: params.userPrompt },
  ]
  for (const url of params.imageUrls) {
    userContent.push({ type: 'image_url', image_url: { url } })
  }

  const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
      'HTTP-Referer': 'https://content.yurykukin.ru',
      'X-Title': 'Content Factory',
    },
    body: JSON.stringify({
      model,
      max_tokens: params.maxTokens || 1000,
      messages: [
        { role: 'system', content: params.systemPrompt },
        { role: 'user', content: userContent },
      ],
    }),
  })

  if (!response.ok) {
    const err = await response.text()
    throw new Error(`OpenRouter vision error ${response.status}: ${err}`)
  }

  const data = await response.json() as any
  const content = data.choices?.[0]?.message?.content || ''
  const usage = data.usage || {}

  const result: AiCompleteResult = {
    content,
    tokensIn: usage.prompt_tokens || 0,
    tokensOut: usage.completion_tokens || 0,
    cachedTokens: usage.prompt_tokens_details?.cached_tokens || 0,
    costUsd: calculateCost(model, usage.prompt_tokens || 0, usage.completion_tokens || 0),
    model,
  }

  if (params.action) {
    await logAndCharge({
      businessId: params.businessId,
      userId: params.userId,
      action: params.action,
      model,
      result,
      prompt: params.userPrompt || '',
      start,
    })
  }

  return result
}

/**
 * Multi-turn chat вызов OpenRouter API.
 * Принимает историю сообщений user/assistant и системный промпт.
 * Трекает использование в AiUsageLog — пишет последнее user-сообщение как prompt.
 */
export async function aiChat(params: AiChatParams): Promise<AiCompleteResult> {
  const model = params.model || config.models.haiku
  const apiKey = await getApiKey()
  const start = Date.now()

  const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
      'HTTP-Referer': 'https://content.yurykukin.ru',
      'X-Title': 'Content Factory',
    },
    body: JSON.stringify({
      model,
      max_tokens: params.maxTokens || 2000,
      messages: [
        { role: 'system', content: params.systemPrompt },
        ...params.messages,
      ],
    }),
  })

  if (!response.ok) {
    const err = await response.text()
    throw new Error(`OpenRouter chat error ${response.status}: ${err}`)
  }

  const data = await response.json() as any
  const content = data.choices?.[0]?.message?.content || ''
  const usage = data.usage || {}

  const result: AiCompleteResult = {
    content,
    tokensIn: usage.prompt_tokens || 0,
    tokensOut: usage.completion_tokens || 0,
    cachedTokens: usage.prompt_tokens_details?.cached_tokens || 0,
    costUsd: calculateCost(model, usage.prompt_tokens || 0, usage.completion_tokens || 0),
    model,
  }

  if (params.action) {
    // Для лога берём последнее user-сообщение из истории
    const lastUserMessage = [...params.messages].reverse().find(m => m.role === 'user')
    const promptForLog = lastUserMessage?.content || ''

    await logAndCharge({
      businessId: params.businessId,
      userId: params.userId,
      action: params.action,
      model,
      result,
      prompt: promptForLog,
      start,
    })
  }

  return result
}
