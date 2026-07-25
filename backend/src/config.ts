import { z } from 'zod'

const envSchema = z.object({
  DATABASE_URL: z.string(),
  JWT_SECRET: z.string().min(32),
  PORT: z.coerce.number().default(3800),
  OPENROUTER_API_KEY: z.string().default(''),  // Можно задать через UI (Settings → AI)

  // LLM-канал. Из РФ-ноды (СПб) openrouter.ai отдаёт 403 (Cloudflare geo-block),
  // Anthropic/OpenAI недопустимы по ToS → чат идёт через litellm-шлюз на EU-ноде.
  // Пусто = прежнее прямое поведение. На шлюзе wildcard-passthrough, поэтому
  // id моделей и таблица MODEL_PRICING остаются без изменений.
  LLM_BASE_URL: z.string().default(''),
  LLM_API_KEY: z.string().default(''),          // на шлюзе это LITELLM_MASTER_KEY
  // Отдельный канал для OpenRouter-специфичных ручек (/credits — баланса у litellm нет).
  // Через Caddy-шлюз это passthrough-путь: https://gw.yurykukin.ru/api/v1
  OPENROUTER_PASSTHROUGH_URL: z.string().default('https://openrouter.ai/api/v1'),
  KIE_API_KEY: z.string().default(''),            // KIE.ai — image editing, video generation
  OPENAI_API_KEY: z.string().default(''),          // OpenAI Whisper (voice transcription)
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
})

const parsed = envSchema.safeParse(process.env)

if (!parsed.success) {
  console.error('Invalid environment variables:', parsed.error.flatten().fieldErrors)
  process.exit(1)
}

// В production JWT_SECRET не должен быть плейсхолдером/предсказуемым dev-ключом — иначе токены подделываются.
if (parsed.data.NODE_ENV === 'production') {
  const s = parsed.data.JWT_SECRET
  const weak = s.startsWith('change-this') || /-dev-|dev-key/i.test(s)
  if (weak) {
    console.error('[SECURITY] JWT_SECRET выглядит как плейсхолдер/dev-ключ. Сгенерируйте: openssl rand -base64 48')
    process.exit(1)
  }
}

export const config = {
  ...parsed.data,
  isProd: parsed.data.NODE_ENV === 'production',

  // LLM-канал (см. services/ai/openrouter.ts). baseUrl задан => чат идёт через
  // EU-шлюз и ключ берём из env (master-key шлюза), а НЕ из БД: в БД лежит
  // прямой ключ OpenRouter, шлюз его не примет.
  llm: {
    baseUrl: parsed.data.LLM_BASE_URL || '',
    apiKey: parsed.data.LLM_API_KEY || '',
    chatUrl: (parsed.data.LLM_BASE_URL || 'https://openrouter.ai/api/v1') + '/chat/completions',
  },

  // AI models
  models: {
    haiku: 'anthropic/claude-haiku-4.5', // 3.5-haiku снят с Bedrock (EOL → 404) 2026-06-20; 4.5 — актуальный Haiku
    sonnet: 'anthropic/claude-sonnet-4.6', // 4.6 — актуальный Sonnet, та же цена $3/$15 (был claude-sonnet-4, deprecated 15.06.2026)
    vision: 'google/gemini-2.5-flash-lite', // captioning галереи: быстрее/дешевле flash при том же качестве (тест Ф0.1, 19.06.2026)
    visionFallback: 'google/gemini-2.5-flash', // запасная (НЕ qwen — зацикливается)
    imageGen: 'google/gemini-2.5-flash-image',
    kieEditImage: 'nano-banana-2',
    kieRemoveBg: 'recraft/remove-background',
  },
}
