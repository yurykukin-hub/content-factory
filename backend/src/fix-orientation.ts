/**
 * One-time migration: запекает EXIF-ориентацию в пиксели для УЖЕ загруженных фото.
 * Чинит и перевёрнутые превьюшки (thumbnail регенерируется из нормализованного буфера),
 * и рассинхрон (когда thumbnail уже норм, а оригинал ещё с EXIF-тегом).
 *
 * Идемпотентность: после нормализации EXIF-orientation становится 1 → повторный прогон всё пропускает.
 * Запуск: bun src/fix-orientation.ts   (на VPS — внутри backend-контейнера, ПОСЛЕ деплоя нормализации upload)
 *
 * Нюанс кэша: URL файла не меняется, /uploads/* отдаётся с Cache-Control max-age=300 →
 * старое (боковое) фото может висеть в браузере до 5 минут. Само пройдёт, либо hard-refresh.
 */

import { db } from './db'
import { join } from 'path'
import { existsSync } from 'fs'
import sharp from 'sharp'
import { getModuleDir } from './utils/paths'

// Поддержка dev (../../uploads) и Docker (/app/uploads) — как в fix-video-thumbs.ts
const devPath = join(getModuleDir(import.meta), '../../uploads')
const UPLOAD_DIR = existsSync('/app/uploads') ? '/app/uploads' : devPath

const THUMB_SIZE = 200 // совпадает с THUMB_SIZE в routes/media.ts (там module-local, не экспортируется)

async function main() {
  const images = await db.mediaFile.findMany({
    where: { mimeType: { startsWith: 'image/' } },
    select: { id: true, url: true, thumbUrl: true, mimeType: true, filename: true },
  })
  console.log(`Found ${images.length} image files to inspect`)

  let rotated = 0, skipped = 0, missing = 0, errored = 0
  let i = 0
  for (const img of images) {
    i++
    const srcPath = join(UPLOAD_DIR, img.url.replace('/uploads/', ''))
    if (!existsSync(srcPath)) {
      missing++
      console.log(`  [${i}/${images.length}] MISSING ${img.filename}`)
      continue
    }
    try {
      const meta = await sharp(srcPath).metadata()
      if (!meta.orientation || meta.orientation <= 1) {
        skipped++ // уже нормальная ориентация — пропускаем (идемпотентность)
        continue
      }
      const reencodable = /jpeg|png|webp/.test(img.mimeType)
      if (!reencodable) {
        // HEIC/HEIF: оригинал не переписываем, чиним только (WebP) thumbnail
        if (img.thumbUrl) {
          const tp = join(UPLOAD_DIR, img.thumbUrl.replace('/uploads/', ''))
          await sharp(srcPath).rotate().resize(THUMB_SIZE, THUMB_SIZE, { fit: 'cover' }).webp({ quality: 80 }).toFile(tp).catch(() => {})
        }
        skipped++
        continue
      }
      const fmt = img.mimeType.includes('png') ? 'png' : img.mimeType.includes('webp') ? 'webp' : 'jpeg'
      let pipeline = sharp(srcPath).rotate() // EXIF-ориентацию → в пиксели
      pipeline = fmt === 'png' ? pipeline.png() : fmt === 'webp' ? pipeline.webp({ quality: 90 }) : pipeline.jpeg({ quality: 92 })
      const buf = await pipeline.toBuffer()
      await Bun.write(srcPath, buf) // перезапись оригинала
      if (img.thumbUrl) {
        const tp = join(UPLOAD_DIR, img.thumbUrl.replace('/uploads/', ''))
        await sharp(buf).resize(THUMB_SIZE, THUMB_SIZE, { fit: 'cover' }).webp({ quality: 80 }).toFile(tp).catch(() => {})
      }
      await db.mediaFile.update({ where: { id: img.id }, data: { sizeBytes: buf.length } })
      rotated++
      console.log(`  [${i}/${images.length}] FIXED ${img.filename} (orient ${meta.orientation})`)
    } catch (e: any) {
      errored++
      console.log(`  [${i}/${images.length}] ERROR ${img.filename}: ${e?.message || e}`)
    }
  }

  console.log(`\nDone. rotated=${rotated} skipped=${skipped} missing=${missing} errored=${errored} total=${images.length}`)
  process.exit(0)
}

main().catch((e) => { console.error('Migration failed:', e); process.exit(1) })
