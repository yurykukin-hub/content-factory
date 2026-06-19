/**
 * Auto-Post API — view and manage auto-posting tasks.
 * Web UI complement to the Telegram approval bot.
 */

import { Hono } from 'hono'
import { db } from '../db'
import { z } from 'zod'

export const autoPost = new Hono()

// GET /api/auto-posts — list tasks with filters
autoPost.get('/', async (c) => {
  const status = c.req.query('status')
  const businessId = c.req.query('businessId')
  const source = c.req.query('source')
  const limit = Math.min(parseInt(c.req.query('limit') || '50'), 100)

  const where: any = {}
  if (status) {
    // Поддержка нескольких статусов через запятую: ?status=proposed,approved
    const statuses = status.split(',').map(s => s.trim()).filter(Boolean)
    where.status = statuses.length > 1 ? { in: statuses } : statuses[0]
  }
  if (businessId) where.businessId = businessId
  if (source) where.source = source

  const tasks = await db.autoPostTask.findMany({
    where,
    orderBy: { createdAt: 'desc' },
    take: limit,
  })

  // Подтянуть превью выбранных фото (Ф1.2) — AutoPostTask.mediaFileId без relation, джойним вручную
  const mediaIds = [...new Set(tasks.map(t => t.mediaFileId).filter(Boolean))] as string[]
  const mediaMap = new Map<string, { id: string; url: string; thumbUrl: string | null; altText: string | null }>()
  if (mediaIds.length) {
    const files = await db.mediaFile.findMany({
      where: { id: { in: mediaIds } },
      select: { id: true, url: true, thumbUrl: true, altText: true },
    })
    files.forEach(f => mediaMap.set(f.id, f))
  }
  const enriched = tasks.map(t => ({ ...t, media: t.mediaFileId ? mediaMap.get(t.mediaFileId) ?? null : null }))

  return c.json(enriched)
})

// POST /api/auto-posts/:id/approve — approve task
autoPost.post('/:id/approve', async (c) => {
  const task = await db.autoPostTask.findUnique({ where: { id: c.req.param('id') } })
  if (!task) return c.json({ error: 'Task not found' }, 404)
  if (task.status !== 'proposed') return c.json({ error: 'Task is not in proposed state' }, 400)

  // Digest-задача: одобрение создаёт ЧЕРНОВИК поста (human-in-the-loop), без авто-публикации
  if (task.source === 'digest') {
    const { approveDigestTask } = await import('../services/daily-digest')
    const res = await approveDigestTask(task)
    return c.json({ ok: true, ...res })
  }

  // Photo-задача: классический флоу (публикация фото) через telegram-approval
  const { handleCallbackQuery } = await import('../services/telegram-approval')
  await handleCallbackQuery({ data: `approve:${task.id}`, message: null, id: '' })
  return c.json({ ok: true })
})

// POST /api/auto-posts/generate-digest — ручной запуск утреннего дайджеста (admin)
autoPost.post('/generate-digest', async (c) => {
  const user = c.get('user') as { role?: string }
  if (user?.role !== 'ADMIN') return c.json({ error: 'Admin only' }, 403)
  const body = await c.req.json().catch(() => ({}))
  const { runDailyDigest } = await import('../services/daily-digest')
  try {
    const res = await runDailyDigest({ businessId: body?.businessId, force: true })
    return c.json({ ok: true, ...res })
  } catch (err: any) {
    return c.json({ ok: false, error: err.message }, 500)
  }
})

// POST /api/auto-posts/collect-competitors — ручной сбор постов конкурентов из VK (admin)
autoPost.post('/collect-competitors', async (c) => {
  const user = c.get('user') as { role?: string }
  if (user?.role !== 'ADMIN') return c.json({ error: 'Admin only' }, 403)
  const { runCompetitorCollection } = await import('../services/competitor-poller')
  try {
    const res = await runCompetitorCollection()
    return c.json({ ok: true, ...res })
  } catch (err: any) {
    return c.json({ ok: false, error: err.message }, 500)
  }
})

// POST /api/auto-posts/:id/reject — reject task
autoPost.post('/:id/reject', async (c) => {
  const task = await db.autoPostTask.findUnique({ where: { id: c.req.param('id') } })
  if (!task) return c.json({ error: 'Task not found' }, 404)

  await db.autoPostTask.update({
    where: { id: task.id },
    data: { status: 'rejected', decidedAt: new Date() },
  })

  return c.json({ ok: true })
})

// POST /api/auto-posts/:id/restore — вернуть отклонённое предложение обратно
autoPost.post('/:id/restore', async (c) => {
  const task = await db.autoPostTask.findUnique({ where: { id: c.req.param('id') } })
  if (!task) return c.json({ error: 'Task not found' }, 404)
  await db.autoPostTask.update({
    where: { id: task.id },
    data: { status: 'proposed', decidedAt: null },
  })
  return c.json({ ok: true })
})

// PATCH /api/auto-posts/:id — заменить выбранное фото предложения (Ф1.2)
autoPost.patch('/:id', async (c) => {
  const task = await db.autoPostTask.findUnique({ where: { id: c.req.param('id') } })
  if (!task) return c.json({ error: 'Task not found' }, 404)

  const parsed = z.object({ mediaFileId: z.string().nullable() }).safeParse(await c.req.json().catch(() => ({})))
  if (!parsed.success) return c.json({ error: 'Invalid body' }, 400)

  // Фото должно принадлежать тому же бизнесу
  if (parsed.data.mediaFileId) {
    const mf = await db.mediaFile.findUnique({ where: { id: parsed.data.mediaFileId }, select: { businessId: true } })
    if (!mf || mf.businessId !== task.businessId) return c.json({ error: 'Media not found in this business' }, 400)
  }

  const updated = await db.autoPostTask.update({
    where: { id: task.id },
    data: { mediaFileId: parsed.data.mediaFileId },
  })
  return c.json(updated)
})

// GET /api/auto-posts/competitor-inspiration?businessId=X — топ «залетевших» постов конкурентов
autoPost.get('/competitor-inspiration', async (c) => {
  const businessId = c.req.query('businessId')
  if (!businessId) return c.json([])
  const { getViralCompetitorPosts } = await import('../services/competitor-poller')
  const posts = await getViralCompetitorPosts(businessId, 7, 5)
  return c.json(posts.map((p: any) => ({
    id: p.id,
    accountName: p.account.displayName,
    text: p.text,
    engagementRate: p.engagementRate,
    likes: p.likes,
    reposts: p.reposts,
    views: p.views,
    externalUrl: p.externalUrl,
  })))
})

// POST /api/auto-posts/generate — manual trigger
autoPost.post('/generate', async (c) => {
  const user = c.get('user') as { role?: string }
  if (user?.role !== 'ADMIN') return c.json({ error: 'Admin only' }, 403)

  const { runAutoPostGeneration } = await import('../services/auto-poster')

  // Run in background
  runAutoPostGeneration().catch(err =>
    console.error('[AutoPost] manual generate error:', err.message)
  )

  return c.json({ ok: true, message: 'Auto-post generation started' })
})

// GET /api/auto-posts/stats — summary stats
autoPost.get('/stats', async (c) => {
  const [proposed, approved, rejected, published] = await Promise.all([
    db.autoPostTask.count({ where: { status: 'proposed' } }),
    db.autoPostTask.count({ where: { status: 'approved' } }),
    db.autoPostTask.count({ where: { status: 'rejected' } }),
    db.autoPostTask.count({ where: { status: 'published' } }),
  ])

  const catalogTotal = await db.photoCatalog.count()
  const catalogAnalyzed = await db.photoCatalog.count({ where: { status: 'analyzed' } })

  return c.json({
    tasks: { proposed, approved, rejected, published },
    catalog: { total: catalogTotal, analyzed: catalogAnalyzed },
  })
})
