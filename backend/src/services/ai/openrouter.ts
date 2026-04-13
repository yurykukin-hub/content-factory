import { config } from '../../config'
import { db } from '../../db'

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

interface AiCompleteParams {
  systemPrompt: string
  userPrompt: string
  model?: string
  maxTokens?: number
  businessId?: string
  action?: string
}

interface AiCompleteResult {
  content: string
  tokensIn: number
  tokensOut: number
  cachedTokens: number
  costUsd: number
  model: string
}

/**
 * Вызов OpenRouter API для генерации текста.
 * Трекает использование в AiUsageLog.
 */
export async function aiComplete(params: AiCompleteParams): Promise<AiCompleteResult> {
  const model = params.model || config.models.haiku
  const apiKey = await getApiKey()

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

  // Log usage
  if (params.businessId && params.action) {
    await db.aiUsageLog.create({
      data: {
        businessId: params.businessId,
        action: params.action,
        model,
        tokensIn: result.tokensIn,
        tokensOut: result.tokensOut,
        cachedTokens: result.cachedTokens,
        costUsd: result.costUsd,
      },
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
  businessId?: string
  action?: string
}): Promise<AiCompleteResult> {
  const model = params.model || config.models.haiku
  const apiKey = await getApiKey()

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

  if (params.businessId && params.action) {
    await db.aiUsageLog.create({
      data: {
        businessId: params.businessId,
        action: params.action,
        model,
        tokensIn: result.tokensIn,
        tokensOut: result.tokensOut,
        cachedTokens: result.cachedTokens,
        costUsd: result.costUsd,
      },
    })
  }

  return result
}
