import { db } from '../db'
import { getPublisher } from './publishers/base'

const CHECK_INTERVAL = 60_000 // каждую минуту

/**
 * Scheduler: проверяет PostVersions со статусом SCHEDULED
 * и публикует те, у которых scheduledAt <= now.
 */
export function startPublishScheduler(): void {
  console.log('[Scheduler] Started — checking every 60s for scheduled posts')

  setInterval(async () => {
    try {
      const now = new Date()
      const dueVersions = await db.postVersion.findMany({
        where: {
          status: 'SCHEDULED',
          scheduledAt: { lte: now },
        },
        include: {
          post: true,
          platformAccount: true,
        },
      })

      if (dueVersions.length === 0) return

      console.log(`[Scheduler] Found ${dueVersions.length} posts to publish`)

      for (const version of dueVersions) {
        try {
          const publisher = getPublisher(version.platformAccount.platform)
          const result = await publisher.publish({
            text: version.body,
            hashtags: version.hashtags,
            platformAccount: version.platformAccount,
          })

          console.log(`[Scheduler] Published ${version.id} to ${version.platformAccount.platform}: ${result.success}`)

          // Записать лог
          await db.publishLog.create({
            data: {
              postVersionId: version.id,
              status: result.success ? 'SUCCESS' : 'FAILED',
              response: result.rawResponse as any,
              errorMessage: result.error || null,
            },
          })

          // Обновить статус версии
          await db.postVersion.update({
            where: { id: version.id },
            data: {
              status: result.success ? 'PUBLISHED' : 'FAILED',
              publishedAt: result.success ? new Date() : null,
              externalPostId: result.externalPostId || null,
              externalUrl: result.externalUrl || null,
            },
          })

          // Обновить статус поста
          if (result.success) {
            await db.post.update({
              where: { id: version.postId },
              data: { status: 'PUBLISHED' },
            })
          }
        } catch (err) {
          console.error(`[Scheduler] Failed to publish ${version.id}:`, err)
          await db.postVersion.update({
            where: { id: version.id },
            data: { status: 'FAILED' },
          })
          await db.publishLog.create({
            data: {
              postVersionId: version.id,
              status: 'FAILED',
              errorMessage: String(err),
            },
          })
        }
      }
    } catch (err) {
      console.error('[Scheduler] Error:', err)
    }
  }, CHECK_INTERVAL)
}
