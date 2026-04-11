import { describe, it, expect, beforeEach, vi } from 'vitest'
import * as jose from 'jose'

// ============================================================
// Mock setup
// ============================================================

const { mockDb } = vi.hoisted(() => {
  const m = () => ({
    findMany: vi.fn().mockResolvedValue([]),
    findFirst: vi.fn().mockResolvedValue(null),
    findUnique: vi.fn().mockResolvedValue(null),
    create: vi.fn().mockResolvedValue({ id: 'mock-id' }),
    update: vi.fn().mockResolvedValue({ id: 'mock-id' }),
    delete: vi.fn().mockResolvedValue({ id: 'mock-id' }),
    deleteMany: vi.fn().mockResolvedValue({ count: 0 }),
    createMany: vi.fn().mockResolvedValue({ count: 0 }),
    count: vi.fn().mockResolvedValue(0),
    upsert: vi.fn().mockResolvedValue({ id: 'mock-id' }),
  })
  return {
    mockDb: {
      user: m(), userBusiness: m(), business: m(), brandProfile: m(),
      platformAccount: m(), contentPlan: m(), contentPlanItem: m(),
      post: m(), postVersion: m(), publishLog: m(), mediaFile: m(),
      aiUsageLog: { ...m(), aggregate: vi.fn().mockResolvedValue({ _sum: { tokensIn: 0, tokensOut: 0, costUsd: 0 }, _count: 0 }) },
      webhookRule: m(), appConfig: m(),
      $queryRaw: vi.fn().mockResolvedValue([]),
      $executeRaw: vi.fn().mockResolvedValue(0),
      $transaction: vi.fn(async (fn: any) => fn(mockDb)),
    },
  }
})

vi.mock('../../db', () => ({ db: mockDb }))
vi.mock('../../services/scheduler', () => ({ startPublishScheduler: vi.fn() }))
vi.mock('../../services/ai/openrouter', () => ({ aiComplete: vi.fn() }))

import { app } from '../../app'

async function makeToken(role: 'ADMIN' | 'EDITOR' | 'VIEWER' = 'EDITOR', userId = 'editor-1') {
  const secret = new TextEncoder().encode('test-jwt-secret-at-least-32-characters-long')
  return await new jose.SignJWT({ userId, name: 'Test', role, type: 'access' })
    .setProtectedHeader({ alg: 'HS256' })
    .setExpirationTime('1h')
    .sign(secret)
}

// ============================================================
// Security tests: EDITOR can't access other business resources
// ============================================================

describe('RBAC: Post access control', () => {
  beforeEach(() => vi.clearAllMocks())

  it('EDITOR gets 403 when accessing post of another business', async () => {
    const token = await makeToken('EDITOR', 'editor-1')

    // Post belongs to business 'biz-other'
    mockDb.post.findUnique.mockResolvedValue({ id: 'p1', businessId: 'biz-other' })
    // EDITOR has no access to 'biz-other'
    mockDb.userBusiness.findUnique.mockResolvedValue(null)

    const res = await app.request('/api/posts/p1', {
      headers: { Cookie: `token=${token}` },
    })
    expect(res.status).toBe(403)
  })

  it('EDITOR can access post of their business', async () => {
    const token = await makeToken('EDITOR', 'editor-1')

    mockDb.post.findUnique
      .mockResolvedValueOnce({ id: 'p1', businessId: 'biz-mine' }) // verifyPostAccess
      .mockResolvedValueOnce({ id: 'p1', businessId: 'biz-mine', body: 'text', versions: [], mediaFiles: [] }) // actual query
    mockDb.userBusiness.findUnique.mockResolvedValue({ userId: 'editor-1', businessId: 'biz-mine' })

    const res = await app.request('/api/posts/p1', {
      headers: { Cookie: `token=${token}` },
    })
    expect(res.status).toBe(200)
  })

  it('ADMIN can access any post', async () => {
    const token = await makeToken('ADMIN', 'admin-1')

    mockDb.post.findUnique.mockResolvedValue({
      id: 'p1', businessId: 'any-biz', body: 'text', versions: [], mediaFiles: [],
    })

    const res = await app.request('/api/posts/p1', {
      headers: { Cookie: `token=${token}` },
    })
    expect(res.status).toBe(200)
  })
})

describe('RBAC: Settings access control', () => {
  beforeEach(() => vi.clearAllMocks())

  it('EDITOR gets 403 on settings', async () => {
    const token = await makeToken('EDITOR')

    const res = await app.request('/api/settings/config', {
      headers: { Cookie: `token=${token}` },
    })
    expect(res.status).toBe(403)
  })

  it('ADMIN can access settings', async () => {
    const token = await makeToken('ADMIN', 'admin-1')
    mockDb.appConfig.findMany.mockResolvedValue([])

    const res = await app.request('/api/settings/config', {
      headers: { Cookie: `token=${token}` },
    })
    expect(res.status).toBe(200)
  })
})

describe('RBAC: Dashboard scoping', () => {
  beforeEach(() => vi.clearAllMocks())

  it('EDITOR dashboard is scoped to their businesses', async () => {
    const token = await makeToken('EDITOR', 'editor-1')
    mockDb.userBusiness.findMany.mockResolvedValue([{ businessId: 'biz-1' }])
    mockDb.business.count.mockResolvedValue(1)
    mockDb.post.count.mockResolvedValue(5)
    mockDb.postVersion.count.mockResolvedValue(2)
    mockDb.aiUsageLog.findMany.mockResolvedValue([])

    const res = await app.request('/api/dashboard', {
      headers: { Cookie: `token=${token}` },
    })
    expect(res.status).toBe(200)

    // Verify business.count was called with filter
    const countCall = mockDb.business.count.mock.calls[0]?.[0]
    expect(countCall?.where?.id).toEqual({ in: ['biz-1'] })
  })
})

describe('Refresh token', () => {
  beforeEach(() => vi.clearAllMocks())

  it('POST /api/auth/refresh returns 401 without token', async () => {
    const res = await app.request('/api/auth/refresh', { method: 'POST' })
    expect(res.status).toBe(401)
  })

  it('POST /api/auth/refresh works with valid refresh token', async () => {
    // Create a refresh token
    const secret = new TextEncoder().encode('test-jwt-secret-at-least-32-characters-long')
    const refreshToken = await new jose.SignJWT({ userId: 'u1', type: 'refresh' })
      .setProtectedHeader({ alg: 'HS256' })
      .setExpirationTime('30d')
      .sign(secret)

    mockDb.user.findUnique.mockResolvedValue({
      id: 'u1', name: 'Test', login: 'test', role: 'EDITOR', isActive: true,
    })

    const res = await app.request('/api/auth/refresh', {
      method: 'POST',
      headers: { Cookie: `refresh_token=${refreshToken}` },
    })
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.success).toBe(true)
    expect(json.user.id).toBe('u1')

    // Check new access token cookie
    const setCookies = res.headers.getSetCookie()
    expect(setCookies.some((c: string) => c.startsWith('token='))).toBe(true)
  })
})
