/**
 * Агент-аналитик SMM (петля обратной связи, Эпик B Phase 5).
 *
 * Раз/нед: контент + метрики площадок (CF) + конверсии по UTM (Метрика) →
 * Sonnet → «что зашло / не зашло (форматы/площадки/время → охват И брони) + рекомендации».
 * Human-in-the-loop: отчёт AnalyticsReport(status='proposed') → одобрение/отклонение в UI.
 * Cost-efficient: агрегация в коде (Haiku-дёшево не нужно), выводы — Sonnet, запуск раз/нед.
 */
import { db } from '../../db'
import { log } from '../../utils/logger'
import { emitEvent } from '../../eventBus'
import { buildBrandContext } from '../ai/prompt-builder'
import { aiComplete } from '../ai/openrouter'
import { getBookingRoiByRef, isNawodeDataAvailable } from '../nawode-data'

const DOW = ['воскресенье', 'понедельник', 'вторник', 'среда', 'четверг', 'пятница', 'суббота']

interface AnalyticsContext {
  period: { days: number; from: string; to: string }
  totals: { posts: number; reach: number; views: number; engagements: number; engagementRate: number | null; visits: number; conversions: number }
  byPlatform: Array<{ platform: string; posts: number; reach: number; views: number; engagements: number; avgEngagementRate: number | null }>
  byFormat: Array<{ format: string; posts: number; avgReach: number; avgEngagementRate: number | null; visits: number; conversions: number }>
  byDow: Array<{ dow: string; posts: number; avgReach: number }>
  topPosts: Array<any>
  bottomPosts: Array<any>
  roiConfigured: boolean
  bookingRoi?: Array<{ ref: string; bookings: number; cancelled: number; paidRub: number }>
}

/** Собрать агрегированный контекст для агента + снимок для дашборда. */
export async function gatherAnalyticsContext(businessId: string, days = 30): Promise<AnalyticsContext> {
  const now = new Date()
  const since = new Date(now.getTime() - days * 86400000)

  // Последний снимок на пост (по source:externalId)
  const snaps = await db.socialPostMetricSnapshot.findMany({
    where: { businessId, capturedAt: { gte: since } },
    orderBy: { capturedAt: 'desc' },
    include: { post: { select: { id: true, title: true, body: true, postType: true } } },
  })
  const latestByKey = new Map<string, typeof snaps[number]>()
  for (const s of snaps) {
    const k = `${s.source}:${s.externalId}`
    if (!latestByKey.has(k)) latestByKey.set(k, s)
  }
  const latest = [...latestByKey.values()]

  // publishedAt по версиям (для анализа по дням недели)
  const versionIds = latest.map(s => s.postVersionId).filter(Boolean) as string[]
  const versions = versionIds.length
    ? await db.postVersion.findMany({ where: { id: { in: versionIds } }, select: { id: true, publishedAt: true } })
    : []
  const pubAtByVersion = new Map(versions.map(v => [v.id, v.publishedAt]))

  // Конверсии/визиты из Метрики
  const traffic = await db.siteTrafficSnapshot.findMany({ where: { businessId, metricDate: { gte: since } } })
  const visitsByPost = new Map<string, number>()
  const convByPost = new Map<string, number>()
  let totalVisits = 0, totalConversions = 0
  for (const t of traffic) {
    const conv = t.goalReaches ? Object.values(t.goalReaches as Record<string, number>).reduce((a, b) => a + (Number(b) || 0), 0) : 0
    totalVisits += t.visits; totalConversions += conv
    if (t.postId) {
      visitsByPost.set(t.postId, (visitsByPost.get(t.postId) || 0) + t.visits)
      convByPost.set(t.postId, (convByPost.get(t.postId) || 0) + conv)
    }
  }
  const roiConfigured = traffic.length > 0

  // Реальные брони из ERP (нижний уровень воронки — деньги по источнику)
  const bizRow = await db.business.findUnique({ where: { id: businessId }, select: { erpType: true } })
  let bookingRoi: AnalyticsContext['bookingRoi'] = undefined
  if (bizRow?.erpType === 'nawode' && isNawodeDataAvailable()) {
    const rows = await getBookingRoiByRef(since.toISOString(), now.toISOString())
    if (rows.length) bookingRoi = rows.map(r => ({ ref: r.ref, bookings: r.bookings, cancelled: r.cancelled, paidRub: Math.round(r.paidKopecks / 100) }))
  }

  const eng = (s: any) => (s.likes || 0) + (s.comments || 0) + (s.shares || 0) + (s.saves || 0)
  const totals = { posts: 0, reach: 0, views: 0, engagements: 0, engagementRate: null as number | null, visits: totalVisits, conversions: totalConversions }
  const byPlatform = new Map<string, any>()
  const byFormat = new Map<string, any>()
  const byDow = new Map<number, { posts: number; reach: number }>()

  const rows = latest.map(s => {
    const e = eng(s)
    totals.posts++; totals.reach += s.reach || 0; totals.views += s.views || 0; totals.engagements += e
    const format = s.post?.postType || s.publicationType
    const platform = s.platform as string
    const visits = s.postId ? (visitsByPost.get(s.postId) || 0) : 0
    const conversions = s.postId ? (convByPost.get(s.postId) || 0) : 0

    const p = byPlatform.get(platform) || { platform, posts: 0, reach: 0, views: 0, engagements: 0, erSum: 0, erN: 0 }
    p.posts++; p.reach += s.reach || 0; p.views += s.views || 0; p.engagements += e
    if (s.engagementRate != null) { p.erSum += s.engagementRate; p.erN++ }
    byPlatform.set(platform, p)

    const f = byFormat.get(format) || { format, posts: 0, reachSum: 0, erSum: 0, erN: 0, visits: 0, conversions: 0 }
    f.posts++; f.reachSum += s.reach || 0; f.visits += visits; f.conversions += conversions
    if (s.engagementRate != null) { f.erSum += s.engagementRate; f.erN++ }
    byFormat.set(format, f)

    const pubAt = s.postVersionId ? pubAtByVersion.get(s.postVersionId) : null
    if (pubAt) {
      const d = new Date(pubAt).getUTCDay()
      const dd = byDow.get(d) || { posts: 0, reach: 0 }
      dd.posts++; dd.reach += s.reach || 0
      byDow.set(d, dd)
    }

    return {
      title: s.post?.title || null,
      body: (s.post?.body || '').replace(/\s+/g, ' ').slice(0, 90),
      format, platform,
      reach: s.reach, views: s.views, engagements: e, engagementRate: s.engagementRate,
      visits, conversions,
      publishedAt: pubAt || s.capturedAt,
      url: s.externalUrl,
    }
  })

  totals.engagementRate = totals.reach > 0 ? Math.round((totals.engagements / totals.reach) * 1000) / 10
    : (totals.views > 0 ? Math.round((totals.engagements / totals.views) * 1000) / 10 : null)

  const sorted = [...rows].sort((a, b) => (b.engagements - a.engagements) || ((b.reach || 0) - (a.reach || 0)))

  return {
    period: { days, from: since.toISOString(), to: now.toISOString() },
    totals,
    byPlatform: [...byPlatform.values()].map(p => ({
      platform: p.platform, posts: p.posts, reach: p.reach, views: p.views, engagements: p.engagements,
      avgEngagementRate: p.erN ? Math.round((p.erSum / p.erN) * 100) / 100 : null,
    })),
    byFormat: [...byFormat.values()].map(f => ({
      format: f.format, posts: f.posts,
      avgReach: f.posts ? Math.round(f.reachSum / f.posts) : 0,
      avgEngagementRate: f.erN ? Math.round((f.erSum / f.erN) * 100) / 100 : null,
      visits: f.visits, conversions: f.conversions,
    })),
    byDow: [...byDow.entries()].sort((a, b) => b[1].reach - a[1].reach).map(([d, v]) => ({
      dow: DOW[d], posts: v.posts, avgReach: v.posts ? Math.round(v.reach / v.posts) : 0,
    })),
    topPosts: sorted.slice(0, 5),
    bottomPosts: sorted.slice(-3).reverse(),
    roiConfigured,
    bookingRoi,
  }
}

/** Сгенерировать недельный отчёт-аналитику для бизнеса. */
export async function generateAnalyticsReport(
  businessId: string,
  opts: { days?: number; userId?: string } = {},
): Promise<{ reportId: string } | null> {
  const days = opts.days ?? 30
  const business = await db.business.findUnique({ where: { id: businessId } })
  if (!business) return null

  const ctx = await gatherAnalyticsContext(businessId, days)
  if (ctx.totals.posts === 0) {
    log.info('[Analyst] нет данных для отчёта', { business: business.slug })
    return null
  }

  const brandContext = await buildBrandContext(businessId).catch(() => '')

  const dataBlock = JSON.stringify({
    период_дней: days,
    итого: ctx.totals,
    по_площадкам: ctx.byPlatform,
    по_форматам: ctx.byFormat,
    по_дням_недели: ctx.byDow,
    топ_посты: ctx.topPosts,
    слабые_посты: ctx.bottomPosts,
    конверсии_метрика_подключены: ctx.roiConfigured,
    реальные_брони_erp: ctx.bookingRoi ?? null,
  }, null, 2)

  const systemPrompt = `Ты — аналитик SMM-агентства. Анализируешь эффективность контента бренда за период и даёшь конкретные рекомендации для следующего цикла.

${brandContext}

ДАННЫЕ (метрики площадок + конверсии с сайта по UTM):
${dataBlock}

ПОЯСНЕНИЯ К МЕТРИКАМ:
- reach=охват, views=просмотры, engagements=вовлечённость (лайки+комменты+репосты+сохранения), engagementRate=ER%.
- visits/conversions — переходы на сайт и достигнутые цели (брони) из Яндекс.Метрики по utm_content=postId. Если "конверсии_метрика_подключены"=false — данных о бронях НЕТ, выводы делай по охвату/вовлечённости и явно отметь, что воронка до брони не подключена.
- реальные_брони_erp — ФАКТИЧЕСКИЕ брони и оплаченные деньги (paidRub, ₽) из ERP по источнику (referral_source = ссылка/канал, напр. bron_vk, *_sayt). Это РЕАЛЬНЫЙ нижний уровень воронки (деньги), точнее Метрики. Атрибуция по ссылке/каналу, НЕ по конкретному посту. Если есть — делай выводы «какой канал/ссылка приносит реальные брони и доход», сопоставляй с охватом/форматами.
- Анализируй: какие ФОРМАТЫ, ПЛОЩАДКИ и ДНИ дают охват И (если есть) брони; что не зашло.

ЗАКОНОДАТЕЛЬСТВО РФ: не предлагай продвижение в Instagram (Meta признана экстремистской), нейтральный тон.

ЗАДАЧА: дай краткий разбор и 3–5 КОНКРЕТНЫХ рекомендаций (что менять в форматах/частоте/времени/темах/площадках для роста охвата и броней). Рекомендации — действенные, проверяемые на следующем цикле.

Ответь СТРОГО JSON без markdown:
{"summary":"2-4 предложения: что зашло / что не зашло за период","findings":[{"type":"win|loss|insight","title":"коротко","detail":"1-2 предложения с цифрами","metric":"reach|er|conversions|time|format"}],"recommendations":[{"area":"format|time|frequency|topic|platform|funnel","action":"что сделать","reason":"почему (из данных)"}]}`

  const result = await aiComplete({
    model: 'anthropic/claude-sonnet-4.6', // актуальный Sonnet (та же цена $3/$15)
    systemPrompt,
    userPrompt: 'Сделай разбор и рекомендации в формате JSON.',
    maxTokens: 2500,
    businessId,
    userId: opts.userId,
    action: 'analytics_report',
  })

  const cleaned = (result.content || '').replace(/```json\n?/g, '').replace(/```\n?/g, '').trim()
  let parsed: any = {}
  try { parsed = JSON.parse(cleaned) } catch {
    log.error('[Analyst] JSON parse failed', { business: business.slug, raw: cleaned.slice(0, 200) })
    return null
  }

  const report = await db.analyticsReport.create({
    data: {
      businessId,
      periodStart: new Date(ctx.period.from),
      periodEnd: new Date(ctx.period.to),
      status: 'proposed',
      summary: parsed.summary || '',
      findings: parsed.findings || [],
      recommendations: parsed.recommendations || [],
      metricsJson: {
        totals: ctx.totals, byPlatform: ctx.byPlatform, byFormat: ctx.byFormat, byDow: ctx.byDow,
      } as any,
      model: 'anthropic/claude-sonnet-4.6', // актуальный Sonnet (та же цена $3/$15)
      generatedBy: opts.userId ? 'manual' : 'agent',
    },
  })

  emitEvent({ type: 'post_created', tabId: '', postId: `analytics:${businessId}` })

  // Доставка в Telegram (graceful)
  try {
    const { sendAnalyticsReportToTelegram } = await import('./analyst-telegram')
    await sendAnalyticsReportToTelegram(report, business)
  } catch (err: any) {
    log.warn('[Analyst] telegram skipped', { error: err?.message })
  }

  log.info('[Analyst] report created', { business: business.slug, reportId: report.id })
  return { reportId: report.id }
}

// --- Weekly scheduler trigger ---
async function getConfig(key: string): Promise<string | null> {
  const row = await db.appConfig.findUnique({ where: { key } })
  return row?.value ?? null
}
async function setConfig(key: string, value: string): Promise<void> {
  await db.appConfig.upsert({ where: { key }, create: { key, value }, update: { value } })
}

/** Проверка по расписанию (каждые 60с из scheduler). Запуск раз/нед. */
export async function checkAndRunWeeklyAnalysis(): Promise<void> {
  if ((await getConfig('analytics_agent_enabled')) !== 'true') return // default OFF (включить в Настройках)

  const day = parseInt((await getConfig('analytics_agent_day')) || '1', 10)   // 1=пн
  const timeUtc = (await getConfig('analytics_agent_time_utc')) || '06:00'    // 09:00 МСК
  const [h, m] = timeUtc.split(':').map(Number)
  const now = new Date()
  if (now.getUTCDay() !== day || now.getUTCHours() !== h || now.getUTCMinutes() !== m) return

  const last = await getConfig('analytics_agent_last_run')
  if (last && (now.getTime() - new Date(last).getTime()) < 6 * 86400000) return // не чаще раз/нед
  await setConfig('analytics_agent_last_run', now.toISOString())

  log.info('[Analyst] weekly run starting')
  const businesses = await db.business.findMany({
    where: { isActive: true, platformAccounts: { some: { isActive: true } } },
    select: { id: true },
  })
  for (const b of businesses) {
    await generateAnalyticsReport(b.id, { days: 7 }).catch((e: any) => log.error('[Analyst] business failed', { error: e?.message }))
  }
}
