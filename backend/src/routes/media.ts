import { Hono } from 'hono'
import { db } from '../db'
import { nanoid } from 'nanoid'
import sharp from 'sharp'
import { join, extname } from 'path'
import { unlink } from 'fs/promises'
import { log } from '../utils/logger'
import type { AuthUser } from '../middleware/auth'
import { verifyMediaAccess, assertBusinessAccess } from '../middleware/resource-access'
import { extractVideoThumbnail } from '../utils/video-thumbnail'
import { overlayImageOnVideo, overlayAudioOnVideo } from '../services/video-overlay'
import { renderAndSaveStoryDesign, renderAndSaveCarousel } from '../services/story-design'
import { renderOverlay } from '../services/overlay/render-overlay'
import { normalizeOverlaySpec } from '../services/overlay/overlay-spec'
import { LocalFileScope, getStorage, keyFromUrl, localBizDir, makeKey } from '../services/storage'

const media = new Hono()

const THUMB_SIZE = 200

/**
 * Удалить объект и его превью. БД — источник правды, файлы best-effort: даже если
 * объект не удалился, запись убираем, а сироту логируем (warn), чтобы вычистить диск.
 */
async function deleteMediaObjects(
  file: { url: string; thumbUrl: string | null },
  context: string,
): Promise<void> {
  const storage = getStorage()
  for (const [label, url] of [['file', file.url], ['thumb', file.thumbUrl]] as const) {
    if (!url) continue
    const key = keyFromUrl(url)
    if (!key) {
      log.warn(`${context}: unrecognized media url`, { url })
      continue
    }
    if (!(await storage.delete(key))) {
      log.warn(`${context}: orphan ${label} left on disk`, { key })
    }
  }
}
const MAX_FILE_SIZE = 500 * 1024 * 1024 // 500 MB (рилз/видео туров с телефона)

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
    return c.json({ error: 'Файл слишком большой (макс. 500 MB)' }, 400)
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
  const storage = getStorage()
  const key = makeKey(businessId, filename)

  // Save original file. Blob уходит в хранилище ПОТОКОМ — НЕ материализуем через
  // Buffer.from(arrayBuffer()), который держал ВТОРУЮ полную копию файла в памяти поверх blob.
  // На больших видео (до 500 МБ) это снимает риск OOM на Docker-лимите памяти.
  const saved = await storage.put(key, blob, { contentType: mimeType })

  // Generate thumbnail for images. Пайплайн целиком в буфере: sharp умеет буферы, и только
  // эта форма переносима на объектное хранилище (файловых путей там нет).
  // Плюс НОРМАЛИЗУЕМ ОРИЕНТАЦИЮ самого оригинала: телефоны пишут EXIF-orientation вместо реального
  // поворота пикселей. Соцсети и часть вьюверов EXIF игнорируют → фото «на боку». Запекаем поворот
  // в пиксели ОДИН раз при загрузке, чтобы фото было верным везде (сетка, превью, публикация).
  let thumbKey: string | null = null
  let thumbUrl: string | null = null
  let normalizedSize = saved.size
  if (mimeType.startsWith('image/')) {
    try {
      let srcBuf: Buffer = await storage.get(key)
      const meta = await sharp(srcBuf).metadata()
      // orientation 2..8 = есть EXIF-поворот. Перекодируем только jpeg/png/webp; HEIC/HEIF не трогаем
      // (иначе JPEG-байты окажутся в .heic-файле) — для него нормализуем лишь WebP-thumbnail.
      const reencodable = /jpeg|png|webp/.test(mimeType)
      let thumbSource: sharp.Sharp
      if (meta.orientation && meta.orientation > 1 && reencodable) {
        const fmt = mimeType.includes('png') ? 'png' : mimeType.includes('webp') ? 'webp' : 'jpeg'
        let pipeline = sharp(srcBuf).rotate() // EXIF-ориентацию → в пиксели, EXIF-тег сбрасывается
        pipeline = fmt === 'png' ? pipeline.png() : fmt === 'webp' ? pipeline.webp({ quality: 90 }) : pipeline.jpeg({ quality: 92 })
        srcBuf = await pipeline.toBuffer()
        const renormalized = await storage.put(key, srcBuf, { contentType: mimeType }) // перезапись оригинала (orientation станет 1)
        normalizedSize = renormalized.size
        thumbSource = sharp(srcBuf)
      } else {
        // Нет EXIF-поворота (или HEIC) — оригинал не трогаем (бережём качество JPEG и CPU),
        // thumbnail с .rotate() нормализуется на случай EXIF в исходнике.
        thumbSource = sharp(srcBuf).rotate()
      }
      const thumbBuf = await thumbSource
        .resize(THUMB_SIZE, THUMB_SIZE, { fit: 'cover' })
        .webp({ quality: 80 })
        .toBuffer()
      const k = makeKey(businessId, `${fileId}_thumb.webp`)
      thumbUrl = (await storage.put(k, thumbBuf, { contentType: 'image/webp' })).url
      thumbKey = k
    } catch (e) {
      console.error('Image normalize/thumbnail failed:', e)
    }
  }

  // Generate thumbnail for videos (first frame via ffmpeg — ему нужен файл на диске)
  if (mimeType.startsWith('video/')) {
    const thumb = await storage.withLocalFile(key, async (videoPath) => {
      const bizDir = await localBizDir(businessId) // PHASE-2 DEBT: ffmpeg пишет превью рядом
      const thumbFile = await extractVideoThumbnail(videoPath, bizDir, fileId)
      if (!thumbFile) return null
      const k = makeKey(businessId, thumbFile)
      const put = await storage.putFromLocalFile(k, join(bizDir, thumbFile), { contentType: 'image/webp' })
      return { key: k, url: put.url }
    })
    if (thumb) {
      thumbKey = thumb.key
      thumbUrl = thumb.url
    }
  }

  // Create DB record. Для фото ставим флаг авто-описания (Ф0.2) — фоновый image-describer
  // опишет (altText) для семантического поиска по галерее.
  // Атомарность: если запись в БД упала после сохранения — удаляем объекты, чтобы не плодить сирот.
  let mediaFile
  try {
    mediaFile = await db.mediaFile.create({
      data: {
        businessId,
        postId,
        folderId,
        filename: blob.name || filename,
        url: saved.url,
        thumbUrl,
        mimeType,
        sizeBytes: normalizedSize,
        sortOrder: 0,
        aiModel: mimeType.startsWith('image/') ? 'describe_pending' : null,
      },
    })
  } catch (e) {
    await storage.delete(key)
    if (thumbKey) await storage.delete(thumbKey)
    throw e
  }

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

  // ffmpeg принимает только файлы на диске → материализуем входы через scope,
  // он же освободит их в finally (в Фазе 2 это будут временные копии из S3).
  const inputs = new LocalFileScope()
  const videoPath = await inputs.resolve(videoMf.url)
  if (!videoPath) {
    await inputs.dispose()
    return c.json({ error: 'Файл видео отсутствует на диске' }, 404)
  }

  // Резолвим аудио (опц.): из медиатеки или из музыкальной сессии Sound Studio
  let audioPath: string | null = null
  if (audioMediaFileId) {
    const af = await db.mediaFile.findUnique({ where: { id: audioMediaFileId } })
    if (af && af.businessId === businessId) audioPath = await inputs.resolve(af.url)
  } else if (musicSessionId) {
    const sess = await db.generationSession.findUnique({ where: { id: musicSessionId } })
    if (sess && sess.businessId === businessId) audioPath = await inputs.resolve(sess.audioUrl)
  }

  const bizDir = await localBizDir(businessId)

  const fileId = nanoid(12)
  const overlayTmpPath = join(bizDir, `overlay_${fileId}.png`)
  const outFilename = `story_video_${fileId}.mp4`
  const outPath = join(bizDir, outFilename)

  try {
    // 1. Сохранить временный PNG-слой
    // PHASE-2 DEBT: временный слой для ffmpeg — локальный файл, не объект хранилища.
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

    // 4. Результат ffmpeg — файл на диске; регистрируем его (и превью) как объекты хранилища
    const storage = getStorage()
    const savedOut = await storage.putFromLocalFile(makeKey(businessId, outFilename), outPath, { contentType: 'video/mp4' })
    const savedThumb = thumbFile
      ? await storage.putFromLocalFile(makeKey(businessId, thumbFile), join(bizDir, thumbFile), { contentType: 'image/webp' })
      : null

    // 5. MediaFile (тег story — попадёт в историю + превью поста)
    const mediaFile = await db.mediaFile.create({
      data: {
        businessId,
        filename: `Stories video: ${(videoMf.filename || 'video').slice(0, 40)}`,
        url: savedOut.url,
        thumbUrl: savedThumb ? savedThumb.url : videoMf.thumbUrl,
        mimeType: 'video/mp4',
        sizeBytes: savedOut.size,
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
    await inputs.dispose()
  }
})

// POST /api/media/render-design — Ф2: дизайн-сторис (satori HTML→PNG: фото-фон + текст-оверлей + погодный виджет + CTA)
media.post('/render-design', async (c) => {
  const { mediaFileId, businessId, title, temp, weather, cta, photoPosition } = await c.req.json<{
    mediaFileId: string; businessId: string; title: string; temp?: string; weather?: string; cta?: string; photoPosition?: string
  }>()
  const user = c.get('user') as AuthUser
  try {
    await assertBusinessAccess(user, businessId)
  } catch (e: any) {
    if (e.message === 'FORBIDDEN') return c.json({ error: 'Нет доступа' }, 403)
    throw e
  }

  const src = await db.mediaFile.findUnique({ where: { id: mediaFileId } })
  if (!src) return c.json({ error: 'Фото не найдено' }, 404)

  // Если передан baked-дизайн (переоформление) — берём ИСХОДНОЕ фото, иначе получится дизайн-поверх-дизайна
  let photoUrl = src.url
  let sourceId = src.id
  if (src.tags.includes('story-design') && src.sourceMediaId) {
    const orig = await db.mediaFile.findUnique({ where: { id: src.sourceMediaId } })
    if (orig) { photoUrl = orig.url; sourceId = orig.id }
  }

  try {
    const result = await renderAndSaveStoryDesign({ businessId, photoUrl, title: title || '', temp, weather, cta, photoPosition, sourceMediaId: sourceId })
    if (!result) return c.json({ error: 'Не удалось загрузить фото' }, 400)
    return c.json(result, 201)
  } catch (e: any) {
    console.error('[render-design] failed:', e)
    return c.json({ error: 'Ошибка рендера дизайна: ' + String(e?.message || e).slice(0, 200) }, 500)
  }
})

// POST /api/media/render-overlay — Фаза B: единое запекание из OverlaySpec (фото satori / видео ffmpeg-слой).
// Всегда бейкает из ОРИГИНАЛА (spec.sourceMediaId / fallback mediaId), никогда design-over-design. Идемпотентно.
media.post('/render-overlay', async (c) => {
  const { postId, mediaId, spec, audioMediaFileId, musicSessionId } = await c.req.json<{
    postId?: string; mediaId: string; spec: any; audioMediaFileId?: string; musicSessionId?: string
  }>()
  if (!mediaId) return c.json({ error: 'mediaId обязателен' }, 400)

  const media0 = await db.mediaFile.findUnique({ where: { id: mediaId } })
  if (!media0) return c.json({ error: 'Медиа не найдено' }, 404)
  const businessId = media0.businessId

  const user = c.get('user') as AuthUser
  try {
    await assertBusinessAccess(user, businessId)
  } catch (e: any) {
    if (e.message === 'FORBIDDEN') return c.json({ error: 'Нет доступа' }, 403)
    throw e
  }

  // Нормализуем spec; sourceMediaId по умолчанию — оригинал (если mediaId baked-дизайн, берём его исходник)
  const normalized = normalizeOverlaySpec(spec)
  if (!normalized.sourceMediaId) {
    normalized.sourceMediaId = media0.sourceMediaId || media0.id
  }

  // Если постом управляем — проверяем принадлежность бизнесу
  if (postId) {
    const post = await db.post.findUnique({ where: { id: postId }, select: { businessId: true } })
    if (!post) return c.json({ error: 'Пост не найден' }, 404)
    if (post.businessId !== businessId) return c.json({ error: 'Пост принадлежит другому бизнесу' }, 403)
  }

  try {
    const baked = await renderOverlay(businessId, normalized, { audioMediaFileId, musicSessionId })

    let mediaFileId = baked.id
    if (postId) {
      // Персистим spec на пост + перепривязываем baked-медиа (старые overlay открепляем, не удаляя — без сирот)
      await db.$transaction([
        db.post.update({ where: { id: postId }, data: { overlaySpec: normalized as any } }),
        db.mediaFile.updateMany({ where: { postId, tags: { has: 'overlay' } }, data: { postId: null } }),
        db.mediaFile.update({ where: { id: baked.id }, data: { postId } }),
      ])
    }

    return c.json({ id: baked.id, url: baked.url, thumbUrl: baked.thumbUrl, mimeType: baked.mimeType, mediaFileId, spec: normalized }, 201)
  } catch (e: any) {
    console.error('[render-overlay] failed:', e)
    return c.json({ error: 'Ошибка запекания: ' + String(e?.message || e).slice(0, 200) }, 500)
  }
})

// POST /api/media/render-carousel — Ф2c: серия дизайн-слайдов карусели (4:5) → массив MediaFile
media.post('/render-carousel', async (c) => {
  const { businessId, slides } = await c.req.json<{
    businessId: string
    slides: Array<{ photoMediaId?: string; heading: string; body?: string; kind?: 'cover' | 'content' | 'cta'; cta?: string }>
  }>()
  const user = c.get('user') as AuthUser
  try {
    await assertBusinessAccess(user, businessId)
  } catch (e: any) {
    if (e.message === 'FORBIDDEN') return c.json({ error: 'Нет доступа' }, 403)
    throw e
  }
  if (!Array.isArray(slides) || !slides.length) return c.json({ error: 'Нет слайдов' }, 400)

  // Резолвим фото-фоны слайдов (photoMediaId → url)
  const photoIds = [...new Set(slides.map(s => s.photoMediaId).filter(Boolean))] as string[]
  const photoMap = new Map<string, string>()
  if (photoIds.length) {
    const files = await db.mediaFile.findMany({ where: { id: { in: photoIds } }, select: { id: true, url: true } })
    files.forEach(f => photoMap.set(f.id, f.url))
  }
  const input = slides.map(s => ({
    photoUrl: s.photoMediaId ? photoMap.get(s.photoMediaId) ?? null : null,
    heading: s.heading || '', body: s.body, kind: s.kind, cta: s.cta,
  }))

  try {
    const result = await renderAndSaveCarousel(businessId, input)
    return c.json(result, 201)
  } catch (e: any) {
    console.error('[render-carousel] failed:', e)
    return c.json({ error: 'Ошибка рендера карусели: ' + String(e?.message || e).slice(0, 200) }, 500)
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

  const storage = getStorage()
  const srcKey = keyFromUrl(mf.url)
  const srcBuf = srcKey ? await storage.get(srcKey).catch(() => null) : null
  if (!srcBuf) return c.json({ error: 'Файл отсутствует на диске' }, 404)

  const [w, h] = dims
  const fileId = nanoid(12)
  const outKey = makeKey(businessId, `fit_${ratio.replace(':', 'x')}_${mode}_${fileId}.jpg`)

  try {
    let outBuf: Buffer
    if (mode === 'crop') {
      // Умная обрезка под формат (фокус на значимой области кадра)
      outBuf = await sharp(srcBuf).rotate().resize(w, h, { fit: 'cover', position: sharp.strategy.attention }).jpeg({ quality: 90 }).toBuffer()
    } else {
      // Поля: размытая увеличенная копия как фон + фото целиком по центру (без обрезки)
      const bg = await sharp(srcBuf).rotate().resize(w, h, { fit: 'cover' }).blur(40).modulate({ brightness: 0.85 }).toBuffer()
      const fg = await sharp(srcBuf).rotate().resize(w, h, { fit: 'inside' }).toBuffer()
      outBuf = await sharp(bg).composite([{ input: fg, gravity: 'center' }]).jpeg({ quality: 90 }).toBuffer()
    }
    const savedOut = await storage.put(outKey, outBuf, { contentType: 'image/jpeg' })

    const thumbBuf = await sharp(outBuf).resize(400, 400, { fit: 'cover' }).webp({ quality: 70 }).toBuffer()
    const savedThumb = await storage.put(makeKey(businessId, `fit_${fileId}_thumb.webp`), thumbBuf, { contentType: 'image/webp' })

    const created = await db.mediaFile.create({
      data: {
        businessId,
        postId: postId || null,
        filename: `${ratio} · ${mode === 'crop' ? 'обрезка' : 'размытый фон'}`,
        url: savedOut.url,
        thumbUrl: savedThumb.url,
        mimeType: 'image/jpeg',
        sizeBytes: savedOut.size,
        tags: ['fitted', ratio],
        sortOrder: 0,
      },
    })
    return c.json(created, 201)
  } catch (e: any) {
    await storage.delete(outKey)
    return c.json({ error: 'Ошибка обработки: ' + String(e?.message || e).slice(0, 200) }, 500)
  }
})

// POST /api/media/:id/rotate — повернуть изображение на 90/180/270° (правка на месте).
// Перезаписывает оригинал + регенерирует thumbnail. Связи (postId, attachments) сохраняются.
media.post('/:id/rotate', async (c) => {
  const { id } = c.req.param()
  const user = c.get('user') as AuthUser
  try {
    await verifyMediaAccess(user, id)
  } catch (e: any) {
    if (e.message === 'NOT_FOUND') return c.json({ error: 'Не найдено' }, 404)
    if (e.message === 'FORBIDDEN') return c.json({ error: 'Нет доступа' }, 403)
    throw e
  }

  const { angle } = await c.req.json<{ angle: number }>().catch(() => ({ angle: NaN }))
  if (angle !== 90 && angle !== 180 && angle !== 270) {
    return c.json({ error: 'angle должен быть 90, 180 или 270' }, 400)
  }

  const file = await db.mediaFile.findUnique({ where: { id } })
  if (!file) return c.json({ error: 'Файл не найден' }, 404)
  if (!file.mimeType.startsWith('image/')) return c.json({ error: 'Поворот доступен только для изображений' }, 400)

  const storage = getStorage()
  const srcKey = keyFromUrl(file.url)
  const srcBuf = srcKey ? await storage.get(srcKey).catch(() => null) : null
  if (!srcKey || !srcBuf) return c.json({ error: 'Файл отсутствует на диске' }, 404)

  try {
    // Порядок важен: сначала .rotate() (EXIF-ориентацию → в пиксели), затем .rotate(angle) (наш доворот).
    // Иначе при наличии EXIF получится двойной поворот.
    const fmt = file.mimeType.includes('png') ? 'png' : file.mimeType.includes('webp') ? 'webp' : 'jpeg'
    let pipeline = sharp(srcBuf).rotate().rotate(angle)
    pipeline = fmt === 'png' ? pipeline.png() : fmt === 'webp' ? pipeline.webp({ quality: 90 }) : pipeline.jpeg({ quality: 92 })
    // Весь поворот в буфере: объект перезаписывается ОДНОЙ операцией, а не читается и
    // пишется одновременно (тот же ключ — правка на месте, URL не меняется).
    const outBuf = await pipeline.toBuffer()
    await storage.put(srcKey, outBuf, { contentType: file.mimeType })

    // Регенерируем thumbnail из уже повёрнутого буфера (тот же ключ — перезапись)
    const thumbKey = keyFromUrl(file.thumbUrl)
    if (thumbKey) {
      const thumbBuf = await sharp(outBuf).resize(THUMB_SIZE, THUMB_SIZE, { fit: 'cover' }).webp({ quality: 80 }).toBuffer()
      await storage.put(thumbKey, thumbBuf, { contentType: 'image/webp' })
        .catch((e) => log.warn('rotate: thumb regen failed', { key: thumbKey, error: String(e?.message || e) }))
    }

    const updated = await db.mediaFile.update({ where: { id }, data: { sizeBytes: outBuf.length } })
    // URL не меняется → фронт добавит ?v=<ts> для cache-busting (см. Cache-Control на /uploads/*)
    return c.json({ ...updated, cacheBust: true })
  } catch (e: any) {
    return c.json({ error: 'Ошибка поворота: ' + String(e?.message || e).slice(0, 200) }, 500)
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
  // Поиск по смыслу (Ф0.4): по имени файла, AI-описанию (altText) и тегам.
  if (search) {
    where.OR = [
      { filename: { contains: search, mode: 'insensitive' } },
      { altText: { contains: search, mode: 'insensitive' } },
      { tags: { has: search } },
    ]
  }
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

  // Counts only on first page (no cursor) to avoid extra queries on "load more".
  // Разбивка (фото/видео/без поста) считается по базовому набору без type/postId-фильтров,
  // чтобы цифры были стабильны при переключении таба типа. Снимает 3× O(n) .filter() на фронте.
  let totalCount: number | undefined
  let counts: { images: number; videos: number; unattached: number } | undefined
  if (!cursor) {
    const { mimeType: _mt, postId: _pid, ...base } = where
    const [total, images, videos, unattached] = await Promise.all([
      db.mediaFile.count({ where }),
      db.mediaFile.count({ where: { ...base, mimeType: { startsWith: 'image/' } } }),
      db.mediaFile.count({ where: { ...base, mimeType: { startsWith: 'video/' } } }),
      db.mediaFile.count({ where: { ...base, postId: null } }),
    ])
    totalCount = total
    counts = { images, videos, unattached }
  }

  return c.json({ files, hasMore, ...(totalCount !== undefined ? { totalCount } : {}), ...(counts ? { counts } : {}) })
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

  await deleteMediaObjects(file, 'media delete')

  // Delete DB record
  await db.mediaFile.delete({ where: { id } })
  return c.json({ success: true })
})

// POST /api/media/bulk-delete — массовое удаление выбранных файлов.
// Путь статический (одна секция) → не конфликтует с POST /:id/attach|rotate (две секции).
// Доступ проверяется ПОКАЗАТЕЛЬНО по каждому файлу: недоступные молча пропускаем, не валим всю пачку.
media.post('/bulk-delete', async (c) => {
  const user = c.get('user') as AuthUser
  const { ids } = await c.req.json<{ ids: string[] }>().catch(() => ({ ids: [] as string[] }))
  if (!Array.isArray(ids) || ids.length === 0) return c.json({ error: 'ids обязательны' }, 400)

  const targets = await db.mediaFile.findMany({ where: { id: { in: ids } } })
  let deleted = 0
  for (const file of targets) {
    try {
      await verifyMediaAccess(user, file.id)
    } catch {
      continue // нет доступа к этому файлу — пропускаем
    }
    await deleteMediaObjects(file, 'bulk-delete')
    await db.mediaFile.delete({ where: { id: file.id } })
    deleted++
  }
  return c.json({ success: true, deleted })
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
