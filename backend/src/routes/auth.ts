import { Hono } from 'hono'
import { setCookie, deleteCookie } from 'hono/cookie'
import * as jose from 'jose'
import { db } from '../db'
import { config } from '../config'
import type { AuthUser } from '../middleware/auth'

const auth = new Hono()

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

  const secret = new TextEncoder().encode(config.JWT_SECRET)
  const token = await new jose.SignJWT({
    userId: user.id,
    name: user.name,
    role: user.role,
  })
    .setProtectedHeader({ alg: 'HS256' })
    .setExpirationTime('30d')
    .sign(secret)

  setCookie(c, 'token', token, {
    httpOnly: true,
    secure: config.isProd,
    sameSite: 'Lax',
    maxAge: 30 * 24 * 60 * 60, // 30 days
    path: '/',
  })

  return c.json({
    success: true,
    user: { id: user.id, name: user.name, login: user.login, role: user.role },
  })
})

// POST /api/auth/logout
auth.post('/logout', (c) => {
  deleteCookie(c, 'token', { path: '/' })
  return c.json({ success: true })
})

// GET /api/auth/me
// Примечание: этот route монтируется ДО requireAuth middleware,
// поэтому читаем и верифицируем JWT вручную
auth.get('/me', async (c) => {
  const { getCookie } = await import('hono/cookie')
  const token = getCookie(c, 'token')
  if (!token) return c.json(null)

  try {
    const secret = new TextEncoder().encode(config.JWT_SECRET)
    const { payload } = await jose.jwtVerify(token, secret)

    const dbUser = await db.user.findUnique({
      where: { id: payload.userId as string },
      select: { id: true, name: true, login: true, role: true },
    })

    return c.json(dbUser)
  } catch {
    return c.json(null)
  }
})

export { auth }
