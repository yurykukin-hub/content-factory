import { Context, Next } from 'hono'
import { getCookie } from 'hono/cookie'
import * as jose from 'jose'
import { config } from '../config'

export interface AuthUser {
  userId: string
  name: string
  role: 'ADMIN' | 'EDITOR' | 'VIEWER'
}

/**
 * JWT auth middleware. Reads token from httpOnly cookie "token".
 * Sets c.set('user', AuthUser) on success.
 */
export async function requireAuth(c: Context, next: Next) {
  const token = getCookie(c, 'token')
  if (!token) {
    return c.json({ error: 'UNAUTHORIZED' }, 401)
  }

  try {
    const secret = new TextEncoder().encode(config.JWT_SECRET)
    const { payload } = await jose.jwtVerify(token, secret)

    const user: AuthUser = {
      userId: payload.userId as string,
      name: payload.name as string,
      role: payload.role as AuthUser['role'],
    }

    c.set('user', user)
    await next()
  } catch {
    return c.json({ error: 'INVALID_TOKEN' }, 401)
  }
}

/**
 * Role-based access control middleware.
 * Usage: app.use('/api/admin/*', requireRole('ADMIN'))
 */
export function requireRole(...roles: AuthUser['role'][]) {
  return async (c: Context, next: Next) => {
    const user = c.get('user') as AuthUser
    if (!roles.includes(user.role)) {
      return c.json({ error: 'FORBIDDEN' }, 403)
    }
    await next()
  }
}
