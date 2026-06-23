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
import { config } from '../config'
import { log } from '../utils/logger'
import { emitEvent } from '../eventBus'
import {
  buildBrandContext,
  buildDigestStrategistPrompt,
  buildDigestCopywriterPrompt,
  buildDigestArtDirectorPrompt,
  buildDigestRoleStoryPrompt,
  buildFlashStoryPrompt,
  buildDigestRecruitmentPrompt,
  buildAdaptPrompt,
  type DigestStoryRole,
} from './ai/prompt-builder'
import { getDataSourceAdapter } from './datasource'
import { getStrategyBlock, getSeasonHint, getRubricNames } from './ai/strategy'
import { getViralCompetitorPosts } from './competitor-poller'
import { renderAndSaveStoryDesign } from './story-design'
import { stripInlineHashtags } from '../utils/hashtags'
import { cleanStoryTitle } from '../utils/story-title'
import { evaluateWeatherFlash, type FlashSignal } from './promo/weather-flash'

// IG с 2025 ограничил рекомендованное число хэштегов (≤5/пост даёт лучший охват, чем «ковёр» тегов).
const IG_HASHTAG_CAP = 5

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

/** Роль прогона дайджеста: 'full' = легаси пачка идей (ручная кнопка); morning/day/evening = одна сторис ритма. */
export type DigestRole = 'full' | DigestStoryRole

/** Собранный контекст дня — общий вход для команды агентов и fallback single-shot. */
interface DigestContext {
  dayName: string
  dateStr: string
  brandContext: string
  strategyText: string
  seasonHint: string
  rubrics: string[]
  dataBlock: string
  hotSlotsBlock: string          // «горячие» слоты (где уже есть записанные) — для слот-филла
  recentSummary: string
  recentProposals: string
  competitorBlock: string
  platforms: string[]
  todayTemp?: string | null      // "+21°" — для погодного виджета дизайн-сторис
  todayWeather?: string | null   // "слабый ветер"
  promoBlock?: string            // действующие скидки из ERP для промпта (Фаза 3; '' если выключено/нет)
  promoBadge?: string | null     // короткая плашка скидки для картинки дизайн-сторис («Прокат −10% · 900₽»)
}

/** Скорость ветра (м/с) → словесное описание. Цифры м/с люди не понимают — в тексте только словами. */
function windLabel(ms: number | null | undefined): string {
  if (ms == null) return 'ветер спокойный'
  if (ms < 2) return 'штиль'
  if (ms < 4) return 'слабый ветер'
  if (ms < 7) return 'умеренный ветер'
  if (ms < 10) return 'свежий ветер'
  return 'сильный ветер'
}

/** Безопасный парс JSON из ответа LLM (срезает markdown-обёртку). */
function parseJsonLoose<T>(raw: string): T | null {
  const cleaned = (raw || '').replace(/```json\n?/g, '').replace(/```\n?/g, '').trim()
  try { return JSON.parse(cleaned) as T } catch { return null }
}

/** Проверка по расписанию (вызывается каждые 60с из scheduler) — ЛЕГАСИ единый прогон (пачка идей). */
export async function checkAndRunDailyDigest(): Promise<void> {
  const enabled = await getConfig('digest_enabled')
  if (enabled !== 'true') return
  // Ритм-режим (3 сторис/день) владеет дайджестом — чтобы не было двойной генерации.
  if ((await getConfig('digest_roles_enabled')) === 'true') return

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

/** Дефолтное время ролей (UTC): 07:00 / 13:00 / 19:00 МСК. */
const DIGEST_ROLE_DEFAULT_TIMES: Record<DigestStoryRole, string> = { morning: '04:00', day: '10:00', evening: '16:00' }

/**
 * Ритм-движок (Ф2): 3 прогона/день по ролям (утро/день/вечер), КАЖДЫЙ генерит свою сторис
 * по СВЕЖИМ данным на момент прогона. Opt-in `digest_roles_enabled` (иначе работает легаси).
 * Per-slot дедуп `digest_last_run_<role>` — каждый слот раз в день.
 */
export async function checkAndRunDigestRoles(): Promise<void> {
  if ((await getConfig('digest_roles_enabled')) !== 'true') return
  const rolesCfg = (await getConfig('digest_story_roles')) || 'morning,day,evening'
  const roles = rolesCfg.split(',').map(s => s.trim())
    .filter((r): r is DigestStoryRole => r === 'morning' || r === 'day' || r === 'evening')
  const now = new Date()
  for (const role of roles) {
    const timeUtc = (await getConfig(`digest_time_utc_${role}`)) || DIGEST_ROLE_DEFAULT_TIMES[role]
    const [h, m] = timeUtc.split(':').map(Number)
    if (now.getUTCHours() !== h || now.getUTCMinutes() !== m) continue

    const lastKey = `digest_last_run_${role}`
    const last = await getConfig(lastKey)
    if (last && new Date(last).toDateString() === now.toDateString()) continue // этот слот уже сегодня
    await setConfig(lastKey, now.toISOString())

    log.info('[Digest] role run starting', { role })
    await runDailyDigest({ role }).catch((e: any) => log.error('[Digest] role run failed', { role, error: e.message }))
  }
}

/** Сгенерировать дайджест для НаWоде-бизнесов (или конкретного). force = игнорировать дневной дедуп.
 *  role: 'full' (ручная кнопка — пачка идей) | morning/day/evening (одна сторис ритма). */
export async function runDailyDigest(opts?: { businessId?: string; force?: boolean; role?: DigestRole }): Promise<{ created: number }> {
  // Бизнесы с настроенным источником данных (erpType) — generic, не литерал 'nawode'.
  const businesses = await db.business.findMany({
    where: opts?.businessId ? { id: opts.businessId } : { erpType: { not: null }, isActive: true },
    include: { platformAccounts: { where: { isActive: true } } },
  })

  const role: DigestRole = opts?.role ?? 'full'
  let created = 0
  for (const biz of businesses) {
    try {
      created += await generateDigestForBusiness(biz, opts?.force === true, role)
    } catch (err: any) {
      log.error('[Digest] business error', { business: biz.slug, error: err.message })
    }
  }
  log.info('[Digest] done', { created, role })
  return { created }
}

async function generateDigestForBusiness(biz: any, force: boolean, role: DigestRole = 'full'): Promise<number> {
  // Авто-архив (Ф1.4): неразобранные proposed прошлых дней → archived (в дайджесте показываем только сегодняшние)
  const todayStart = new Date(); todayStart.setUTCHours(0, 0, 0, 0)
  const archived = await db.autoPostTask.updateMany({
    where: { businessId: biz.id, source: 'digest', status: 'proposed', createdAt: { lt: todayStart } },
    data: { status: 'archived' },
  })
  if (archived.count > 0) log.info('[Digest] archived stale proposals', { business: biz.slug, count: archived.count })

  // Идемпотентность ЛЕГАСИ-прогона ('full'): не плодить дубли в один день (если не force).
  // Ролевые прогоны (morning/day/evening) дедупятся per-slot в checkAndRunDigestRoles — здесь не блокируем.
  if (role === 'full' && !force) {
    const today = new Date(); today.setUTCHours(0, 0, 0, 0)
    const existing = await db.autoPostTask.count({
      where: { businessId: biz.id, source: 'digest', createdAt: { gte: today }, status: { in: ['proposed'] } },
    })
    if (existing > 0) {
      log.info('[Digest] already has suggestions today', { business: biz.slug })
      return 0
    }
  }

  const adapter = getDataSourceAdapter(biz)
  const data = await adapter.getDailySummary(3)
  const hotSlots = await adapter.getHotSlots(7).catch(() => [])
  let brandContext = await buildBrandContext(biz.id)
  // ВАЖНЫЕ ФАКТЫ бизнеса (напр. переезд проката Тапиола→скала) — агент должен ВСЕГДА их знать,
  // чтобы не вводить клиентов в заблуждение + периодически мягко напоминать. Только публично-безопасное.
  // Одна точка инъекции (brandContext) → видят ВСЕ промпты (стратег/роль/копирайтер/вакансия/адаптация).
  const keyFacts = await getConfig('digest_key_facts')
  if (keyFacts) brandContext += `\n\n## ВАЖНЫЕ ФАКТЫ (помни всегда; можно периодически мягко напоминать клиентам):\n${keyFacts}`
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

  // Анти-повтор МЕЖДУ днями: история предложений дайджеста за 7 дней (ВСЕ статусы — proposed/archived/
  // approved/rejected). Без этого стратег не видел вчерашние идеи (Post создаётся лишь при одобрении,
  // а юзер часто не одобряет) и каждый день предлагал одно и то же.
  const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)
  const recentTasks = await db.autoPostTask.findMany({
    where: { businessId: biz.id, source: 'digest', createdAt: { gte: weekAgo } },
    orderBy: { createdAt: 'desc' },
    take: 25,
    select: { title: true, proposedText: true, postType: true, aiReasoning: true, createdAt: true },
  })
  const recentProposals = recentTasks
    .map(t => {
      const d = t.createdAt.toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit' })
      const topic = t.title || (t.proposedText || '').replace(/\s+/g, ' ').slice(0, 80)
      const why = t.aiReasoning ? ` — ${t.aiReasoning.replace(/\s+/g, ' ').slice(0, 60)}` : ''
      return `- ${d} [${t.postType}] ${topic}${why}`
    })
    .join('\n') || 'ещё ничего не предлагалось'

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
      `${d.date}: ${d.tempMax ?? '?'}°C (днём ~${d.tempAvg ?? '?'}°C), ${windLabel(d.windMax)}, ${d.label}${d.precipMm ? `, осадки ${d.precipMm}мм` : ''}`
    ).join('\n') || 'нет прогноза'
    const b = data.bookings.length
      ? data.bookings.map(d => `${d.date}: ${d.bookings} брони, ${d.people} чел.`).join('\n')
      : 'на ближайшие дни броней в базе нет (ранний сезон — делай акцент на приглашении и погоде)'
    dataBlock = `ПОГОДА (Выборг, набережная):\n${w}\n\nБРОНИРОВАНИЯ:\n${b}`
  }

  // «Горячие» слоты (где уже есть записанные) — вход для слот-филла (утренняя/дневная сторис)
  const todayStr = now.toISOString().slice(0, 10)
  const hotSlotsBlock = hotSlots.length
    ? hotSlots.slice(0, 6).map((s: any) => {
        const when = s.date === todayStr ? 'сегодня' : s.date
        const room = s.remaining != null ? `, осталось ~${s.remaining} мест` : ''
        const what = s.tourName || (s.serviceType === 'RENTAL' ? 'прокат' : s.serviceType || 'слот')
        return `- ${when} ${s.startTime || ''} ${what}: уже ${s.peopleBooked} чел.${room}`.replace(/ +/g, ' ').trim()
      }).join('\n')
    : 'горячих слотов нет (нет предстоящих броней — делай акцент на погоде и приглашении)'

  // Промо (Фаза 3, opt-in digest_promo_enabled): анонсируем ТОЛЬКО реально заведённые в ERP
  // скидки (этап 1 — без flash несуществующих). Вечерняя сторис — про завтра, остальные — про
  // сегодня. Грейсфул '' при ошибке/выключенном флаге → промпты блок не показывают.
  let promoBlock = ''
  let promoBadge: string | null = null
  if ((await getConfig('digest_promo_enabled')) === 'true') {
    const promoDate = role === 'evening'
      ? new Date(now.getTime() + 24 * 60 * 60 * 1000).toISOString().slice(0, 10)
      : todayStr
    const discounts = await adapter.getActiveDiscounts(promoDate).catch(() => [])
    const { buildPromoBlock, buildPromoBadge } = await import('./promo/promo-block')
    promoBlock = buildPromoBlock(discounts, { dateLabel: role === 'evening' ? 'на завтра' : 'на сегодня' })
    promoBadge = buildPromoBadge(discounts) // плашка скидки НА КАРТИНКУ дизайн-сторис
  }

  // Дедуп фото МЕЖДУ ДНЯМИ: кадры из предложений за 10 дней → не повторять (исходные фото дизайн-сторис тоже)
  const recentPhotoIds = await getRecentlyUsedPhotoIds(biz.id, 10).catch(() => new Set<string>())

  const rubrics = await getRubricNames(biz.id)
  const ctx: DigestContext = {
    dayName: dayNames[now.getDay()],
    dateStr,
    brandContext,
    strategyText,
    seasonHint: getSeasonHint(seasonHints, now.getMonth()),
    rubrics,
    dataBlock,
    hotSlotsBlock,
    recentSummary,
    recentProposals,
    competitorBlock,
    platforms,
    todayTemp: data?.weather?.[0]?.tempMax != null ? `+${Math.round(data.weather[0].tempMax)}°` : null,
    todayWeather: data?.weather?.[0]?.windMax != null ? windLabel(data.weather[0].windMax) : null,
    promoBlock,
    promoBadge,
  }

  let suggestions: Suggestion[] = []
  if (role === 'full') {
    // ЛЕГАСИ-прогон (ручная кнопка): команда агентов (стратег → копирайтер → арт-директор) + fallback single-shot.
    try {
      suggestions = await runAgentTeam(biz.id, ctx, 3, recentPhotoIds)
    } catch (err: any) {
      log.warn('[Digest] agent team failed → fallback to single-shot', { business: biz.slug, error: err.message })
    }
    if (!suggestions.length) {
      suggestions = await runSingleShot(biz.id, ctx).catch((e: any) => {
        log.error('[Digest] single-shot failed', { business: biz.slug, error: e.message })
        return [] as Suggestion[]
      })
    }
  } else {
    // РИТМ-прогон: ОДНА сторис под роль (свежие данные на момент прогона).
    const story = await runRoleStory(biz.id, ctx, role, recentPhotoIds).catch((e: any) => {
      log.warn('[Digest] role story failed', { business: biz.slug, role, error: e.message })
      return null
    })
    if (story) suggestions.push(story)
    // Лента — в утреннем прогоне на feed-день (opt-in digest_feed_days, напр. "1,2,3,4,5"; 0=вс)
    if (role === 'morning') {
      const feedDays = ((await getConfig('digest_feed_days')) || '').split(',').map(s => s.trim()).filter(Boolean)
      if (feedDays.includes(String(now.getUTCDay()))) {
        const feed = await runAgentTeam(biz.id, ctx, 1, recentPhotoIds).catch(() => [] as Suggestion[])
        suggestions.push(...feed)
      }
      // Погодный flash (Фаза 3, этап 2): «распогодилось + свободно сегодня» → разовая скидка.
      // Полу-ручной: предлагаем сторис + инструкцию завести скидку в ERP (в reasoning). Дедуп — общий
      // с утренним прогоном (раз/день). Пороги/глубина — через AppConfig digest_flash_* (иначе дефолты).
      if ((await getConfig('digest_flash_enabled')) === 'true') {
        const num = async (k: string): Promise<number | undefined> => {
          const v = await getConfig(k)
          return v != null && v !== '' ? Number(v) : undefined
        }
        const todayWeather = data?.weather?.find(w => w.date === todayStr) || data?.weather?.[0] || null
        const bookingsToday = data?.bookings?.find(b => b.date === todayStr)?.bookings ?? 0
        const signal = evaluateWeatherFlash({
          weatherToday: todayWeather,
          bookingsToday,
          conditions: {
            minTemp: await num('digest_flash_min_temp'),
            maxWind: await num('digest_flash_max_wind'),
            maxPrecip: await num('digest_flash_max_precip'),
            percent: await num('digest_flash_percent'),
            maxBookings: await num('digest_flash_max_bookings'),
          },
        })
        if (signal.triggered) {
          const weatherLine = todayWeather
            ? `${todayWeather.tempMax ?? '?'}°, ${todayWeather.label}, ${windLabel(todayWeather.windMax)}`
            : 'тепло'
          const flash = await runFlashStory(biz.id, ctx, signal, weatherLine, recentPhotoIds).catch((e: any) => {
            log.warn('[Digest] flash story failed', { business: biz.slug, error: e.message }); return null
          })
          if (flash) suggestions.push(flash)
        } else {
          log.info('[Digest] flash skipped', { business: biz.slug, reason: signal.reason })
        }
      }
      // Набор инструкторов — еженедельно (по умолч. среда dow=3), ТОЛЬКО VK (opt-in digest_recruitment_enabled)
      if ((await getConfig('digest_recruitment_enabled')) === 'true') {
        const recDay = ((await getConfig('digest_recruitment_day')) || '3').trim()
        if (String(now.getUTCDay()) === recDay) {
          const contact = (await getConfig('digest_recruitment_contact')) || 'пишите в сообщения сообщества'
          const recChannels = ((await getConfig('digest_recruitment_channels')) || 'VK').split(',').map(s => s.trim().toUpperCase()).filter(Boolean)
          const rec = await runRecruitmentPost(biz.id, ctx, contact, recChannels).catch((e: any) => {
            log.warn('[Digest] recruitment failed', { business: biz.slug, error: e.message }); return null
          })
          if (rec) suggestions.push(rec)
        }
      }
    }
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
        title: s.title ? cleanStoryTitle(s.title) : null, // чистим заголовок для ВСЕХ генераторов (роль/лента/flash)
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
      NOT: { tags: { has: 'ai-generated' } }, // только реальные фото — не AI-генерация/макеты
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

/**
 * Фото, уже использованные в предложениях дайджеста за последние `days` дней — чтобы НЕ
 * повторять один кадр изо дня в день (баг: дедуп жил только в памяти одного прогона).
 * Дизайн-сторис хранит baked-PNG в mediaFileId, а исходное фото — в sourceMediaId; возвращаем
 * И то и другое (исключаем исходные фото из кандидатов; baked и так отсеяны тегом ai-generated).
 */
async function getRecentlyUsedPhotoIds(businessId: string, days = 10): Promise<Set<string>> {
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000)
  const tasks = await db.autoPostTask.findMany({
    where: { businessId, mediaFileId: { not: null }, createdAt: { gte: since } },
    select: { mediaFileId: true },
  })
  const ids = tasks.map(t => t.mediaFileId).filter((x): x is string => !!x)
  const used = new Set<string>(ids)
  if (ids.length) {
    const files = await db.mediaFile.findMany({
      where: { id: { in: ids }, sourceMediaId: { not: null } },
      select: { sourceMediaId: true },
    })
    for (const f of files) if (f.sourceMediaId) used.add(f.sourceMediaId) // исходное фото дизайн-сторис
  }
  return used
}

/** Арт-директор: выбирает лучшее фото из галереи под пост (null, если ничего не подходит). */
async function pickPhotoForPost(
  businessId: string,
  brief: { theme: string; format: string; text: string; photoKeywords: string[] },
  excludeIds: Set<string> = new Set(),
): Promise<string | null> {
  const found = await searchGalleryPhotos(businessId, brief.photoKeywords, 16)
  let candidates = found.filter(c => !excludeIds.has(c.id)) // дедуп: не повторять недавние/уже выбранные фото
  // Дедуп исчерпал всех кандидатов под тему → лучше ПОВТОРИТЬ фото, чем оставить пост без картинки.
  if (!candidates.length && found.length) {
    log.info('[Digest] dedup exhausted candidates — allowing reuse', { businessId, keywords: brief.photoKeywords })
    candidates = found
  }
  if (!candidates.length) return null
  if (candidates.length === 1) return candidates[0].id

  const { aiComplete } = await import('./ai/openrouter')
  const res = await aiComplete({
    model: config.models.haiku, // выбор из списка — простая задача, Haiku дешевле
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
      model: config.models.haiku,
      systemPrompt: buildAdaptPrompt(platform, brandContext),
      userPrompt: masterText,
      maxTokens: 1000,
      businessId,
      action: 'daily_digest',
    })
    // Вырезаем инлайн-теги: источник правды = массив hashtags (иначе паблишер задублирует, см. utils/hashtags)
    const text = stripInlineHashtags((res.content || '').trim() || masterText)
    // TG: хэштеги не работают для discovery; IG: кап ≤5 (лимит 2025); VK: мастер-теги
    const hashtags = platform === 'TELEGRAM' ? [] : platform === 'INSTAGRAM' ? masterTags.slice(0, IG_HASHTAG_CAP) : masterTags
    return { platform, text, hashtags }
  }))
  return results
    .filter((r): r is PromiseFulfilledResult<PlatformAdaptation> => r.status === 'fulfilled')
    .map(r => r.value)
}

/** Цепочка ролей: стратег (1 вызов) → по каждой идее копирайтер + адаптация + арт-директор (параллельно).
 *  count — сколько идей просить (3 для легаси-дайджеста, 1 для ленты в ритм-прогоне). */
async function runAgentTeam(businessId: string, ctx: DigestContext, count = 3, excludeSeed: Set<string> = new Set()): Promise<Suggestion[]> {
  const { aiComplete } = await import('./ai/openrouter')

  // РОЛЬ 1 — Стратег: темы дня
  const stratRes = await aiComplete({
    model: 'anthropic/claude-sonnet-4',
    systemPrompt: buildDigestStrategistPrompt({ ...ctx, count }),
    userPrompt: 'Предложи идеи контента на сегодня. Ответь JSON.',
    maxTokens: 1500,
    temperature: 0.9, // разнообразие: иначе одинаковый вход → одинаковые идеи каждый день
    businessId,
    action: 'daily_digest',
  })
  const ideas = parseJsonLoose<{ ideas: any[] }>(stratRes.content || '')?.ideas || []
  if (!ideas.length) throw new Error('strategist returned no ideas')

  // РОЛИ 2+3 — копирайтер + адаптация + арт-директор по каждой идее.
  // Последовательно (не параллельно) ради ДЕДУПА фото: usedMediaIds копит уже выбранные кадры.
  const suggestions: Suggestion[] = []
  const usedMediaIds = excludeSeed // тот же объект — дедуп между днями (seed) + накопление в этом прогоне
  for (const idea of ideas.slice(0, Math.max(1, count))) {
    try {
      // Ф1.6: только PHOTO/STORIES (каждый пост с фото). Любой другой формат → PHOTO.
      const format = String(idea.format || 'PHOTO').toUpperCase() === 'STORIES' ? 'STORIES' : 'PHOTO'
      // Каналы: channels[] ∩ доступные; fallback — первый доступный (back-compat со старым полем channel)
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
      if (!copy?.text) continue
      // Хэштеги — только в массиве copy.hashtags; вырезаем их из текста (анти-дубль при публикации).
      // Чистим РАНО: чистый мастер-текст уходит и в адаптации, и в заголовок дизайн-сторис.
      copy.text = stripInlineHashtags(copy.text)

      // Адаптация под каналы. STORIES = короткая подпись-оверлей (без ленточной адаптации и хэштегов);
      // PHOTO = полная адаптация текста ленты под каждую платформу.
      const adaptations = format === 'STORIES'
        ? channels.map(p => ({ platform: p, text: copy.text, hashtags: [] as string[] }))
        : await adaptForPlatforms(copy.text, copy.hashtags || [], channels, ctx.brandContext, businessId)

      // РОЛЬ 3 — Арт-директор (реальное фото, не повторяя уже выбранные в этом дайджесте)
      let mediaFileId: string | null = null
      if (format === 'PHOTO' || format === 'STORIES') {
        const photoId = await pickPhotoForPost(businessId, {
          theme: idea.theme, format, text: copy.text, photoKeywords: idea.photoKeywords || [],
        }, usedMediaIds).catch(() => null)
        if (photoId) usedMediaIds.add(photoId)
        mediaFileId = photoId
        // STORIES → авто-собрать дизайн-картинку (фото-фон + текст-оверлей + погодный виджет + лого)
        if (format === 'STORIES' && photoId) {
          const photo = await db.mediaFile.findUnique({ where: { id: photoId }, select: { url: true } })
          if (photo) {
            const design = await renderAndSaveStoryDesign({
              businessId, photoUrl: photo.url, title: idea.theme || copy.text,
              temp: ctx.todayTemp, weather: ctx.todayWeather, cta: 'Записаться · nawode.ru', promo: ctx.promoBadge,
              sourceMediaId: photoId, // исходное фото — чтобы потом переоформить кадр
            }).catch((e: any) => { log.warn('[Digest] story design failed', { error: e.message }); return null })
            if (design) mediaFileId = design.id
          }
        }
      }

      suggestions.push({
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
      })
    } catch (err: any) {
      log.warn('[Digest] idea failed', { error: err.message })
    }
  }
  return suggestions
}

/**
 * Ритм (Ф2): ОДНА сторис под роль времени дня. Один Sonnet (стратегия + копия сразу — для сторис
 * per-platform адаптация не нужна) → арт-директор выбирает реальное фото → дизайн-слой (satori).
 * Данные (погода/hotSlots) уже свежие в ctx (собраны на момент прогона).
 */
async function runRoleStory(businessId: string, ctx: DigestContext, role: DigestStoryRole, excludeIds: Set<string> = new Set()): Promise<Suggestion | null> {
  const { aiComplete } = await import('./ai/openrouter')
  const res = await aiComplete({
    model: 'anthropic/claude-sonnet-4',
    systemPrompt: buildDigestRoleStoryPrompt(role, ctx),
    userPrompt: 'Сделай сторис на сейчас. Ответь JSON.',
    maxTokens: 900,
    temperature: 0.9,
    businessId,
    action: 'daily_digest',
  })
  const idea = parseJsonLoose<{ rubric?: string; theme?: string; text?: string; photoKeywords?: string[]; reasoning?: string }>(res.content || '')
  if (!idea?.text) return null
  const text = stripInlineHashtags(idea.text) // хэштеги в сторис не нужны; страхуемся

  const channels = ctx.platforms.length ? ctx.platforms : ['VK']

  // Арт-директор — реальное фото из галереи под тему сторис
  let mediaFileId: string | null = await pickPhotoForPost(businessId, {
    theme: idea.theme || text, format: 'STORIES', text, photoKeywords: idea.photoKeywords || [],
  }, excludeIds).catch(() => null)

  // STORIES → собрать дизайн-картинку (фото-фон + текст + погодный виджет + лого)
  if (mediaFileId) {
    const photo = await db.mediaFile.findUnique({ where: { id: mediaFileId }, select: { url: true } })
    if (photo) {
      const design = await renderAndSaveStoryDesign({
        businessId, photoUrl: photo.url, title: idea.theme || text,
        temp: ctx.todayTemp, weather: ctx.todayWeather, cta: 'Записаться · nawode.ru', promo: ctx.promoBadge,
        sourceMediaId: mediaFileId,
      }).catch((e: any) => { log.warn('[Digest] role story design failed', { error: e.message }); return null })
      if (design) mediaFileId = design.id
    }
  }

  return {
    postType: 'STORIES',
    platforms: channels,
    title: idea.theme ? String(idea.theme).slice(0, 80) : undefined,
    text,
    hashtags: [],
    adaptations: channels.map(p => ({ platform: p, text, hashtags: [] as string[] })),
    visualIdea: idea.theme || undefined,
    rubric: idea.rubric,
    reasoning: idea.reasoning || `Сторис (${role})`,
    mediaFileId,
  }
}

/**
 * Погодный FLASH (Фаза 3, этап 2, ПОЛУ-РУЧНОЙ): разовая скидка «только сегодня», когда
 * распогодилось и есть свободные места. CF лишь ПРЕДЛАГАЕТ сторис — скидку в ERP человек
 * заводит вручную перед публикацией (reasoning содержит явную инструкцию ⚠). Глубина уже
 * обрезана красной линией (signal.suggestedPercent). Рубрика 'акция'.
 */
async function runFlashStory(businessId: string, ctx: DigestContext, signal: FlashSignal, weatherLine: string, excludeIds: Set<string> = new Set()): Promise<Suggestion | null> {
  const { aiComplete } = await import('./ai/openrouter')
  const res = await aiComplete({
    model: 'anthropic/claude-sonnet-4',
    systemPrompt: buildFlashStoryPrompt({
      dayName: ctx.dayName, dateStr: ctx.dateStr, brandContext: ctx.brandContext,
      seasonHint: ctx.seasonHint, weatherLine,
      percent: signal.suggestedPercent, serviceLabel: signal.serviceLabel,
    }),
    userPrompt: 'Сделай flash-сторис на сегодня. Ответь JSON.',
    maxTokens: 700,
    temperature: 0.9,
    businessId,
    action: 'daily_digest',
  })
  const idea = parseJsonLoose<{ theme?: string; text?: string; photoKeywords?: string[]; reasoning?: string }>(res.content || '')
  if (!idea?.text) return null
  const text = stripInlineHashtags(idea.text)
  const channels = ctx.platforms.length ? ctx.platforms : ['VK']

  let mediaFileId: string | null = await pickPhotoForPost(businessId, {
    theme: idea.theme || text, format: 'STORIES', text, photoKeywords: idea.photoKeywords || [],
  }, excludeIds).catch(() => null)
  if (mediaFileId) {
    excludeIds.add(mediaFileId) // исходное фото — не повторять в последующих генераторах этого прогона
    const photo = await db.mediaFile.findUnique({ where: { id: mediaFileId }, select: { url: true } })
    if (photo) {
      const design = await renderAndSaveStoryDesign({
        businessId, photoUrl: photo.url, title: idea.theme || text,
        temp: ctx.todayTemp, weather: ctx.todayWeather, cta: 'Записаться · nawode.ru',
        promo: `Прокат −${signal.suggestedPercent}% сегодня`,
        sourceMediaId: mediaFileId,
      }).catch((e: any) => { log.warn('[Digest] flash story design failed', { error: e.message }); return null })
      if (design) mediaFileId = design.id
    }
  }

  // ⚠ ПОЛУ-РУЧНОЙ: явная инструкция человеку — завести скидку в ERP ПЕРЕД публикацией.
  const erpHint = `⚠ ДО публикации заведи в ERP разовую скидку −${signal.suggestedPercent}% на ${signal.serviceLabel} на сегодня (service_slot_overrides у нужного слота) — иначе клиент не получит цену.`

  return {
    postType: 'STORIES',
    platforms: channels,
    title: idea.theme ? String(idea.theme).slice(0, 80) : 'Flash-скидка',
    text,
    hashtags: [],
    adaptations: channels.map(p => ({ platform: p, text, hashtags: [] as string[] })),
    visualIdea: idea.theme || undefined,
    rubric: 'акция',
    reasoning: `${idea.reasoning || 'Погодный flash'} ${erpHint}`,
    mediaFileId,
  }
}

/**
 * Набор инструкторов (еженедельно, ~среда): ВК-пост-вакансия. ТОЛЬКО VK (не Instagram — решение Юрия).
 * PHOTO-пост (вакансия = постоянный пост, не эфемерная сторис) + фото команды из галереи.
 */
async function runRecruitmentPost(businessId: string, ctx: DigestContext, contact: string, allowedChannels: string[]): Promise<Suggestion | null> {
  const { aiComplete } = await import('./ai/openrouter')
  const res = await aiComplete({
    model: 'anthropic/claude-sonnet-4',
    systemPrompt: buildDigestRecruitmentPrompt(ctx, contact),
    userPrompt: 'Напиши пост о наборе инструкторов. Ответь JSON.',
    maxTokens: 900,
    temperature: 0.8,
    businessId,
    action: 'daily_digest',
  })
  const idea = parseJsonLoose<{ theme?: string; text?: string; photoKeywords?: string[]; hashtags?: string[] }>(res.content || '')
  if (!idea?.text) return null
  const text = stripInlineHashtags(idea.text)
  const hashtags = (idea.hashtags || []).slice(0, 10)

  // Каналы вакансии (по умолчанию только VK; IG-органику можно включить конфигом digest_recruitment_channels)
  const channels = ctx.platforms.filter(p => allowedChannels.includes(p))
  if (!channels.length && allowedChannels.includes('VK')) channels.push('VK')

  const mediaFileId = await pickPhotoForPost(businessId, {
    theme: idea.theme || 'команда НаWоде', format: 'PHOTO', text,
    photoKeywords: idea.photoKeywords?.length ? idea.photoKeywords : ['команда', 'сап'],
  }).catch(() => null)

  return {
    postType: 'PHOTO',
    platforms: channels,
    title: idea.theme ? String(idea.theme).slice(0, 80) : 'Ищем инструкторов',
    text,
    hashtags,
    adaptations: channels.map(p => ({ platform: p, text, hashtags })),
    visualIdea: 'команда на воде',
    rubric: 'Ищем инструкторов',
    reasoning: 'Еженедельный набор инструкторов',
    mediaFileId,
  }
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

УЖЕ ПРЕДЛАГАЛОСЬ В ПОСЛЕДНИЕ ДНИ (предложи ДРУГИЕ темы/углы/рубрики, не повторяй эти):
${ctx.recentProposals}
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
    temperature: 0.9,
    businessId,
    action: 'daily_digest',
  })
  const parsed = parseJsonLoose<any>(res.content || '')
  const list = (Array.isArray(parsed) ? parsed : parsed?.suggestions || []) as Suggestion[]
  // Анти-дубль: вырезаем инлайн-теги из текста (хэштеги остаются в s.hashtags = источник правды).
  return list.map(s => ({ ...s, text: stripInlineHashtags(s.text || '') }))
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
