import { Hono } from 'hono'
import { z } from 'zod'
import { db } from '../db'
import { emitEvent } from '../eventBus'

const posts = new Hono()

// GET /api/businesses/:bizId/posts
posts.get('/:bizId/posts', async (c) => {
  const { bizId } = c.req.param()
  const status = c.req.query('status')
  const list = await db.post.findMany({
    where: {
      businessId: bizId,
      ...(status ? { status: status as any } : {}),
    },
    include: {
      versions: {
        include: { platformAccount: { select: { platform: true, accountName: true } } },
      },
      _count: { select: { mediaFiles: true } },
    },
    orderBy: { createdAt: 'desc' },
    take: 50,
  })
  return c.json(list)
})

// GET /api/posts/:id
posts.get('/:id', async (c) => {
  const { id } = c.req.param()
  const post = await db.post.findUnique({
    where: { id },
    include: {
      versions: {
        include: {
          platformAccount: true,
          publishLogs: { orderBy: { attemptedAt: 'desc' }, take: 5 },
        },
      },
      mediaFiles: { orderBy: { sortOrder: 'asc' } },
    },
  })
  if (!post) return c.json({ error: 'Пост не найден' }, 404)
  return c.json(post)
})

const createSchema = z.object({
  businessId: z.string(),
  title: z.string().optional(),
  body: z.string().min(1),
  postType: z.enum(['TEXT', 'PHOTO', 'VIDEO', 'REELS', 'STORIES']).default('TEXT'),
  hashtags: z.array(z.string()).default([]),
})

// POST /api/posts
posts.post('/', async (c) => {
  const data = createSchema.parse(await c.req.json())
  const post = await db.post.create({
    data: { ...data, createdBy: 'manual' },
  })
  emitEvent({ type: 'post_created', tabId: c.req.header('X-Tab-ID') || '', postId: post.id })
  return c.json(post, 201)
})

// PUT /api/posts/:id
posts.put('/:id', async (c) => {
  const { id } = c.req.param()
  const data = await c.req.json()
  const post = await db.post.update({ where: { id }, data })
  emitEvent({ type: 'post_updated', tabId: c.req.header('X-Tab-ID') || '', postId: post.id })
  return c.json(post)
})

// POST /api/posts/:id/approve
posts.post('/:id/approve', async (c) => {
  const { id } = c.req.param()
  const post = await db.post.update({
    where: { id },
    data: { status: 'APPROVED' },
  })
  // Также одобряем все версии
  await db.postVersion.updateMany({
    where: { postId: id, status: 'DRAFT' },
    data: { status: 'APPROVED' },
  })
  emitEvent({ type: 'post_updated', tabId: c.req.header('X-Tab-ID') || '', postId: post.id })
  return c.json(post)
})

// POST /api/posts/:id/versions — создать версию поста для платформы
const versionSchema = z.object({
  platformAccountId: z.string(),
  body: z.string().min(1),
  hashtags: z.array(z.string()).default([]),
})

posts.post('/:id/versions', async (c) => {
  const { id } = c.req.param()
  const post = await db.post.findUnique({ where: { id } })
  if (!post) return c.json({ error: 'Пост не найден' }, 404)

  const data = versionSchema.parse(await c.req.json())

  const version = await db.postVersion.create({
    data: {
      postId: id,
      platformAccountId: data.platformAccountId,
      body: data.body,
      hashtags: data.hashtags,
      status: 'DRAFT',
    },
    include: {
      platformAccount: { select: { platform: true, accountName: true } },
    },
  })

  emitEvent({ type: 'version_created', tabId: c.req.header('X-Tab-ID') || '', postId: id })
  return c.json(version, 201)
})

// DELETE /api/posts/:id
posts.delete('/:id', async (c) => {
  const { id } = c.req.param()
  await db.post.delete({ where: { id } })
  emitEvent({ type: 'post_deleted', tabId: c.req.header('X-Tab-ID') || '', postId: id })
  return c.json({ success: true })
})

export { posts }
