// Поиск/дедуп фото галереи для дайджеста (read-only Prisma).
// Вынесено из daily-digest.ts: detectRouteFolder (папка-маршрут по тексту поста),
// searchGalleryPhotos (по altText / жёстко из папки-маршрута), getRecentlyUsedPhotoIds
// (анти-повтор кадра за N дней, с разворотом baked→sourceMediaId).
import { db } from '../../db'

/**
 * Папка-маршрут по ТЕКСТУ поста (тема+тело), а НЕ по photoKeywords: агент кладёт в keywords
 * «сап/скалы/вода», а название маршрута («Беличьи») — в тему. Папка матчится, если ВСЕ значимые
 * слова её названия (≥4 букв) есть в тексте: «Беличьи скалы…»→«Беличьи», «тур Место силы»→«Место Силы».
 * Самое длинное совпадение приоритетно (специфичнее). null — маршрут не распознан.
 */
export async function detectRouteFolder(businessId: string, text: string): Promise<string | null> {
  const t = (text || '').toLowerCase()
  if (!t) return null
  const folders = await db.mediaFolder.findMany({ where: { businessId }, select: { name: true } })
  const matched = folders
    .map(f => f.name)
    .filter(name => {
      const words = (name || '').toLowerCase().split(/\s+/).filter(w => w.length >= 4)
      return words.length > 0 && words.every(w => t.includes(w))
    })
    .sort((a, b) => b.length - a.length)
  return matched[0] || null
}

/** Поиск реальных фото в галерее: по altText, ИЛИ ЖЁСТКО из папки-маршрута (Беличьи/Монрепо/…), если она задана. */
export async function searchGalleryPhotos(businessId: string, keywords: string[], limit = 12, routeFolder?: string | null): Promise<{ id: string; altText: string }[]> {
  const kw = (keywords || []).map(k => String(k).trim().toLowerCase()).filter(Boolean)
  const score = (alt: string | null) => kw.filter(k => (alt || '').toLowerCase().includes(k)).length

  // Тема про конкретный маршрут → берём ТОЛЬКО фото из его папки (важнее keyword-совпадений по altText),
  // ранжируя их по релевантности keywords. Так пост «Беличьи» не получит фото Монрепо.
  if (routeFolder) {
    const rows = await db.mediaFile.findMany({
      where: {
        businessId, mimeType: { startsWith: 'image/' },
        NOT: { tags: { has: 'ai-generated' } },
        folder: { name: { equals: routeFolder, mode: 'insensitive' as const } },
      },
      select: { id: true, altText: true },
      take: 40,
    })
    if (rows.length) {
      return rows
        .map(r => ({ id: r.id, altText: r.altText || '', s: score(r.altText) }))
        .sort((a, b) => b.s - a.s)
        .slice(0, limit)
        .map(({ id, altText }) => ({ id, altText }))
    }
    // папка пуста — падаем на обычный поиск по keywords
  }

  if (!kw.length) return []
  const rows = await db.mediaFile.findMany({
    where: {
      businessId, mimeType: { startsWith: 'image/' }, altText: { not: null },
      NOT: { tags: { has: 'ai-generated' } },
      OR: kw.map(k => ({ altText: { contains: k, mode: 'insensitive' as const } })),
    },
    select: { id: true, altText: true },
    take: 50,
  })
  return rows
    .map(r => ({ id: r.id, altText: r.altText || '', s: score(r.altText) }))
    .sort((a, b) => b.s - a.s)
    .slice(0, limit)
    .map(({ id, altText }) => ({ id, altText }))
}

/**
 * Фото, уже использованные в предложениях дайджеста за последние `days` дней — чтобы НЕ
 * повторять один кадр изо дня в день (баг: дедуп жил только в памяти одного прогона).
 * Дизайн-сторис хранит baked-PNG в mediaFileId, а исходное фото — в sourceMediaId; возвращаем
 * И то и другое (исключаем исходные фото из кандидатов; baked и так отсеяны тегом ai-generated).
 */
export async function getRecentlyUsedPhotoIds(businessId: string, days = 10): Promise<Set<string>> {
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
