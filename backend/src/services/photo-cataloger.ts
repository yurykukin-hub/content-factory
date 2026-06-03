/**
 * Photo Cataloger — indexes files from Google Photos sync directory.
 *
 * Scans /app/google-photos/ every 10 minutes, creates PhotoCatalog records
 * with metadata (size, date, album, MIME) and thumbnails.
 *
 * NO AI at this stage — just filesystem metadata. AI analysis is triggered
 * separately by auto-poster before generating posts.
 *
 * Privacy: files stay in the private sync directory. Nothing is imported
 * into CF MediaLibrary until explicitly approved by the user.
 */

import { db } from '../db'
import { log } from '../utils/logger'
import { resolve, basename, dirname, extname, join } from 'path'
import { statSync, readdirSync, existsSync, mkdirSync } from 'fs'
import { createHash } from 'crypto'

const CATALOG_INTERVAL = 10 * 60 * 1000  // 10 minutes
const BATCH_SIZE = 50
const GOOGLE_PHOTOS_DIR = process.env.GOOGLE_PHOTOS_DIR || '/app/google-photos'
const THUMBS_DIR = join(GOOGLE_PHOTOS_DIR, '.thumbs')

const SUPPORTED_EXTENSIONS = new Set([
  '.jpg', '.jpeg', '.png', '.heic', '.webp', '.gif',
  '.mp4', '.mov', '.avi', '.mkv', '.3gp',
])

function getMimeType(ext: string): string {
  const map: Record<string, string> = {
    '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png',
    '.heic': 'image/heic', '.webp': 'image/webp', '.gif': 'image/gif',
    '.mp4': 'video/mp4', '.mov': 'video/quicktime', '.avi': 'video/x-msvideo',
    '.mkv': 'video/x-matroska', '.3gp': 'video/3gpp',
  }
  return map[ext.toLowerCase()] || 'application/octet-stream'
}

function isImageMime(mime: string): boolean {
  return mime.startsWith('image/')
}

/** Recursively collect all media files from directory */
function collectFiles(dir: string): string[] {
  const files: string[] = []
  if (!existsSync(dir)) return files

  try {
    const entries = readdirSync(dir, { withFileTypes: true })
    for (const entry of entries) {
      const fullPath = join(dir, entry.name)
      if (entry.name === '.thumbs') continue  // skip thumbs directory
      if (entry.isDirectory()) {
        files.push(...collectFiles(fullPath))
      } else if (entry.isFile()) {
        const ext = extname(entry.name).toLowerCase()
        if (SUPPORTED_EXTENSIONS.has(ext)) {
          files.push(fullPath)
        }
      }
    }
  } catch (err: any) {
    log.error('[Cataloger] readdir error', { dir, error: err.message })
  }

  return files
}

/** Extract album name from file path relative to sync dir */
function extractAlbumName(filePath: string): string | null {
  const relative = filePath.replace(GOOGLE_PHOTOS_DIR + '/', '')
  const parts = relative.split('/')
  // e.g. "Vacation 2026/IMG_001.jpg" -> "Vacation 2026"
  if (parts.length > 1) {
    return parts.slice(0, -1).join('/')
  }
  return null
}

/** Compute MD5 hash of file for deduplication */
async function computeFileHash(filePath: string): Promise<string> {
  const file = Bun.file(filePath)
  const buffer = await file.arrayBuffer()
  const hash = createHash('md5')
  hash.update(Buffer.from(buffer))
  return hash.digest('hex')
}

/** Generate thumbnail for image using sharp */
async function generateImageThumb(filePath: string, thumbName: string): Promise<string | null> {
  try {
    const sharp = (await import('sharp')).default
    const thumbPath = join(THUMBS_DIR, thumbName)
    await sharp(filePath)
      .resize(300, 300, { fit: 'cover' })
      .webp({ quality: 70 })
      .toFile(thumbPath)
    return thumbPath
  } catch (err: any) {
    log.error('[Cataloger] thumb error', { filePath, error: err.message })
    return null
  }
}

/** Generate thumbnail for video using ffmpeg (first frame) */
async function generateVideoThumb(filePath: string, thumbName: string): Promise<string | null> {
  try {
    const thumbPath = join(THUMBS_DIR, thumbName)
    const proc = Bun.spawn([
      'ffmpeg', '-y', '-i', filePath,
      '-vframes', '1', '-ss', '1',
      '-vf', 'scale=300:300:force_original_aspect_ratio=decrease',
      '-f', 'image2', thumbPath.replace('.webp', '.jpg'),
    ], { stdout: 'ignore', stderr: 'ignore' })
    await proc.exited

    // Convert to webp with sharp
    if (existsSync(thumbPath.replace('.webp', '.jpg'))) {
      const sharp = (await import('sharp')).default
      await sharp(thumbPath.replace('.webp', '.jpg'))
        .webp({ quality: 70 })
        .toFile(thumbPath)
      // Clean up intermediate jpg
      try { await Bun.write(thumbPath.replace('.webp', '.jpg'), '') } catch {}
      return thumbPath
    }
    return null
  } catch (err: any) {
    log.error('[Cataloger] video thumb error', { filePath, error: err.message })
    return null
  }
}

async function catalogNewFiles() {
  if (!existsSync(GOOGLE_PHOTOS_DIR)) {
    return  // sync directory doesn't exist yet — skip silently
  }

  // Ensure thumbs directory exists
  if (!existsSync(THUMBS_DIR)) {
    mkdirSync(THUMBS_DIR, { recursive: true })
  }

  // Collect all media files
  const allFiles = collectFiles(GOOGLE_PHOTOS_DIR)
  if (allFiles.length === 0) return

  // Find which files are already cataloged
  const existingPaths = new Set(
    (await db.photoCatalog.findMany({
      select: { filePath: true },
    })).map(r => r.filePath)
  )

  // Filter to new files only
  const newFiles = allFiles.filter(f => !existingPaths.has(f))
  if (newFiles.length === 0) return

  // Process in batch
  const batch = newFiles.slice(0, BATCH_SIZE)
  log.info('[Cataloger] processing batch', { total: newFiles.length, batch: batch.length })

  for (const filePath of batch) {
    try {
      const stat = statSync(filePath)
      const ext = extname(filePath).toLowerCase()
      const mime = getMimeType(ext)
      const albumName = extractAlbumName(filePath)
      const fileDate = stat.mtime

      // Generate thumbnail
      const thumbName = `${createHash('md5').update(filePath).digest('hex').slice(0, 16)}.webp`
      let thumbPath: string | null = null

      if (isImageMime(mime)) {
        thumbPath = await generateImageThumb(filePath, thumbName)
      } else {
        thumbPath = await generateVideoThumb(filePath, thumbName)
      }

      await db.photoCatalog.create({
        data: {
          filePath,
          fileSize: stat.size,
          mimeType: mime,
          fileDate,
          albumName,
          thumbPath,
          status: 'indexed',
        },
      })
    } catch (err: any) {
      // Skip duplicates (unique constraint on filePath) and other errors
      if (!err.message?.includes('Unique constraint')) {
        log.error('[Cataloger] index error', { filePath, error: err.message })
      }
    }
  }

  log.info('[Cataloger] batch done', { indexed: batch.length, remaining: newFiles.length - batch.length })
}

export function startPhotoCataloger(): ReturnType<typeof setInterval> {
  log.info('[Cataloger] started', { interval: '10min', dir: GOOGLE_PHOTOS_DIR })

  // Run once on startup (delayed 30s to let DB connect)
  setTimeout(() => {
    catalogNewFiles().catch(e => log.error('[Cataloger] initial error', { error: e.message }))
  }, 30_000)

  return setInterval(() => {
    catalogNewFiles().catch(e => log.error('[Cataloger] poll error', { error: e.message }))
  }, CATALOG_INTERVAL)
}
