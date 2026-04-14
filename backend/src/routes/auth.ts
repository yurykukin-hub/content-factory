import { Hono } from 'hono'
import { setCookie, deleteCookie, getCookie } from 'hono/cookie'
import * as jose from 'jose'
import { db } from '../db'
import { config } from '../config'
import type { AuthUser } from '../middleware/auth'

const auth = new Hono()

const ACCESS_TOKEN_TTL = '1h'     // Short-lived access token
const REFRESH_TOKEN_TTL = '30d'   // Long-lived refresh token
const ACCESS_COOKIE_MAX_AGE = 60 * 60          // 1 hour
const REFRESH_COOKIE_MAX_AGE = 30 * 24 * 60 * 60 // 30 days

async function issueTokens(c: any, user: { id: string; name: string; login: string; role: string; sectionAccess?: unknown }) {
  const secret = new TextEncoder().encode(config.JWT_SECRET)

  const accessToken = await new jose.SignJWT({
    userId: user.id, name: user.name, role: user.role, type: 'access',
    ...(user.sectionAccess ? { sectionAccess: user.sectionAccess } : {}),
  })
    .setProtectedHeader({ alg: 'HS256' })
    .setExpirationTime(ACCESS_TOKEN_TTL)
    .sign(secret)

  const refreshToken = await new jose.SignJWT({
    userId: user.id, type: 'refresh',
  })
    .setProtectedHeader({ alg: 'HS256' })
    .setExpirationTime(REFRESH_TOKEN_TTL)
    .sign(secret)

  setCookie(c, 'token', accessToken, {
    httpOnly: true, secure: config.isProd, sameSite: 'Lax',
    maxAge: ACCESS_COOKIE_MAX_AGE, path: '/',
  })

  setCookie(c, 'refresh_token', refreshToken, {
    httpOnly: true, secure: config.isProd, sameSite: 'Lax',
    maxAge: REFRESH_COOKIE_MAX_AGE, path: '/api/auth',
  })

  return { accessToken, refreshToken }
}

// POST /api/auth/login
auth.post('/login', async (c) => {
  const { login, password } = await c.req.json<{ login: string; password: string }>()

  const user = await db.user.findUnique({ where: { login } })
  if (!user || !user.isActive) {
    return c.json({ error: 'Неверный логин или пароль' }, 401)
  }

  const valid = await Bun.password.verify(password, user.passwordHash)
  if (!valid) {
    return c.json({ error: 'Неверный логин или пароль' }, 401)
  }

  await issueTokens(c, user)

  return c.json({
    success: true,
    user: {
      id: user.id, name: user.name, login: user.login, role: user.role,
      sectionAccess: user.sectionAccess,
    },
  })
})

// POST /api/auth/refresh — get new access token using refresh token
auth.post('/refresh', async (c) => {
  const refreshToken = getCookie(c, 'refresh_token')
  if (!refreshToken) {
    return c.json({ error: 'No refresh token' }, 401)
  }

  try {
    const secret = new TextEncoder().encode(config.JWT_SECRET)
    const { payload } = await jose.jwtVerify(refreshToken, secret)

    if (payload.type !== 'refresh') {
      return c.json({ error: 'Invalid token type' }, 401)
    }

    const user = await db.user.findUnique({
      where: { id: payload.userId as string },
      select: { id: true, name: true, login: true, role: true, isActive: true, sectionAccess: true },
    })

    if (!user || !user.isActive) {
      return c.json({ error: 'User not found or inactive' }, 401)
    }

    await issueTokens(c, user)

    return c.json({
      success: true,
      user: {
        id: user.id, name: user.name, login: user.login, role: user.role,
        sectionAccess: user.sectionAccess,
      },
    })
  } catch {
    return c.json({ error: 'Invalid refresh token' }, 401)
  }
})

// POST /api/auth/logout
auth.post('/logout', (c) => {
  deleteCookie(c, 'token', { path: '/' })
  deleteCookie(c, 'refresh_token', { path: '/api/auth' })
  return c.json({ success: true })
})

// GET /api/auth/me
auth.get('/me', async (c) => {
  const token = getCookie(c, 'token')
  if (!token) return c.json(null)

  try {
    const secret = new TextEncoder().encode(config.JWT_SECRET)
    const { payload } = await jose.jwtVerify(token, secret)

    const dbUser = await db.user.findUnique({
      where: { id: payload.userId as string },
      select: { id: true, name: true, login: true, role: true, sectionAccess: true },
    })

    return c.json(dbUser)
  } catch {
    // Access token expired — try refresh
    const refreshToken = getCookie(c, 'refresh_token')
    if (!refreshToken) return c.json(null)

    try {
      const secret = new TextEncoder().encode(config.JWT_SECRET)
      const { payload } = await jose.jwtVerify(refreshToken, secret)
      if (payload.type !== 'refresh') return c.json(null)

      const user = await db.user.findUnique({
        where: { id: payload.userId as string },
        select: { id: true, name: true, login: true, role: true, isActive: true, sectionAccess: true },
      })
      if (!user || !user.isActive) return c.json(null)

      // Re-issue tokens transparently
      await issueTokens(c, user)
      return c.json({
        id: user.id, name: user.name, login: user.login, role: user.role,
        sectionAccess: user.sectionAccess,
      })
    } catch {
      return c.json(null)
    }
  }
})

export { auth }
