/**
 * One-time migration: fix mimeType for existing files
 * stored as 'application/octet-stream' by detecting from filename extension.
 *
 * Run: cd backend && bun src/fix-mime-types.ts
 * Safe & idempotent — re-running does nothing if already fixed.
 */
import { db } from './db'

const EXT_TO_MIME: Record<string, string> = {
  // Video
  '.mov': 'video/quicktime',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.avi': 'video/x-msvideo',
  '.mkv': 'video/x-matroska',
  '.wmv': 'video/x-ms-wmv',
  '.m4v': 'video/x-m4v',
  '.3gp': 'video/3gpp',
  // Image
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.heic': 'image/heic',
  // Audio
  '.mp3': 'audio/mpeg',
  '.ogg': 'audio/ogg',
  '.wav': 'audio/wav',
}

async function main() {
  const broken = await db.mediaFile.findMany({
    where: { mimeType: 'application/octet-stream' },
    select: { id: true, filename: true, mimeType: true },
  })

  console.log(`Found ${broken.length} files with application/octet-stream`)

  if (broken.length === 0) {
    console.log('Nothing to fix!')
    process.exit(0)
  }

  let fixed = 0
  let skipped = 0
  for (const file of broken) {
    const dotIdx = file.filename.lastIndexOf('.')
    if (dotIdx === -1) {
      console.log(`  SKIP: ${file.filename} (no extension)`)
      skipped++
      continue
    }
    const ext = file.filename.slice(dotIdx).toLowerCase()
    const correctMime = EXT_TO_MIME[ext]
    if (!correctMime) {
      console.log(`  SKIP: ${file.filename} (unknown ext: ${ext})`)
      skipped++
      continue
    }
    await db.mediaFile.update({
      where: { id: file.id },
      data: { mimeType: correctMime },
    })
    console.log(`  FIXED: ${file.filename} -> ${correctMime}`)
    fixed++
  }

  console.log(`\nDone. Fixed ${fixed}, skipped ${skipped}, total ${broken.length}.`)
  process.exit(0)
}

main().catch(e => {
  console.error('Migration failed:', e)
  process.exit(1)
})
