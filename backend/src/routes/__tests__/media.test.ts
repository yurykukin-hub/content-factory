/**
 * Tests for media rotate endpoint + library counts.
 *
 * Covers: POST /:id/rotate (angle validation, access, not-found),
 *         GET /library/:bizId (counts on first page, omitted on cursor pages).
 *
 * Note: успешный поворот (sharp + Bun.write) проверяется вручную на dev — здесь
 * покрыт контракт (валидация/доступ), который срабатывает ДО файловых операций.
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
vi.mock('../../services/ai/openrouter', () => ({ aiComplete: vi.fn(), aiVision: vi.fn() }))
vi.mock('../../eventBus', () => ({ emitEvent: vi.fn() }))

import { app } from '../../app'

async function makeToken(role: 'ADMIN' | 'EDITOR' | 'VIEWER' = 'ADMIN', userId = 'admin-1') {
  const secret = new TextEncoder().encode('test-jwt-secret-at-least-32-characters-long')
  return await new jose.SignJWT({ userId, name: 'Test', role, type: 'access' })
    .setProtectedHeader({ alg: 'HS256' })
    .setExpirationTime('1h')
    .sign(secret)
}

function rotateReq(id: string, angle: unknown, token: string) {
  return app.request(`/api/media/${id}/rotate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: `token=${token}`, 'X-Tab-ID': 'test' },
    body: JSON.stringify({ angle }),
  })
}

// ============================================================
// POST /api/media/:id/rotate
// ============================================================

describe('POST /api/media/:id/rotate', () => {
  beforeEach(() => vi.clearAllMocks())

  it('rejects invalid angle (400)', async () => {
    const token = await makeToken('ADMIN')
    mockDb.mediaFile.findUnique.mockResolvedValue({ id: 'm1', businessId: 'biz-1', mimeType: 'image/jpeg', url: '/uploads/biz-1/x.jpg', thumbUrl: null })
    const res = await rotateReq('m1', 45, token)
    expect(res.status).toBe(400)
  })

  it('rejects non-image media (400)', async () => {
    const token = await makeToken('ADMIN')
    mockDb.mediaFile.findUnique.mockResolvedValue({ id: 'm1', businessId: 'biz-1', mimeType: 'video/mp4', url: '/uploads/biz-1/x.mp4', thumbUrl: null })
    const res = await rotateReq('m1', 90, token)
    expect(res.status).toBe(400)
  })

  it('returns 404 when media not found', async () => {
    const token = await makeToken('ADMIN')
    mockDb.mediaFile.findUnique.mockResolvedValue(null)
    const res = await rotateReq('missing', 90, token)
    expect(res.status).toBe(404)
  })

  it('requires authentication (401 without token)', async () => {
    const res = await app.request('/api/media/m1/rotate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Tab-ID': 'test' },
      body: JSON.stringify({ angle: 90 }),
    })
    expect(res.status).toBe(401)
  })
})

// ============================================================
// GET /api/media/library/:bizId — counts
// ============================================================

describe('GET /api/media/library/:bizId — counts', () => {
  beforeEach(() => vi.clearAllMocks())

  it('returns totalCount + counts on first page', async () => {
    const token = await makeToken('ADMIN')
    mockDb.mediaFile.findMany.mockResolvedValue([])
    mockDb.mediaFile.count.mockResolvedValue(3)
    const res = await app.request('/api/media/library/biz-1', {
      headers: { Cookie: `token=${token}`, 'X-Tab-ID': 'test' },
    })
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.totalCount).toBe(3)
    expect(json.counts).toBeDefined()
    expect(json.counts).toHaveProperty('images')
    expect(json.counts).toHaveProperty('videos')
    expect(json.counts).toHaveProperty('unattached')
  })

  it('omits counts/totalCount on cursor (load-more) pages', async () => {
    const token = await makeToken('ADMIN')
    mockDb.mediaFile.findMany.mockResolvedValue([])
    const res = await app.request('/api/media/library/biz-1?cursor=abc', {
      headers: { Cookie: `token=${token}`, 'X-Tab-ID': 'test' },
    })
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.counts).toBeUndefined()
    expect(json.totalCount).toBeUndefined()
  })
})
