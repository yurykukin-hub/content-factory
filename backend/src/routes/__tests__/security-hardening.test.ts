/**
 * Regression tests for security hardening (code review fixes).
 *
 * Tests cover:
 * 1. Path traversal on /uploads/*
 * 2. Zod validation on PUT endpoints
 * 3. Business access check on GET /api/businesses/:id
 * 4. Login rate limiting
 * 5. CSRF header requirement
 * 6. Brand-profile access check
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'
import * as jose from 'jose'

// ============================================================
// Mock setup (same pattern as security.test.ts)
// ============================================================

const { mockDb } = vi.hoisted(() => {
  const m = () => ({
    findMany: vi.fn().mockResolvedValue([]),
    findFirst: vi.fn().mockResolvedValue(null),
    findUnique: vi.fn().mockResolvedValue(null),
    create: vi.fn().mockResolvedValue({ id: 'mock-id' }),
    update: vi.fn().mockResolvedValue({ id: 'mock-id' }),
    updateMany: vi.fn().mockResolvedValue({ count: 1 }),
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
      post: m(), postVersion: m(), publishLog: m(), mediaFile: m(), mediaFolder: m(),
      aiUsageLog: { ...m(), aggregate: vi.fn().mockResolvedValue({ _sum: { tokensIn: 0, tokensOut: 0, costUsd: 0 }, _count: 0 }) },
      webhookRule: m(), appConfig: m(), balanceTransaction: m(),
      generationSession: m(),
      $queryRaw: vi.fn().mockResolvedValue([]),
      $executeRaw: vi.fn().mockResolvedValue(0),
      $transaction: vi.fn(async (fn: any) => fn(mockDb)),
    },
  }
})

vi.mock('../../db', () => ({ db: mockDb }))
vi.mock('../../services/scheduler', () => ({ startPublishScheduler: vi.fn() }))
vi.mock('../../services/video-poller', () => ({ startVideoPoller: vi.fn() }))
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
// 1. Path Traversal Protection
// ============================================================

describe('Path traversal on /uploads/*', () => {
  it('Hono normalizes bare ../ before routing (safe: route does not match)', async () => {
    // /uploads/../../x is normalized to /x by Hono → doesn't match /uploads/* → 404
    const res = await app.request('/uploads/../../backend/.env')
    expect([403, 404]).toContain(res.status) // either is safe
  })

  it('blocks traversal via nested path like /uploads/sub/../../etc', async () => {
    // /uploads/sub/../../etc normalizes to /etc → doesn't match /uploads/* → 404
    const res = await app.request('/uploads/sub/../../etc/passwd')
    expect([403, 404]).toContain(res.status) // either is safe
  })

  it('returns 404 for non-existent file (no traversal)', async () => {
    const res = await app.request('/uploads/nonexistent.jpg')
    expect(res.status).toBe(404)
  })

  it('returns 404 for valid path that does not exist', async () => {
    const res = await app.request('/uploads/business-1/photo.jpg')
    expect(res.status).toBe(404)
  })
})

// ============================================================
// 2. Zod validation on PUT endpoints
// ============================================================

describe('PUT /api/platforms/:id — Zod validation', () => {
  beforeEach(() => vi.clearAllMocks())

  it('rejects unknown fields (e.g. isActive, businessId)', async () => {
    const token = await makeToken('ADMIN')

    const res = await app.request('/api/platforms/p1', {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        Cookie: `token=${token}`,
        'X-Tab-ID': 'test',
      },
      body: JSON.stringify({ isActive: false, businessId: 'hacked' }),
    })

    // Zod strips unknown keys, so the valid-but-empty update goes through
    // Important: isActive and businessId should NOT reach the DB
    if (res.status === 200) {
      // Check that update was called WITHOUT isActive/businessId
      const updateCall = mockDb.platformAccount.update.mock.calls[0]?.[0]
      expect(updateCall?.data).not.toHaveProperty('isActive')
      expect(updateCall?.data).not.toHaveProperty('businessId')
    }
  })

  it('accepts valid fields only', async () => {
    const token = await makeToken('ADMIN')
    mockDb.platformAccount.update.mockResolvedValue({
      id: 'p1', accountName: 'Updated', platform: 'VK',
    })

    const res = await app.request('/api/platforms/p1', {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        Cookie: `token=${token}`,
        'X-Tab-ID': 'test',
      },
      body: JSON.stringify({ accountName: 'Updated Name' }),
    })
    expect(res.status).toBe(200)
  })
})

// ============================================================
// 3. Business access check on GET /api/businesses/:id
// ============================================================

describe('GET /api/businesses/:id — access check', () => {
  beforeEach(() => vi.clearAllMocks())

  it('EDITOR cannot access business they are not assigned to', async () => {
    const token = await makeToken('EDITOR', 'editor-1')
    // EDITOR has access only to 'biz-mine'
    mockDb.userBusiness.findMany.mockResolvedValue([{ businessId: 'biz-mine' }])
    mockDb.business.findUnique.mockResolvedValue({ id: 'biz-other', name: 'Other' })

    const res = await app.request('/api/businesses/biz-other', {
      headers: { Cookie: `token=${token}` },
    })
    expect(res.status).toBe(403)
  })

  it('EDITOR can access their assigned business', async () => {
    const token = await makeToken('EDITOR', 'editor-1')
    mockDb.userBusiness.findMany.mockResolvedValue([{ businessId: 'biz-mine' }])
    mockDb.business.findUnique.mockResolvedValue({
      id: 'biz-mine', name: 'My Biz', isActive: true,
      brandProfile: null, platformAccounts: [], _count: { posts: 0, contentPlans: 0 },
    })

    const res = await app.request('/api/businesses/biz-mine', {
      headers: { Cookie: `token=${token}` },
    })
    expect(res.status).toBe(200)
  })

  it('ADMIN can access any business', async () => {
    const token = await makeToken('ADMIN')
    mockDb.business.findUnique.mockResolvedValue({
      id: 'any-biz', name: 'Any', isActive: true,
      brandProfile: null, platformAccounts: [], _count: { posts: 0, contentPlans: 0 },
    })

    const res = await app.request('/api/businesses/any-biz', {
      headers: { Cookie: `token=${token}` },
    })
    expect(res.status).toBe(200)
  })
})

// ============================================================
// 4. Brand-profile access check
// ============================================================

describe('PUT /api/businesses/:id/brand-profile — access check', () => {
  beforeEach(() => vi.clearAllMocks())

  it('EDITOR cannot update brand-profile of another business', async () => {
    const token = await makeToken('EDITOR', 'editor-1')
    mockDb.userBusiness.findMany.mockResolvedValue([{ businessId: 'biz-mine' }])

    const res = await app.request('/api/businesses/biz-other/brand-profile', {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        Cookie: `token=${token}`,
        'X-Tab-ID': 'test',
      },
      body: JSON.stringify({ tone: 'hacked' }),
    })
    expect(res.status).toBe(403)
  })

  it('EDITOR can update their own business brand-profile', async () => {
    const token = await makeToken('EDITOR', 'editor-1')
    mockDb.userBusiness.findMany.mockResolvedValue([{ businessId: 'biz-mine' }])
    mockDb.brandProfile.upsert.mockResolvedValue({ id: 'bp-1', tone: 'friendly' })

    const res = await app.request('/api/businesses/biz-mine/brand-profile', {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        Cookie: `token=${token}`,
        'X-Tab-ID': 'test',
      },
      body: JSON.stringify({ tone: 'friendly' }),
    })
    expect(res.status).toBe(200)
  })

  it('rejects invalid fields in brand-profile (e.g. businessId)', async () => {
    const token = await makeToken('ADMIN')
    mockDb.brandProfile.upsert.mockResolvedValue({ id: 'bp-1' })

    const res = await app.request('/api/businesses/biz-1/brand-profile', {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        Cookie: `token=${token}`,
        'X-Tab-ID': 'test',
      },
      body: JSON.stringify({ businessId: 'hacked', id: 'hacked', tone: 'ok' }),
    })

    if (res.status === 200) {
      const upsertCall = mockDb.brandProfile.upsert.mock.calls[0]?.[0]
      expect(upsertCall?.update).not.toHaveProperty('businessId')
      expect(upsertCall?.update).not.toHaveProperty('id')
    }
  })
})

// ============================================================
// 5. Login rate limiting
// ============================================================

describe('Login rate limiting', () => {
  beforeEach(() => vi.clearAllMocks())

  it('returns 429 after too many failed attempts', async () => {
    // First 5 attempts should work (even if they fail auth)
    mockDb.user.findUnique.mockResolvedValue(null)

    for (let i = 0; i < 5; i++) {
      const res = await app.request('/api/auth/login', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Real-IP': '192.168.1.100',
        },
        body: JSON.stringify({ login: 'attacker', password: 'wrong' }),
      })
      expect(res.status).toBe(401) // auth failed, but not rate limited
    }

    // 6th attempt should be rate limited
    const res = await app.request('/api/auth/login', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Real-IP': '192.168.1.100',
      },
      body: JSON.stringify({ login: 'attacker', password: 'wrong' }),
    })
    expect(res.status).toBe(429)
  })

  it('different IPs have separate rate limits', async () => {
    mockDb.user.findUnique.mockResolvedValue(null)

    // Exhaust limit for IP-A
    for (let i = 0; i < 5; i++) {
      await app.request('/api/auth/login', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Real-IP': '10.0.0.1',
        },
        body: JSON.stringify({ login: 'a', password: 'b' }),
      })
    }

    // IP-B should still work
    const res = await app.request('/api/auth/login', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Real-IP': '10.0.0.2',
      },
      body: JSON.stringify({ login: 'a', password: 'b' }),
    })
    expect(res.status).toBe(401) // not 429
  })
})

// ============================================================
// 6. CSRF header requirement
// ============================================================

describe('CSRF: X-Tab-ID header required on mutating requests', () => {
  beforeEach(() => vi.clearAllMocks())

  it('POST without X-Tab-ID returns 403', async () => {
    const token = await makeToken('ADMIN')

    const res = await app.request('/api/users', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: `token=${token}`,
        // No X-Tab-ID!
      },
      body: JSON.stringify({ login: 'test', password: 'test', name: 'Test' }),
    })
    expect(res.status).toBe(403)
  })

  it('POST with X-Tab-ID passes through CSRF check', async () => {
    const token = await makeToken('ADMIN')
    mockDb.user.findUnique.mockResolvedValue(null) // login not taken
    mockDb.user.create.mockResolvedValue({ id: 'new-1', login: 'test', name: 'Test', role: 'EDITOR', isActive: true })

    const res = await app.request('/api/users', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: `token=${token}`,
        'X-Tab-ID': 'test-tab',
      },
      body: JSON.stringify({ login: 'test', password: 'test123', name: 'Test', role: 'EDITOR' }),
    })
    expect(res.status).toBe(201)
  })

  it('Auth routes exempt from CSRF (login works without X-Tab-ID)', async () => {
    mockDb.user.findUnique.mockResolvedValue(null)

    const res = await app.request('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ login: 'test', password: 'test' }),
    })
    // 401 = auth failed, NOT 403 (CSRF), meaning CSRF middleware was skipped
    expect(res.status).toBe(401)
  })

  it('GET requests do not require X-Tab-ID', async () => {
    const token = await makeToken('ADMIN')
    mockDb.appConfig.findMany.mockResolvedValue([])

    const res = await app.request('/api/settings/config', {
      headers: { Cookie: `token=${token}` },
    })
    expect(res.status).toBe(200)
  })
})

// ============================================================
// 7. BOLA on businesses mutations (PUT / POST / DELETE)
// ============================================================

describe('BOLA: businesses mutations', () => {
  beforeEach(() => vi.clearAllMocks())

  it('EDITOR cannot PUT a business they have no access to', async () => {
    const token = await makeToken('EDITOR', 'editor-1')
    mockDb.userBusiness.findMany.mockResolvedValue([{ businessId: 'biz-mine' }])

    const res = await app.request('/api/businesses/biz-other', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Cookie: `token=${token}`, 'X-Tab-ID': 't' },
      body: JSON.stringify({ name: 'hacked' }),
    })
    expect(res.status).toBe(403)
    expect(mockDb.business.update).not.toHaveBeenCalled()
  })

  it('EDITOR can PUT their own business', async () => {
    const token = await makeToken('EDITOR', 'editor-1')
    mockDb.userBusiness.findMany.mockResolvedValue([{ businessId: 'biz-mine' }])
    mockDb.business.update.mockResolvedValue({ id: 'biz-mine', name: 'Renamed', brandProfile: null })

    const res = await app.request('/api/businesses/biz-mine', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Cookie: `token=${token}`, 'X-Tab-ID': 't' },
      body: JSON.stringify({ name: 'Renamed' }),
    })
    expect(res.status).toBe(200)
  })

  it('non-ADMIN cannot create a business (POST)', async () => {
    const token = await makeToken('EDITOR', 'editor-1')

    const res = await app.request('/api/businesses', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: `token=${token}`, 'X-Tab-ID': 't' },
      body: JSON.stringify({ slug: 'new-biz', name: 'New' }),
    })
    expect(res.status).toBe(403)
    expect(mockDb.business.create).not.toHaveBeenCalled()
  })

  it('non-ADMIN cannot delete a business', async () => {
    const token = await makeToken('EDITOR', 'editor-1')

    const res = await app.request('/api/businesses/biz-x', {
      method: 'DELETE',
      headers: { Cookie: `token=${token}`, 'X-Tab-ID': 't' },
    })
    expect(res.status).toBe(403)
    expect(mockDb.business.update).not.toHaveBeenCalled()
  })

  it('ADMIN can delete a business', async () => {
    const token = await makeToken('ADMIN')
    mockDb.business.update.mockResolvedValue({ id: 'biz-x', isActive: false })

    const res = await app.request('/api/businesses/biz-x', {
      method: 'DELETE',
      headers: { Cookie: `token=${token}`, 'X-Tab-ID': 't' },
    })
    expect(res.status).toBe(200)
  })
})

// ============================================================
// 8. BOLA on platforms (business-scoped + by-id)
// ============================================================

describe('BOLA: platforms', () => {
  beforeEach(() => vi.clearAllMocks())

  it('EDITOR cannot list platforms of a business they have no access to', async () => {
    const token = await makeToken('EDITOR', 'editor-1')
    mockDb.userBusiness.findUnique.mockResolvedValue(null) // no UserBusiness record

    const res = await app.request('/api/businesses/biz-other/platforms', {
      headers: { Cookie: `token=${token}` },
    })
    expect(res.status).toBe(403)
  })

  it('EDITOR with access lists platforms WITHOUT accessToken (hasToken only)', async () => {
    const token = await makeToken('EDITOR', 'editor-1')
    mockDb.userBusiness.findUnique.mockResolvedValue({ userId: 'editor-1', businessId: 'biz-mine' })
    mockDb.platformAccount.findMany.mockResolvedValue([
      { id: 'p1', platform: 'VK', accountType: 'GROUP', accountName: 'G', accountId: '1', accessToken: 'SECRET', isActive: true },
    ])

    const res = await app.request('/api/businesses/biz-mine/platforms', {
      headers: { Cookie: `token=${token}` },
    })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body[0]).not.toHaveProperty('accessToken')
    expect(body[0].hasToken).toBe(true)
  })

  it('EDITOR cannot update a platform belonging to another business', async () => {
    const token = await makeToken('EDITOR', 'editor-1')
    mockDb.platformAccount.findUnique.mockResolvedValue({ businessId: 'biz-other' })
    mockDb.userBusiness.findMany.mockResolvedValue([{ businessId: 'biz-mine' }])

    const res = await app.request('/api/platforms/p1', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Cookie: `token=${token}`, 'X-Tab-ID': 't' },
      body: JSON.stringify({ accountName: 'hacked' }),
    })
    expect(res.status).toBe(403)
    expect(mockDb.platformAccount.update).not.toHaveBeenCalled()
  })

  it('ADMIN can update any platform (bypass)', async () => {
    const token = await makeToken('ADMIN')
    mockDb.platformAccount.update.mockResolvedValue({ id: 'p1', accountName: 'OK', platform: 'VK' })

    const res = await app.request('/api/platforms/p1', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Cookie: `token=${token}`, 'X-Tab-ID': 't' },
      body: JSON.stringify({ accountName: 'OK' }),
    })
    expect(res.status).toBe(200)
  })

  it('POST /:bizId/platforms does NOT echo accessToken in response', async () => {
    const token = await makeToken('ADMIN')
    mockDb.platformAccount.create.mockResolvedValue({
      id: 'p9', businessId: 'biz-1', platform: 'VK', accountType: 'GROUP',
      accountName: 'G', accountId: '1', accessToken: 'SECRET', isActive: true,
    })
    const res = await app.request('/api/businesses/biz-1/platforms', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: `token=${token}`, 'X-Tab-ID': 't' },
      body: JSON.stringify({ platform: 'VK', accountType: 'GROUP', accountName: 'G', accountId: '1', accessToken: 'SECRET' }),
    })
    expect(res.status).toBe(201)
    const body = await res.json()
    expect(body).not.toHaveProperty('accessToken')
    expect(body.hasToken).toBe(true)
  })

  it('PUT /platforms/:id does NOT echo accessToken in response', async () => {
    const token = await makeToken('ADMIN')
    mockDb.platformAccount.update.mockResolvedValue({
      id: 'p1', platform: 'VK', accountName: 'OK', accountId: '1', accessToken: 'SECRET', isActive: true,
    })
    const res = await app.request('/api/platforms/p1', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Cookie: `token=${token}`, 'X-Tab-ID': 't' },
      body: JSON.stringify({ accountName: 'OK' }),
    })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body).not.toHaveProperty('accessToken')
    expect(body.hasToken).toBe(true)
  })
})

// ============================================================
// 9. Token leak: accessToken never returned to client
// ============================================================

describe('Token leak: accessToken stripped from business responses', () => {
  beforeEach(() => vi.clearAllMocks())

  it('GET /api/businesses/:id does not leak platform accessToken', async () => {
    const token = await makeToken('ADMIN')
    mockDb.business.findUnique.mockResolvedValue({
      id: 'biz-1', name: 'Biz', isActive: true, brandProfile: null,
      platformAccounts: [{ id: 'p1', platform: 'VK', accountName: 'G', accountId: '1', accessToken: 'LIVE-VK-TOKEN', isActive: true }],
      _count: { posts: 0, contentPlans: 0 },
    })

    const res = await app.request('/api/businesses/biz-1', {
      headers: { Cookie: `token=${token}` },
    })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.platformAccounts[0]).not.toHaveProperty('accessToken')
    expect(body.platformAccounts[0].hasToken).toBe(true)
  })
})

// ============================================================
// 10. Refresh token cannot be used as access token
// ============================================================

describe('Refresh token rejected on protected routes', () => {
  beforeEach(() => vi.clearAllMocks())

  it('a refresh token (type:refresh) in the token cookie is rejected with 401', async () => {
    const secret = new TextEncoder().encode('test-jwt-secret-at-least-32-characters-long')
    const refreshToken = await new jose.SignJWT({ userId: 'editor-1', type: 'refresh' })
      .setProtectedHeader({ alg: 'HS256' })
      .setExpirationTime('30d')
      .sign(secret)

    const res = await app.request('/api/businesses', {
      headers: { Cookie: `token=${refreshToken}` },
    })
    expect(res.status).toBe(401)
  })

  it('a valid access token still works on the same route', async () => {
    const token = await makeToken('ADMIN')
    mockDb.business.findMany.mockResolvedValue([])

    const res = await app.request('/api/businesses', {
      headers: { Cookie: `token=${token}` },
    })
    expect(res.status).toBe(200)
  })
})
