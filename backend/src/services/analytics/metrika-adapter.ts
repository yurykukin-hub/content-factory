/**
 * Яндекс.Метрика MetricsAdapter — мост соцтрафик → конверсии (брони).
 *
 * Stat API: GET https://api-metrika.yandex.net/stat/v1/data
 *   metrics:    ym:s:visits, ym:s:users, ym:s:bounceRate (+ ym:s:goal{id}reaches на каждую цель)
 *   dimensions: ym:s:date, ym:s:UTMContent (=postId), ym:s:UTMSource (vk|telegram|instagram)
 *   filter:     ym:s:UTMMedium=='social'
 *   auth:       Authorization: OAuth {token}
 *
 * Gated: пока в AppConfig нет `metrika_oauth_token` — возвращаем [] (graceful).
 * Счётчик/цели — AppConfig `metrika_config` (JSON по businessId|slug), с дефолтом для НаWоде.
 */
import { db } from '../../db'
import { log } from '../../utils/logger'
import type { CollectedSiteTraffic } from './types'
import { ymd } from './types'

const STAT_API = 'https://api-metrika.yandex.net/stat/v1/data'

export interface MetrikaBizConfig {
  counterId: string
  goalIds: string[]
  bookingGoalId?: string
}

/** Бизнес с per-business Метрика-полями (читаем из БД, не из глобального JSON). */
export interface MetrikaBusinessRef {
  id: string
  slug: string
  metrikaCounterId?: string | null
  metrikaGoalIds?: string[]
}

async function getConfig(key: string): Promise<string | null> {
  const row = await db.appConfig.findUnique({ where: { key } })
  return row?.value ?? null
}

/**
 * OAuth-токен Метрики для бизнеса (масштабируемо под разные Яндекс-аккаунты):
 * per-business AppConfig `metrika_token_{id}` → глобальный `metrika_oauth_token` → env.
 * Токен — СЕКРЕТ, живёт ТОЛЬКО в AppConfig (admin-only), НЕ в модели Business (та уходит во фронт).
 */
export async function getMetrikaToken(businessId?: string): Promise<string | null> {
  if (businessId) {
    const perBiz = await getConfig(`metrika_token_${businessId}`)
    if (perBiz) return perBiz
  }
  return (await getConfig('metrika_oauth_token')) || process.env.METRIKA_OAUTH_TOKEN || null
}

/**
 * Счётчик/цели бизнеса: per-business поля `Business.metrikaCounterId/metrikaGoalIds` (новая
 * архитектура) → fallback на старый `metrika_config` JSON (backward-compat). null = не настроено.
 * Добавить бизнес = заполнить его поля в БД (UI/seed), а не править код.
 */
export async function getMetrikaConfigForBusiness(business: MetrikaBusinessRef): Promise<MetrikaBizConfig | null> {
  if (business.metrikaCounterId) {
    return { counterId: business.metrikaCounterId, goalIds: business.metrikaGoalIds ?? [] }
  }
  const raw = await getConfig('metrika_config')
  if (raw) {
    try {
      const map = JSON.parse(raw) as Record<string, MetrikaBizConfig>
      const cfg = map[business.id] || map[business.slug]
      if (cfg?.counterId) return { counterId: cfg.counterId, goalIds: cfg.goalIds ?? [], bookingGoalId: cfg.bookingGoalId }
    } catch (err: any) {
      log.warn('[MetrikaAdapter] bad metrika_config JSON', { error: err?.message })
    }
  }
  return null
}

/**
 * Собрать веб-трафик по UTM за период (по дням). Возвращает [] если адаптер не настроен.
 */
export async function fetchMetrikaTraffic(
  business: MetrikaBusinessRef,
  dateFrom: Date,
  dateTo: Date,
): Promise<CollectedSiteTraffic[]> {
  const token = await getMetrikaToken(business.id)
  if (!token) {
    log.info('[MetrikaAdapter] выключен — нет metrika_oauth_token (предусловие: OAuth Метрики)')
    return []
  }
  const cfg = await getMetrikaConfigForBusiness(business)
  if (!cfg) {
    log.info('[MetrikaAdapter] нет конфига счётчика для бизнеса', { slug: business.slug })
    return []
  }

  const goalMetrics = (cfg.goalIds || []).map(g => `ym:s:goal${g}reaches`)
  const metrics = ['ym:s:visits', 'ym:s:users', 'ym:s:bounceRate', ...goalMetrics].join(',')
  const dimensions = 'ym:s:date,ym:s:UTMContent,ym:s:UTMSource'

  const params = new URLSearchParams({
    ids: cfg.counterId,
    metrics,
    dimensions,
    date1: ymd(dateFrom),
    date2: ymd(dateTo),
    filters: `ym:s:UTMMedium=='social'`,
    limit: '10000',
    accuracy: 'full',
  })

  let data: any
  try {
    const res = await fetch(`${STAT_API}?${params}`, { headers: { Authorization: `OAuth ${token}` } })
    if (!res.ok) {
      const txt = await res.text().catch(() => '')
      log.warn('[MetrikaAdapter] Stat API non-ok', { status: res.status, body: txt.slice(0, 200) })
      return []
    }
    data = await res.json()
  } catch (err: any) {
    log.warn('[MetrikaAdapter] Stat API failed', { error: err?.message })
    return []
  }

  const rows: any[] = data?.data || []
  const out: CollectedSiteTraffic[] = []
  for (const row of rows) {
    const dims = row.dimensions || []
    const mvals = row.metrics || []
    const metricDate = dims[0]?.name || ymd(dateTo)
    const utmContent = dims[1]?.name && dims[1].name !== 'none' ? String(dims[1].name) : null
    const utmSource = dims[2]?.name && dims[2].name !== 'none' ? String(dims[2].name) : null

    const goalReaches: Record<string, number> = {}
    ;(cfg.goalIds || []).forEach((g, i) => {
      const v = mvals[3 + i]
      if (typeof v === 'number') goalReaches[g] = v
    })

    out.push({
      counterId: cfg.counterId,
      utmSource,
      utmMedium: 'social',
      utmContent,
      postId: null,             // резолвится в коллекторе (проверка принадлежности бизнесу)
      metricDate: String(metricDate).slice(0, 10),
      visits: Number(mvals[0]) || 0,
      users: typeof mvals[1] === 'number' ? mvals[1] : null,
      bounceRate: typeof mvals[2] === 'number' ? mvals[2] : null,
      goalReaches: Object.keys(goalReaches).length ? goalReaches : undefined,
      raw: row,
    })
  }
  log.info('[MetrikaAdapter] собрано строк трафика', { slug: business.slug, rows: out.length })
  return out
}
