/**
 * UTM-конвенция Content Factory — мост к аналитике (Эпик B).
 *
 * Редактор/публикатор генерит UTM-метки на исходящих ссылках бренда,
 * аналитика на стороне сайта/ERP читает utm_source / utm_medium / utm_campaign.
 *
 * Конвенция:
 *   utm_source   = канал: vk | telegram | instagram
 *   utm_medium   = social
 *   utm_campaign = cf_{YYYY_MM}  (Content Factory + месяц)
 *   utm_content  = короткий postId (атрибуция к посту)
 *
 * Помечаем ТОЛЬКО ссылки на домены бренда (из BrandProfile.links) —
 * чужие ссылки не трогаем. Идемпотентно: уже помеченные не перетираем.
 */

export interface UtmParams {
  source: string
  medium?: string
  campaign?: string
  content?: string
}

/** Канал → значение utm_source */
export function platformUtmSource(platform: string): string {
  const map: Record<string, string> = { VK: 'vk', TELEGRAM: 'telegram', INSTAGRAM: 'instagram' }
  return map[platform] || platform.toLowerCase()
}

/** utm_campaign по дате: cf_2026_06 */
export function utmCampaign(date: Date): string {
  const y = date.getUTCFullYear()
  const m = String(date.getUTCMonth() + 1).padStart(2, '0')
  return `cf_${y}_${m}`
}

/** Нормализовать host: lowercase, без www. */
function normHost(host: string): string {
  return host.toLowerCase().replace(/^www\./, '')
}

/** Извлечь хосты из BrandProfile.links ([{label,url}]) */
export function hostsFromLinks(links: unknown): string[] {
  if (!Array.isArray(links)) return []
  const hosts: string[] = []
  for (const l of links) {
    const url = l && typeof l === 'object' && 'url' in l ? (l as any).url : null
    if (typeof url === 'string') {
      try { hosts.push(new URL(url).hostname) } catch { /* skip */ }
    }
  }
  return hosts
}

/**
 * Дописать UTM к одному URL. Идемпотентно (не трогает уже помеченные).
 * Невалидный URL возвращается как есть.
 */
export function buildUtmUrl(rawUrl: string, params: UtmParams): string {
  try {
    const u = new URL(rawUrl)
    if (!u.searchParams.has('utm_source')) {
      u.searchParams.set('utm_source', params.source)
      u.searchParams.set('utm_medium', params.medium || 'social')
      if (params.campaign) u.searchParams.set('utm_campaign', params.campaign)
      if (params.content) u.searchParams.set('utm_content', params.content)
    }
    return u.toString()
  } catch {
    return rawUrl
  }
}

const URL_RE = /https?:\/\/[^\s<>()"'»]+/gi

/**
 * Пометить в тексте все http(s)-ссылки на домены бренда.
 * Хвостовая пунктуация (точка/скобка/запятая) не считается частью URL.
 */
export function tagBusinessLinks(
  text: string,
  opts: { hosts: string[]; source: string; medium?: string; campaign?: string; content?: string }
): string {
  if (!text || !opts.hosts.length) return text
  const hostSet = new Set(opts.hosts.map(normHost))
  return text.replace(URL_RE, (match) => {
    const trailing = match.match(/[).,!?;:]+$/)?.[0] || ''
    const url = trailing ? match.slice(0, match.length - trailing.length) : match
    try {
      const host = normHost(new URL(url).hostname)
      if (!hostSet.has(host)) return match
      return buildUtmUrl(url, opts) + trailing
    } catch {
      return match
    }
  })
}

/** Пометить одиночный URL, только если его host принадлежит бренду */
export function tagBusinessUrl(
  rawUrl: string,
  opts: { hosts: string[]; source: string; medium?: string; campaign?: string; content?: string }
): string {
  if (!rawUrl || !opts.hosts.length) return rawUrl
  const hostSet = new Set(opts.hosts.map(normHost))
  try {
    const host = normHost(new URL(rawUrl).hostname)
    if (!hostSet.has(host)) return rawUrl
    return buildUtmUrl(rawUrl, opts)
  } catch {
    return rawUrl
  }
}
