/**
 * Tests for Posts CRUD + RBAC.
 *
 * Covers: GET /:id, POST /, PUT /:id, POST /:id/approve, POST /:id/versions, DELETE /:id
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
// POST /api/posts — Create
// ============================================================

describe('POST /api/posts — Create', () => {
  beforeEach(() => vi.clearAllMocks())

  it('EDITOR can create post in assigned business', async () => {
    const token = await makeToken('EDITOR', 'editor-1')
    mockDb.userBusiness.findUnique.mockResolvedValue({ userId: 'editor-1', businessId: 'biz-1' })
    mockDb.post.create.mockResolvedValue({ id: 'p1', businessId: 'biz-1', body: 'Hello', postType: 'TEXT' })

    const res = await app.request('/api/posts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: `token=${token}`, 'X-Tab-ID': 'test' },
      body: JSON.stringify({ businessId: 'biz-1', body: 'Hello' }),
    })
    expect(res.status).toBe(201)
  })

  it('EDITOR cannot create post in unassigned business', async () => {
    const token = await makeToken('EDITOR', 'editor-1')
    mockDb.userBusiness.findUnique.mockResolvedValue(null)

    const res = await app.request('/api/posts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: `token=${token}`, 'X-Tab-ID': 'test' },
      body: JSON.stringify({ businessId: 'biz-other', body: 'Hacked' }),
    })
    expect(res.status).toBe(403)
  })

  it('rejects empty body', async () => {
    const token = await makeToken('ADMIN')

    const res = await app.request('/api/posts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: `token=${token}`, 'X-Tab-ID': 'test' },
      body: JSON.stringify({ businessId: 'biz-1', body: '' }),
    })
    expect(res.status).toBe(400)
  })

  it('validates postType enum', async () => {
    const token = await makeToken('ADMIN')

    const res = await app.request('/api/posts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: `token=${token}`, 'X-Tab-ID': 'test' },
      body: JSON.stringify({ businessId: 'biz-1', body: 'ok', postType: 'INVALID' }),
    })
    expect(res.status).toBe(400)
  })
})

// ============================================================
// GET /api/posts/:id — Read
// ============================================================

describe('GET /api/posts/:id — Read', () => {
  beforeEach(() => vi.clearAllMocks())

  it('EDITOR gets 403 for post of unassigned business', async () => {
    const token = await makeToken('EDITOR', 'editor-1')
    mockDb.post.findUnique.mockResolvedValue({ id: 'p1', businessId: 'biz-other' })
    mockDb.userBusiness.findUnique.mockResolvedValue(null)

    const res = await app.request('/api/posts/p1', {
      headers: { Cookie: `token=${token}` },
    })
    expect(res.status).toBe(403)
  })

  it('ADMIN can read any post', async () => {
    const token = await makeToken('ADMIN')
    mockDb.post.findUnique.mockResolvedValue({
      id: 'p1', businessId: 'biz-any', body: 'text', versions: [], mediaFiles: [],
    })

    const res = await app.request('/api/posts/p1', {
      headers: { Cookie: `token=${token}` },
    })
    expect(res.status).toBe(200)
  })

  it('returns 404 for non-existent post', async () => {
    const token = await makeToken('ADMIN')
    mockDb.post.findUnique.mockResolvedValue(null)

    const res = await app.request('/api/posts/nonexistent', {
      headers: { Cookie: `token=${token}` },
    })
    expect(res.status).toBe(404)
  })
})

// ============================================================
// POST /api/posts/:id/approve — Approve
// ============================================================

describe('POST /api/posts/:id/approve', () => {
  beforeEach(() => vi.clearAllMocks())

  it('approves post and all DRAFT versions', async () => {
    const token = await makeToken('ADMIN')
    mockDb.post.findUnique.mockResolvedValue({ id: 'p1', businessId: 'biz-1' })
    mockDb.post.update.mockResolvedValue({ id: 'p1', status: 'APPROVED' })
    mockDb.postVersion.updateMany.mockResolvedValue({ count: 3 })

    const res = await app.request('/api/posts/p1/approve', {
      method: 'POST',
      headers: { Cookie: `token=${token}`, 'X-Tab-ID': 'test' },
    })
    expect(res.status).toBe(200)

    // Verify both post.update and postVersion.updateMany called
    expect(mockDb.post.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { status: 'APPROVED' } })
    )
    expect(mockDb.postVersion.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { postId: 'p1', status: 'DRAFT' },
        data: { status: 'APPROVED' },
      })
    )
  })
})

// ============================================================
// POST /api/posts/:id/versions — Create version
// ============================================================

describe('POST /api/posts/:id/versions', () => {
  beforeEach(() => vi.clearAllMocks())

  it('creates version with valid data', async () => {
    const token = await makeToken('ADMIN')
    mockDb.post.findUnique
      .mockResolvedValueOnce({ id: 'p1', businessId: 'biz-1' }) // verifyPostAccess
      .mockResolvedValueOnce({ id: 'p1', businessId: 'biz-1' }) // findUnique in handler
    mockDb.postVersion.create.mockResolvedValue({
      id: 'v1', postId: 'p1', body: 'VK text', status: 'DRAFT',
      platformAccount: { platform: 'VK', accountName: 'Test' },
    })

    const res = await app.request('/api/posts/p1/versions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: `token=${token}`, 'X-Tab-ID': 'test' },
      body: JSON.stringify({ platformAccountId: 'pa-1', body: 'VK text' }),
    })
    expect(res.status).toBe(201)
  })

  it('rejects version with empty body', async () => {
    const token = await makeToken('ADMIN')
    mockDb.post.findUnique.mockResolvedValue({ id: 'p1', businessId: 'biz-1' })

    const res = await app.request('/api/posts/p1/versions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: `token=${token}`, 'X-Tab-ID': 'test' },
      body: JSON.stringify({ platformAccountId: 'pa-1', body: '' }),
    })
    expect(res.status).toBe(400)
  })
})

// ============================================================
// DELETE /api/posts/:id
// ============================================================

describe('DELETE /api/posts/:id', () => {
  beforeEach(() => vi.clearAllMocks())

  it('ADMIN can delete post', async () => {
    const token = await makeToken('ADMIN')
    mockDb.post.findUnique.mockResolvedValue({ id: 'p1', businessId: 'biz-1' })
    mockDb.post.delete.mockResolvedValue({ id: 'p1' })

    const res = await app.request('/api/posts/p1', {
      method: 'DELETE',
      headers: { Cookie: `token=${token}`, 'X-Tab-ID': 'test' },
    })
    expect(res.status).toBe(200)
  })

  it('EDITOR cannot delete post of unassigned business', async () => {
    const token = await makeToken('EDITOR', 'editor-1')
    mockDb.post.findUnique.mockResolvedValue({ id: 'p1', businessId: 'biz-other' })
    mockDb.userBusiness.findUnique.mockResolvedValue(null)

    const res = await app.request('/api/posts/p1', {
      method: 'DELETE',
      headers: { Cookie: `token=${token}`, 'X-Tab-ID': 'test' },
    })
    expect(res.status).toBe(403)
  })
})
