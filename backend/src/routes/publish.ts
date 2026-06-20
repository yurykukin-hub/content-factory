import { Hono } from 'hono'
import { z } from 'zod'
import { db } from '../db'
import { emitEvent } from '../eventBus'
import type { AuthUser } from '../middleware/auth'
import { verifyPostVersionAccess } from '../middleware/resource-access'
import { publishPostVersion, schedulePostVersion } from '../services/publish-runner'

const publish = new Hono()

// Опции публикации сторис, сохраняемые для отложенной публикации (кнопка ВК, музыка)
const storiesOptionsSchema = z
  .object({
    skipOverlay: z.boolean().optional(),
    linkText: z.string().optional(),
    linkUrl: z.string().optional(),
    photoPosition: z.string().optional(),
    audioUrl: z.string().optional(),
    musicSessionId: z.string().optional(),
  })
  .optional()

const scheduleSchema = z.object({
  scheduledAt: z.string().nullable(),
  storiesOptions: storiesOptionsSchema,
})

// POST /api/post-versions/:id/publish — опубликовать сейчас
publish.post('/post-versions/:id/publish', async (c) => {
  const { id } = c.req.param()
  const user = c.get('user') as AuthUser
  try {
    await verifyPostVersionAccess(user, id)
  } catch (e: any) {
    if (e.message === 'NOT_FOUND') return c.json({ error: 'Не найдено' }, 404)
    if (e.message === 'FORBIDDEN') return c.json({ error: 'Нет доступа' }, 403)
    throw e
  }
  // Принимаем опциональные storiesOptions из body
  let storiesOptions: any = undefined
  try {
    const body = await c.req.json()
    storiesOptions = body?.storiesOptions
  } catch {} // Body может быть пустым

  try {
    const result = await publishPostVersion(id, { storiesOptions, tabId: c.req.header('X-Tab-ID') || '' })
    return c.json({
      success: result.success,
      version: result.version,
      externalUrl: result.externalUrl,
      error: result.error,
    })
  } catch (e: any) {
    if (e.message === 'VERSION_NOT_FOUND') return c.json({ error: 'Версия поста не найдена' }, 404)
    throw e
  }
})

// POST /api/post-versions/:id/schedule — запланировать публикацию
publish.post('/post-versions/:id/schedule', async (c) => {
  const { id } = c.req.param()
  const user = c.get('user') as AuthUser
  try {
    await verifyPostVersionAccess(user, id)
  } catch (e: any) {
    if (e.message === 'NOT_FOUND') return c.json({ error: 'Не найдено' }, 404)
    if (e.message === 'FORBIDDEN') return c.json({ error: 'Нет доступа' }, 403)
    throw e
  }
  const raw = await c.req.json().catch(() => ({ scheduledAt: null }))
  const parsed = scheduleSchema.safeParse(raw)
  if (!parsed.success) {
    return c.json({ error: 'Неверные данные', details: parsed.error.flatten() }, 400)
  }
  const { scheduledAt, storiesOptions } = parsed.data
  const version = await schedulePostVersion(id, scheduledAt, storiesOptions)
  return c.json(version)
})

// PUT /api/post-versions/:id — обновить per-channel оверрайд (текст/хештеги) — модель master/override (Phase 4)
const updateVersionSchema = z.object({
  body: z.string().min(1).optional(),
  hashtags: z.array(z.string()).optional(),
})
publish.put('/post-versions/:id', async (c) => {
  const { id } = c.req.param()
  const user = c.get('user') as AuthUser
  try {
    await verifyPostVersionAccess(user, id)
  } catch (e: any) {
    if (e.message === 'NOT_FOUND') return c.json({ error: 'Не найдено' }, 404)
    if (e.message === 'FORBIDDEN') return c.json({ error: 'Нет доступа' }, 403)
    throw e
  }
  const existing = await db.postVersion.findUnique({ where: { id } })
  if (!existing) return c.json({ error: 'Версия не найдена' }, 404)
  if (existing.status === 'PUBLISHED') return c.json({ error: 'Опубликованную версию нельзя изменить' }, 409)

  const data = updateVersionSchema.parse(await c.req.json())
  const updated = await db.postVersion.update({
    where: { id },
    // если версия падала — правка возвращает её в черновик
    data: { ...data, ...(existing.status === 'FAILED' ? { status: 'DRAFT' as const } : {}) },
    include: { platformAccount: { select: { platform: true, accountName: true } } },
  })
  emitEvent({ type: 'post_updated', tabId: c.req.header('X-Tab-ID') || '', postId: existing.postId })
  return c.json(updated)
})

// DELETE /api/post-versions/:id — сбросить оверрайд к мастер-тексту (удалить версию) — Phase 4
publish.delete('/post-versions/:id', async (c) => {
  const { id } = c.req.param()
  const user = c.get('user') as AuthUser
  try {
    await verifyPostVersionAccess(user, id)
  } catch (e: any) {
    if (e.message === 'NOT_FOUND') return c.json({ error: 'Не найдено' }, 404)
    if (e.message === 'FORBIDDEN') return c.json({ error: 'Нет доступа' }, 403)
    throw e
  }
  const existing = await db.postVersion.findUnique({ where: { id } })
  if (!existing) return c.json({ error: 'Версия не найдена' }, 404)
  if (existing.status === 'PUBLISHED' || existing.status === 'SCHEDULED') {
    return c.json({ error: 'Нельзя сбросить опубликованную/запланированную версию' }, 409)
  }
  await db.postVersion.delete({ where: { id } })
  emitEvent({ type: 'post_updated', tabId: c.req.header('X-Tab-ID') || '', postId: existing.postId })
  return c.json({ success: true })
})

// POST /api/webhooks/erp — webhook приёмник от ERP
publish.post('/webhooks/erp', async (c) => {
  const secret = c.req.header('X-Webhook-Secret')
  const body = await c.req.json<{
    event: string
    business_slug: string
    data: Record<string, unknown>
  }>()

  // Найти бизнес по slug + проверить secret
  const biz = await db.business.findUnique({ where: { slug: body.business_slug } })
  if (!biz || biz.erpApiKey !== secret) {
    return c.json({ error: 'Unauthorized' }, 401)
  }

  // TODO: найти WebhookRule, сгенерировать пост
  console.log(`[Webhook] ${body.event} from ${body.business_slug}:`, body.data)

  return c.json({ received: true })
})

export { publish }
