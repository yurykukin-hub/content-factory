import { describe, it, expect, beforeEach, vi } from 'vitest'

// ============================================================
// Mock setup (must be before app import)
// ============================================================

const { mockDb } = vi.hoisted(() => {
  const m = () => ({
    findMany: vi.fn().mockResolvedValue([]),
    findFirst: vi.fn().mockResolvedValue(null),
    findUnique: vi.fn().mockResolvedValue(null),
    create: vi.fn().mockResolvedValue({ id: 'mock-id' }),
    update: vi.fn().mockResolvedValue({ id: 'mock-id' }),
    delete: vi.fn().mockResolvedValue({ id: 'mock-id' }),
    count: vi.fn().mockResolvedValue(0),
    upsert: vi.fn().mockResolvedValue({ id: 'mock-id' }),
  })
  return {
    mockDb: {
      user: m(),
      business: m(),
      brandProfile: m(),
      platformAccount: m(),
      contentPlan: m(),
      contentPlanItem: m(),
      post: m(),
      postVersion: m(),
      publishLog: m(),
      mediaFile: m(),
      aiUsageLog: m(),
      webhookRule: m(),
      appConfig: m(),
      $queryRaw: vi.fn().mockResolvedValue([{ '?column?': 1 }]),
      $executeRaw: vi.fn().mockResolvedValue(0),
      $transaction: vi.fn(async (fn: any) => fn(mockDb)),
    },
  }
})

vi.mock('../../db', () => ({ db: mockDb }))

// Mock scheduler to prevent it from running
vi.mock('../../services/scheduler', () => ({
  startPublishScheduler: vi.fn(),
}))

// Mock OpenRouter (uses db at top level for API key)
vi.mock('../../services/ai/openrouter', () => ({
  aiRequest: vi.fn(),
}))

import { app } from '../../app'

// ============================================================
// Tests
// ============================================================

describe('POST /api/auth/login', () => {
  beforeEach(() => vi.clearAllMocks())

  it('returns 401 for non-existent user', async () => {
    mockDb.user.findUnique.mockResolvedValue(null)

    const res = await app.request('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ login: 'nobody', password: 'test' }),
    })

    expect(res.status).toBe(401)
    const json = await res.json()
    expect(json.error).toContain('Неверный')
  })

  it('returns 401 for inactive user', async () => {
    mockDb.user.findUnique.mockResolvedValue({
      id: '1', login: 'test', name: 'Test', role: 'EDITOR',
      passwordHash: 'hash', isActive: false,
    })

    const res = await app.request('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ login: 'test', password: 'test' }),
    })

    expect(res.status).toBe(401)
  })

  it('returns 401 for wrong password', async () => {
    const hash = await Bun.password.hash('correct-password')
    mockDb.user.findUnique.mockResolvedValue({
      id: '1', login: 'test', name: 'Test', role: 'EDITOR',
      passwordHash: hash, isActive: true,
    })

    const res = await app.request('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ login: 'test', password: 'wrong' }),
    })

    expect(res.status).toBe(401)
  })

  it('returns 200 and sets cookie for valid login', async () => {
    const hash = await Bun.password.hash('pass123')
    mockDb.user.findUnique.mockResolvedValue({
      id: 'u1', login: 'yury', name: 'Yury', role: 'ADMIN',
      passwordHash: hash, isActive: true,
    })

    const res = await app.request('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ login: 'yury', password: 'pass123' }),
    })

    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.success).toBe(true)
    expect(json.user).toMatchObject({
      id: 'u1',
      name: 'Yury',
      login: 'yury',
      role: 'ADMIN',
    })

    // Check Set-Cookie header
    const setCookie = res.headers.get('set-cookie')
    expect(setCookie).toContain('token=')
    expect(setCookie).toContain('HttpOnly')
  })
})

describe('POST /api/auth/logout', () => {
  it('returns success and clears cookie', async () => {
    const res = await app.request('/api/auth/logout', {
      method: 'POST',
    })

    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.success).toBe(true)
  })
})

describe('GET /api/auth/me', () => {
  beforeEach(() => vi.clearAllMocks())

  it('returns null without token', async () => {
    const res = await app.request('/api/auth/me')
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json).toBeNull()
  })

  it('returns user data with valid token', async () => {
    // First login to get a token
    const hash = await Bun.password.hash('pass123')
    mockDb.user.findUnique.mockResolvedValue({
      id: 'u1', login: 'yury', name: 'Yury', role: 'ADMIN',
      passwordHash: hash, isActive: true,
    })

    const loginRes = await app.request('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ login: 'yury', password: 'pass123' }),
    })

    const setCookie = loginRes.headers.get('set-cookie') || ''
    const tokenMatch = setCookie.match(/token=([^;]+)/)
    expect(tokenMatch).not.toBeNull()

    // Now call /me with that token
    mockDb.user.findUnique.mockResolvedValue({
      id: 'u1', name: 'Yury', login: 'yury', role: 'ADMIN',
    })

    const meRes = await app.request('/api/auth/me', {
      headers: { Cookie: `token=${tokenMatch![1]}` },
    })

    expect(meRes.status).toBe(200)
    const json = await meRes.json()
    expect(json).toMatchObject({
      id: 'u1',
      name: 'Yury',
      role: 'ADMIN',
    })
  })
})

describe('GET /api/health', () => {
  it('returns ok for liveness check', async () => {
    const res = await app.request('/api/health')
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.status).toBe('ok')
    expect(json).toHaveProperty('timestamp')
  })

  it('returns db status for readiness check', async () => {
    mockDb.$queryRaw.mockResolvedValue([{ '?column?': 1 }])

    const res = await app.request('/api/health?full=true')
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.status).toBe('ok')
    expect(json.db).toBe('connected')
    expect(json).toHaveProperty('uptime')
  })

  it('returns 503 when DB is down', async () => {
    mockDb.$queryRaw.mockRejectedValue(new Error('Connection refused'))

    const res = await app.request('/api/health?full=true')
    expect(res.status).toBe(503)
    const json = await res.json()
    expect(json.status).toBe('degraded')
    expect(json.db).toBe('disconnected')
  })
})
