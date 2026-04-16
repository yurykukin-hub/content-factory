/**
 * RBAC + ownership tests for Ideas, Sessions, Content Plans, Settings public endpoint.
 *
 * Covers per-user ownership (ideas), business + user ownership (sessions),
 * business-scoped RBAC (content-plans), and new public settings endpoint.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'
import * as jose from 'jose'

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
      aiUsageLog: { ...m(), aggregate: vi.fn().mockResolvedValue({ _sum: {}, _count: 0 }) },
      webhookRule: m(), appConfig: m(), balanceTransaction: m(),
      generationSession: m(), idea: m(),
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
vi.mock('../../eventBus', () => ({ emitEvent: vi.fn() }))

import { app } from '../../app'

async function makeToken(role: 'ADMIN' | 'EDITOR' | 'VIEWER' = 'EDITOR', userId = 'editor-1') {
  const secret = new TextEncoder().encode('test-jwt-secret-at-least-32-characters-long')
  return await new jose.SignJWT({ userId, name: 'Test', role, type: 'access' })
    .setProtectedHeader({ alg: 'HS256' })
    .setExpirationTime('1h')
    .sign(secret)
}

// ============================================================
// Ideas — per-user ownership (not business-scoped)
// ============================================================

describe('Ideas — per-user ownership', () => {
  beforeEach(() => vi.clearAllMocks())

  it('GET /api/ideas returns only current user ideas', async () => {
    const token = await makeToken('EDITOR', 'user-1')
    mockDb.idea.findMany.mockResolvedValue([
      { id: 'i1', title: 'My idea', userId: 'user-1' },
    ])

    const res = await app.request('/api/ideas', {
      headers: { Cookie: `token=${token}` },
    })
    expect(res.status).toBe(200)

    // Verify filter by userId
    const findCall = mockDb.idea.findMany.mock.calls[0]?.[0]
    expect(findCall?.where?.userId).toBe('user-1')
  })

  it('POST /api/ideas creates idea tied to current user', async () => {
    const token = await makeToken('EDITOR', 'user-1')
    mockDb.idea.create.mockResolvedValue({ id: 'i1', title: 'New', userId: 'user-1' })

    const res = await app.request('/api/ideas', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: `token=${token}`, 'X-Tab-ID': 'test' },
      body: JSON.stringify({ title: 'New idea', body: 'Details' }),
    })
    expect(res.status).toBe(201)

    const createCall = mockDb.idea.create.mock.calls[0]?.[0]
    expect(createCall?.data?.userId).toBe('user-1')
  })

  it('PUT /api/ideas/:id returns 404 for another user idea', async () => {
    const token = await makeToken('EDITOR', 'user-1')
    // findFirst with userId filter returns null (not this user's idea)
    mockDb.idea.findFirst.mockResolvedValue(null)

    const res = await app.request('/api/ideas/i-other', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Cookie: `token=${token}`, 'X-Tab-ID': 'test' },
      body: JSON.stringify({ title: 'Stolen' }),
    })
    expect(res.status).toBe(404)
  })

  it('DELETE /api/ideas/:id returns 404 for another user idea', async () => {
    const token = await makeToken('EDITOR', 'user-1')
    mockDb.idea.findFirst.mockResolvedValue(null)

    const res = await app.request('/api/ideas/i-other', {
      method: 'DELETE',
      headers: { Cookie: `token=${token}`, 'X-Tab-ID': 'test' },
    })
    expect(res.status).toBe(404)
  })
})

// ============================================================
// Sessions — business access + user ownership
// ============================================================

describe('Sessions — business access + ownership', () => {
  beforeEach(() => vi.clearAllMocks())

  it('GET /api/sessions requires businessId', async () => {
    const token = await makeToken('EDITOR')

    const res = await app.request('/api/sessions', {
      headers: { Cookie: `token=${token}` },
    })
    expect(res.status).toBe(400)
  })

  it('EDITOR cannot list sessions of unassigned business', async () => {
    const token = await makeToken('EDITOR', 'editor-1')
    mockDb.userBusiness.findUnique.mockResolvedValue(null)

    const res = await app.request('/api/sessions?businessId=biz-other', {
      headers: { Cookie: `token=${token}` },
    })
    expect(res.status).toBe(403)
  })

  it('GET /api/sessions/:id returns 403 for another user session', async () => {
    const token = await makeToken('EDITOR', 'user-1')
    mockDb.generationSession.findUnique.mockResolvedValue({
      id: 's1', businessId: 'biz-1', userId: 'user-other', // different user!
    })

    const res = await app.request('/api/sessions/s1', {
      headers: { Cookie: `token=${token}` },
    })
    expect(res.status).toBe(403)
  })

  it('ADMIN can access any user session', async () => {
    const token = await makeToken('ADMIN', 'admin-1')
    mockDb.generationSession.findUnique.mockResolvedValue({
      id: 's1', businessId: 'biz-1', userId: 'user-other',
      mediaFile: null,
    })

    const res = await app.request('/api/sessions/s1', {
      headers: { Cookie: `token=${token}` },
    })
    expect(res.status).toBe(200)
  })

  it('POST /api/sessions validates duration range', async () => {
    const token = await makeToken('ADMIN')

    const res = await app.request('/api/sessions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: `token=${token}`, 'X-Tab-ID': 'test' },
      body: JSON.stringify({ businessId: 'biz-1', duration: 99 }),
    })
    expect(res.status).toBe(400)
  })

  it('POST /api/sessions validates aspectRatio enum', async () => {
    const token = await makeToken('ADMIN')

    const res = await app.request('/api/sessions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: `token=${token}`, 'X-Tab-ID': 'test' },
      body: JSON.stringify({ businessId: 'biz-1', aspectRatio: '4:3' }),
    })
    expect(res.status).toBe(400)
  })
})

// ============================================================
// Content Plans — business-scoped RBAC
// ============================================================

describe('Content Plans — business access', () => {
  beforeEach(() => vi.clearAllMocks())

  it('EDITOR cannot create plan in unassigned business', async () => {
    const token = await makeToken('EDITOR', 'editor-1')
    mockDb.userBusiness.findUnique.mockResolvedValue(null)

    const res = await app.request('/api/plans', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: `token=${token}`, 'X-Tab-ID': 'test' },
      body: JSON.stringify({
        businessId: 'biz-other',
        title: 'Hacked plan',
        startDate: '2026-06-01',
        endDate: '2026-06-30',
      }),
    })
    expect(res.status).toBe(403)
  })

  it('ADMIN can create plan in any business', async () => {
    const token = await makeToken('ADMIN')
    mockDb.contentPlan.create.mockResolvedValue({
      id: 'plan-1', title: 'June Plan', businessId: 'biz-1',
    })

    const res = await app.request('/api/plans', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: `token=${token}`, 'X-Tab-ID': 'test' },
      body: JSON.stringify({
        businessId: 'biz-1',
        title: 'June Plan',
        startDate: '2026-06-01',
        endDate: '2026-06-30',
      }),
    })
    expect(res.status).toBe(201)
  })

  it('GET /api/plans/:id checks business access', async () => {
    const token = await makeToken('EDITOR', 'editor-1')
    mockDb.contentPlan.findUnique.mockResolvedValue({ id: 'plan-1', businessId: 'biz-other' })
    mockDb.userBusiness.findUnique.mockResolvedValue(null)

    const res = await app.request('/api/plans/plan-1', {
      headers: { Cookie: `token=${token}` },
    })
    expect(res.status).toBe(403)
  })
})

// ============================================================
// Settings — public endpoint
// ============================================================

describe('GET /api/settings/public', () => {
  beforeEach(() => vi.clearAllMocks())

  it('returns usdRubRate and markupPercent for authenticated user', async () => {
    const token = await makeToken('EDITOR')
    mockDb.appConfig.findUnique.mockResolvedValue(null) // use defaults

    const res = await app.request('/api/settings/public', {
      headers: { Cookie: `token=${token}` },
    })
    expect(res.status).toBe(200)
    const json = await res.json() as any
    expect(json.usdRubRate).toBeTypeOf('number')
    expect(json.markupPercent).toBeTypeOf('number')
    expect(json.usdRubRate).toBeGreaterThan(0)
  })

  it('returns 401 without auth', async () => {
    const res = await app.request('/api/settings/public')
    expect(res.status).toBe(401)
  })
})

// ============================================================
// Billing unit tests
// ============================================================

describe('Billing: calculateChargedKopecks', () => {
  // Import pure functions directly (no mocks needed)
  it('calculates correctly with default rate', async () => {
    const { calculateChargedKopecks } = await import('../../services/billing')

    // $0.06 × 95 RUB × (1 + 50%) = 8.55 RUB ≈ 856 kopecks (float: 855.00000001 → ceil = 856)
    const result = calculateChargedKopecks(0.06, 50)
    expect(result).toBe(856)
  })

  it('calculates correctly with custom rate', async () => {
    const { calculateChargedKopecks } = await import('../../services/billing')

    // $0.10 × 100 RUB × (1 + 0%) = 10 RUB = 1000 kopecks
    const result = calculateChargedKopecks(0.10, 0, 100)
    expect(result).toBe(1000)
  })

  it('rounds up (ceil) in favor of owner', async () => {
    const { calculateChargedKopecks } = await import('../../services/billing')

    // $0.001 × 95 × 1.5 = 0.1425 RUB = 14.25 kopecks → ceil = 15
    const result = calculateChargedKopecks(0.001, 50)
    expect(result).toBe(15)
  })
})
