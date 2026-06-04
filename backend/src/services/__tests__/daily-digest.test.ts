/**
 * Integration tests for the morning agent (Epic C):
 * - approveDigestTask creates a DRAFT post (human-in-the-loop, no auto-publish)
 * - runDailyDigest turns AI suggestions into AutoPostTasks
 * DB / aiComplete / nawode-data / telegram all mocked (Node env — no real bun SQL / AI).
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'

const { mockDb } = vi.hoisted(() => {
  const m = () => ({
    findMany: vi.fn().mockResolvedValue([]),
    findFirst: vi.fn().mockResolvedValue(null),
    findUnique: vi.fn().mockResolvedValue(null),
    create: vi.fn().mockResolvedValue({ id: 'mock-id' }),
    update: vi.fn().mockResolvedValue({ id: 'mock-id' }),
    count: vi.fn().mockResolvedValue(0),
    upsert: vi.fn().mockResolvedValue({ id: 'mock-id' }),
  })
  return {
    mockDb: {
      business: m(), brandProfile: m(), post: m(), autoPostTask: m(), appConfig: m(),
      platformAccount: m(), generationSession: m(),
    },
  }
})

vi.mock('../../db', () => ({ db: mockDb }))
vi.mock('../../eventBus', () => ({ emitEvent: vi.fn() }))
vi.mock('../nawode-data', () => ({
  getNawodeData: vi.fn().mockResolvedValue(null),
  getBookingsInRange: vi.fn().mockResolvedValue([]),
  isNawodeDataAvailable: vi.fn().mockReturnValue(false),
}))
vi.mock('../ai/prompt-builder', () => ({ buildBrandContext: vi.fn().mockResolvedValue('## Бренд: НаWоде') }))
vi.mock('../ai/openrouter', () => ({ aiComplete: vi.fn() }))
vi.mock('../telegram-approval', () => ({ sendApprovalToTelegram: vi.fn() }))

import { approveDigestTask, runDailyDigest } from '../daily-digest'
import { aiComplete } from '../ai/openrouter'

describe('approveDigestTask (Epic C — human-in-the-loop)', () => {
  beforeEach(() => vi.clearAllMocks())

  it('creates a DRAFT post from the suggestion (no auto-publish)', async () => {
    mockDb.post.create.mockResolvedValue({ id: 'p1' })
    mockDb.autoPostTask.update.mockResolvedValue({})

    const res = await approveDigestTask({
      id: 't1', businessId: 'biz-1', postType: 'STORIES',
      title: 'Заголовок', proposedText: 'Текст', proposedTags: ['нawode'], aiReasoning: 'погода',
    })

    expect(res.postId).toBe('p1')
    expect(res.postType).toBe('STORIES')
    expect(mockDb.post.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: 'DRAFT', postType: 'STORIES', businessId: 'biz-1', createdBy: 'ai' }),
      })
    )
    expect(mockDb.autoPostTask.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 't1' }, data: expect.objectContaining({ status: 'approved', postId: 'p1' }) })
    )
  })

  it('falls back to TEXT for unknown post types', async () => {
    mockDb.post.create.mockResolvedValue({ id: 'p2' })
    mockDb.autoPostTask.update.mockResolvedValue({})
    const res = await approveDigestTask({ id: 't2', businessId: 'biz-1', postType: 'BOGUS', proposedText: 'x' })
    expect(res.postType).toBe('TEXT')
  })
})

describe('runDailyDigest (Epic C — generate suggestions)', () => {
  beforeEach(() => vi.clearAllMocks())

  it('creates AutoPostTasks from AI suggestions', async () => {
    mockDb.business.findMany.mockResolvedValue([
      { id: 'biz-1', slug: 'nawode', name: 'НаWоде', platformAccounts: [{ platform: 'VK' }] },
    ])
    mockDb.autoPostTask.count.mockResolvedValue(0)
    mockDb.post.findMany.mockResolvedValue([])
    mockDb.autoPostTask.create.mockResolvedValue({ id: 'task-1', businessId: 'biz-1' })
    vi.mocked(aiComplete).mockResolvedValue({
      content: JSON.stringify({
        suggestions: [
          { postType: 'STORIES', platforms: ['VK'], title: 'T', text: 'B', hashtags: ['a'], reasoning: 'погода', visualIdea: 'фото' },
        ],
      }),
      tokensIn: 1, tokensOut: 1, cachedTokens: 0, costUsd: 0, model: 'sonnet',
    } as any)

    const res = await runDailyDigest({ businessId: 'biz-1', force: true })

    expect(res.created).toBe(1)
    expect(mockDb.autoPostTask.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ source: 'digest', status: 'proposed', postType: 'STORIES' }) })
    )
  })

  it('creates nothing when AI returns no suggestions', async () => {
    mockDb.business.findMany.mockResolvedValue([
      { id: 'biz-1', slug: 'nawode', name: 'НаWоде', platformAccounts: [{ platform: 'VK' }] },
    ])
    mockDb.autoPostTask.count.mockResolvedValue(0)
    mockDb.post.findMany.mockResolvedValue([])
    vi.mocked(aiComplete).mockResolvedValue({
      content: '{"suggestions":[]}', tokensIn: 1, tokensOut: 1, cachedTokens: 0, costUsd: 0, model: 'sonnet',
    } as any)

    const res = await runDailyDigest({ businessId: 'biz-1', force: true })
    expect(res.created).toBe(0)
    expect(mockDb.autoPostTask.create).not.toHaveBeenCalled()
  })
})
