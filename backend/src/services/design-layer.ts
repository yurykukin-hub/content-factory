/**
 * Единый «запечённый» дизайн-слой (Фаза 1, ядро).
 *
 * Прозрачный PNG (текст/дизайн из canvas-редактора) запекается в медиа:
 *  - ФОТО  → sharp.composite (слой масштабируется под размер фото)
 *  - ВИДЕО → ffmpeg overlay (переиспользуем video-overlay.ts) + опц. музыка («bake once»)
 *
 * Один редактор слоя → один bake → любой тип контента (сторис/фото-пост/видео-пост).
 * Надёжнее «нативного» оверлея: детерминированный результат, переживает каналы.
 */
import sharp from 'sharp'
import { unlink } from 'fs/promises'
import { existsSync } from 'fs'
import { overlayImageOnVideo, overlayAudioOnVideo } from './video-overlay'

/**
 * Запечь прозрачный PNG-слой в ФОТО через sharp.
 * Слой ресайзится под точные размеры фото (редактор проектирует слой в том же аспекте).
 * @param photoPath   абсолютный путь к исходному фото
 * @param overlayPath абсолютный путь к прозрачному PNG (текст-дизайн)
 * @param outPath     абсолютный путь для результата (.jpg)
 */
export async function bakeDesignLayerOnPhoto(
  photoPath: string,
  overlayPath: string,
  outPath: string,
): Promise<void> {
  // Применяем EXIF-ориентацию и берём итоговые (display) размеры — те же, что видит редактор.
  const base = await sharp(photoPath).rotate().toBuffer({ resolveWithObject: true })
  const w = base.info.width
  const h = base.info.height

  // Слой проектируется в том же аспекте, что и фото → fill по точным display-размерам.
  const overlayResized = await sharp(overlayPath)
    .resize(w, h, { fit: 'fill' })
    .png()
    .toBuffer()

  await sharp(base.data)
    .composite([{ input: overlayResized, blend: 'over' }])
    .jpeg({ quality: 92 })
    .toFile(outPath)

  if (!existsSync(outPath)) {
    throw new Error('sharp завершился, но выходной файл не создан')
  }
}

/**
 * Запечь дизайн-слой в медиа любого типа.
 * Видео: PNG-слой + опц. музыка (bake once). Фото: sharp composite.
 */
export async function bakeDesignLayer(opts: {
  targetPath: string
  overlayPath: string
  outPath: string
  isVideo: boolean
  audioPath?: string | null
}): Promise<void> {
  const { targetPath, overlayPath, outPath, isVideo, audioPath } = opts

  if (!isVideo) {
    await bakeDesignLayerOnPhoto(targetPath, overlayPath, outPath)
    return
  }

  // Видео: текст-слой, затем (опц.) вшиваем музыку через промежуточный файл.
  if (audioPath) {
    const txtPath = outPath.replace(/\.(mp4|mov|webm)$/i, '_txt.mp4')
    try {
      await overlayImageOnVideo(targetPath, overlayPath, txtPath)
      await overlayAudioOnVideo(txtPath, audioPath, outPath)
    } finally {
      await unlink(txtPath).catch(() => {})
    }
  } else {
    await overlayImageOnVideo(targetPath, overlayPath, outPath)
  }
}
