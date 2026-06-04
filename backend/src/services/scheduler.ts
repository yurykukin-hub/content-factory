import { db } from '../db'
import { getPublisher } from './publishers/base'
import { checkAndRunAutoPost } from './auto-poster'
import { checkAndRunDailyDigest } from './daily-digest'
import { checkAndRunMetricsCollection } from './metrics-poller'
import { checkAndRunWeeklyAnalysis } from './analytics/analyst-agent'
import { applyUtmForPublish } from './publish-utm'

const CHECK_INTERVAL = 60_000 // каждую минуту

/**
 * Scheduler: проверяет PostVersions со статусом SCHEDULED
 * и публикует те, у которых scheduledAt <= now.
 * Also triggers daily auto-poster check.
 */
export function startPublishScheduler(): ReturnType<typeof setInterval> {
  console.log('[Scheduler] Started — checking every 60s for scheduled posts + daily auto-poster')

  return setInterval(async () => {
    try {
      // Daily auto-poster check (runs at configured time, skips if already ran today)
      await checkAndRunAutoPost().catch(e =>
        console.error('[Scheduler] AutoPoster error:', e.message)
      )
      // Daily morning digest check (НаWоде content agent)
      await checkAndRunDailyDigest().catch(e =>
        console.error('[Scheduler] DailyDigest error:', e.message)
      )
      // SMM metrics collection (VK/IG/Метрика) — в окна metrics_times_utc
      await checkAndRunMetricsCollection().catch(e =>
        console.error('[Scheduler] MetricsCollection error:', e.message)
      )
      // Weekly SMM analyst report (петля обратной связи)
      await checkAndRunWeeklyAnalysis().catch(e =>
        console.error('[Scheduler] WeeklyAnalysis error:', e.message)
      )
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
          const publisher = getPublisher(version.platformAccount.platform, {
            postType: version.post.postType,
            config: version.platformAccount.config,
          })

          // Медиа привязано к посту — догружаем и прокидываем (иначе сторис/фото-пост уедет без медиа)
          const postMedia = await db.mediaFile.findMany({
            where: { postId: version.postId },
            orderBy: { sortOrder: 'asc' },
          })
          const isStories = version.post.postType === 'STORIES'
          // Опции публикации, сохранённые при планировании (кнопка ВК, музыка вшита в видео заранее)
          const opts = (version.publishOptions as Record<string, any> | null) || {}

          // UTM-метки на ссылки бренда (тот же слой, что и при ручной публикации)
          const { text: schedText, storiesOptions: schedStories } = await applyUtmForPublish({
            businessId: version.post.businessId,
            platform: version.platformAccount.platform,
            postType: version.post.postType,
            postId: version.postId,
            text: isStories ? version.post.body : version.body,
            storiesOptions: isStories
              ? {
                  skipOverlay: opts.skipOverlay ?? true,
                  linkText: opts.linkText,
                  linkUrl: opts.linkUrl,
                  photoPosition: opts.photoPosition,
                }
              : undefined,
          })

          const result = await publisher.publish({
            // Для STORIES оверлей-текст = post.body (короткий), медиа уже отрендерено клиентом
            text: schedText,
            hashtags: isStories ? [] : version.hashtags,
            mediaFiles: postMedia.map(m => ({ url: m.url, mimeType: m.mimeType, filename: m.filename })),
            platformAccount: version.platformAccount,
            postType: version.post.postType,
            storiesOptions: schedStories,
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
