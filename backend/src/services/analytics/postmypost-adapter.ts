/**
 * Postmypost (Instagram) MetricsAdapter.
 *
 * IG-аналитика идёт через Postmypost (НЕ Meta Graph — блок в РФ).
 * base: api.postmypost.io/v4.1, Bearer.
 *
 * Per-post метрики: GET /analytics/publications?project_id&account_id&date_from&date_to&per_page&page
 *   row: { id(pm), external_id(IG media), external_url, created_at, content,
 *          analytics:{ likes, shares, engagements, views, reach,
 *                      engagement_rate_reach, engagement_rate_views, ... }, type(1=post,3=story,4=reels) }
 *   (реальные ключи сняты вживую 2026-06-04; недокументированные ловит raw.)
 *
 * Связь analytics-строки с CF Post:
 *   CF хранит PostVersion.externalPostId = Postmypost publication id (числовой).
 *   GET /publications/{id} → posts[0].external_id (IG media) + url.
 *   Матчим analytics.external_id == posts[0].external_id.
 */
import { log } from '../../utils/logger'
import type { CollectedPostMetric, PublishedRef } from './types'
import { round2, ymd } from './types'

const BASE = 'https://api.postmypost.io/v4.1'

async function pmApi(token: string, method: 'GET', path: string): Promise<{ ok: boolean; status: number; data: any }> {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
  })
  const data = await res.json().catch(() => null)
  return { ok: res.ok, status: res.status, data }
}

/** Postmypost type → нормализованный publicationType */
function mapType(t: any): string {
  if (t === 3) return 'STORY'
  if (t === 4) return 'REELS'
  return 'POST'
}

/** Разрешить IG external_id + реальный URL по числовому publication id. */
async function resolveIgPost(token: string, pubId: string): Promise<{ externalId: string; url: string | null } | null> {
  try {
    const res = await pmApi(token, 'GET', `/publications/${pubId}`)
    const post = res.data?.posts?.[0]
    if (post?.external_id) return { externalId: String(post.external_id), url: post.url || null }
  } catch (err: any) {
    log.warn('[PostmypostAdapter] resolveIgPost failed', { pubId, error: err?.message })
  }
  return null
}

/**
 * Собрать per-post метрики IG за период по аккаунту Postmypost.
 * Возвращает ВСЕ строки аналитики (и привязанные к CF-постам, и органические).
 */
export async function fetchPostmypostPostMetrics(
  token: string,
  projectId: number,
  accountId: number,
  refs: PublishedRef[],
  dateFrom: Date,
  dateTo: Date,
): Promise<CollectedPostMetric[]> {
  // 1. Карта externalPostId(pm) → IG external_id для CF-постов этого аккаунта
  const igMap = new Map<string, { postId: string; postVersionId: string }>()
  for (const ref of refs) {
    const resolved = await resolveIgPost(token, ref.externalPostId)
    if (resolved) igMap.set(resolved.externalId, { postId: ref.postId, postVersionId: ref.postVersionId })
  }

  // 2. Постранично тянем аналитику публикаций
  const out: CollectedPostMetric[] = []
  const df = ymd(dateFrom)
  const dt = ymd(dateTo)
  let page = 1
  let totalPages = 1
  do {
    const path = `/analytics/publications?project_id=${projectId}&account_id=${accountId}&date_from=${df}&date_to=${dt}&per_page=50&page=${page}`
    const res = await pmApi(token, 'GET', path)
    if (!res.ok) {
      log.warn('[PostmypostAdapter] /analytics/publications failed', { status: res.status, msg: res.data?.message })
      break
    }
    const rows: any[] = res.data?.data || []
    totalPages = res.data?.pages?.total_pages || 1
    for (const row of rows) {
      const a = row.analytics || {}
      const igId = row.external_id ? String(row.external_id) : null
      const link = igId ? igMap.get(igId) : undefined
      const reach = numOrNull(a.reach)
      const engaged = numOrNull(a.engagements)
      const engagementRate = a.engagement_rate_reach != null
        ? round2(Number(a.engagement_rate_reach))
        : (reach && engaged != null ? round2((engaged / reach) * 100) : null)
      out.push({
        source: 'POSTMYPOST',
        platform: 'INSTAGRAM',
        publicationType: mapType(row.type),
        externalId: igId || String(row.id),
        externalUrl: row.external_url || null,
        postId: link?.postId ?? null,
        postVersionId: link?.postVersionId ?? null,
        likes: numOrNull(a.likes),
        comments: numOrNull(a.comments),
        shares: numOrNull(a.shares),
        views: numOrNull(a.views),
        reach,
        impressions: numOrNull(a.impressions),
        saves: numOrNull(a.saved ?? a.saves),
        storyExits: numOrNull(a.exits ?? a.story_exits),
        storyReplies: numOrNull(a.replies ?? a.story_replies),
        engagementRate,
        raw: row,
      })
    }
    page++
  } while (page <= totalPages && page <= 40) // защита от бесконечного цикла

  return out
}

function numOrNull(v: any): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : (v != null && Number.isFinite(Number(v)) ? Number(v) : null)
}
