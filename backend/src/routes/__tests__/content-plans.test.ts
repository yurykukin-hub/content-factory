/**
 * Integration tests for content-plan AI (Epic D): regenerate cell with direction.
 * DB + aiComplete mocked (same harness as posts.test.ts).
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
      generationSession: m(), idea: m(), autoPostTask: m(),
      $queryRaw: vi.fn().mockResolvedValue([]),
      $executeRaw: vi.fn().mockResolvedValue(0),
      $transaction: vi.fn(async (fn: any) => fn(mockDb)),
    },
  }
})

vi.mock('../../db', () => ({ db: mockDb }))
vi.mock('../../services/scheduler', () => ({ startPublishScheduler: vi.fn() }))
vi.mock('../../services/video-poller', () => ({ startVideoPoller: vi.fn() }))
vi.mock('../../services/ai/openrouter', () => ({ aiComplete: vi.fn(), aiVision: vi.fn(), aiChat: vi.fn() }))
vi.mock('../../eventBus', () => ({ emitEvent: vi.fn() }))

import { app } from '../../app'
import { aiComplete } from '../../services/ai/openrouter'

async function makeToken(role: 'ADMIN' | 'EDITOR' = 'ADMIN', userId = 'admin-1') {
  const secret = new TextEncoder().encode('test-jwt-secret-at-least-32-characters-long')
  return await new jose.SignJWT({ userId, name: 'Test', role, type: 'access' })
    .setProtectedHeader({ alg: 'HS256' })
    .setExpirationTime('1h')
    .sign(secret)
}

const aiCompleteResult = (content: string) => ({
  content, tokensIn: 1, tokensOut: 1, cachedTokens: 0, costUsd: 0, model: 'haiku',
})

describe('POST /api/plan-items/:id/regenerate (Epic D)', () => {
  beforeEach(() => vi.clearAllMocks())

  it('rewrites a plan cell with AI output', async () => {
    const token = await makeToken('ADMIN')
    mockDb.contentPlanItem.findUnique.mockResolvedValue({
      id: 'item-1', topic: 'Старая тема', postType: 'TEXT', description: '',
      contentPlan: { businessId: 'biz-1' },
    })
    mockDb.business.findUnique.mockResolvedValue({ id: 'biz-1', name: 'НаWоде', slug: 'nawode' })
    mockDb.post.findMany.mockResolvedValue([])
    vi.mocked(aiComplete).mockResolvedValue(
      aiCompleteResult('{"topic":"Свежая тема","postType":"PHOTO","description":"Описание"}') as any
    )
    mockDb.contentPlanItem.update.mockResolvedValue({
      id: 'item-1', topic: 'Свежая тема', postType: 'PHOTO', description: 'Описание',
    })

    const res = await app.request('/api/plan-items/item-1/regenerate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: `token=${token}`, 'X-Tab-ID': 'test' },
      body: JSON.stringify({ direction: 'сделай фото-пост' }),
    })

    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.topic).toBe('Свежая тема')
    expect(body.postType).toBe('PHOTO')
    expect(mockDb.contentPlanItem.update).toHaveBeenCalled()
    expect(vi.mocked(aiComplete)).toHaveBeenCalled()
  })

  it('returns 422 when AI returns invalid JSON', async () => {
    const token = await makeToken('ADMIN')
    mockDb.contentPlanItem.findUnique.mockResolvedValue({
      id: 'item-1', topic: 'X', postType: 'TEXT', description: '', contentPlan: { businessId: 'biz-1' },
    })
    mockDb.business.findUnique.mockResolvedValue({ id: 'biz-1', name: 'НаWоде' })
    mockDb.post.findMany.mockResolvedValue([])
    vi.mocked(aiComplete).mockResolvedValue(aiCompleteResult('это не json') as any)

    const res = await app.request('/api/plan-items/item-1/regenerate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: `token=${token}`, 'X-Tab-ID': 'test' },
      body: JSON.stringify({}),
    })
    expect(res.status).toBe(422)
  })

  it('requires auth', async () => {
    const res = await app.request('/api/plan-items/item-1/regenerate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Tab-ID': 'test' },
      body: JSON.stringify({}),
    })
    expect(res.status).toBe(401)
  })
})
