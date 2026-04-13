import { Hono } from 'hono'
import { db } from '../db'
import { nanoid } from 'nanoid'
import sharp from 'sharp'
import { join, extname } from 'path'
import { mkdir, unlink, stat } from 'fs/promises'
import { getModuleDir } from '../utils/paths'
import type { AuthUser } from '../middleware/auth'
import { verifyMediaAccess, assertBusinessAccess } from '../middleware/resource-access'

const media = new Hono()

const UPLOAD_DIR = join(getModuleDir(import.meta), '../../uploads')
const THUMB_SIZE = 200
const MAX_FILE_SIZE = 100 * 1024 * 1024 // 100 MB

// POST /api/media/upload — загрузка файла (multipart/form-data)
media.post('/upload', async (c) => {
  const body = await c.req.parseBody()
  const file = body['file']
  const businessId = body['businessId'] as string
  const postId = (body['postId'] as string) || null
  const folderId = (body['folderId'] as string) || null

  if (!file || typeof file === 'string') {
    return c.json({ error: 'Файл не найден' }, 400)
  }
  if (!businessId) {
    return c.json({ error: 'businessId обязателен' }, 400)
  }
  const user = c.get('user') as AuthUser
  try {
    await assertBusinessAccess(user, businessId)
  } catch (e: any) {
    if (e.message === 'FORBIDDEN') return c.json({ error: 'Нет доступа' }, 403)
    throw e
  }

  const blob = file as File
  if (blob.size > MAX_FILE_SIZE) {
    return c.json({ error: 'Файл слишком большой (макс. 100 MB)' }, 400)
  }

  // Determine file type
  const mimeType = blob.type || 'application/octet-stream'
  const ext = extname(blob.name || '.bin') || mimeExtension(mimeType)
  const fileId = nanoid(12)
  const filename = `${fileId}${ext}`
  const thumbFilename = `${fileId}_thumb.webp`

  // Ensure upload dir exists
  const bizDir = join(UPLOAD_DIR, businessId)
  await mkdir(bizDir, { recursive: true })

  // Save original file
  const filePath = join(bizDir, filename)
  const buffer = Buffer.from(await blob.arrayBuffer())
  await Bun.write(filePath, buffer)

  // Generate thumbnail for images
  let thumbUrl: string | null = null
  if (mimeType.startsWith('image/')) {
    try {
      const thumbPath = join(bizDir, thumbFilename)
      await sharp(buffer)
        .resize(THUMB_SIZE, THUMB_SIZE, { fit: 'cover' })
        .webp({ quality: 80 })
        .toFile(thumbPath)
      thumbUrl = `/uploads/${businessId}/${thumbFilename}`
    } catch (e) {
      console.error('Thumbnail generation failed:', e)
    }
  }

  // Generate thumbnail for videos (first frame placeholder)
  if (mimeType.startsWith('video/')) {
    thumbUrl = null // TODO: ffmpeg for video thumbnails
  }

  // Create DB record
  const mediaFile = await db.mediaFile.create({
    data: {
      businessId,
      postId,
      folderId,
      filename: blob.name || filename,
      url: `/uploads/${businessId}/${filename}`,
      thumbUrl,
      mimeType,
      sizeBytes: blob.size,
      sortOrder: 0,
    },
  })

  return c.json(mediaFile, 201)
})

// GET /api/media/library/:bizId — медиа-библиотека бизнеса
media.get('/library/:bizId', async (c) => {
  const { bizId } = c.req.param()
  const type = c.req.query('type') // 'image' | 'video' | undefined (all)
  const tag = c.req.query('tag')
  const search = c.req.query('search')
  const unattached = c.req.query('unattached') === 'true'
  const folderId = c.req.query('folderId') // filter by folder (null = root, specific id = folder)

  const where: Record<string, unknown> = { businessId: bizId }

  if (type === 'image') where.mimeType = { startsWith: 'image/' }
  else if (type === 'video') where.mimeType = { startsWith: 'video/' }

  if (tag) where.tags = { has: tag }
  if (search) where.filename = { contains: search, mode: 'insensitive' }
  if (unattached) where.postId = null

  // Folder filter: 'root' = files without folder, specific id = files in folder
  // No folderId param = all files (for search across folders)
  if (folderId === 'root') {
    where.folderId = null
  } else if (folderId) {
    where.folderId = folderId
  }

  const files = await db.mediaFile.findMany({
    where,
    orderBy: { createdAt: 'desc' },
    take: 200,
    include: {
      post: { select: { id: true, title: true, status: true } },
      folder: { select: { id: true, name: true } },
    },
  })

  return c.json(files)
})

// GET /api/media/tags/:bizId — все уникальные теги бизнеса
media.get('/tags/:bizId', async (c) => {
  const { bizId } = c.req.param()
  const files = await db.mediaFile.findMany({
    where: { businessId: bizId, tags: { isEmpty: false } },
    select: { tags: true },
  })
  const allTags = new Set<string>()
  for (const f of files) f.tags.forEach(t => allTags.add(t))
  return c.json([...allTags].sort())
})

// PUT /api/media/:id/tags — обновить теги файла
media.put('/:id/tags', async (c) => {
  const { id } = c.req.param()
  const user = c.get('user') as AuthUser
  try {
    await verifyMediaAccess(user, id)
  } catch (e: any) {
    if (e.message === 'NOT_FOUND') return c.json({ error: 'Не найдено' }, 404)
    if (e.message === 'FORBIDDEN') return c.json({ error: 'Нет доступа' }, 403)
    throw e
  }
  const { tags } = await c.req.json<{ tags: string[] }>()
  const file = await db.mediaFile.update({
    where: { id },
    data: { tags },
  })
  return c.json(file)
})

// GET /api/media/:id — метаданные файла
media.get('/:id', async (c) => {
  const { id } = c.req.param()
  const user = c.get('user') as AuthUser
  try {
    await verifyMediaAccess(user, id)
  } catch (e: any) {
    if (e.message === 'NOT_FOUND') return c.json({ error: 'Не найдено' }, 404)
    if (e.message === 'FORBIDDEN') return c.json({ error: 'Нет доступа' }, 403)
    throw e
  }
  const file = await db.mediaFile.findUnique({ where: { id } })
  if (!file) return c.json({ error: 'Файл не найден' }, 404)
  return c.json(file)
})

// DELETE /api/media/:id — удаление файла
media.delete('/:id', async (c) => {
  const { id } = c.req.param()
  const user = c.get('user') as AuthUser
  try {
    await verifyMediaAccess(user, id)
  } catch (e: any) {
    if (e.message === 'NOT_FOUND') return c.json({ error: 'Не найдено' }, 404)
    if (e.message === 'FORBIDDEN') return c.json({ error: 'Нет доступа' }, 403)
    throw e
  }
  const file = await db.mediaFile.findUnique({ where: { id } })
  if (!file) return c.json({ error: 'Файл не найден' }, 404)

  // Delete physical files
  try {
    const filePath = join(UPLOAD_DIR, file.url.replace('/uploads/', ''))
    await unlink(filePath).catch(() => {})
    if (file.thumbUrl) {
      const thumbPath = join(UPLOAD_DIR, file.thumbUrl.replace('/uploads/', ''))
      await unlink(thumbPath).catch(() => {})
    }
  } catch (e) {
    console.error('File delete error:', e)
  }

  // Delete DB record
  await db.mediaFile.delete({ where: { id } })
  return c.json({ success: true })
})

// GET /api/posts/:postId/media — медиафайлы поста
media.get('/posts/:postId/media', async (c) => {
  const { postId } = c.req.param()
  const files = await db.mediaFile.findMany({
    where: { postId },
    orderBy: { sortOrder: 'asc' },
  })
  return c.json(files)
})

// POST /api/media/:id/attach — привязать/отвязать файл к посту
media.post('/:id/attach', async (c) => {
  const { id } = c.req.param()
  const user = c.get('user') as AuthUser
  try {
    await verifyMediaAccess(user, id)
  } catch (e: any) {
    if (e.message === 'NOT_FOUND') return c.json({ error: 'Не найдено' }, 404)
    if (e.message === 'FORBIDDEN') return c.json({ error: 'Нет доступа' }, 403)
    throw e
  }
  const { postId } = await c.req.json<{ postId: string | null }>()
  const file = await db.mediaFile.update({
    where: { id },
    data: { postId: postId || null },
  })
  return c.json(file)
})

function mimeExtension(mime: string): string {
  const map: Record<string, string> = {
    'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp',
    'image/gif': '.gif', 'video/mp4': '.mp4', 'video/webm': '.webm',
    'audio/mpeg': '.mp3', 'audio/ogg': '.ogg',
  }
  return map[mime] || '.bin'
}

export { media }
