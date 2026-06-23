/**
 * Auto-Poster — daily AI-powered post generation from Google Photos.
 *
 * Flow:
 * 1. Runs daily at configured time (default 6:00 UTC / 9:00 MSK)
 * 2. Analyzes recent photos from PhotoCatalog using Gemini Vision
 * 3. Selects best photos per business using AI
 * 4. Generates post text + hashtags via Sonnet
 * 5. Creates AutoPostTask records
 * 6. Sends approval messages to Telegram
 *
 * Privacy: only reads from PhotoCatalog (private sync dir).
 * Photos enter CF MediaFile ONLY after user approves in Telegram.
 */

import { db } from '../db'
import { log } from '../utils/logger'
import { buildBrandContext } from './ai/prompt-builder'
import { existsSync } from 'fs'

// --- AppConfig helpers ---
async function getConfig(key: string): Promise<string | null> {
  const row = await db.appConfig.findUnique({ where: { key } })
  return row?.value ?? null
}

async function setConfig(key: string, value: string): Promise<void> {
  await db.appConfig.upsert({
    where: { key },
    create: { key, value },
    update: { value },
  })
}

/** Check if auto-poster should run right now (called every 60s from scheduler) */
export async function checkAndRunAutoPost(): Promise<void> {
  const enabled = await getConfig('autopost_enabled')
  if (enabled !== 'true') return

  const timeUtc = await getConfig('autopost_time_utc') || '06:00'
  const [targetHour, targetMin] = timeUtc.split(':').map(Number)

  const now = new Date()
  if (now.getUTCHours() !== targetHour || now.getUTCMinutes() !== targetMin) return

  // Check if already ran today
  const lastRun = await getConfig('autopost_last_run')
  if (lastRun) {
    const lastDate = new Date(lastRun)
    if (lastDate.toDateString() === now.toDateString()) return  // already ran today
  }

  log.info('[AutoPoster] daily run starting')
  await setConfig('autopost_last_run', now.toISOString())

  try {
    await runAutoPostGeneration()
  } catch (err: any) {
    log.error('[AutoPoster] daily run failed', { error: err.message })
  }
}

/** Analyze recent photos with AI Vision (only unanalyzed, recent ones) */
export async function analyzePhotosForPosting(): Promise<number> {
  const DAYS_BACK = 14
  const BATCH = 20
  const cutoff = new Date(Date.now() - DAYS_BACK * 24 * 60 * 60 * 1000)

  const photos = await db.photoCatalog.findMany({
    where: {
      status: 'indexed',
      mimeType: { startsWith: 'image/' },  // only images, not video
      fileDate: { gte: cutoff },
    },
    orderBy: { fileDate: 'desc' },
    take: BATCH,
  })

  if (photos.length === 0) return 0

  // Load businesses for classification
  const businesses = await db.business.findMany({
    where: { isActive: true },
    select: { id: true, slug: true, name: true, description: true },
  })

  const bizContext = businesses
    .map(b => `- ${b.slug}: ${b.name} — ${b.description || ''}`)
    .join('\n')

  let analyzed = 0

  for (const photo of photos) {
    // Verify file still exists
    if (!existsSync(photo.filePath)) {
      await db.photoCatalog.update({
        where: { id: photo.id },
        data: { status: 'skipped' },
      })
      continue
    }

    try {
      const { aiVision } = await import('./ai/openrouter')

      // Read image as base64 data URL
      const file = Bun.file(photo.filePath)
      const buffer = await file.arrayBuffer()
      const base64 = Buffer.from(buffer).toString('base64')
      const dataUrl = `data:${photo.mimeType};base64,${base64}`

      const systemPrompt = `Ты — AI-классификатор фотографий для SMM-агентства. Определи, к какому бизнесу/проекту относится фото и опиши его.

Доступные проекты:
${bizContext}
- personal: Личное — всё что не относится к бизнесам, личные фото, селфи, еда

ВАЖНО: Если ты не уверен (confidence < 0.7) — ВСЕГДА ставь "personal". Лучше ошибиться в сторону "personal", чем случайно отнести личное фото к бизнесу.

Ответь строго JSON (без markdown):
{"business": "slug", "confidence": 0.0-1.0, "tags": ["тег1", "тег2"], "description": "Описание на русском (1-2 предложения)"}`

      const result = await aiVision({
        model: 'google/gemini-2.0-flash-001',
        systemPrompt,
        userPrompt: 'Классифицируй это фото.',
        imageUrls: [dataUrl],
        maxTokens: 300,
      })

      const text = result.content || ''
      const cleaned = text.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim()
      const parsed = JSON.parse(cleaned)

      // Find business ID by slug
      const matchedBiz = businesses.find(b => b.slug === parsed.business)

      await db.photoCatalog.update({
        where: { id: photo.id },
        data: {
          status: 'analyzed',
          aiDescription: parsed.description || null,
          aiBusiness: parsed.business || 'personal',
          aiConfidence: parsed.confidence ?? 0.5,
          aiTags: parsed.tags || [],
          aiAnalyzedAt: new Date(),
        },
      })

      analyzed++
    } catch (err: any) {
      log.error('[AutoPoster] classify error', { photoId: photo.id, error: err.message })
    }
  }

  log.info('[AutoPoster] analyzed photos', { count: analyzed })
  return analyzed
}

/** Main auto-post generation: select photos, generate posts, create tasks */
export async function runAutoPostGeneration(): Promise<void> {
  // Step 1: Analyze recent photos
  await analyzePhotosForPosting()

  // Step 2: For each active business, find best photos and generate posts
  const businesses = await db.business.findMany({
    where: { isActive: true },
    include: { brandProfile: true, platformAccounts: true },
  })

  for (const biz of businesses) {
    // Skip businesses without platform accounts
    if (biz.platformAccounts.length === 0) continue

    try {
      await generatePostForBusiness(biz)
    } catch (err: any) {
      log.error('[AutoPoster] generate error', { business: biz.slug, error: err.message })
    }
  }
}

async function generatePostForBusiness(business: any): Promise<void> {
  // Find analyzed photos for this business (recent, not yet posted)
  const candidates = await db.photoCatalog.findMany({
    where: {
      status: 'analyzed',
      aiBusiness: business.slug,
      aiConfidence: { gte: 0.6 },
    },
    orderBy: { fileDate: 'desc' },
    take: 5,
  })

  if (candidates.length === 0) {
    log.info('[AutoPoster] no candidates', { business: business.slug })
    return
  }

  // Check if we already have pending/proposed tasks for this business today
  const today = new Date()
  today.setUTCHours(0, 0, 0, 0)
  const existingToday = await db.autoPostTask.count({
    where: {
      businessId: business.id,
      createdAt: { gte: today },
      status: { in: ['pending', 'proposed'] },
    },
  })

  if (existingToday > 0) {
    log.info('[AutoPoster] already has tasks today', { business: business.slug })
    return
  }

  // Get recent posts to avoid repetition
  const recentPosts = await db.post.findMany({
    where: { businessId: business.id },
    orderBy: { createdAt: 'desc' },
    take: 10,
    select: { body: true, createdAt: true },
  })

  const recentTopics = recentPosts.map(p => p.body?.slice(0, 100) || '').join('\n')

  // Select best photo (first candidate)
  const selectedPhoto = candidates[0]

  // Generate post text
  const brandContext = await buildBrandContext(business.id)
  const { aiComplete } = await import('./ai/openrouter')

  const dayNames = ['воскресенье', 'понедельник', 'вторник', 'среда', 'четверг', 'пятница', 'суббота']
  const dayOfWeek = dayNames[new Date().getDay()]
  const month = new Date().toLocaleDateString('ru-RU', { month: 'long' })

  const systemPrompt = `Ты — SMM-менеджер. Напиши пост для соцсетей на основе фотографии.

${brandContext}

Сегодня: ${dayOfWeek}, ${month} ${new Date().getFullYear()}

Описание фото: ${selectedPhoto.aiDescription || 'нет описания'}
Теги фото: ${selectedPhoto.aiTags?.join(', ') || 'нет'}

Недавние посты (не повторяйся):
${recentTopics || 'нет постов'}

Требования:
- Текст 200-500 символов (компактный, живой)
- Тон соответствует бренду
- Привязка к фото (опиши что на фото, добавь контекст)
- Без воды, каждое слово — ценность

Ответь строго JSON (без markdown):
{"text": "текст поста", "hashtags": ["тег1", "тег2"], "reasoning": "почему выбрано это фото (1 предложение)"}`

  const result = await aiComplete({
    model: 'anthropic/claude-sonnet-4.6', // актуальный Sonnet (та же цена $3/$15)
    systemPrompt,
    userPrompt: 'Сгенерируй пост для этого фото.',
    maxTokens: 500,
  })

  const text = result.content || ''
  const cleaned = text.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim()

  let postData: { text: string; hashtags: string[]; reasoning: string }
  try {
    postData = JSON.parse(cleaned)
  } catch {
    log.error('[AutoPoster] failed to parse post JSON', { response: cleaned.slice(0, 200) })
    return
  }

  // Determine platforms from business platform accounts
  const platforms = [...new Set(business.platformAccounts.map((pa: any) => pa.platform))]

  // Create AutoPostTask
  await db.autoPostTask.create({
    data: {
      businessId: business.id,
      catalogId: selectedPhoto.id,
      status: 'proposed',
      proposedText: postData.text,
      proposedTags: postData.hashtags || [],
      aiReasoning: postData.reasoning || null,
      platforms,
      proposedAt: new Date(),
    },
  })

  log.info('[AutoPoster] task created', {
    business: business.slug,
    photo: selectedPhoto.filePath,
    platforms,
  })

  // Send to Telegram approval (if configured)
  try {
    const { sendApprovalToTelegram } = await import('./telegram-approval')
    const task = await db.autoPostTask.findFirst({
      where: { catalogId: selectedPhoto.id, status: 'proposed' },
      orderBy: { createdAt: 'desc' },
    })
    if (task) {
      await sendApprovalToTelegram(task, selectedPhoto, business)
    }
  } catch (err: any) {
    // Telegram not configured yet — that's OK, tasks still visible in web UI
    log.warn('[AutoPoster] telegram notification skipped', { error: err.message })
  }
}
