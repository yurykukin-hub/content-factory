import { Hono } from 'hono'
import * as vkOAuth from '../services/vk-oauth'

const vkOauthRoutes = new Hono()

// GET /api/vk-oauth/status — статус подключения
vkOauthRoutes.get('/status', async (c) => {
  const status = await vkOAuth.getStatus()
  return c.json(status)
})

// PUT /api/vk-oauth/app-config — сохранить App ID + App Secret
vkOauthRoutes.put('/app-config', async (c) => {
  const { appId, appSecret } = await c.req.json<{ appId: string; appSecret: string }>()
  if (!appId) return c.json({ error: 'App ID обязателен' }, 400)
  await vkOAuth.saveAppConfig(appId, appSecret || '')
  return c.json({ success: true })
})

// POST /api/vk-oauth/init — генерировать URL для OAuth
vkOauthRoutes.post('/init', async (c) => {
  try {
    const result = await vkOAuth.generateAuthUrl()
    return c.json(result)
  } catch (e: any) {
    return c.json({ error: e.message }, 400)
  }
})

// POST /api/vk-oauth/callback — обменять code на token
vkOauthRoutes.post('/callback', async (c) => {
  const { code, deviceId } = await c.req.json<{ code: string; deviceId: string }>()
  if (!code || !deviceId) return c.json({ error: 'code и deviceId обязательны' }, 400)

  const result = await vkOAuth.exchangeCode(code, deviceId)
  return c.json(result)
})

// POST /api/vk-oauth/refresh — ручной refresh токена
vkOauthRoutes.post('/refresh', async (c) => {
  const result = await vkOAuth.refreshToken()
  return c.json(result)
})

// POST /api/vk-oauth/disconnect — отключить OAuth
vkOauthRoutes.post('/disconnect', async (c) => {
  await vkOAuth.disconnect()
  return c.json({ success: true })
})

export { vkOauthRoutes }
