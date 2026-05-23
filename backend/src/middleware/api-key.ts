import { Context, Next } from 'hono'
import { createHash } from 'crypto'
import { db } from '../db'
import type { AuthUser } from './auth'

function hashKey(key: string): string {
  return createHash('sha256').update(key).digest('hex')
}

let lastUsedUpdates = new Map<string, number>()

/**
 * API Key auth middleware. Reads key from Authorization: Bearer <key>.
 * Sets c.set('user', AuthUser) on success — same interface as JWT auth.
 */
export async function requireApiKey(c: Context, next: Next) {
  const authHeader = c.req.header('Authorization')
  if (!authHeader?.startsWith('Bearer ')) {
    return c.json({ error: 'UNAUTHORIZED' }, 401)
  }

  const key = authHeader.slice(7)
  const keyHash = hashKey(key)

  const apiKey = await db.apiKey.findUnique({
    where: { keyHash },
    include: { user: true },
  })

  if (!apiKey || !apiKey.isActive || !apiKey.user.isActive) {
    return c.json({ error: 'INVALID_API_KEY' }, 401)
  }

  // Debounced lastUsed update (at most once per minute per key)
  const now = Date.now()
  const lastUpdate = lastUsedUpdates.get(apiKey.id) ?? 0
  if (now - lastUpdate > 60_000) {
    lastUsedUpdates.set(apiKey.id, now)
    db.apiKey.update({
      where: { id: apiKey.id },
      data: { lastUsed: new Date() },
    }).catch(() => {}) // fire-and-forget
  }

  const user: AuthUser = {
    userId: apiKey.user.id,
    name: apiKey.user.name,
    role: apiKey.user.role as AuthUser['role'],
    sectionAccess: apiKey.user.sectionAccess as AuthUser['sectionAccess'],
  }

  c.set('user', user)
  c.set('isApiKey', true) // Flag for CSRF skip
  await next()
}

export { hashKey }
