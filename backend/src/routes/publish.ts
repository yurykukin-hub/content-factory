import { Hono } from 'hono'
import { z } from 'zod'
import { db } from '../db'
import { emitEvent } from '../eventBus'
import { getPublisher } from '../services/publishers/base'
import type { AuthUser } from '../middleware/auth'
import { verifyPostVersionAccess } from '../middleware/resource-access'
import { applyUtmForPublish } from '../services/publish-utm'

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

  const version = await db.postVersion.findUnique({
    where: { id },
    include: { platformAccount: true, post: true },
  })
  if (!version) return c.json({ error: 'Версия поста не найдена' }, 404)

  // Загрузить медиафайлы поста (если есть)
  const mediaFiles = await db.mediaFile.findMany({
    where: { postId: version.postId },
    orderBy: { sortOrder: 'asc' },
  })

  // Получить publisher для платформы и опубликовать
  const publisher = getPublisher(version.platformAccount.platform)

  const isStories = version.post.postType === 'STORIES'
  // Для Stories: overlay текст = post.body (короткий), не version.body (AI-адаптация)
  const baseText = isStories ? version.post.body : version.body

  // UTM-метки на ссылки бренда (мост к аналитике, Эпик B)
  const { text: publishText, storiesOptions: effectiveStoriesOptions } = await applyUtmForPublish({
    businessId: version.post.businessId,
    platform: version.platformAccount.platform,
    postType: version.post.postType,
    postId: version.postId,
    text: baseText,
    storiesOptions,
  })

  const result = await publisher.publish({
    text: publishText,
    hashtags: isStories ? [] : version.hashtags,
    mediaFiles: mediaFiles.map(mf => ({
      url: mf.url,
      mimeType: mf.mimeType,
      filename: mf.filename,
    })),
    platformAccount: version.platformAccount,
    postType: version.post.postType,
    storiesOptions: effectiveStoriesOptions,
  })

  // Записать лог публикации
  await db.publishLog.create({
    data: {
      postVersionId: id,
      status: result.success ? 'SUCCESS' : 'FAILED',
      response: result.rawResponse as any,
      errorMessage: result.error || null,
    },
  })

  // Обновить статус версии
  const updated = await db.postVersion.update({
    where: { id },
    data: {
      status: result.success ? 'PUBLISHED' : 'FAILED',
      publishedAt: result.success ? new Date() : null,
      externalPostId: result.externalPostId || null,
      externalUrl: result.externalUrl || null,
    },
    include: { platformAccount: true, post: true },
  })

  // Обновить статус поста если публикация успешна
  if (result.success) {
    await db.post.update({
      where: { id: version.postId },
      data: { status: 'PUBLISHED' },
    })
  }

  emitEvent({
    type: result.success ? 'post_published' : 'post_publish_failed',
    tabId: c.req.header('X-Tab-ID') || '',
    postId: version.postId,
  })

  return c.json({
    success: result.success,
    version: updated,
    externalUrl: result.externalUrl,
    error: result.error,
  })
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

  // null = отменить планирование
  const version = await db.postVersion.update({
    where: { id },
    data: scheduledAt
      ? {
          scheduledAt: new Date(scheduledAt),
          status: 'SCHEDULED',
          // Сохраняем опции (кнопка ВК, музыка), чтобы они не потерялись при отложке
          publishOptions: storiesOptions ?? undefined,
        }
      : { scheduledAt: null, status: 'DRAFT' },
  })

  // Rollup статуса поста, чтобы списки/фильтры/бейджи отражали реальное состояние
  if (scheduledAt) {
    const p = await db.post.findUnique({ where: { id: version.postId }, select: { status: true } })
    if (p && p.status !== 'PUBLISHED') {
      await db.post.update({ where: { id: version.postId }, data: { status: 'SCHEDULED' } })
    }
  } else {
    // Отмена — пересчитать статус по оставшимся версиям
    const siblings = await db.postVersion.findMany({
      where: { postId: version.postId },
      select: { status: true },
    })
    const rollup = siblings.some(s => s.status === 'PUBLISHED')
      ? 'PUBLISHED'
      : siblings.some(s => s.status === 'SCHEDULED')
        ? 'SCHEDULED'
        : 'DRAFT'
    await db.post.update({ where: { id: version.postId }, data: { status: rollup as any } })
  }

  return c.json(version)
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
