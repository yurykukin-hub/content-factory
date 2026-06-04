/**
 * VK MetricsAdapter.
 *
 * Per-post метрики — `wall.getById` (views/likes/reposts/comments). Работает
 * с любым валидным токеном (читаем публичную стену), scope `stats` НЕ нужен.
 * Account-level (охват/просмотры профиля) — `stats.get`: требует admin user-токен
 * со scope `stats`. Если его нет — best-effort, тихо возвращаем [].
 *
 * VK API 5.199. user-токен: 3 req/s.
 */
import { log } from '../../utils/logger'
import type { CollectedPostMetric, CollectedAccountMetric, PublishedRef } from './types'
import { chunk, round2, ymd } from './types'

const API = 'https://api.vk.com/method'
const V = '5.199'

async function vkCall(method: string, params: Record<string, string>): Promise<any> {
  const res = await fetch(`${API}/${method}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ ...params, v: V }),
  })
  return res.json() as any
}

/**
 * Собрать метрики по опубликованным VK-постам.
 * @param token валидный VK-токен (user/community)
 * @param ownerId владелец стены: `-{groupId}` для группы, `{userId}` для личной
 */
export async function fetchVkPostMetrics(
  token: string,
  ownerId: string,
  refs: PublishedRef[],
): Promise<CollectedPostMetric[]> {
  if (!refs.length) return []
  const out: CollectedPostMetric[] = []

  for (const part of chunk(refs, 100)) {
    const posts = part.map(r => `${ownerId}_${r.externalPostId}`).join(',')
    let data: any
    try {
      data = await vkCall('wall.getById', { posts, access_token: token, extended: '0' })
    } catch (err: any) {
      log.warn('[VkAdapter] wall.getById failed', { error: err?.message })
      continue
    }
    if (data?.error) {
      log.warn('[VkAdapter] wall.getById VK error', { code: data.error.error_code, msg: data.error.error_msg })
      continue
    }
    // 5.199 может вернуть массив или {items:[...]}
    const items: any[] = Array.isArray(data.response) ? data.response : (data.response?.items || [])
    for (const item of items) {
      const ref = part.find(r => String(r.externalPostId) === String(item.id))
      const likes = item.likes?.count ?? null
      const comments = item.comments?.count ?? null
      const shares = item.reposts?.count ?? null
      const views = item.views?.count ?? null
      const engaged = (likes || 0) + (comments || 0) + (shares || 0)
      const engagementRate = views && views > 0 ? round2((engaged / views) * 100) : null
      out.push({
        source: 'VK',
        platform: 'VK',
        publicationType: ref?.publicationType || 'POST',
        externalId: String(item.id),
        externalUrl: `https://vk.com/wall${ownerId}_${item.id}`,
        postId: ref?.postId ?? null,
        postVersionId: ref?.postVersionId ?? null,
        likes, comments, shares, views,
        reach: null,              // охват — только через stats.get (account-level)
        impressions: null, saves: null,
        engagementRate,
        raw: item,
      })
    }
  }
  return out
}

/**
 * Метрики VK-сторис: stories.getStats (views/replies/shares/open_link).
 * Требует admin user-токен; статистика доступна, пока сторис активна (~24ч) —
 * поэтому поллер должен снимать её в день публикации. Best-effort.
 */
export async function fetchVkStoryMetrics(
  token: string,
  ownerId: string,
  refs: PublishedRef[],
): Promise<CollectedPostMetric[]> {
  const out: CollectedPostMetric[] = []
  for (const ref of refs) {
    let data: any
    try {
      data = await vkCall('stories.getStats', { owner_id: ownerId, story_id: ref.externalPostId, access_token: token })
    } catch (err: any) {
      log.warn('[VkAdapter] stories.getStats failed', { error: err?.message })
      continue
    }
    if (data?.error) {
      const code = data.error?.error_code
      log.info('[VkAdapter] stories.getStats unavailable', { code, story: ref.externalPostId })
      // 15/100/200 — нет доступа/scope: дальше тот же результат, выходим
      if ([15, 100, 200].includes(code)) break
      continue
    }
    const r = data.response || {}
    const cnt = (x: any) => (x && typeof x.count === 'number' ? x.count : null)
    out.push({
      source: 'VK',
      platform: 'VK',
      publicationType: 'STORY',
      externalId: String(ref.externalPostId),
      externalUrl: `https://vk.com/story${ownerId}_${ref.externalPostId}`,
      postId: ref.postId ?? null,
      postVersionId: ref.postVersionId ?? null,
      views: cnt(r.views),
      reach: null, likes: null, comments: null, impressions: null, saves: null,
      shares: cnt(r.shares),
      storyReplies: cnt(r.replies) ?? cnt(r.answer),
      storyExits: cnt(r.bans),
      engagementRate: null,
      raw: r,
    })
  }
  return out
}

/**
 * Account-level метрики сообщества: stats.get (охват/просмотры по дням).
 * Требует scope `stats` + admin user-токен. Best-effort.
 */
export async function fetchVkAccountMetrics(
  token: string,
  groupId: string,
  dateFrom: Date,
  dateTo: Date,
): Promise<CollectedAccountMetric[]> {
  let data: any
  try {
    data = await vkCall('stats.get', {
      group_id: groupId,
      date_from: ymd(dateFrom),
      date_to: ymd(dateTo),
      access_token: token,
      intervals: 'day',
    })
  } catch (err: any) {
    log.warn('[VkAdapter] stats.get failed', { error: err?.message })
    return []
  }
  if (data?.error) {
    // error 15 (no access) / 100 — нет scope stats. Тихо.
    log.info('[VkAdapter] stats.get unavailable (нужен scope `stats`)', { code: data.error?.error_code })
    return []
  }
  const periods: any[] = Array.isArray(data.response) ? data.response : []
  const out: CollectedAccountMetric[] = []
  for (const p of periods) {
    // VK отдаёт day как timestamp (sec) или строку — нормализуем
    const dayDate = p.period_from
      ? new Date((typeof p.period_from === 'number' ? p.period_from * 1000 : Date.parse(p.period_from)))
      : dateTo
    const metricDate = ymd(dayDate)
    const push = (code: string, val: any) => {
      if (typeof val === 'number') out.push({ source: 'VK', platform: 'VK', accountExternalId: groupId, metricCode: code, value: val, metricDate, raw: p })
    }
    push('reach', p.reach?.reach)
    push('reach_subscribers', p.reach?.reach_subscribers)
    push('views', p.visitors?.views ?? p.activity?.views)
    push('subscribers', p.reach?.reach_subscribers)
    push('visitors', p.visitors?.visitors)
  }
  return out
}
