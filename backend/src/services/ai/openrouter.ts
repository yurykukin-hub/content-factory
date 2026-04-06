import { config } from '../../config'
import { db } from '../../db'

/**
 * Получить OpenRouter API key: сначала из БД (AppConfig), потом fallback на .env
 */
async function getApiKey(): Promise<string> {
  try {
    const dbKey = await db.appConfig.findUnique({ where: { key: 'openrouter_api_key' } })
    if (dbKey?.value) return dbKey.value
  } catch {}
  return config.OPENROUTER_API_KEY
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
    costUsd: 0, // TODO: рассчитать по модели
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
