// Переиспользуемая логика публикации/планирования одной PostVersion.
// Источник правды для: роутов publish.ts (ручная публикация) И прямой публикации из дайджеста (auto-post.ts).
// Вынесено, чтобы три копии логики (роут, дайджест, scheduler) не разошлись.

import { db } from '../db'
import { emitEvent } from '../eventBus'
import { getPublisher } from './publishers/base'
import { applyUtmForPublish } from './publish-utm'

export interface PublishVersionResult {
  success: boolean
  externalUrl: string | null
  error: string | null
  version: any
}

/** Опубликовать одну PostVersion сейчас. Бросает VERSION_NOT_FOUND если версии нет. */
export async function publishPostVersion(
  versionId: string,
  opts: { storiesOptions?: any; tabId?: string } = {},
): Promise<PublishVersionResult> {
  const version = await db.postVersion.findUnique({
    where: { id: versionId },
    include: { platformAccount: true, post: true },
  })
  if (!version) throw new Error('VERSION_NOT_FOUND')

  const mediaFiles = await db.mediaFile.findMany({
    where: { postId: version.postId },
    orderBy: { sortOrder: 'asc' },
  })

  // VK: гибрид — сторис прямой, стена через PMP по флагу config
  const publisher = getPublisher(version.platformAccount.platform, {
    postType: version.post.postType,
    config: version.platformAccount.config,
  })

  const isStories = version.post.postType === 'STORIES'
  // Для Stories overlay-текст = post.body (короткий), не version.body (AI-адаптация)
  const baseText = isStories ? version.post.body : version.body

  // UTM-метки на ссылки бренда (мост к аналитике)
  const { text: publishText, storiesOptions: effectiveStoriesOptions } = await applyUtmForPublish({
    businessId: version.post.businessId,
    platform: version.platformAccount.platform,
    postType: version.post.postType,
    postId: version.postId,
    text: baseText,
    storiesOptions: opts.storiesOptions,
  })

  const result = await publisher.publish({
    text: publishText,
    hashtags: isStories ? [] : version.hashtags,
    mediaFiles: mediaFiles.map(mf => ({ url: mf.url, mimeType: mf.mimeType, filename: mf.filename })),
    platformAccount: version.platformAccount,
    postType: version.post.postType,
    storiesOptions: effectiveStoriesOptions,
  })

  await db.publishLog.create({
    data: {
      postVersionId: versionId,
      status: result.success ? 'SUCCESS' : 'FAILED',
      response: result.rawResponse as any,
      errorMessage: result.error || null,
    },
  })

  const updated = await db.postVersion.update({
    where: { id: versionId },
    data: {
      status: result.success ? 'PUBLISHED' : 'FAILED',
      publishedAt: result.success ? new Date() : null,
      externalPostId: result.externalPostId || null,
      externalUrl: result.externalUrl || null,
    },
    include: { platformAccount: true, post: true },
  })

  if (result.success) {
    await db.post.update({ where: { id: version.postId }, data: { status: 'PUBLISHED' } })
  }

  emitEvent({
    type: result.success ? 'post_published' : 'post_publish_failed',
    tabId: opts.tabId || '',
    postId: version.postId,
  })

  return { success: result.success, externalUrl: result.externalUrl ?? null, error: result.error ?? null, version: updated }
}

/** Запланировать (scheduledAt!=null) или отменить (null) публикацию одной PostVersion + rollup статуса поста. */
export async function schedulePostVersion(
  versionId: string,
  scheduledAt: string | null,
  storiesOptions?: any,
): Promise<any> {
  const version = await db.postVersion.update({
    where: { id: versionId },
    data: scheduledAt
      ? {
          scheduledAt: new Date(scheduledAt),
          status: 'SCHEDULED',
          publishOptions: storiesOptions ?? undefined,
        }
      : { scheduledAt: null, status: 'DRAFT' },
  })

  if (scheduledAt) {
    const p = await db.post.findUnique({ where: { id: version.postId }, select: { status: true } })
    if (p && p.status !== 'PUBLISHED') {
      await db.post.update({ where: { id: version.postId }, data: { status: 'SCHEDULED' } })
    }
  } else {
    const siblings = await db.postVersion.findMany({
      where: { postId: version.postId },
      select: { status: true },
    })
    const rollup = siblings.some(s => s.status === 'PUBLISHED')
      ? 'PUBLISHED'
      : siblings.some(s => s.status === 'SCHEDULED')
        ? 'SCHEDULED'
        : 'DRAFT'
    await db.post.update({ where: { id: version.postId }, data: { status: rollup as any } })
  }
  return version
}
