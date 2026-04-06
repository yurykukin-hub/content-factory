import { Hono } from 'hono'
import { db } from '../db'

const settings = new Hono()

// GET /api/settings/config — все настройки
settings.get('/config', async (c) => {
  const configs = await db.appConfig.findMany()
  const result: Record<string, string> = {}
  for (const cfg of configs) {
    // Маскируем секретные ключи
    if (cfg.key.includes('key') || cfg.key.includes('token') || cfg.key.includes('secret')) {
      result[cfg.key] = cfg.value ? `${cfg.value.slice(0, 10)}...${cfg.value.slice(-4)}` : ''
    } else {
      result[cfg.key] = cfg.value
    }
  }
  return c.json(result)
})

// PUT /api/settings/config — обновить настройку
settings.put('/config', async (c) => {
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
  const { key } = c.req.param()
  const config = await db.appConfig.findUnique({ where: { key } })
  return c.json({ key, hasValue: !!config?.value })
})

export { settings }
