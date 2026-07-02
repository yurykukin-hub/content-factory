import { Context, Next } from 'hono'
import { getCookie } from 'hono/cookie'
import * as jose from 'jose'
import { config } from '../config'
import type { SectionAccess } from '../shared/section-access'

export interface AuthUser {
  userId: string
  name: string
  role: 'ADMIN' | 'EDITOR' | 'VIEWER'
  sectionAccess?: SectionAccess | null
}

// Типизируем Hono-контекст: c.get('user') → AuthUser (вместо unknown).
// Убирает TS2769 "No overload" на c.get('user') по всему проекту (часть Hono-baseline).
declare module 'hono' {
  interface ContextVariableMap {
    user: AuthUser
    isApiKey: boolean // выставляется api-key middleware для пропуска CSRF
  }
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
    // Пиннинг алгоритма HS256 — защита от algorithm-confusion.
    const { payload } = await jose.jwtVerify(token, secret, { algorithms: ['HS256'] })

    // Отклоняем не-access токены (например, 30-дневный refresh, поданный как access).
    // Access-токены подписываются с type:'access'; refresh живёт в отдельной cookie refresh_token.
    if (payload.type !== 'access') {
      return c.json({ error: 'INVALID_TOKEN' }, 401)
    }

    const user: AuthUser = {
      userId: payload.userId as string,
      name: payload.name as string,
      role: payload.role as AuthUser['role'],
      sectionAccess: (payload.sectionAccess as SectionAccess) ?? null,
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
