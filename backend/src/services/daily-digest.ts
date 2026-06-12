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
import { buildBrandContext } from './ai/prompt-builder'
import { getDataSourceAdapter } from './datasource'
import { getStrategyBlock, getSeasonHint } from './ai/strategy'
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

  const systemPrompt = `Ты — утренний AI-контент-стратег SMM-агентства. Сегодня ${dayNames[now.getDay()]}, ${dateStr}.

${brandContext}

${strategyText}

СЕЗОН: ${getSeasonHint(seasonHints, now.getMonth())}

ДАННЫЕ НА СЕГОДНЯ И БЛИЖАЙШИЕ ДНИ:
${dataBlock}

НЕДАВНИЕ ПОСТЫ (НЕ повторяйся по теме):
${recentSummary}
${competitorBlock ? `\nЗАЛЕТЕВШИЕ ПОСТЫ КОНКУРЕНТОВ (за 7 дней — черпай идеи/форматы/темы, НЕ копируй дословно, адаптируй под НаWоде):\n${competitorBlock}\n` : ''}
ДОСТУПНЫЕ КАНАЛЫ: ${platforms.join(', ') || 'VK'}

ЗАКОНОДАТЕЛЬСТВО РФ (строго): нейтральный тон; НЕ упоминай и не зови в Instagram в текстах для VK/публичных РФ-каналов (Meta признана экстремистской в РФ); без запрещённого контента. Ссылку nawode.ru уместно добавлять в продающие/сезонные посты.

ЗАДАЧА: предложи 3–4 идеи контента ИМЕННО на сегодня, опираясь на погоду, бронирования, рубрику и сезон. Разнообразь форматы (хотя бы одна Stories с погодой/приглашением; по возможности один пост по рубрике; видео-идея если уместно). Текст — готовый к публикации (живой, по тону бренда), с учётом погоды (жара → «все на воду», сильный ветер → про безопасность/перенос).

Ответь СТРОГО JSON без markdown:
{"suggestions":[{"postType":"STORIES|TEXT|PHOTO|REELS","platforms":["VK"],"title":"короткий заголовок","text":"готовый текст поста","hashtags":["хэштег_без_решётки"],"visualIdea":"идея фото/видео для визуала","rubric":"название рубрики","reasoning":"почему именно это сегодня (1 предложение: погода/бронь/рубрика)"}]}`

  const { aiComplete } = await import('./ai/openrouter')
  const result = await aiComplete({
    model: 'anthropic/claude-sonnet-4',
    systemPrompt,
    userPrompt: 'Сгенерируй предложения контента на сегодня в формате JSON.',
    maxTokens: 2500,
    businessId: biz.id,
    action: 'daily_digest',
  })

  const cleaned = (result.content || '').replace(/```json\n?/g, '').replace(/```\n?/g, '').trim()
  let suggestions: Suggestion[] = []
  try {
    const parsed = JSON.parse(cleaned)
    suggestions = Array.isArray(parsed) ? parsed : parsed.suggestions || []
  } catch {
    log.error('[Digest] JSON parse failed', { business: biz.slug, raw: cleaned.slice(0, 200) })
    return 0
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
        visualIdea: s.visualIdea || null,
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

  await db.autoPostTask.update({
    where: { id: task.id },
    data: { status: 'approved', postId: post.id, decidedAt: new Date() },
  })

  emitEvent({ type: 'post_created', tabId: '', postId: post.id })
  log.info('[Digest] approved -> draft post', { taskId: task.id, postId: post.id, postType: pt })
  return { postId: post.id, postType: pt }
}
