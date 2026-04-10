import { db } from '../db'
import crypto from 'crypto'

const VK_OAUTH_URL = 'https://id.vk.com/authorize'
const VK_TOKEN_URL = 'https://id.vk.com/oauth2/auth'
const VK_REDIRECT_URI = 'https://oauth.vk.com/blank.html'

/**
 * VK OAuth 2.1 + PKCE service.
 * Хранит credentials и токены в AppConfig (key-value).
 * Автоматически обновляет User Token перед истечением.
 */

// --- Helpers для AppConfig ---
async function getConfig(key: string): Promise<string | null> {
  const row = await db.appConfig.findUnique({ where: { key } })
  return row?.value || null
}

async function setConfig(key: string, value: string): Promise<void> {
  await db.appConfig.upsert({
    where: { key },
    update: { value },
    create: { key, value },
  })
}

async function deleteConfig(key: string): Promise<void> {
  await db.appConfig.deleteMany({ where: { key } })
}

// --- PKCE ---
function generatePKCE(): { verifier: string; challenge: string } {
  const verifier = crypto.randomBytes(32).toString('base64url').slice(0, 43)
  const challenge = crypto.createHash('sha256').update(verifier).digest('base64url')
  return { verifier, challenge }
}

// --- Public API ---

/**
 * Сохранить VK App credentials (App ID + App Secret)
 */
export async function saveAppConfig(appId: string, appSecret: string): Promise<void> {
  await setConfig('vk_app_id', appId)
  await setConfig('vk_app_secret', appSecret)
}

/**
 * Сгенерировать OAuth URL для авторизации.
 * Сохраняет PKCE verifier в AppConfig для обмена кода.
 */
export async function generateAuthUrl(): Promise<{ authUrl: string }> {
  const appId = await getConfig('vk_app_id')
  if (!appId) throw new Error('VK App ID не настроен. Сначала введите App ID в настройках.')

  const { verifier, challenge } = generatePKCE()
  await setConfig('vk_pkce_verifier', verifier)

  const params = new URLSearchParams({
    response_type: 'code',
    client_id: appId,
    scope: 'wall photos video stories offline',
    redirect_uri: VK_REDIRECT_URI,
    code_challenge: challenge,
    code_challenge_method: 's256',
    state: 'content-factory',
  })

  return { authUrl: `${VK_OAUTH_URL}?${params}` }
}

/**
 * Обменять authorization code на access_token + refresh_token.
 * Сохраняет токены в AppConfig.
 */
export async function exchangeCode(code: string, deviceId: string): Promise<{ success: boolean; error?: string }> {
  const appId = await getConfig('vk_app_id')
  const verifier = await getConfig('vk_pkce_verifier')

  if (!appId || !verifier) {
    return { success: false, error: 'App ID или PKCE verifier не найдены' }
  }

  const res = await fetch(VK_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      client_id: appId,
      code_verifier: verifier,
      redirect_uri: VK_REDIRECT_URI,
      device_id: deviceId,
    }),
  })

  const data = await res.json() as any

  if (data.error) {
    return { success: false, error: `VK OAuth: ${data.error} — ${data.error_description || ''}` }
  }

  if (!data.access_token) {
    return { success: false, error: 'VK не вернул access_token' }
  }

  // Сохранить токены
  await setConfig('vk_user_token', data.access_token)
  await setConfig('vk_refresh_token', data.refresh_token || '')
  await setConfig('vk_device_id', deviceId)

  const expiresAt = new Date(Date.now() + (data.expires_in || 3600) * 1000)
  await setConfig('vk_token_expires_at', expiresAt.toISOString())

  // Очистить verifier
  await deleteConfig('vk_pkce_verifier')

  console.log(`[VK OAuth] Token obtained, expires at ${expiresAt.toISOString()}`)
  return { success: true }
}

/**
 * Обновить access_token через refresh_token.
 */
export async function refreshToken(): Promise<{ success: boolean; expiresAt?: string; error?: string }> {
  const appId = await getConfig('vk_app_id')
  const refreshTok = await getConfig('vk_refresh_token')
  const deviceId = await getConfig('vk_device_id')

  if (!appId || !refreshTok || !deviceId) {
    const error = 'Нет данных для обновления токена (app_id, refresh_token или device_id)'
    await setConfig('vk_last_error', error)
    return { success: false, error }
  }

  try {
    const res = await fetch(VK_TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'refresh_token',
        refresh_token: refreshTok,
        client_id: appId,
        device_id: deviceId,
      }),
    })

    const data = await res.json() as any

    if (data.error) {
      const error = `VK Refresh: ${data.error} — ${data.error_description || ''}`
      await setConfig('vk_last_error', error)
      return { success: false, error }
    }

    await setConfig('vk_user_token', data.access_token)
    if (data.refresh_token) {
      await setConfig('vk_refresh_token', data.refresh_token)
    }

    const expiresAt = new Date(Date.now() + (data.expires_in || 3600) * 1000)
    await setConfig('vk_token_expires_at', expiresAt.toISOString())
    await deleteConfig('vk_last_error')

    console.log(`[VK OAuth] Token refreshed, expires at ${expiresAt.toISOString()}`)
    return { success: true, expiresAt: expiresAt.toISOString() }
  } catch (err) {
    const error = `Refresh failed: ${String(err)}`
    await setConfig('vk_last_error', error)
    return { success: false, error }
  }
}

/**
 * Получить валидный User Token. Обновляет автоматически если <5 мин до истечения.
 * Возвращает null если OAuth не настроен.
 */
export async function ensureValidToken(): Promise<string | null> {
  const token = await getConfig('vk_user_token')
  if (!token) return null

  const expiresAtStr = await getConfig('vk_token_expires_at')
  if (expiresAtStr) {
    const expiresAt = new Date(expiresAtStr)
    const minutesLeft = (expiresAt.getTime() - Date.now()) / 60000

    if (minutesLeft < 5) {
      console.log(`[VK OAuth] Token expires in ${minutesLeft.toFixed(1)} min, refreshing...`)
      const result = await refreshToken()
      if (result.success) {
        return await getConfig('vk_user_token')
      }
      // Если refresh не удался но токен ещё валиден — вернуть текущий
      if (minutesLeft > 0) return token
      return null
    }
  }

  return token
}

/**
 * Получить статус OAuth подключения.
 */
export async function getStatus(): Promise<{
  connected: boolean
  appId?: string
  hasAppSecret: boolean
  expiresAt?: string
  lastError?: string
}> {
  const appId = await getConfig('vk_app_id')
  const appSecret = await getConfig('vk_app_secret')
  const token = await getConfig('vk_user_token')
  const expiresAt = await getConfig('vk_token_expires_at')
  const lastError = await getConfig('vk_last_error')

  return {
    connected: !!token,
    appId: appId || undefined,
    hasAppSecret: !!appSecret,
    expiresAt: expiresAt || undefined,
    lastError: lastError || undefined,
  }
}

/**
 * Отключить VK OAuth — удалить все токены.
 */
export async function disconnect(): Promise<void> {
  const keys = ['vk_user_token', 'vk_refresh_token', 'vk_token_expires_at', 'vk_device_id', 'vk_pkce_verifier', 'vk_last_error']
  for (const key of keys) {
    await deleteConfig(key)
  }
  console.log('[VK OAuth] Disconnected')
}
