import { describe, it, expect, beforeEach, vi } from 'vitest'
import * as jose from 'jose'

// ============================================================
// Mock setup (must be before app import)
// ============================================================

const { mockDb } = vi.hoisted(() => {
  const m = () => ({
    findMany: vi.fn().mockResolvedValue([]),
    findFirst: vi.fn().mockResolvedValue(null),
    findUnique: vi.fn().mockResolvedValue(null),
    create: vi.fn().mockResolvedValue({ id: 'ticket-1', number: 1 }),
    update: vi.fn().mockResolvedValue({ id: 'ticket-1' }),
    delete: vi.fn().mockResolvedValue({ id: 'ticket-1' }),
    count: vi.fn().mockResolvedValue(0),
    upsert: vi.fn().mockResolvedValue({ id: 'ticket-1' }),
  })
  return {
    mockDb: {
      user: m(),
      business: m(),
      ticket: m(),
      ticketEvent: m(),
      ticketPlan: m(),
      ticketAttachment: m(),
      appConfig: m(),
      $queryRaw: vi.fn().mockResolvedValue([{ '?column?': 1 }]),
      $transaction: vi.fn(async (fn: any) => fn(mockDb)),
    },
  }
})

vi.mock('../../db', () => ({ db: mockDb }))
vi.mock('../../services/scheduler', () => ({ startPublishScheduler: vi.fn() }))
vi.mock('../../services/ai/openrouter', () => ({ aiRequest: vi.fn() }))
vi.mock('../../eventBus', () => ({ emitEvent: vi.fn(), eventBus: { on: vi.fn(), off: vi.fn() } }))

import { app } from '../../app'

async function makeToken(role: 'ADMIN' | 'EDITOR' | 'VIEWER' = 'ADMIN', userId = 'admin-1') {
  const secret = new TextEncoder().encode('test-jwt-secret-at-least-32-characters-long')
  return await new jose.SignJWT({ userId, name: 'Test', role, type: 'access' })
    .setProtectedHeader({ alg: 'HS256' })
    .setExpirationTime('1h')
    .sign(secret)
}

const validBody = {
  businessSlug: 'kukin',
  appSlug: 'kb-erp',
  title: 'Смета съезжает на телефоне',
  body: 'Открываю заказ 741, блок «К оплате» уезжает под смету',
  reporterExternalId: 'user-misha',
  reporterName: 'Миша',
}

function postTicket(body: unknown, token: string) {
  return app.request('/api/tickets', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: `token=${token}`, 'X-Tab-ID': 'test' },
    body: JSON.stringify(body),
  })
}

describe('POST /api/tickets — приём обращения', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    // clearAllMocks чистит вызовы, но НЕ заданные значения — счётчик потолка
    // протекал бы в соседние тесты и давал ложные 429.
    mockDb.ticket.count.mockResolvedValue(0)
  })

  it('создаёт тикет и заводит запись в ленте', async () => {
    const token = await makeToken('ADMIN')
    mockDb.business.findUnique.mockResolvedValue({ id: 'biz-1', slug: 'kukin' })

    const res = await postTicket(validBody, token)
    expect(res.status).toBe(201)

    const arg = mockDb.ticket.create.mock.calls[0][0]
    expect(arg.data.businessId).toBe('biz-1')
    expect(arg.data.appSlug).toBe('kb-erp')
    // Лента заводится тем же запросом — иначе история тикета начинается с пустоты
    expect(arg.data.events.create.kind).toBe('created')
  })

  it('отклоняет неизвестный проект (400), а не создаёт висячий тикет', async () => {
    const token = await makeToken('ADMIN')
    mockDb.business.findUnique.mockResolvedValue(null)

    const res = await postTicket(validBody, token)
    expect(res.status).toBe(400)
    expect(mockDb.ticket.create).not.toHaveBeenCalled()
  })

  it('держит суточный потолок на автора (429)', async () => {
    const token = await makeToken('ADMIN')
    mockDb.business.findUnique.mockResolvedValue({ id: 'biz-1', slug: 'kukin' })
    mockDb.ticket.count.mockResolvedValue(30)

    const res = await postTicket(validBody, token)
    expect(res.status).toBe(429)
    expect(mockDb.ticket.create).not.toHaveBeenCalled()
  })

  it('отклоняет пустой заголовок и чужое приложение (400)', async () => {
    const token = await makeToken('ADMIN')
    mockDb.business.findUnique.mockResolvedValue({ id: 'biz-1', slug: 'kukin' })

    expect((await postTicket({ ...validBody, title: '' }, token)).status).toBe(400)
    expect((await postTicket({ ...validBody, appSlug: 'unknown-app' }, token)).status).toBe(400)
  })
})

describe('POST /api/tickets — автоконтекст режется по размеру', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockDb.ticket.count.mockResolvedValue(0)
    mockDb.business.findUnique.mockResolvedValue({ id: 'biz-1', slug: 'kukin' })
  })

  it('усекает длинную строку и хвост консоли', async () => {
    const token = await makeToken('ADMIN')
    const context = {
      route: 'x'.repeat(5000),
      console: Array.from({ length: 200 }, (_, i) => `error #${i}`),
      failedRequests: Array.from({ length: 100 }, (_, i) => `PATCH /api/orders/${i} 500`),
    }

    const res = await postTicket({ ...validBody, context }, token)
    expect(res.status).toBe(201)

    const saved = mockDb.ticket.create.mock.calls[0][0].data.context as Record<string, unknown>
    expect((saved.route as string).length).toBeLessThan(600)
    expect(saved.console).toHaveLength(50)
    expect(saved.failedRequests).toHaveLength(20)
    // Хвост важнее головы: последние ошибки ближе к моменту жалобы
    expect((saved.console as string[])[49]).toContain('#199')
  })

  it('не падает на мусорном контексте', async () => {
    const token = await makeToken('ADMIN')
    for (const context of ['строка вместо объекта', 42, null, ['массив']]) {
      const res = await postTicket({ ...validBody, context }, token)
      expect(res.status).toBe(201)
    }
  })
})

describe('PATCH /api/tickets/:id — ведение', () => {
  beforeEach(() => vi.clearAllMocks())

  function patch(id: string, body: unknown, token: string) {
    return app.request(`/api/tickets/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', Cookie: `token=${token}`, 'X-Tab-ID': 'test' },
      body: JSON.stringify(body),
    })
  }

  it('VIEWER не может менять статус (403)', async () => {
    const token = await makeToken('VIEWER')
    mockDb.ticket.findUnique.mockResolvedValue({ id: 't1', status: 'new' })

    const res = await patch('t1', { status: 'triaged' }, token)
    expect(res.status).toBe(403)
    expect(mockDb.ticket.update).not.toHaveBeenCalled()
  })

  it('пишет смену статуса в ленту и ставит дату выката', async () => {
    const token = await makeToken('ADMIN')
    mockDb.ticket.findUnique.mockResolvedValue({ id: 't1', status: 'running', deployedAt: null, closedAt: null })

    const res = await patch('t1', { status: 'deployed' }, token)
    expect(res.status).toBe(200)
    expect(mockDb.ticket.update.mock.calls[0][0].data.deployedAt).toBeInstanceOf(Date)
    expect(mockDb.ticketEvent.create.mock.calls[0][0].data.kind).toBe('status_changed')
  })

  it('не даёт пометить тикет дублем самого себя (400)', async () => {
    const token = await makeToken('ADMIN')
    mockDb.ticket.findUnique.mockResolvedValue({ id: 't1', status: 'new' })

    const res = await patch('t1', { dedupOfId: 't1' }, token)
    expect(res.status).toBe(400)
    expect(mockDb.ticket.update).not.toHaveBeenCalled()
  })

  it('отдаёт 404 на несуществующий тикет', async () => {
    const token = await makeToken('ADMIN')
    mockDb.ticket.findUnique.mockResolvedValue(null)

    const res = await patch('missing', { status: 'triaged' }, token)
    expect(res.status).toBe(404)
  })
})
