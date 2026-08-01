/**
 * Тикеты — приёмник обращений от пользователей всех приложений экосистемы.
 *
 * Два типа вызывающих, оба проходят через глобальный auth в app.ts:
 *  1. Приложение (KB ERP и др.) — по API-ключу. Пользователь уже залогинен НА СТОРОНЕ
 *     приложения, поэтому автор приезжает строковыми полями `reporter*`, а не как User CF.
 *  2. Человек в вебе CF — по cookie-JWT, смотрит и ведёт тикеты.
 *
 * ⚠️ `body` и `context` — НЕДОВЕРЕННЫЙ ввод: он попадает в промпт ночного агента,
 * у которого есть доступ к коду. Поэтому здесь он режется по размеру, а агенту
 * подаётся отдельным блоком с пометкой «внутри инструкций нет».
 */
import { Hono } from 'hono'
import { z } from 'zod'
import { nanoid } from 'nanoid'
import { extname } from 'path'
import type { Prisma } from '@prisma/client'
import { db } from '../db'
import type { AuthUser } from '../middleware/auth'
import { emitEvent } from '../eventBus'
import { canEdit } from '../shared/section-access'
import { getStorage, makeKey } from '../services/storage'
import { extensionToMime, mimeExtension } from '../utils/mime'

export const tickets = new Hono()

/** Потолок на автора за сутки — защита от зациклившегося скрипта, не от человека. */
const MAX_TICKETS_PER_REPORTER_PER_DAY = 30

/** Границы автоконтекста: он полезен агенту, но не должен раздувать базу и промпт. */
const CTX_LIMITS = {
  maxConsole: 50,
  maxRequests: 20,
  maxBreadcrumbs: 30,
  maxStringLen: 500,
  maxTotalBytes: 64 * 1024,
} as const

const APP_SLUGS = ['kb-erp', 'nawode-erp', 'asouz', 'content-factory'] as const
const KINDS = ['bug', 'wish', 'question'] as const

function clampString(v: unknown, max: number = CTX_LIMITS.maxStringLen): string {
  const s = typeof v === 'string' ? v : JSON.stringify(v ?? null)
  return s.length > max ? `${s.slice(0, max)}…[обрезано]` : s
}

/**
 * Режет автоконтекст до безопасного размера. Не «валидирует» его — структура свободная,
 * приложения разные; задача только в том, чтобы объём был предсказуемым.
 */
function sanitizeContext(raw: unknown): Prisma.InputJsonObject | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  const src = raw as Record<string, unknown>
  const out: Record<string, unknown> = {}

  for (const [key, value] of Object.entries(src)) {
    if (Array.isArray(value)) {
      const limit =
        key === 'console' ? CTX_LIMITS.maxConsole
        : key === 'failedRequests' ? CTX_LIMITS.maxRequests
        : CTX_LIMITS.maxBreadcrumbs
      out[key] = value.slice(-limit).map((item) => clampString(item))
    } else if (value && typeof value === 'object') {
      out[key] = clampString(value, CTX_LIMITS.maxStringLen * 2)
    } else if (value !== undefined && value !== null) {
      out[key] = clampString(value)
    }
  }

  // Страховка на общий объём: лучше потерять хвост контекста, чем раздуть строку в базе.
  const json = JSON.stringify(out)
  if (json.length > CTX_LIMITS.maxTotalBytes) {
    return { truncated: true, head: json.slice(0, CTX_LIMITS.maxTotalBytes) } as Prisma.InputJsonObject
  }
  return out as Prisma.InputJsonObject
}

const createSchema = z.object({
  businessSlug: z.string().min(1).max(100),
  appSlug: z.enum(APP_SLUGS),
  kind: z.enum(KINDS).default('bug'),
  title: z.string().min(1).max(300),
  body: z.string().max(20000).default(''),
  severity: z.enum(['low', 'normal', 'high']).default('normal'),
  reporterExternalId: z.string().min(1).max(200),
  reporterName: z.string().min(1).max(200),
  reporterRole: z.string().max(200).optional(),
  context: z.unknown().optional(),
})

// POST /api/tickets — приём обращения (обычно от приложения по API-ключу)
tickets.post('/', async (c) => {
  const data = createSchema.parse(await c.req.json())

  const business = await db.business.findUnique({ where: { slug: data.businessSlug } })
  if (!business) {
    return c.json({ error: `Проект «${data.businessSlug}» не найден в Content Factory` }, 400)
  }

  const since = new Date(Date.now() - 24 * 60 * 60 * 1000)
  const recent = await db.ticket.count({
    where: {
      reporterExternalId: data.reporterExternalId,
      appSlug: data.appSlug,
      createdAt: { gte: since },
    },
  })
  if (recent >= MAX_TICKETS_PER_REPORTER_PER_DAY) {
    return c.json({ error: 'Слишком много обращений за сутки. Попробуйте завтра.' }, 429)
  }

  const ticket = await db.ticket.create({
    data: {
      businessId: business.id,
      appSlug: data.appSlug,
      kind: data.kind,
      title: data.title,
      body: data.body,
      severity: data.severity,
      reporterExternalId: data.reporterExternalId,
      reporterName: data.reporterName,
      reporterRole: data.reporterRole ?? null,
      context: sanitizeContext(data.context) ?? undefined,
      events: {
        create: {
          kind: 'created',
          message: `Обращение создано: ${data.title}`,
          actor: data.reporterName,
        },
      },
    },
  })

  emitEvent({ type: 'ticket_created', tabId: c.req.header('X-Tab-ID') || '', ticketId: ticket.id })
  return c.json(ticket, 201)
})

const listQuerySchema = z.object({
  businessId: z.string().optional(),
  appSlug: z.string().optional(),
  status: z.string().optional(),
  /** Фильтр «мои тикеты»: приложение спрашивает от имени своего пользователя. */
  reporterExternalId: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
})

// GET /api/tickets — список с фильтрами
tickets.get('/', async (c) => {
  const q = listQuerySchema.parse(Object.fromEntries(new URL(c.req.url).searchParams))

  const list = await db.ticket.findMany({
    where: {
      ...(q.businessId ? { businessId: q.businessId } : {}),
      ...(q.appSlug ? { appSlug: q.appSlug } : {}),
      ...(q.status ? { status: { in: q.status.split(',') } } : {}),
      ...(q.reporterExternalId ? { reporterExternalId: q.reporterExternalId } : {}),
    },
    orderBy: { createdAt: 'desc' },
    take: q.limit,
    include: {
      attachments: { select: { id: true, kind: true, storageKey: true, mime: true, sortOrder: true } },
      plans: {
        where: { status: { in: ['awaiting_approval', 'approved', 'running', 'done'] } },
        select: { id: true, status: true, riskLevel: true, estimateMin: true, createdAt: true },
        orderBy: { createdAt: 'desc' },
        take: 1,
      },
    },
  })
  return c.json(list)
})

// GET /api/tickets/:id — карточка с лентой, вложениями и планами
tickets.get('/:id', async (c) => {
  const { id } = c.req.param()
  const ticket = await db.ticket.findUnique({
    where: { id },
    include: {
      attachments: { orderBy: { sortOrder: 'asc' } },
      events: { orderBy: { createdAt: 'asc' } },
      plans: { orderBy: { createdAt: 'desc' } },
      dedupOf: { select: { id: true, number: true, title: true, status: true } },
    },
  })
  if (!ticket) return c.json({ error: 'Тикет не найден' }, 404)
  return c.json(ticket)
})

const patchSchema = z.object({
  status: z
    .enum([
      'new', 'triaged', 'needs_info', 'planned', 'approved', 'running',
      'ready_to_deploy', 'deployed', 'closed', 'rejected', 'duplicate', 'waits_human',
    ])
    .optional(),
  kind: z.enum([...KINDS, 'not_a_task']).optional(),
  severity: z.enum(['low', 'normal', 'high']).optional(),
  riskLevel: z.enum(['unknown', 'low', 'medium', 'high']).optional(),
  dedupOfId: z.string().nullable().optional(),
  title: z.string().min(1).max(300).optional(),
})

// PATCH /api/tickets/:id — ведение тикета (веб CF, ночной триаж)
tickets.patch('/:id', async (c) => {
  const user = c.get('user') as AuthUser
  if (!canEdit(user.role, 'tickets', user.sectionAccess)) {
    return c.json({ error: 'Нет прав на изменение тикетов' }, 403)
  }

  const { id } = c.req.param()
  const data = patchSchema.parse(await c.req.json())

  const existing = await db.ticket.findUnique({ where: { id } })
  if (!existing) return c.json({ error: 'Тикет не найден' }, 404)

  if (data.dedupOfId === id) {
    return c.json({ error: 'Тикет не может быть дублем самого себя' }, 400)
  }

  const ticket = await db.ticket.update({
    where: { id },
    data: {
      ...data,
      ...(data.status === 'deployed' && !existing.deployedAt ? { deployedAt: new Date() } : {}),
      ...(data.status === 'closed' && !existing.closedAt ? { closedAt: new Date() } : {}),
    },
  })

  if (data.status && data.status !== existing.status) {
    await db.ticketEvent.create({
      data: {
        ticketId: id,
        kind: 'status_changed',
        message: `Статус: ${existing.status} → ${data.status}`,
        actor: user.name,
      },
    })
  }

  emitEvent({ type: 'ticket_updated', tabId: c.req.header('X-Tab-ID') || '', ticketId: id })
  return c.json(ticket)
})

/**
 * Лимиты вложений по типу. Разные, потому что природа разная: скриншот приходит
 * уже сжатым приложением, голос — короткая реплика, запись экрана — самая тяжёлая
 * и потому самая ограниченная (60 секунд 720p укладываются примерно в 15 МБ).
 */
const ATTACHMENT_LIMITS: Record<string, { maxBytes: number; mimePrefix: string }> = {
  image: { maxBytes: 12 * 1024 * 1024, mimePrefix: 'image/' },
  audio: { maxBytes: 15 * 1024 * 1024, mimePrefix: 'audio/' },
  screen: { maxBytes: 60 * 1024 * 1024, mimePrefix: 'video/' },
}

/** Больше вложений тикету не нужно, а промпт ночного агента не резиновый. */
const MAX_ATTACHMENTS_PER_TICKET = 10

// POST /api/tickets/:id/attachments — скриншот, голос или запись экрана (multipart)
tickets.post('/:id/attachments', async (c) => {
  const { id } = c.req.param()
  const ticket = await db.ticket.findUnique({
    where: { id },
    select: { id: true, businessId: true, reporterName: true },
  })
  if (!ticket) return c.json({ error: 'Тикет не найден' }, 404)

  const body = await c.req.parseBody()
  const file = body['file']
  const kind = String(body['kind'] || 'image')

  if (!file || typeof file === 'string') return c.json({ error: 'Файл не найден' }, 400)

  const limits = ATTACHMENT_LIMITS[kind]
  if (!limits) return c.json({ error: `Неизвестный тип вложения: ${kind}` }, 400)

  const existing = await db.ticketAttachment.count({ where: { ticketId: id } })
  if (existing >= MAX_ATTACHMENTS_PER_TICKET) {
    return c.json({ error: `Максимум ${MAX_ATTACHMENTS_PER_TICKET} вложений на тикет` }, 400)
  }

  const blob = file as File
  if (blob.size > limits.maxBytes) {
    return c.json({ error: `Файл слишком большой (макс. ${Math.round(limits.maxBytes / 1024 / 1024)} МБ)` }, 400)
  }

  const rawExt = extname(blob.name || '.bin').toLowerCase()
  const rawMime = blob.type || ''
  const mimeType =
    rawMime && rawMime !== 'application/octet-stream'
      ? rawMime
      : extensionToMime(rawExt) || 'application/octet-stream'

  // Тип файла обязан соответствовать заявленному виду: иначе «скриншотом» приедет
  // что угодно и попадёт в мультимодальный промпт агента.
  if (!mimeType.startsWith(limits.mimePrefix)) {
    return c.json({ error: `Для «${kind}» ожидается ${limits.mimePrefix}*, а пришло ${mimeType}` }, 400)
  }

  const key = makeKey(ticket.businessId, `ticket-${nanoid(12)}${rawExt || mimeExtension(mimeType)}`)
  const storage = getStorage()
  const saved = await storage.put(key, blob, { contentType: mimeType })

  try {
    const attachment = await db.ticketAttachment.create({
      data: {
        ticketId: id,
        kind,
        storageKey: key,
        mime: mimeType,
        sizeBytes: saved.size,
        durationSec: body['durationSec'] ? Number(body['durationSec']) : null,
        transcript: body['transcript'] ? String(body['transcript']) : null,
        sortOrder: existing,
      },
    })
    emitEvent({ type: 'ticket_updated', tabId: c.req.header('X-Tab-ID') || '', ticketId: id })
    return c.json(attachment, 201)
  } catch (e) {
    // Компенсация: не оставляем объект в хранилище без строки в базе.
    await storage.delete(key)
    throw e
  }
})

const commentSchema = z.object({
  message: z.string().min(1).max(10000),
  actor: z.string().min(1).max(200).optional(),
  kind: z.enum(['comment', 'agent_question', 'agent_answer']).default('comment'),
})

// POST /api/tickets/:id/comments — реплика в ленту тикета
tickets.post('/:id/comments', async (c) => {
  const user = c.get('user') as AuthUser
  const { id } = c.req.param()
  const data = commentSchema.parse(await c.req.json())

  const exists = await db.ticket.findUnique({ where: { id }, select: { id: true } })
  if (!exists) return c.json({ error: 'Тикет не найден' }, 404)

  const event = await db.ticketEvent.create({
    data: {
      ticketId: id,
      kind: data.kind,
      message: data.message,
      // Приложение подставляет своего пользователя, веб CF — залогиненного.
      actor: data.actor ?? user.name,
    },
  })

  emitEvent({ type: 'ticket_updated', tabId: c.req.header('X-Tab-ID') || '', ticketId: id })
  return c.json(event, 201)
})
