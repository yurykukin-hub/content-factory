/**
 * Daily Digest — утренний AI-контент-стратег для НаWоде.
 *
 * Каждое утро: бронирования + погода (nawode-data) + контент-план (рубрики) +
 * недавние посты → Sonnet → 3–4 предложения контента на сегодня
 * (формат, канал, текст, идея визуала, обоснование) → AutoPostTask(source='digest')
 * → доставка в Telegram (graceful) + видимость в UI (SSE).
 *
 * Одобрение (auto-post.ts) создаёт ЧЕРНОВИК Post (human-in-the-loop), который
 * виден в интерфейсе и дорабатывается вручную в редакторе.
 */

import { db } from '../db'
import { log } from '../utils/logger'
import { emitEvent } from '../eventBus'
import {
  buildBrandContext,
  buildDigestStrategistPrompt,
  buildDigestCopywriterPrompt,
  buildDigestArtDirectorPrompt,
  buildAdaptPrompt,
} from './ai/prompt-builder'
import { getDataSourceAdapter } from './datasource'
import { getStrategyBlock, getSeasonHint, getRubricNames } from './ai/strategy'
import { getViralCompetitorPosts } from './competitor-poller'

// --- AppConfig helpers ---
async function getConfig(key: string): Promise<string | null> {
  const row = await db.appConfig.findUnique({ where: { key } })
  return row?.value ?? null
}
async function setConfig(key: string, value: string): Promise<void> {
  await db.appConfig.upsert({ where: { key }, create: { key, value }, update: { value } })
}

interface Suggestion {
  postType: string
  platforms: string[]
  title?: string
  text: string
  hashtags?: string[]
  visualIdea?: string
  rubric?: string
  reasoning?: string
  mediaFileId?: string | null // выбранное арт-директором фото из галереи (Ф1)
  adaptations?: PlatformAdaptation[] // per-platform версии текста (Ф1.5)
}

/** Адаптация мастер-текста под конкретную платформу (Ф1.5). */
interface PlatformAdaptation {
  platform: string
  text: string
  hashtags: string[]
}

/** Собранный контекст дня — общий вход для команды агентов и fallback single-shot. */
interface DigestContext {
  dayName: string
  dateStr: string
  brandContext: string
  strategyText: string
  seasonHint: string
  rubrics: string[]
  dataBlock: string
  recentSummary: string
  competitorBlock: string
  platforms: string[]
}

/** Безопасный парс JSON из ответа LLM (срезает markdown-обёртку). */
function parseJsonLoose<T>(raw: string): T | null {
  const cleaned = (raw || '').replace(/```json\n?/g, '').replace(/```\n?/g, '').trim()
  try { return JSON.parse(cleaned) as T } catch { return null }
}

/** Проверка по расписанию (вызывается каждые 60с из scheduler) */
export async function checkAndRunDailyDigest(): Promise<void> {
  const enabled = await getConfig('digest_enabled')
  if (enabled !== 'true') return

  const timeUtc = (await getConfig('digest_time_utc')) || '04:00' // 07:00 МСК
  const [h, m] = timeUtc.split(':').map(Number)
  const now = new Date()
  if (now.getUTCHours() !== h || now.getUTCMinutes() !== m) return

  const last = await getConfig('digest_last_run')
  if (last && new Date(last).toDateString() === now.toDateString()) return // уже сегодня
  await setConfig('digest_last_run', now.toISOString())

  log.info('[Digest] daily run starting')
  await runDailyDigest().catch((e: any) => log.error('[Digest] run failed', { error: e.message }))
}

/** Сгенерировать дайджест для НаWоде-бизнесов (или конкретного). force = игнорировать дневной дедуп. */
export async function runDailyDigest(opts?: { businessId?: string; force?: boolean }): Promise<{ created: number }> {
  // Бизнесы с настроенным источником данных (erpType) — generic, не литерал 'nawode'.
  const businesses = await db.business.findMany({
    where: opts?.businessId ? { id: opts.businessId } : { erpType: { not: null }, isActive: true },
    include: { platformAccounts: { where: { isActive: true } } },
  })

  let created = 0
  for (const biz of businesses) {
    try {
      created += await generateDigestForBusiness(biz, opts?.force === true)
    } catch (err: any) {
      log.error('[Digest] business error', { business: biz.slug, error: err.message })
    }
  }
  log.info('[Digest] done', { created })
  return { created }
}

async function generateDigestForBusiness(biz: any, force: boolean): Promise<number> {
  // Авто-архив (Ф1.4): неразобранные proposed прошлых дней → archived (в дайджесте показываем только сегодняшние)
  const todayStart = new Date(); todayStart.setUTCHours(0, 0, 0, 0)
  const archived = await db.autoPostTask.updateMany({
    where: { businessId: biz.id, source: 'digest', status: 'proposed', createdAt: { lt: todayStart } },
    data: { status: 'archived' },
  })
  if (archived.count > 0) log.info('[Digest] archived stale proposals', { business: biz.slug, count: archived.count })

  // Идемпотентность: не плодить дубли в один день (если не force)
  if (!force) {
    const today = new Date(); today.setUTCHours(0, 0, 0, 0)
    const existing = await db.autoPostTask.count({
      where: { businessId: biz.id, source: 'digest', createdAt: { gte: today }, status: { in: ['proposed'] } },
    })
    if (existing > 0) {
      log.info('[Digest] already has suggestions today', { business: biz.slug })
      return 0
    }
  }

  const data = await getDataSourceAdapter(biz).getDailySummary(3)
  const brandContext = await buildBrandContext(biz.id)
  const { strategyText, seasonHints } = await getStrategyBlock(biz.id)
  const platforms = [...new Set((biz.platformAccounts || []).map((p: any) => p.platform))] as string[]

  const recentPosts = await db.post.findMany({
    where: { businessId: biz.id },
    orderBy: { createdAt: 'desc' },
    take: 10,
    select: { body: true, postType: true, createdAt: true },
  })
  const recentSummary = recentPosts
    .map(p => `- [${p.postType}] ${(p.body || '').replace(/\s+/g, ' ').slice(0, 80)}`)
    .join('\n') || 'нет недавних постов'

  // Залетевшие посты конкурентов (если модуль «Конкуренты» включён) — вдохновение, НЕ копирование
  const viralPosts = await getViralCompetitorPosts(biz.id, 7, 5).catch(() => [])
  const competitorBlock = viralPosts.length
    ? viralPosts.map((p: any) =>
        `- ${p.account.displayName}: «${(p.text || '').replace(/\s+/g, ' ').slice(0, 140)}» [ER ${p.engagementRate ?? '?'}%, ${p.likes}❤ ${p.reposts}🔁 ${p.views}👁]`
      ).join('\n')
    : ''

  const now = new Date()
  const dayNames = ['воскресенье', 'понедельник', 'вторник', 'среда', 'четверг', 'пятница', 'суббота']
  const dateStr = now.toLocaleDateString('ru-RU', { day: '2-digit', month: 'long', year: 'numeric' })

  // Сводка данных НаWоде
  let dataBlock = 'Данные ERP недоступны.'
  if (data) {
    const w = data.weather.map(d =>
      `${d.date}: ${d.tempMax ?? '?'}°C (днём ~${d.tempAvg ?? '?'}°C), ветер до ${d.windMax ?? '?'} м/с, ${d.label}${d.precipMm ? `, осадки ${d.precipMm}мм` : ''}`
    ).join('\n') || 'нет прогноза'
    const b = data.bookings.length
      ? data.bookings.map(d => `${d.date}: ${d.bookings} брони, ${d.people} чел.`).join('\n')
      : 'на ближайшие дни броней в базе нет (ранний сезон — делай акцент на приглашении и погоде)'
    dataBlock = `ПОГОДА (Выборг, набережная):\n${w}\n\nБРОНИРОВАНИЯ:\n${b}`
  }

  const rubrics = await getRubricNames(biz.id)
  const ctx: DigestContext = {
    dayName: dayNames[now.getDay()],
    dateStr,
    brandContext,
    strategyText,
    seasonHint: getSeasonHint(seasonHints, now.getMonth()),
    rubrics,
    dataBlock,
    recentSummary,
    competitorBlock,
    platforms,
  }

  // Команда агентов (стратег → копирайтер → арт-директор) с fallback на single-shot Sonnet.
  let suggestions: Suggestion[] = []
  try {
    suggestions = await runAgentTeam(biz.id, ctx)
  } catch (err: any) {
    log.warn('[Digest] agent team failed → fallback to single-shot', { business: biz.slug, error: err.message })
  }
  if (!suggestions.length) {
    suggestions = await runSingleShot(biz.id, ctx).catch((e: any) => {
      log.error('[Digest] single-shot failed', { business: biz.slug, error: e.message })
      return [] as Suggestion[]
    })
  }
  if (!suggestions.length) return 0

  let created = 0
  for (const s of suggestions) {
    const validPlatforms = (s.platforms || platforms).filter((p: string) => platforms.includes(p))
    const task = await db.autoPostTask.create({
      data: {
        businessId: biz.id,
        source: 'digest',
        status: 'proposed',
        postType: (s.postType || 'TEXT').toUpperCase(),
        title: s.title || null,
        proposedText: s.text || '',
        proposedTags: s.hashtags || [],
        adaptations: (s.adaptations && s.adaptations.length ? s.adaptations : undefined) as any,
        visualIdea: s.visualIdea || null,
        mediaFileId: s.mediaFileId || null,
        aiReasoning: s.reasoning || (s.rubric ? `Рубрика: ${s.rubric}` : null),
        platforms: validPlatforms.length ? validPlatforms : platforms,
        proposedAt: new Date(),
      },
    })
    created++

    // Доставка в Telegram (graceful — если не настроен, тихо пропустится)
    try {
      const { sendApprovalToTelegram } = await import('./telegram-approval')
      await sendApprovalToTelegram(task, { filePath: null }, biz)
    } catch (err: any) {
      log.warn('[Digest] telegram skipped', { error: err.message })
    }
  }

  // Уведомить UI (SSE) — появятся новые предложения
  emitEvent({ type: 'post_created', tabId: '', postId: `digest:${biz.id}` })

  log.info('[Digest] suggestions created', { business: biz.slug, created })
  return created
}

// ─────────────────────────────────────────────────────────────────────────
// Команда агентов (Ф1): стратег → копирайтер → арт-директор.
// ─────────────────────────────────────────────────────────────────────────

/** Поиск реальных фото в галерее по ключевым словам (по altText из Ф0). */
async function searchGalleryPhotos(businessId: string, keywords: string[], limit = 12): Promise<{ id: string; altText: string }[]> {
  const kw = (keywords || []).map(k => String(k).trim().toLowerCase()).filter(Boolean)
  if (!kw.length) return []
  const rows = await db.mediaFile.findMany({
    where: {
      businessId,
      mimeType: { startsWith: 'image/' },
      altText: { not: null },
      OR: kw.map(k => ({ altText: { contains: k, mode: 'insensitive' as const } })),
    },
    select: { id: true, altText: true },
    take: 50, // больше кандидатов — ранжируем ниже по релевантности
  })
  // Ранжируем по числу совпавших ключевых слов: фото с бОльшим пересечением релевантнее
  // (иначе keyword «рассвет» притягивал сап-йогу под тему «замок»).
  return rows
    .map(r => {
      const alt = (r.altText || '').toLowerCase()
      return { id: r.id, altText: r.altText || '', score: kw.filter(k => alt.includes(k)).length }
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map(({ id, altText }) => ({ id, altText }))
}

/** Арт-директор: выбирает лучшее фото из галереи под пост (null, если ничего не подходит). */
async function pickPhotoForPost(
  businessId: string,
  brief: { theme: string; format: string; text: string; photoKeywords: string[] },
): Promise<string | null> {
  const candidates = await searchGalleryPhotos(businessId, brief.photoKeywords, 12)
  if (!candidates.length) return null
  if (candidates.length === 1) return candidates[0].id

  const { aiComplete } = await import('./ai/openrouter')
  const res = await aiComplete({
    model: 'anthropic/claude-3.5-haiku', // выбор из списка — простая задача, Haiku дешевле
    systemPrompt: buildDigestArtDirectorPrompt(brief, candidates),
    userPrompt: 'Выбери лучшее фото под пост. Ответь JSON.',
    maxTokens: 300,
    businessId,
    action: 'daily_digest',
  })
  const picked = parseJsonLoose<{ mediaFileId: string | null }>(res.content || '')?.mediaFileId
  if (!picked || picked === 'null') return null
  return candidates.some(c => c.id === picked) ? picked : null // защита от выдуманного id
}

/** Адаптация мастер-текста под каждый канал (Ф1.5). Единый движок PLATFORM_RULES (buildAdaptPrompt), Haiku. */
async function adaptForPlatforms(
  masterText: string,
  masterTags: string[],
  platforms: string[],
  brandContext: string,
  businessId: string,
): Promise<PlatformAdaptation[]> {
  if (!platforms.length) return []
  const { aiComplete } = await import('./ai/openrouter')
  const results = await Promise.allSettled(platforms.map(async (platform): Promise<PlatformAdaptation> => {
    const res = await aiComplete({
      model: 'anthropic/claude-3.5-haiku',
      systemPrompt: buildAdaptPrompt(platform, brandContext),
      userPrompt: masterText,
      maxTokens: 1000,
      businessId,
      action: 'daily_digest',
    })
    const text = (res.content || '').trim() || masterText
    // TG: хэштеги не работают для discovery; VK/IG — мастер-теги (per-platform хэштеги — докрутка позже)
    return { platform, text, hashtags: platform === 'TELEGRAM' ? [] : masterTags }
  }))
  return results
    .filter((r): r is PromiseFulfilledResult<PlatformAdaptation> => r.status === 'fulfilled')
    .map(r => r.value)
}

/** Цепочка ролей: стратег (1 вызов) → по каждой идее копирайтер + адаптация + арт-директор (параллельно). */
async function runAgentTeam(businessId: string, ctx: DigestContext): Promise<Suggestion[]> {
  const { aiComplete } = await import('./ai/openrouter')

  // РОЛЬ 1 — Стратег: темы дня
  const stratRes = await aiComplete({
    model: 'anthropic/claude-sonnet-4',
    systemPrompt: buildDigestStrategistPrompt({ ...ctx, count: 3 }),
    userPrompt: 'Предложи идеи контента на сегодня. Ответь JSON.',
    maxTokens: 1500,
    businessId,
    action: 'daily_digest',
  })
  const ideas = parseJsonLoose<{ ideas: any[] }>(stratRes.content || '')?.ideas || []
  if (!ideas.length) throw new Error('strategist returned no ideas')

  // РОЛИ 2+3 — копирайтер и арт-директор по каждой идее (параллельно)
  const results = await Promise.allSettled(ideas.slice(0, 4).map(async (idea: any): Promise<Suggestion> => {
    // Ф1.6: только PHOTO/STORIES (каждый пост с фото). Любой другой формат → PHOTO.
    const format = String(idea.format || 'PHOTO').toUpperCase() === 'STORIES' ? 'STORIES' : 'PHOTO'
    // Каналы предложения: channels[] ∩ доступные; fallback — первый доступный (back-compat со старым полем channel)
    const requested: string[] = Array.isArray(idea.channels) ? idea.channels : (idea.channel ? [idea.channel] : [])
    let channels = requested.filter((c: string) => ctx.platforms.includes(c))
    if (!channels.length) channels = ctx.platforms.slice(0, 1)
    const primary = channels[0] || 'VK'

    // РОЛЬ 2 — Копирайтер: мастер-текст (ориентир — первый канал)
    const copyRes = await aiComplete({
      model: 'anthropic/claude-sonnet-4',
      systemPrompt: buildDigestCopywriterPrompt(
        { rubric: idea.rubric, theme: idea.theme, format, channel: primary, keyMessage: idea.keyMessage },
        ctx.brandContext, ctx.recentSummary,
      ),
      userPrompt: 'Напиши готовый текст поста. Ответь JSON.',
      maxTokens: 1200,
      businessId,
      action: 'daily_digest',
    })
    const copy = parseJsonLoose<{ text: string; hashtags: string[] }>(copyRes.content || '')
    if (!copy?.text) throw new Error('copywriter returned no text')

    // Адаптация мастер-текста под каждый канал (Ф1.5) — честный per-platform превью
    const adaptations = await adaptForPlatforms(copy.text, copy.hashtags || [], channels, ctx.brandContext, businessId)

    // РОЛЬ 3 — Арт-директор (только для форматов с фото)
    let mediaFileId: string | null = null
    if (format === 'PHOTO' || format === 'STORIES') {
      mediaFileId = await pickPhotoForPost(businessId, {
        theme: idea.theme, format, text: copy.text, photoKeywords: idea.photoKeywords || [],
      }).catch(() => null)
    }

    return {
      postType: format,
      platforms: channels,
      title: idea.theme ? String(idea.theme).slice(0, 80) : undefined,
      text: copy.text,
      hashtags: copy.hashtags || [],
      adaptations,
      visualIdea: idea.keyMessage || null,
      rubric: idea.rubric,
      reasoning: idea.reasoning,
      mediaFileId,
    }
  }))

  return results
    .filter((r): r is PromiseFulfilledResult<Suggestion> => r.status === 'fulfilled')
    .map(r => r.value)
}

/** Fallback: один Sonnet генерит все предложения разом (прежнее поведение, без подбора фото). */
async function runSingleShot(businessId: string, ctx: DigestContext): Promise<Suggestion[]> {
  const { aiComplete } = await import('./ai/openrouter')
  const systemPrompt = `Ты — утренний AI-контент-стратег SMM-агентства. Сегодня ${ctx.dayName}, ${ctx.dateStr}.

${ctx.brandContext}

${ctx.strategyText}

СЕЗОН: ${ctx.seasonHint}

ДАННЫЕ НА СЕГОДНЯ И БЛИЖАЙШИЕ ДНИ:
${ctx.dataBlock}

НЕДАВНИЕ ПОСТЫ (НЕ повторяйся по теме):
${ctx.recentSummary}
${ctx.competitorBlock ? `\nЗАЛЕТЕВШИЕ ПОСТЫ КОНКУРЕНТОВ:\n${ctx.competitorBlock}\n` : ''}
ДОСТУПНЫЕ КАНАЛЫ: ${ctx.platforms.join(', ') || 'VK'}

ЗАКОНОДАТЕЛЬСТВО РФ (строго): нейтральный тон; НЕ зови в Instagram в текстах для VK/публичных РФ-каналов (Meta признана экстремистской в РФ); без запрещёнки. Ссылку nawode.ru уместно добавлять в продающие/сезонные посты.

ЗАДАЧА: предложи 3 идеи контента ИМЕННО на сегодня (форматы PHOTO/TEXT/STORIES, видео не предлагай). Текст — готовый к публикации.

Ответь СТРОГО JSON без markdown:
{"suggestions":[{"postType":"STORIES|TEXT|PHOTO","platforms":["VK"],"title":"короткий заголовок","text":"готовый текст поста","hashtags":["хэштег_без_решётки"],"visualIdea":"идея визуала","rubric":"название рубрики","reasoning":"почему сегодня"}]}`

  const res = await aiComplete({
    model: 'anthropic/claude-sonnet-4',
    systemPrompt,
    userPrompt: 'Сгенерируй предложения контента на сегодня в формате JSON.',
    maxTokens: 2500,
    businessId,
    action: 'daily_digest',
  })
  const parsed = parseJsonLoose<any>(res.content || '')
  return (Array.isArray(parsed) ? parsed : parsed?.suggestions || []) as Suggestion[]
}

/**
 * Одобрить digest-предложение → создать ЧЕРНОВИК Post (human-in-the-loop).
 * БЕЗ авто-публикации: пост появляется в интерфейсе, его дорабатывают вручную
 * и публикуют/планируют существующим флоу (Stories/Posts редактор).
 */
export async function approveDigestTask(task: any): Promise<{ postId: string; postType: string }> {
  const validTypes = ['TEXT', 'PHOTO', 'VIDEO', 'REELS', 'CLIPS', 'STORIES']
  const pt = validTypes.includes((task.postType || '').toUpperCase()) ? task.postType.toUpperCase() : 'TEXT'

  const post = await db.post.create({
    data: {
      businessId: task.businessId,
      title: task.title || null,
      body: task.proposedText || ' ',
      postType: pt as any,
      hashtags: task.proposedTags || [],
      status: 'DRAFT',
      createdBy: 'ai',
      aiModel: 'daily-digest',
      aiPromptUsed: task.aiReasoning || null,
    },
  })

  // Привязать выбранное арт-директором фото к черновику (тот же механизм, что композер: MediaFile.postId)
  if (task.mediaFileId) {
    await db.mediaFile
      .update({ where: { id: task.mediaFileId }, data: { postId: post.id } })
      .catch((e: any) => log.warn('[Digest] attach photo failed', { taskId: task.id, mediaFileId: task.mediaFileId, error: e.message }))
  }

  // Создать per-platform версии из адаптаций (Ф1.5) — черновик откроется с готовыми текстами под каждый канал
  const adaptations = Array.isArray(task.adaptations) ? (task.adaptations as any[]) : []
  for (const a of adaptations) {
    if (!a?.platform) continue
    const pa = await db.platformAccount.findFirst({
      where: { businessId: task.businessId, platform: a.platform, isActive: true },
    })
    if (!pa) continue
    await db.postVersion
      .upsert({
        where: { postId_platformAccountId: { postId: post.id, platformAccountId: pa.id } },
        create: { postId: post.id, platformAccountId: pa.id, body: a.text || post.body, hashtags: a.hashtags || [] },
        update: { body: a.text || post.body, hashtags: a.hashtags || [] },
      })
      .catch((e: any) => log.warn('[Digest] postVersion create failed', { platform: a.platform, error: e.message }))
  }

  await db.autoPostTask.update({
    where: { id: task.id },
    data: { status: 'approved', postId: post.id, decidedAt: new Date() },
  })

  emitEvent({ type: 'post_created', tabId: '', postId: post.id })
  log.info('[Digest] approved -> draft post', { taskId: task.id, postId: post.id, postType: pt, photo: !!task.mediaFileId })
  return { postId: post.id, postType: pt }
}
