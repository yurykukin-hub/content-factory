/**
 * One-time script: generate thumbnails for existing video files missing thumbUrl.
 * Run: bun src/fix-video-thumbs.ts
 */

import { db } from './db'
import { join, resolve } from 'path'
import { existsSync } from 'fs'
import { extractVideoThumbnail } from './utils/video-thumbnail'
import { getModuleDir } from './utils/paths'
import { nanoid } from 'nanoid'

// Support both dev (../../uploads) and Docker (/app/uploads)
const devPath = join(getModuleDir(import.meta), '../../uploads')
const UPLOAD_DIR = existsSync('/app/uploads') ? '/app/uploads' : devPath

async function main() {
  const videos = await db.mediaFile.findMany({
    where: {
      mimeType: { startsWith: 'video/' },
      thumbUrl: null,
    },
    select: { id: true, url: true, businessId: true, filename: true },
  })

  console.log(`Found ${videos.length} videos without thumbnails`)

  let fixed = 0
  for (const video of videos) {
    // Extract local path from URL: /uploads/bizId/file.mp4
    const localPath = join(UPLOAD_DIR, video.url.replace('/uploads/', ''))
    if (!existsSync(localPath)) {
      console.log(`  SKIP ${video.filename} — file not found: ${localPath}`)
      continue
    }

    const bizDir = join(UPLOAD_DIR, video.businessId)
    const prefix = `thumb_${nanoid(8)}`
    const thumbFile = await extractVideoThumbnail(localPath, bizDir, prefix)

    if (thumbFile) {
      await db.mediaFile.update({
        where: { id: video.id },
        data: { thumbUrl: `/uploads/${video.businessId}/${thumbFile}` },
      })
      fixed++
      console.log(`  ✓ ${video.filename} → ${thumbFile}`)
    } else {
      console.log(`  ✗ ${video.filename} — failed to extract`)
    }
  }

  console.log(`\nDone: ${fixed}/${videos.length} thumbnails generated`)
  process.exit(0)
}

main().catch(console.error)
