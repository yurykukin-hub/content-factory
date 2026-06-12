import { Hono } from 'hono'
import { db } from '../db'
import { nanoid } from 'nanoid'
import sharp from 'sharp'
import { join, extname } from 'path'
import { mkdir, unlink, stat } from 'fs/promises'
import { existsSync } from 'fs'
import { getModuleDir } from '../utils/paths'
import type { AuthUser } from '../middleware/auth'
import { verifyMediaAccess, assertBusinessAccess } from '../middleware/resource-access'
import { extractVideoThumbnail } from '../utils/video-thumbnail'
import { overlayImageOnVideo, overlayAudioOnVideo } from '../services/video-overlay'
import { bakeDesignLayer } from '../services/design-layer'

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

  // Determine file type (prefer extension-based detection when blob.type is missing/generic)
  const rawExt = extname(blob.name || '.bin').toLowerCase()
  const rawMime = blob.type || ''
  const mimeType = (rawMime && rawMime !== 'application/octet-stream')
    ? rawMime
    : extensionToMime(rawExt) || 'application/octet-stream'
  const ext = rawExt || mimeExtension(mimeType)
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

  // Generate thumbnail for videos (first frame via ffmpeg)
  if (mimeType.startsWith('video/')) {
    const thumbFile = await extractVideoThumbnail(filePath, bizDir, fileId)
    if (thumbFile) thumbUrl = `/uploads/${businessId}/${thumbFile}`
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

// POST /api/media/overlay-video — наложить статичный текст-PNG на видео через ffmpeg.
// Body (multipart): overlay (прозрачный PNG) + videoMediaFileId + businessId.
// Видео-сторис: чистое видео (Seedance) → текст накладывается ПОВЕРХ статично → новый mp4.
media.post('/overlay-video', async (c) => {
  const body = await c.req.parseBody()
  const overlay = body['overlay']
  const videoMediaFileId = body['videoMediaFileId'] as string
  const businessId = body['businessId'] as string
  // Опциональная музыка для сторис: из медиатеки (audioMediaFileId) или Sound Studio (musicSessionId)
  const audioMediaFileId = body['audioMediaFileId'] as string | undefined
  const musicSessionId = body['musicSessionId'] as string | undefined

  if (!overlay || typeof overlay === 'string') return c.json({ error: 'overlay PNG не найден' }, 400)
  if (!videoMediaFileId) return c.json({ error: 'videoMediaFileId обязателен' }, 400)
  if (!businessId) return c.json({ error: 'businessId обязателен' }, 400)

  const user = c.get('user') as AuthUser
  try {
    await assertBusinessAccess(user, businessId)
  } catch (e: any) {
    if (e.message === 'FORBIDDEN') return c.json({ error: 'Нет доступа' }, 403)
    throw e
  }

  // Исходное видео должно существовать и принадлежать тому же бизнесу
  const videoMf = await db.mediaFile.findUnique({ where: { id: videoMediaFileId } })
  if (!videoMf || videoMf.businessId !== businessId) return c.json({ error: 'Видео не найдено' }, 404)
  if (!videoMf.mimeType.startsWith('video/')) return c.json({ error: 'Файл не является видео' }, 400)

  const overlayBlob = overlay as File
  if (overlayBlob.type && overlayBlob.type !== 'image/png') {
    return c.json({ error: 'overlay должен быть PNG' }, 400)
  }
  if (overlayBlob.size > 8 * 1024 * 1024) return c.json({ error: 'overlay слишком большой' }, 400)

  const videoPath = join(UPLOAD_DIR, videoMf.url.replace('/uploads/', ''))
  if (!existsSync(videoPath)) return c.json({ error: 'Файл видео отсутствует на диске' }, 404)

  // Резолвим аудио (опц.): из медиатеки или из музыкальной сессии Sound Studio
  let audioPath: string | null = null
  if (audioMediaFileId) {
    const af = await db.mediaFile.findUnique({ where: { id: audioMediaFileId } })
    if (af && af.businessId === businessId) {
      const p = join(UPLOAD_DIR, af.url.replace('/uploads/', ''))
      if (existsSync(p)) audioPath = p
    }
  } else if (musicSessionId) {
    const sess = await db.generationSession.findUnique({ where: { id: musicSessionId } })
    if (sess && sess.businessId === businessId && sess.audioUrl) {
      const p = join(UPLOAD_DIR, sess.audioUrl.replace('/uploads/', ''))
      if (existsSync(p)) audioPath = p
    }
  }

  const bizDir = join(UPLOAD_DIR, businessId)
  await mkdir(bizDir, { recursive: true })

  const fileId = nanoid(12)
  const overlayTmpPath = join(bizDir, `overlay_${fileId}.png`)
  const outFilename = `story_video_${fileId}.mp4`
  const outPath = join(bizDir, outFilename)

  try {
    // 1. Сохранить временный PNG-слой
    await Bun.write(overlayTmpPath, Buffer.from(await overlayBlob.arrayBuffer()))

    // 2. ffmpeg: наложить текст-слой на видео (синхронно, ~3-12 сек)
    if (audioPath) {
      // С музыкой: сначала текст в промежуточный файл, затем вшиваем аудио ("bake once")
      const txtPath = join(bizDir, `story_video_${fileId}_txt.mp4`)
      try {
        await overlayImageOnVideo(videoPath, overlayTmpPath, txtPath)
        await overlayAudioOnVideo(txtPath, audioPath, outPath)
      } finally {
        await unlink(txtPath).catch(() => {})
      }
    } else {
      await overlayImageOnVideo(videoPath, overlayTmpPath, outPath)
    }

    // 3. Thumbnail из готового видео (текст виден на превью)
    const thumbFile = await extractVideoThumbnail(outPath, bizDir, `story_video_${fileId}`)

    // 4. Размер результата
    const { size } = await stat(outPath)

    // 5. MediaFile (тег story — попадёт в историю + превью поста)
    const mediaFile = await db.mediaFile.create({
      data: {
        businessId,
        filename: `Stories video: ${(videoMf.filename || 'video').slice(0, 40)}`,
        url: `/uploads/${businessId}/${outFilename}`,
        thumbUrl: thumbFile ? `/uploads/${businessId}/${thumbFile}` : videoMf.thumbUrl,
        mimeType: 'video/mp4',
        sizeBytes: size,
        durationSec: videoMf.durationSec ?? null,
        tags: ['story'],
        sortOrder: 0,
      },
    })

    return c.json(mediaFile, 201)
  } catch (e: any) {
    await unlink(outPath).catch(() => {}) // подчистить частичный результат
    console.error('[overlay-video] failed:', e)
    return c.json({ error: 'Ошибка наложения текста на видео: ' + String(e?.message || e).slice(0, 200) }, 500)
  } finally {
    await unlink(overlayTmpPath).catch(() => {}) // временный PNG всегда удаляем
  }
})

// POST /api/media/bake-design-layer — единый «запечённый» дизайн-слой (фото ИЛИ видео).
// Прозрачный PNG (текст-дизайн с canvas) запекается: фото→sharp, видео→ffmpeg(+опц.музыка).
media.post('/bake-design-layer', async (c) => {
  const body = await c.req.parseBody()
  const overlay = body['overlay']
  const targetMediaFileId = body['targetMediaFileId'] as string
  const businessId = body['businessId'] as string
  const audioMediaFileId = body['audioMediaFileId'] as string | undefined // видео + музыка из медиатеки
  const musicSessionId = body['musicSessionId'] as string | undefined     // видео + музыка из Sound Studio
  const tagsRaw = (body['tags'] as string | undefined) || 'design'

  if (!overlay || typeof overlay === 'string') return c.json({ error: 'overlay PNG не найден' }, 400)
  if (!targetMediaFileId) return c.json({ error: 'targetMediaFileId обязателен' }, 400)
  if (!businessId) return c.json({ error: 'businessId обязателен' }, 400)

  const user = c.get('user') as AuthUser
  try {
    await assertBusinessAccess(user, businessId)
  } catch (e: any) {
    if (e.message === 'FORBIDDEN') return c.json({ error: 'Нет доступа' }, 403)
    throw e
  }

  const targetMf = await db.mediaFile.findUnique({ where: { id: targetMediaFileId } })
  if (!targetMf || targetMf.businessId !== businessId) return c.json({ error: 'Медиа не найдено' }, 404)
  const isVideo = targetMf.mimeType.startsWith('video/')
  const isImage = targetMf.mimeType.startsWith('image/')
  if (!isVideo && !isImage) return c.json({ error: 'Поддерживаются только фото и видео' }, 400)

  const overlayBlob = overlay as File
  if (overlayBlob.type && overlayBlob.type !== 'image/png') return c.json({ error: 'overlay должен быть PNG' }, 400)
  if (overlayBlob.size > 8 * 1024 * 1024) return c.json({ error: 'overlay слишком большой' }, 400)

  const targetPath = join(UPLOAD_DIR, targetMf.url.replace('/uploads/', ''))
  if (!existsSync(targetPath)) return c.json({ error: 'Файл медиа отсутствует на диске' }, 404)

  // Музыку вшиваем только в видео
  let audioPath: string | null = null
  if (isVideo) {
    if (audioMediaFileId) {
      const af = await db.mediaFile.findUnique({ where: { id: audioMediaFileId } })
      if (af && af.businessId === businessId) {
        const p = join(UPLOAD_DIR, af.url.replace('/uploads/', ''))
        if (existsSync(p)) audioPath = p
      }
    } else if (musicSessionId) {
      const sess = await db.generationSession.findUnique({ where: { id: musicSessionId } })
      if (sess && sess.businessId === businessId && sess.audioUrl) {
        const p = join(UPLOAD_DIR, sess.audioUrl.replace('/uploads/', ''))
        if (existsSync(p)) audioPath = p
      }
    }
  }

  const bizDir = join(UPLOAD_DIR, businessId)
  await mkdir(bizDir, { recursive: true })

  const fileId = nanoid(12)
  const overlayTmpPath = join(bizDir, `overlay_${fileId}.png`)
  const ext = isVideo ? 'mp4' : 'jpg'
  const outFilename = `design_${fileId}.${ext}`
  const outPath = join(bizDir, outFilename)
  const tags = tagsRaw.split(',').map(t => t.trim()).filter(Boolean)

  try {
    await Bun.write(overlayTmpPath, Buffer.from(await overlayBlob.arrayBuffer()))
    await bakeDesignLayer({ targetPath, overlayPath: overlayTmpPath, outPath, isVideo, audioPath })

    // Превью
    let thumbUrl: string | null = null
    if (isVideo) {
      const thumbFile = await extractVideoThumbnail(outPath, bizDir, `design_${fileId}`)
      thumbUrl = thumbFile ? `/uploads/${businessId}/${thumbFile}` : targetMf.thumbUrl
    } else {
      const thumbName = `design_${fileId}_thumb.webp`
      await sharp(outPath).resize(THUMB_SIZE, THUMB_SIZE, { fit: 'cover' }).webp({ quality: 70 }).toFile(join(bizDir, thumbName))
      thumbUrl = `/uploads/${businessId}/${thumbName}`
    }

    const { size } = await stat(outPath)
    const mediaFile = await db.mediaFile.create({
      data: {
        businessId,
        filename: `Design: ${(targetMf.filename || (isVideo ? 'video' : 'photo')).slice(0, 40)}`,
        url: `/uploads/${businessId}/${outFilename}`,
        thumbUrl,
        mimeType: isVideo ? 'video/mp4' : 'image/jpeg',
        sizeBytes: size,
        durationSec: isVideo ? (targetMf.durationSec ?? null) : null,
        tags,
        sortOrder: 0,
      },
    })
    return c.json(mediaFile, 201)
  } catch (e: any) {
    await unlink(outPath).catch(() => {})
    console.error('[bake-design-layer] failed:', e)
    return c.json({ error: 'Ошибка запекания дизайн-слоя: ' + String(e?.message || e).slice(0, 200) }, 500)
  } finally {
    await unlink(overlayTmpPath).catch(() => {})
  }
})

// POST /api/media/fit — подогнать фото под формат: crop (умная обрезка) или pad (поля с размытым фоном)
const FIT_RATIOS: Record<string, [number, number]> = {
  '1:1': [1080, 1080],
  '4:5': [1080, 1350],
  '3:4': [1080, 1440],
  '9:16': [1080, 1920],
  '16:9': [1920, 1080],
}
media.post('/fit', async (c) => {
  const user = c.get('user') as AuthUser
  const { mediaId, businessId, postId, ratio, mode } = await c.req.json<{
    mediaId: string; businessId: string; postId?: string; ratio: string; mode: 'crop' | 'pad'
  }>()
  if (!mediaId || !businessId) return c.json({ error: 'mediaId и businessId обязательны' }, 400)
  const dims = FIT_RATIOS[ratio]
  if (!dims) return c.json({ error: 'Неверное соотношение' }, 400)
  if (mode !== 'crop' && mode !== 'pad') return c.json({ error: 'Неверный режим' }, 400)
  try {
    await assertBusinessAccess(user, businessId)
  } catch (e: any) {
    if (e.message === 'FORBIDDEN') return c.json({ error: 'Нет доступа' }, 403)
    throw e
  }

  const mf = await db.mediaFile.findUnique({ where: { id: mediaId } })
  if (!mf || mf.businessId !== businessId) return c.json({ error: 'Файл не найден' }, 404)
  if (!mf.mimeType.startsWith('image/')) return c.json({ error: 'Подгон формата только для изображений' }, 400)

  const srcPath = join(UPLOAD_DIR, mf.url.replace('/uploads/', ''))
  if (!existsSync(srcPath)) return c.json({ error: 'Файл отсутствует на диске' }, 404)

  const [w, h] = dims
  const bizDir = join(UPLOAD_DIR, businessId)
  await mkdir(bizDir, { recursive: true })
  const fileId = nanoid(12)
  const outName = `fit_${ratio.replace(':', 'x')}_${mode}_${fileId}.jpg`
  const outPath = join(bizDir, outName)

  try {
    let outBuf: Buffer
    if (mode === 'crop') {
      // Умная обрезка под формат (фокус на значимой области кадра)
      outBuf = await sharp(srcPath).rotate().resize(w, h, { fit: 'cover', position: sharp.strategy.attention }).jpeg({ quality: 90 }).toBuffer()
    } else {
      // Поля: размытая увеличенная копия как фон + фото целиком по центру (без обрезки)
      const bg = await sharp(srcPath).rotate().resize(w, h, { fit: 'cover' }).blur(40).modulate({ brightness: 0.85 }).toBuffer()
      const fg = await sharp(srcPath).rotate().resize(w, h, { fit: 'inside' }).toBuffer()
      outBuf = await sharp(bg).composite([{ input: fg, gravity: 'center' }]).jpeg({ quality: 90 }).toBuffer()
    }
    await Bun.write(outPath, outBuf)

    const thumbName = `fit_${fileId}_thumb.webp`
    await sharp(outBuf).resize(400, 400, { fit: 'cover' }).webp({ quality: 70 }).toFile(join(bizDir, thumbName))

    const created = await db.mediaFile.create({
      data: {
        businessId,
        postId: postId || null,
        filename: `${ratio} · ${mode === 'crop' ? 'обрезка' : 'размытый фон'}`,
        url: `/uploads/${businessId}/${outName}`,
        thumbUrl: `/uploads/${businessId}/${thumbName}`,
        mimeType: 'image/jpeg',
        sizeBytes: outBuf.length,
        tags: ['fitted', ratio],
        sortOrder: 0,
      },
    })
    return c.json(created, 201)
  } catch (e: any) {
    await unlink(outPath).catch(() => {})
    return c.json({ error: 'Ошибка обработки: ' + String(e?.message || e).slice(0, 200) }, 500)
  }
})

// GET /api/media/library/:bizId — медиа-библиотека бизнеса (cursor pagination)
media.get('/library/:bizId', async (c) => {
  const { bizId } = c.req.param()
  const type = c.req.query('type') // 'image' | 'video' | undefined (all)
  const tag = c.req.query('tag')
  const search = c.req.query('search')
  const unattached = c.req.query('unattached') === 'true'
  const folderId = c.req.query('folderId') // filter by folder (null = root, specific id = folder)
  const cursor = c.req.query('cursor') // cursor pagination (id of last item)
  const limit = Math.min(Number(c.req.query('limit')) || 40, 100)

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
    take: limit + 1, // fetch one extra to detect hasMore
    ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    include: {
      post: { select: { id: true, title: true, status: true } },
      folder: { select: { id: true, name: true } },
    },
  })

  const hasMore = files.length > limit
  if (hasMore) files.pop()

  // Total count only on first page (no cursor) to avoid extra query on "load more"
  const totalCount = cursor ? undefined : await db.mediaFile.count({ where })

  return c.json({ files, hasMore, ...(totalCount !== undefined ? { totalCount } : {}) })
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
    'image/gif': '.gif', 'image/svg+xml': '.svg', 'image/heic': '.heic',
    'video/mp4': '.mp4', 'video/webm': '.webm', 'video/quicktime': '.mov',
    'video/x-msvideo': '.avi', 'video/x-matroska': '.mkv',
    'audio/mpeg': '.mp3', 'audio/ogg': '.ogg', 'audio/wav': '.wav',
  }
  return map[mime] || '.bin'
}

function extensionToMime(ext: string): string | null {
  const map: Record<string, string> = {
    '.mov': 'video/quicktime', '.mp4': 'video/mp4', '.webm': 'video/webm',
    '.avi': 'video/x-msvideo', '.mkv': 'video/x-matroska', '.m4v': 'video/x-m4v',
    '.wmv': 'video/x-ms-wmv', '.3gp': 'video/3gpp',
    '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png',
    '.webp': 'image/webp', '.gif': 'image/gif', '.heic': 'image/heic',
    '.mp3': 'audio/mpeg', '.ogg': 'audio/ogg', '.wav': 'audio/wav',
  }
  return map[ext.toLowerCase()] || null
}

export { media }
