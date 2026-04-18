import { Hono } from 'hono'
import { db } from '../db'
import { config } from '../config'
import type { AuthUser } from '../middleware/auth'

const settings = new Hono()

// NOTE: GET /api/settings/public is mounted directly in app.ts (before section guard)

function maskSecret(value: string): string {
  if (!value || value.length < 14) return value ? '***' : ''
  return `${value.slice(0, 10)}...${value.slice(-4)}`
}

// GET /api/settings/config — все настройки (DB + .env fallback)
settings.get('/config', async (c) => {
  const user = c.get('user') as AuthUser
  if (user.role !== 'ADMIN') return c.json({ error: 'FORBIDDEN' }, 403)
  const configs = await db.appConfig.findMany()
  const result: Record<string, string> = {}
  for (const cfg of configs) {
    if (cfg.key.includes('key') || cfg.key.includes('token') || cfg.key.includes('secret')) {
      result[cfg.key] = maskSecret(cfg.value)
    } else {
      result[cfg.key] = cfg.value
    }
  }

  // Fallback: show .env keys if not in DB
  if (!result['openrouter_api_key'] && config.OPENROUTER_API_KEY) {
    result['openrouter_api_key'] = maskSecret(config.OPENROUTER_API_KEY) + ' (.env)'
  }
  if (!result['kie_api_key'] && config.KIE_API_KEY) {
    result['kie_api_key'] = maskSecret(config.KIE_API_KEY) + ' (.env)'
  }
  if (!result['openai_api_key'] && config.OPENAI_API_KEY) {
    result['openai_api_key'] = maskSecret(config.OPENAI_API_KEY) + ' (.env)'
  }

  return c.json(result)
})

// PUT /api/settings/config — обновить настройку
settings.put('/config', async (c) => {
  const user = c.get('user') as AuthUser
  if (user.role !== 'ADMIN') return c.json({ error: 'FORBIDDEN' }, 403)
  const { key, value } = await c.req.json<{ key: string; value: string }>()

  if (!key || typeof value !== 'string') {
    return c.json({ error: 'key и value обязательны' }, 400)
  }

  const config = await db.appConfig.upsert({
    where: { key },
    update: { value },
    create: { key, value },
  })

  return c.json({ success: true, key: config.key })
})

// GET /api/settings/config/:key — одна настройка (для внутреннего использования)
settings.get('/config/:key', async (c) => {
  const user = c.get('user') as AuthUser
  if (user.role !== 'ADMIN') return c.json({ error: 'FORBIDDEN' }, 403)
  const { key } = c.req.param()
  const config = await db.appConfig.findUnique({ where: { key } })
  return c.json({ key, hasValue: !!config?.value })
})

export { settings }
