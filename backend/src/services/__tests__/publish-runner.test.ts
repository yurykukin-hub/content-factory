/**
 * Tests for publish-runner — критичный путь: ПУБЛИКАЦИЯ.
 *
 * Источник правды для роута publish.ts, дайджеста и шедулера.
 * getPublisher замокан → НИКАКИХ живых вызовов VK/IG/Telegram/PostMyPost.
 * Проверяется оркестрация: подготовка текста, вырезание инлайн-хэштегов,
 * инъекция booking-URL (только VK-лента), запись лога, обновление статусов,
 * rollup статуса родительского поста, события, обработка ошибок.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'

const { mockDb } = vi.hoisted(() => {
  const m = () => ({
    findUnique: vi.fn().mockResolvedValue(null),
    findMany: vi.fn().mockResolvedValue([]),
    create: vi.fn().mockResolvedValue({ id: 'mock-id' }),
    update: vi.fn().mockResolvedValue({ id: 'mock-id' }),
  })
  return {
    mockDb: {
      postVersion: m(),
      mediaFile: m(),
      appConfig: m(),
      publishLog: m(),
      post: m(),
    },
  }
})

vi.mock('../../db', () => ({ db: mockDb }))
vi.mock('../../eventBus', () => ({ emitEvent: vi.fn() }))
vi.mock('../publishers/base', () => ({ getPublisher: vi.fn() }))
vi.mock('../publish-utm', () => ({ applyUtmForPublish: vi.fn() }))
vi.mock('../../utils/hashtags', () => ({ stripInlineHashtags: vi.fn((t: string) => t) }))

import { publishPostVersion, schedulePostVersion } from '../publish-runner'
import { getPublisher } from '../publishers/base'
import { applyUtmForPublish } from '../publish-utm'
import { stripInlineHashtags } from '../../utils/hashtags'
import { emitEvent } from '../../eventBus'

const mockGetPublisher = vi.mocked(getPublisher)
const mockApplyUtm = vi.mocked(applyUtmForPublish)
const mockStrip = vi.mocked(stripInlineHashtags)
const mockEmit = vi.mocked(emitEvent)

/** Фейковый publisher — publish() замокан, живых вызовов нет. */
function makePublisher(result: any) {
  return { publish: vi.fn().mockResolvedValue(result), testConnection: vi.fn() } as any
}

function makeVersion(over: any = {}) {
  return {
    id: 'v1',
    postId: 'p1',
    body: 'AI-адаптированный текст',
    hashtags: [],
    platformAccount: { id: 'pa1', platform: 'VK', config: {} },
    post: { id: 'p1', postType: 'PHOTO', body: 'короткий текст поста', businessId: 'biz1' },
    ...over,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  // UTM по умолчанию — идентичность (эхо текста и storiesOptions)
  mockApplyUtm.mockImplementation(async ({ text, storiesOptions }: any) => ({ text, storiesOptions }))
  mockStrip.mockImplementation((t: string) => t)
  mockDb.mediaFile.findMany.mockResolvedValue([])
  mockDb.appConfig.findUnique.mockResolvedValue(null)
  mockDb.publishLog.create.mockResolvedValue({ id: 'log1' })
  mockDb.postVersion.update.mockResolvedValue({ id: 'v1', status: 'PUBLISHED' })
  mockDb.post.update.mockResolvedValue({ id: 'p1' })
})

// ============================================================
// publishPostVersion
// ============================================================
describe('publishPostVersion', () => {
  it('бросает VERSION_NOT_FOUND если версии нет', async () => {
    mockDb.postVersion.findUnique.mockResolvedValue(null)
    await expect(publishPostVersion('nope')).rejects.toThrow('VERSION_NOT_FOUND')
  })

  it('успешная публикация: лог SUCCESS, статусы PUBLISHED, событие post_published', async () => {
    mockDb.postVersion.findUnique.mockResolvedValue(makeVersion())
    const publisher = makePublisher({ success: true, externalPostId: '777', externalUrl: 'https://vk.com/wall-1_777', rawResponse: { ok: 1 } })
    mockGetPublisher.mockReturnValue(publisher)

    const res = await publishPostVersion('v1', { tabId: 'tab-A' })

    expect(res.success).toBe(true)
    expect(res.externalUrl).toBe('https://vk.com/wall-1_777')
    // лог публикации = SUCCESS
    expect(mockDb.publishLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ postVersionId: 'v1', status: 'SUCCESS', errorMessage: null }),
    })
    // версия → PUBLISHED + publishedAt + внешние id/url
    expect(mockDb.postVersion.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'v1' },
      data: expect.objectContaining({ status: 'PUBLISHED', externalPostId: '777', externalUrl: 'https://vk.com/wall-1_777' }),
      include: expect.anything(),
    }))
    // родительский пост → PUBLISHED
    expect(mockDb.post.update).toHaveBeenCalledWith({ where: { id: 'p1' }, data: { status: 'PUBLISHED' } })
    // событие
    expect(mockEmit).toHaveBeenCalledWith(expect.objectContaining({ type: 'post_published', postId: 'p1', tabId: 'tab-A' }))
  })

  it('провал публикации: лог FAILED, версия FAILED (publishedAt=null), пост НЕ трогаем, событие post_publish_failed', async () => {
    mockDb.postVersion.findUnique.mockResolvedValue(makeVersion())
    mockGetPublisher.mockReturnValue(makePublisher({ success: false, error: 'VK token invalid', rawResponse: { error: 1 } }))

    const res = await publishPostVersion('v1')

    expect(res.success).toBe(false)
    expect(res.error).toBe('VK token invalid')
    expect(mockDb.publishLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ status: 'FAILED', errorMessage: 'VK token invalid' }),
    })
    expect(mockDb.postVersion.update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ status: 'FAILED', publishedAt: null }),
    }))
    // при провале родительский пост в PUBLISHED НЕ переводим
    expect(mockDb.post.update).not.toHaveBeenCalled()
    expect(mockEmit).toHaveBeenCalledWith(expect.objectContaining({ type: 'post_publish_failed' }))
  })

  it('VK-лента: booking-URL дописывается в текст (кликабельная ссылка)', async () => {
    mockDb.postVersion.findUnique.mockResolvedValue(makeVersion())
    mockDb.appConfig.findUnique.mockResolvedValue({ value: 'https://erp.nawode.ru/booking.html?ref=vk' })
    const publisher = makePublisher({ success: true, externalUrl: 'u', rawResponse: {} })
    mockGetPublisher.mockReturnValue(publisher)

    await publishPostVersion('v1')

    const passedText = publisher.publish.mock.calls[0][0].text
    expect(passedText).toContain('Забронировать: https://erp.nawode.ru/booking.html?ref=vk')
  })

  it('VK-лента: booking-URL идемпотентен (не дублируется, если уже в тексте)', async () => {
    const url = 'https://erp.nawode.ru/booking.html?ref=vk'
    mockDb.postVersion.findUnique.mockResolvedValue(makeVersion({ body: `текст ${url}` }))
    mockDb.appConfig.findUnique.mockResolvedValue({ value: url })
    // UTM-эхо вернёт текст с уже вшитым url
    const publisher = makePublisher({ success: true, externalUrl: 'u', rawResponse: {} })
    mockGetPublisher.mockReturnValue(publisher)

    await publishPostVersion('v1')

    const passedText: string = publisher.publish.mock.calls[0][0].text
    const occurrences = passedText.split(url).length - 1
    expect(occurrences).toBe(1)
  })

  it('не-VK платформа: booking-URL НЕ дописывается', async () => {
    mockDb.postVersion.findUnique.mockResolvedValue(makeVersion({
      platformAccount: { id: 'pa2', platform: 'TELEGRAM', config: {} },
    }))
    mockDb.appConfig.findUnique.mockResolvedValue({ value: 'https://erp.nawode.ru/booking.html' })
    const publisher = makePublisher({ success: true, externalUrl: 'u', rawResponse: {} })
    mockGetPublisher.mockReturnValue(publisher)

    await publishPostVersion('v1')

    expect(publisher.publish.mock.calls[0][0].text).not.toContain('Забронировать')
  })

  it('STORIES: текст = post.body (короткий), хэштеги пустые, booking-URL не дописывается', async () => {
    mockDb.postVersion.findUnique.mockResolvedValue(makeVersion({
      post: { id: 'p1', postType: 'STORIES', body: 'сторис-оверлей', businessId: 'biz1' },
      body: 'длинная AI-адаптация',
      hashtags: ['#sup', '#vyborg'],
    }))
    mockDb.appConfig.findUnique.mockResolvedValue({ value: 'https://erp.nawode.ru/booking.html' })
    const publisher = makePublisher({ success: true, externalUrl: 'u', rawResponse: {} })
    mockGetPublisher.mockReturnValue(publisher)

    await publishPostVersion('v1')

    const arg = publisher.publish.mock.calls[0][0]
    expect(arg.text).toContain('сторис-оверлей')
    expect(arg.text).not.toContain('длинная AI-адаптация')
    expect(arg.hashtags).toEqual([])
    expect(arg.text).not.toContain('Забронировать')
    // для сторис инлайн-хэштеги не вырезаем (tags пуст)
    expect(mockStrip).not.toHaveBeenCalled()
  })

  it('лента с хэштегами: stripInlineHashtags вызывается (анти-дубль инлайн-тегов)', async () => {
    mockDb.postVersion.findUnique.mockResolvedValue(makeVersion({ hashtags: ['#sup'] }))
    mockGetPublisher.mockReturnValue(makePublisher({ success: true, externalUrl: 'u', rawResponse: {} }))

    await publishPostVersion('v1')

    expect(mockStrip).toHaveBeenCalledWith('AI-адаптированный текст')
  })

  it('лента без хэштегов: stripInlineHashtags НЕ вызывается (ручные теги в теле не теряем)', async () => {
    mockDb.postVersion.findUnique.mockResolvedValue(makeVersion({ hashtags: [] }))
    mockGetPublisher.mockReturnValue(makePublisher({ success: true, externalUrl: 'u', rawResponse: {} }))

    await publishPostVersion('v1')

    expect(mockStrip).not.toHaveBeenCalled()
  })

  it('медиа передаётся в publisher в нужной форме (url/mimeType/filename)', async () => {
    mockDb.postVersion.findUnique.mockResolvedValue(makeVersion())
    mockDb.mediaFile.findMany.mockResolvedValue([
      { url: '/u/a.jpg', mimeType: 'image/jpeg', filename: 'a.jpg', sortOrder: 0, extra: 'ignored' },
    ])
    const publisher = makePublisher({ success: true, externalUrl: 'u', rawResponse: {} })
    mockGetPublisher.mockReturnValue(publisher)

    await publishPostVersion('v1')

    expect(publisher.publish.mock.calls[0][0].mediaFiles).toEqual([
      { url: '/u/a.jpg', mimeType: 'image/jpeg', filename: 'a.jpg' },
    ])
  })
})

// ============================================================
// schedulePostVersion
// ============================================================
describe('schedulePostVersion', () => {
  it('планирование: версия SCHEDULED + scheduledAt, родитель → SCHEDULED', async () => {
    mockDb.postVersion.update.mockResolvedValue({ id: 'v1', postId: 'p1' })
    mockDb.post.findUnique.mockResolvedValue({ status: 'DRAFT' })

    await schedulePostVersion('v1', '2026-07-01T10:00:00Z', { foo: 1 })

    expect(mockDb.postVersion.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'v1' },
      data: expect.objectContaining({ status: 'SCHEDULED', publishOptions: { foo: 1 } }),
    }))
    expect(mockDb.post.update).toHaveBeenCalledWith({ where: { id: 'p1' }, data: { status: 'SCHEDULED' } })
  })

  it('планирование: если пост уже PUBLISHED — статус поста НЕ меняем', async () => {
    mockDb.postVersion.update.mockResolvedValue({ id: 'v1', postId: 'p1' })
    mockDb.post.findUnique.mockResolvedValue({ status: 'PUBLISHED' })

    await schedulePostVersion('v1', '2026-07-01T10:00:00Z')

    expect(mockDb.post.update).not.toHaveBeenCalled()
  })

  it('отмена (null): версия DRAFT, rollup поста = PUBLISHED если есть опубликованная версия', async () => {
    mockDb.postVersion.update.mockResolvedValue({ id: 'v1', postId: 'p1' })
    mockDb.postVersion.findMany.mockResolvedValue([{ status: 'PUBLISHED' }, { status: 'DRAFT' }])

    await schedulePostVersion('v1', null)

    expect(mockDb.postVersion.update).toHaveBeenCalledWith(expect.objectContaining({
      data: { scheduledAt: null, status: 'DRAFT' },
    }))
    expect(mockDb.post.update).toHaveBeenCalledWith({ where: { id: 'p1' }, data: { status: 'PUBLISHED' } })
  })

  it('отмена (null): rollup = SCHEDULED если есть запланированная (и нет опубликованной)', async () => {
    mockDb.postVersion.update.mockResolvedValue({ id: 'v1', postId: 'p1' })
    mockDb.postVersion.findMany.mockResolvedValue([{ status: 'SCHEDULED' }, { status: 'DRAFT' }])

    await schedulePostVersion('v1', null)

    expect(mockDb.post.update).toHaveBeenCalledWith({ where: { id: 'p1' }, data: { status: 'SCHEDULED' } })
  })

  it('отмена (null): rollup = DRAFT если все версии черновики', async () => {
    mockDb.postVersion.update.mockResolvedValue({ id: 'v1', postId: 'p1' })
    mockDb.postVersion.findMany.mockResolvedValue([{ status: 'DRAFT' }, { status: 'DRAFT' }])

    await schedulePostVersion('v1', null)

    expect(mockDb.post.update).toHaveBeenCalledWith({ where: { id: 'p1' }, data: { status: 'DRAFT' } })
  })
})
