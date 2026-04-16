import { describe, it, expect, beforeEach, vi } from 'vitest'

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
      user: m(),
      userBusiness: m(),
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
      $queryRaw: vi.fn().mockResolvedValue([]),
      $executeRaw: vi.fn().mockResolvedValue(0),
      $transaction: vi.fn(async (fn: any) => fn(mockDb)),
    },
  }
})

vi.mock('../../db', () => ({ db: mockDb }))
vi.mock('../../services/scheduler', () => ({ startPublishScheduler: vi.fn() }))
vi.mock('../../services/ai/openrouter', () => ({ aiRequest: vi.fn() }))

import { app } from '../../app'
import * as jose from 'jose'

// Helper: create a valid JWT token for tests
async function makeToken(role: 'ADMIN' | 'EDITOR' | 'VIEWER' = 'ADMIN', userId = 'admin-1') {
  const secret = new TextEncoder().encode('test-jwt-secret-at-least-32-characters-long')
  return await new jose.SignJWT({ userId, name: 'Test', role })
    .setProtectedHeader({ alg: 'HS256' })
    .setExpirationTime('1h')
    .sign(secret)
}

// ============================================================
// Tests
// ============================================================

describe('GET /api/users', () => {
  beforeEach(() => vi.clearAllMocks())

  it('returns 401 without auth', async () => {
    const res = await app.request('/api/users')
    expect(res.status).toBe(401)
  })

  it('returns 403 for EDITOR role', async () => {
    const token = await makeToken('EDITOR')
    const res = await app.request('/api/users', {
      headers: { Cookie: `token=${token}` },
    })
    expect(res.status).toBe(403)
  })

  it('returns users list for ADMIN', async () => {
    const token = await makeToken('ADMIN')
    mockDb.user.findMany.mockResolvedValue([
      { id: '1', login: 'admin', name: 'Admin', role: 'ADMIN', isActive: true, businesses: [] },
    ])

    const res = await app.request('/api/users', {
      headers: { Cookie: `token=${token}` },
    })
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json).toHaveLength(1)
    expect(json[0].login).toBe('admin')
  })
})

describe('POST /api/users', () => {
  beforeEach(() => vi.clearAllMocks())

  it('creates user with ADMIN token', async () => {
    const token = await makeToken('ADMIN')
    mockDb.user.findUnique.mockResolvedValue(null) // login not taken
    mockDb.user.create.mockResolvedValue({
      id: 'new-1', login: 'sveta', name: 'Света', role: 'EDITOR', isActive: true, businesses: [],
    })

    const res = await app.request('/api/users', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: `token=${token}`, 'X-Tab-ID': 'test' },
      body: JSON.stringify({ login: 'sveta', password: 'pass123', name: 'Света', role: 'EDITOR' }),
    })
    expect(res.status).toBe(201)
  })

  it('returns 409 for duplicate login', async () => {
    const token = await makeToken('ADMIN')
    mockDb.user.findUnique.mockResolvedValue({ id: 'existing', login: 'sveta' })

    const res = await app.request('/api/users', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: `token=${token}`, 'X-Tab-ID': 'test' },
      body: JSON.stringify({ login: 'sveta', password: 'pass123', name: 'Света' }),
    })
    expect(res.status).toBe(409)
  })
})

describe('GET /api/businesses (RBAC filtering)', () => {
  beforeEach(() => vi.clearAllMocks())

  it('ADMIN sees all businesses', async () => {
    const token = await makeToken('ADMIN')
    mockDb.business.findMany.mockResolvedValue([
      { id: 'b1', name: 'Biz 1' },
      { id: 'b2', name: 'Biz 2' },
    ])

    const res = await app.request('/api/businesses', {
      headers: { Cookie: `token=${token}` },
    })
    expect(res.status).toBe(200)

    // ADMIN: getUserBusinessIds returns null, no { id: { in: ... } } filter
    const findManyArgs = mockDb.business.findMany.mock.calls[0][0]
    expect(findManyArgs.where.id).toBeUndefined()
  })

  it('EDITOR sees only accessible businesses', async () => {
    const token = await makeToken('EDITOR', 'editor-1')
    mockDb.userBusiness.findMany.mockResolvedValue([
      { businessId: 'b1' },
    ])
    mockDb.business.findMany.mockResolvedValue([
      { id: 'b1', name: 'Allowed Biz' },
    ])

    const res = await app.request('/api/businesses', {
      headers: { Cookie: `token=${token}` },
    })
    expect(res.status).toBe(200)

    // EDITOR: getUserBusinessIds returns ['b1'], filter applied
    const findManyArgs = mockDb.business.findMany.mock.calls[0][0]
    expect(findManyArgs.where.id).toEqual({ in: ['b1'] })
  })
})
