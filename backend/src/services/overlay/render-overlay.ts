/**
 * Единое ядро запекания (Фаза B): OverlaySpec → satori → запечённый MediaFile.
 * ВСЕГДА бейкает из ОРИГИНАЛА (spec.sourceMediaId), никогда design-over-design.
 * Фото → satori PNG поверх фото. Видео → satori прозрачный слой → ffmpeg overlay (+опц. музыка).
 */
import { db } from '../../db'
import { nanoid } from 'nanoid'
import sharp from 'sharp'
import { join } from 'path'
import { copyFile, unlink } from 'fs/promises'
import { log } from '../../utils/logger'
import { renderToPng, imageToDataUri } from '../html-render'
import { buildStoryDesign, STORY_W, STORY_H } from '../design-templates'
import { savePngAsMedia } from '../story-design'
import { overlayImageOnVideo, overlayAudioOnVideo } from '../video-overlay'
import { extractVideoThumbnail } from '../../utils/video-thumbnail'
import type { OverlaySpec } from './overlay-spec'
import { LocalFileScope, getStorage, localBizDir, makeKey } from '../storage'

const THUMB_SIZE = 200
const OVERLAY_TAGS = ['overlay', 'ai-generated']

export interface RenderOverlayResult {
  id: string
  url: string
  thumbUrl: string | null
  mimeType: string
}

export interface RenderOverlayOpts {
  audioMediaFileId?: string | null  // видео + музыка из медиатеки (парити с overlay-video)
  musicSessionId?: string | null    // видео + музыка из Sound Studio
}

/** Собрать satori-узлы из OverlaySpec (общее для фото и прозрачного видео-слоя). */
function nodeFromSpec(spec: OverlaySpec, photoUri: string | null): any {
  return buildStoryDesign({
    photoUri,
    title: spec.bottomText || '',
    topText: spec.topText || null,
    temp: spec.weather?.temp || null,
    weather: spec.weather?.desc || null,
    weatherShow: spec.weather?.show !== false,
    cta: spec.cta || null,
    promo: spec.promo || null,
    photoPosition: spec.photoPosition,
    font: spec.font,
    template: spec.template,
    cleanTitle: false, // ручной OverlayEditor: не срезаем день недели/температуру — пользователь пишет ровно что хочет
  })
}

/** Материализует аудио для видео (media или sound-сессия) в локальный файл для ffmpeg. */
async function resolveAudioPath(
  businessId: string,
  inputs: LocalFileScope,
  opts?: RenderOverlayOpts,
): Promise<string | null> {
  if (!opts) return null
  if (opts.audioMediaFileId) {
    const af = await db.mediaFile.findUnique({ where: { id: opts.audioMediaFileId } })
    if (af && af.businessId === businessId) return await inputs.resolve(af.url)
  } else if (opts.musicSessionId) {
    const sess = await db.generationSession.findUnique({ where: { id: opts.musicSessionId } })
    if (sess && sess.businessId === businessId) return await inputs.resolve(sess.audioUrl)
  }
  return null
}

/**
 * Запечь OverlaySpec в медиа. Возвращает созданный MediaFile (design_*.png|mp4, теги overlay+ai-generated,
 * sourceMediaId = оригинал). Идемпотентно: всегда из оригинала.
 */
export async function renderOverlay(
  businessId: string,
  spec: OverlaySpec,
  opts?: RenderOverlayOpts,
): Promise<RenderOverlayResult> {
  const original = await db.mediaFile.findUnique({ where: { id: spec.sourceMediaId } })
  if (!original) throw new Error('Исходное медиа не найдено')
  if (original.businessId !== businessId) throw new Error('Медиа принадлежит другому бизнесу')

  const isVideo = original.mimeType.startsWith('video/')
  const isImage = original.mimeType.startsWith('image/')
  if (!isVideo && !isImage) throw new Error('Поддерживаются только фото и видео')

  // ─── ФОТО: satori PNG поверх фото ───
  if (isImage) {
    const photoUri = await imageToDataUri(original.url)
    if (!photoUri) throw new Error('Не удалось загрузить исходное фото')
    const png = await renderToPng(nodeFromSpec(spec, photoUri), STORY_W, STORY_H)
    const saved = await savePngAsMedia(businessId, png, 'Overlay-дизайн', OVERLAY_TAGS, original.id)
    return { id: saved.id, url: saved.url, thumbUrl: saved.thumbUrl, mimeType: 'image/png' }
  }

  // ─── ВИДЕО: прозрачный satori-слой → ffmpeg overlay (+опц. музыка) ───
  const layerPng = await renderToPng(nodeFromSpec(spec, null), STORY_W, STORY_H)

  const bizDir = await localBizDir(businessId)
  const fileId = nanoid(12)
  const layerTmpPath = join(bizDir, `overlay_${fileId}.png`)
  const outFilename = `design_${fileId}.mp4`
  const outPath = join(bizDir, outFilename)
  const audioTmpPath = join(bizDir, `overlay_${fileId}_a.mp4`)

  // ffmpeg принимает только файлы на диске → входы через scope, освобождаются в finally.
  const inputs = new LocalFileScope()
  const srcVideoPath = await inputs.resolve(original.url)
  if (!srcVideoPath) {
    await inputs.dispose()
    throw new Error('Файл видео отсутствует на диске')
  }

  const storage = getStorage()
  try {
    await Bun.write(layerTmpPath, layerPng) // временный слой для ffmpeg (PHASE-2 DEBT: локальный tmp)
    await overlayImageOnVideo(srcVideoPath, layerTmpPath, outPath)

    // Опциональная музыка (парити с overlay-video)
    const audioPath = await resolveAudioPath(businessId, inputs, opts)
    if (audioPath) {
      await overlayAudioOnVideo(outPath, audioPath, audioTmpPath)
      await copyFile(audioTmpPath, outPath) // заменяем результат озвученным (потоком, без подъёма в память)
    }

    // Результаты ffmpeg — файлы на диске; регистрируем их как объекты хранилища.
    const thumbFile = await extractVideoThumbnail(outPath, bizDir, `design_${fileId}`)
    const savedOut = await storage.putFromLocalFile(makeKey(businessId, outFilename), outPath, { contentType: 'video/mp4' })
    const thumbUrl = thumbFile
      ? (await storage.putFromLocalFile(makeKey(businessId, thumbFile), join(bizDir, thumbFile), { contentType: 'image/webp' })).url
      : original.thumbUrl

    const mf = await db.mediaFile.create({
      data: {
        businessId,
        filename: `Overlay: ${(original.filename || 'video').slice(0, 40)}`,
        url: savedOut.url,
        thumbUrl,
        mimeType: 'video/mp4',
        sizeBytes: savedOut.size,
        durationSec: original.durationSec ?? null,
        tags: OVERLAY_TAGS,
        sortOrder: 0,
        sourceMediaId: original.id,
      },
    })
    return { id: mf.id, url: mf.url, thumbUrl: mf.thumbUrl, mimeType: 'video/mp4' }
  } catch (e: any) {
    await unlink(outPath).catch(() => {})
    log.warn('[render-overlay] video bake failed', { error: String(e?.message || e).slice(0, 200) })
    throw e
  } finally {
    await unlink(layerTmpPath).catch(() => {})
    await unlink(audioTmpPath).catch(() => {})
    await inputs.dispose()
  }
}
