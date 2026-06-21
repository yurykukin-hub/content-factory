/**
 * Extract thumbnail from video file using ffmpeg.
 * Takes a frame at 1 second (or 0s for very short videos),
 * converts to WebP via sharp for consistency.
 */

import { exec } from 'child_process'
import { promisify } from 'util'
import { join } from 'path'
import { existsSync, unlinkSync } from 'fs'
import sharp from 'sharp'

const execAsync = promisify(exec)
const THUMB_SIZE = 400

/**
 * Extract a thumbnail from a video file.
 * @param videoPath - absolute path to the video file
 * @param outputDir - directory to save the thumbnail
 * @param prefix - filename prefix for the thumbnail
 * @returns relative URL path to the thumbnail, or null if failed
 */
export async function extractVideoThumbnail(
  videoPath: string,
  outputDir: string,
  prefix: string,
): Promise<string | null> {
  const tempPng = join(outputDir, `${prefix}_raw.png`)
  const thumbFilename = `${prefix}_thumb.webp`
  const thumbPath = join(outputDir, thumbFilename)

  try {
    // Extract frame at 1 second (fallback to 0 for very short videos).
    // -ss ДО -i = fast input seek по ключевому кадру: на больших видео не декодит с начала
    // (раньше -ss после -i декодировал весь поток → тормоза/таймаут). -threads 1 бережёт CPU.
    await execAsync(
      `ffmpeg -y -ss 1 -i "${videoPath}" -frames:v 1 -q:v 2 -threads 1 "${tempPng}"`,
      { timeout: 30000 },
    ).catch(() =>
      // Fallback: видео короче 1с — берём самый первый кадр
      execAsync(
        `ffmpeg -y -i "${videoPath}" -frames:v 1 -q:v 2 -threads 1 "${tempPng}"`,
        { timeout: 30000 },
      ),
    )

    if (!existsSync(tempPng)) return null

    // Convert to WebP thumbnail via sharp
    await sharp(tempPng)
      .resize(THUMB_SIZE, THUMB_SIZE, { fit: 'cover' })
      .webp({ quality: 80 })
      .toFile(thumbPath)

    // Clean up temp file
    try { unlinkSync(tempPng) } catch { /* ignore */ }

    return thumbFilename
  } catch (err) {
    console.error('[VideoThumb] Failed to extract thumbnail:', err)
    // Clean up on error
    try { if (existsSync(tempPng)) unlinkSync(tempPng) } catch { /* ignore */ }
    return null
  }
}
