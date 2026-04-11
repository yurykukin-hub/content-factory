import { z } from 'zod'

const envSchema = z.object({
  DATABASE_URL: z.string(),
  JWT_SECRET: z.string().min(32),
  PORT: z.coerce.number().default(3800),
  OPENROUTER_API_KEY: z.string().default(''),  // Можно задать через UI (Settings → AI)
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
})

const parsed = envSchema.safeParse(process.env)

if (!parsed.success) {
  console.error('Invalid environment variables:', parsed.error.flatten().fieldErrors)
  process.exit(1)
}

export const config = {
  ...parsed.data,
  isProd: parsed.data.NODE_ENV === 'production',

  // AI models
  models: {
    haiku: 'anthropic/claude-3.5-haiku',
    sonnet: 'anthropic/claude-sonnet-4',
    imageGen: 'google/gemini-2.5-flash-image',
  },
}
