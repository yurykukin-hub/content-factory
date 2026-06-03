/**
 * One-time migration: перенос данных из Character.referenceMediaId + additionalAngles
 * в новую таблицу CharacterImage.
 *
 * Запуск: cd backend && bun src/migrate-character-images.ts
 */
import { PrismaClient } from '@prisma/client'

const db = new PrismaClient()

async function main() {
  const characters = await db.character.findMany({
    select: {
      id: true,
      name: true,
      referenceMediaId: true,
      additionalAngles: true,
    },
  })

  console.log(`Found ${characters.length} characters to migrate`)

  let created = 0
  let skipped = 0

  for (const char of characters) {
    // 1. Migrate main photo (referenceMediaId)
    if (char.referenceMediaId) {
      try {
        await db.characterImage.create({
          data: {
            characterId: char.id,
            mediaFileId: char.referenceMediaId,
            isMain: true,
            sortOrder: 0,
            source: 'upload',
          },
        })
        created++
        console.log(`  [${char.name}] main photo migrated`)
      } catch (e: any) {
        if (e.code === 'P2002') {
          skipped++
          console.log(`  [${char.name}] main photo already exists, skipping`)
        } else {
          console.error(`  [${char.name}] error migrating main photo:`, e.message)
        }
      }
    }

    // 2. Migrate additional angles
    const angles = (char.additionalAngles as any[] | null) || []
    for (let i = 0; i < angles.length; i++) {
      const angle = angles[i]
      if (!angle?.url) continue

      // Find MediaFile by URL
      const mediaFile = await db.mediaFile.findFirst({
        where: { url: angle.url },
        select: { id: true },
      })

      if (!mediaFile) {
        console.log(`  [${char.name}] angle ${i + 1}: MediaFile not found for URL ${angle.url}, skipping`)
        skipped++
        continue
      }

      try {
        await db.characterImage.create({
          data: {
            characterId: char.id,
            mediaFileId: mediaFile.id,
            isMain: false,
            sortOrder: i + 1,
            source: 'upload',
          },
        })
        created++
        console.log(`  [${char.name}] angle ${i + 1} migrated`)
      } catch (e: any) {
        if (e.code === 'P2002') {
          skipped++
          console.log(`  [${char.name}] angle ${i + 1} already exists, skipping`)
        } else {
          console.error(`  [${char.name}] error migrating angle ${i + 1}:`, e.message)
        }
      }
    }
  }

  console.log(`\nMigration complete: ${created} created, ${skipped} skipped`)
  console.log('\nNext steps:')
  console.log('1. Verify data: SELECT * FROM character_images;')
  console.log('2. Remove old columns from schema.prisma (referenceMediaId, additionalAngles)')
  console.log('3. Run prisma migrate to drop old columns')
}

main()
  .catch(console.error)
  .finally(() => db.$disconnect())
