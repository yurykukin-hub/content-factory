import { Hono } from 'hono'
import { db } from '../db'
import { emitEvent } from '../eventBus'
import { getPublisher } from '../services/publishers/base'

const publish = new Hono()

// POST /api/post-versions/:id/publish — опубликовать сейчас
publish.post('/post-versions/:id/publish', async (c) => {
  const { id } = c.req.param()
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

  // Для Stories: overlay текст = post.body (короткий), не version.body (AI-адаптация)
  const publishText = version.post.postType === 'STORIES' ? version.post.body : version.body

  const result = await publisher.publish({
    text: publishText,
    hashtags: version.post.postType === 'STORIES' ? [] : version.hashtags,
    mediaFiles: mediaFiles.map(mf => ({
      url: mf.url,
      mimeType: mf.mimeType,
      filename: mf.filename,
    })),
    platformAccount: version.platformAccount,
    postType: version.post.postType,
    storiesOptions,
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
  const { scheduledAt } = await c.req.json<{ scheduledAt: string }>()

  const version = await db.postVersion.update({
    where: { id },
    data: {
      scheduledAt: new Date(scheduledAt),
      status: 'SCHEDULED',
    },
  })

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
