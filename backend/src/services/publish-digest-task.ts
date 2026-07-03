/**
 * Shared publisher for digest AutoPostTasks.
 *
 * Single source of truth for "approve + publish/schedule a digest suggestion".
 * Both the HTTP route (POST /auto-posts/:id/approve-publish) and the digest
 * autopilot (daily-digest.generateDigestForBusiness) call this — no duplicated
 * publish logic. Extracted verbatim from the route to preserve behavior.
 */

import { db } from '../db'
import { log } from '../utils/logger'

export interface PublishDigestTaskOpts {
  when: 'now' | 'schedule'
  scheduledAt?: string | null
  platforms?: string[]
  tabId?: string
}

export interface PublishDigestTaskResult {
  postId: string
  results: { platform: string; success: boolean; externalUrl: string | null; error: string | null }[]
}

/**
 * Approve a proposed digest task → Post(DRAFT) + PostVersions, then publish (now)
 * or schedule the chosen platform versions. Marks the task `published` when
 * `when === 'now'` and at least one version succeeds.
 *
 * If no versions match the chosen platforms, returns early with empty results
 * (does NOT throw) — the caller decides how to react.
 */
export async function publishDigestTask(
  task: any,
  opts: PublishDigestTaskOpts,
): Promise<PublishDigestTaskResult> {
  const { when, scheduledAt, platforms, tabId = '' } = opts

  // Baked (дизайн вшит satori) → skipOverlay: публикуем картинку как есть, без наложения текста
  let skipOverlay = false
  if (task.mediaFileId) {
    const mf = await db.mediaFile.findUnique({ where: { id: task.mediaFileId }, select: { tags: true } })
    skipOverlay = !!mf?.tags?.includes('story-design')
  }

  // Одобрить → Post(DRAFT) + per-platform PostVersion (та же логика, что обычное одобрение)
  const { approveDigestTask } = await import('./daily-digest')
  const { postId } = await approveDigestTask(task)

  const versions = await db.postVersion.findMany({ where: { postId }, include: { platformAccount: true } })
  const targetPlatforms = platforms && platforms.length ? platforms : (task.platforms || [])
  const chosen = versions.filter(v => !targetPlatforms.length || targetPlatforms.includes(v.platformAccount.platform))
  if (!chosen.length) {
    // Нет версий для выбранных каналов — не бросаем, возвращаем пустой результат (решает вызывающий).
    return { postId, results: [] }
  }

  const { publishPostVersion, schedulePostVersion } = await import('./publish-runner')

  // VK-сторис из дайджеста (прямая публикация): вернуть нативную кнопку «Забронировать».
  // В редакторе ссылка подставляется (applyDefaultBookingLink), а прямой путь раньше слал
  // storiesOptions без linkUrl → кнопка пропадала (баг B). Берём дефолт-ссылку из НаWоде ERP
  // (scope story+vk → vk → story). UTM добавится дальше в applyUtmForPublish.
  // ERP недоступен / ссылок нет → публикуем как раньше (без кнопки), не падаем.
  const storiesOptions: { skipOverlay: boolean; linkText?: string; linkUrl?: string } = { skipOverlay }
  const hasVkStory = (task.postType || '').toUpperCase() === 'STORIES'
    && chosen.some(v => v.platformAccount.platform === 'VK')
  if (hasVkStory) {
    try {
      const baseUrl = (await db.appConfig.findUnique({ where: { key: 'nawode_booking_base_url' } }))?.value || undefined
      const { getBookingLinks } = await import('./nawode-data')
      const links = await getBookingLinks(baseUrl)
      const pick = links.find(l => l.scope.includes('story') && l.scope.includes('vk'))
        || links.find(l => l.scope.includes('vk'))
        || links.find(l => l.scope.includes('story'))
      if (pick) {
        storiesOptions.linkText = 'book'
        storiesOptions.linkUrl = pick.url
        log.info('[AutoPost] VK story booking link attached', { ref: pick.ref })
      }
    } catch (e: any) {
      log.warn('[AutoPost] booking link resolve failed', { error: e?.message })
    }
  }

  const results: { platform: string; success: boolean; externalUrl: string | null; error: string | null }[] = []

  for (const v of chosen) {
    try {
      if (when === 'schedule') {
        await schedulePostVersion(v.id, scheduledAt!, storiesOptions)
        results.push({ platform: v.platformAccount.platform, success: true, externalUrl: null, error: null })
      } else {
        const r = await publishPostVersion(v.id, { storiesOptions, tabId })
        results.push({ platform: v.platformAccount.platform, success: r.success, externalUrl: r.externalUrl, error: r.error })
      }
    } catch (e: any) {
      results.push({ platform: v.platformAccount.platform, success: false, externalUrl: null, error: e?.message || String(e) })
    }
  }

  // now + хоть один успех → задача published; schedule → пост уже SCHEDULED (задача остаётся approved)
  if (when === 'now' && results.some(r => r.success)) {
    await db.autoPostTask.update({ where: { id: task.id }, data: { status: 'published' } })
  }

  return { postId, results }
}
