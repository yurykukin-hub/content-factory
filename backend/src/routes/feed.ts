/**
 * Feed API — единый кокпит «Лента»: сливает Контент (Post) и Дайджест (AutoPostTask)
 * в один нормализованный список. Заменяет два list-endpoint'а (GET /auto-posts + /businesses/:id/posts)
 * для FeedView. Старые эндпоинты остаются рабочими до миграции фронта.
 */

import { Hono } from 'hono'
import { db } from '../db'
import type { AuthUser } from '../middleware/auth'
import { assertBusinessAccess } from '../middleware/resource-access'
import { canPublishNow } from '../services/can-publish'

export const feed = new Hono()

type FeedStatus = 'proposed' | 'draft' | 'scheduled' | 'published'

interface MediaPreview {
  id?: string
  url: string
  thumbUrl: string | null
  altText: string | null
  tags?: string[]
}

interface PlatformPreview {
  platform: string
  accountName: string
  text: string
  hashtags: string[]
}

interface FeedItem {
  kind: 'proposal' | 'post'
  id: string
  postId?: string
  taskId?: string
  status: FeedStatus
  postType: string
  title: string | null
  text: string
  previews: PlatformPreview[]
  media: MediaPreview[]
  platforms: string[]
  canPublishNow: { ok: boolean; reason?: string }
  createdAt: Date
  aiReasoning?: string | null
}

/** Post.status + версии → единый словарь кокпита. */
function derivePostStatus(postStatus: string, versions: { status: string }[]): FeedStatus {
  if (postStatus === 'PUBLISHED' || versions.some(v => v.status === 'PUBLISHED')) return 'published'
  if (postStatus === 'SCHEDULED' || versions.some(v => v.status === 'SCHEDULED')) return 'scheduled'
  return 'draft'
}

// GET /api/feed?businessId=&status=
feed.get('/', async (c) => {
  const user = c.get('user') as AuthUser
  const businessId = c.req.query('businessId')
  const statusFilter = c.req.query('status') as FeedStatus | undefined

  if (!businessId) return c.json({ error: 'businessId обязателен' }, 400)

  try {
    await assertBusinessAccess(user, businessId)
  } catch (e: any) {
    if (e.message === 'FORBIDDEN') return c.json({ error: 'Нет доступа' }, 403)
    throw e
  }

  // accountName per (business, platform) для превью «как в соцсети»
  const accounts = await db.platformAccount.findMany({
    where: { businessId, isActive: true },
    select: { platform: true, accountName: true },
  })
  const acctMap = new Map<string, string>()
  accounts.forEach(a => acctMap.set(a.platform, a.accountName))

  // --- Предложения: AutoPostTask (digest, proposed, ещё НЕ ставшие Post'ом) ---
  // Дедуп: postId=null гарантирует, что одобренные (уже Post) не покажутся дважды.
  const tasks = await db.autoPostTask.findMany({
    where: { businessId, source: 'digest', status: 'proposed', postId: null },
    orderBy: { createdAt: 'desc' },
  })

  const taskMediaIds = [...new Set(tasks.map(t => t.mediaFileId).filter(Boolean))] as string[]
  const mediaMap = new Map<string, MediaPreview>()
  if (taskMediaIds.length) {
    const files = await db.mediaFile.findMany({
      where: { id: { in: taskMediaIds } },
      select: { id: true, url: true, thumbUrl: true, altText: true, tags: true },
    })
    files.forEach(f => mediaMap.set(f.id, f))
  }

  const proposalItems: FeedItem[] = tasks.map(t => {
    const adaptations = Array.isArray(t.adaptations) ? (t.adaptations as any[]) : []
    const platforms = t.platforms || []
    const previews: PlatformPreview[] = platforms.map(platform => {
      const ad = adaptations.find((a: any) => a?.platform === platform)
      return {
        platform,
        accountName: acctMap.get(platform) || platform,
        text: ad?.text || t.proposedText,
        hashtags: ad?.hashtags ?? t.proposedTags ?? [],
      }
    })
    const mf = t.mediaFileId ? mediaMap.get(t.mediaFileId) : null
    const media: MediaPreview[] = mf ? [mf] : []
    return {
      kind: 'proposal',
      id: t.id,
      taskId: t.id,
      status: 'proposed',
      postType: t.postType || 'STORIES',
      title: t.title ?? null,
      text: t.proposedText,
      previews,
      media,
      platforms,
      canPublishNow: canPublishNow({ postType: t.postType, text: t.proposedText, platforms, media, previews }),
      createdAt: t.createdAt,
      aiReasoning: t.aiReasoning ?? null,
    }
  })

  // --- Посты: Post (любой статус) + версии + медиа ---
  const posts = await db.post.findMany({
    where: { businessId },
    include: {
      versions: {
        include: { platformAccount: { select: { platform: true, accountName: true } } },
      },
      mediaFiles: { orderBy: { sortOrder: 'asc' }, select: { id: true, url: true, thumbUrl: true, altText: true, tags: true } },
    },
    orderBy: { createdAt: 'desc' },
  })

  const postItems: FeedItem[] = posts.map(p => {
    const previews: PlatformPreview[] = p.versions.map(v => ({
      platform: v.platformAccount.platform,
      accountName: acctMap.get(v.platformAccount.platform) || v.platformAccount.accountName || v.platformAccount.platform,
      text: v.body || p.body,
      hashtags: v.hashtags ?? p.hashtags ?? [],
    }))
    const platforms = [...new Set(p.versions.map(v => v.platformAccount.platform))]
    const media: MediaPreview[] = p.mediaFiles.map(m => m)
    return {
      kind: 'post',
      id: p.id,
      postId: p.id,
      status: derivePostStatus(p.status, p.versions),
      postType: p.postType,
      title: p.title ?? null,
      text: p.body,
      previews,
      media,
      platforms,
      canPublishNow: canPublishNow({ postType: p.postType, text: p.body, platforms, media, previews }),
      createdAt: p.createdAt,
    }
  })

  let items = [...proposalItems, ...postItems]
  if (statusFilter) items = items.filter(i => i.status === statusFilter)
  items.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())

  return c.json(items)
})
