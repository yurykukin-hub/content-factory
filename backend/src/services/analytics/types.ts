import type { Platform } from '@prisma/client'

/**
 * Типы слоя SMM-аналитики (Эпик B).
 * Адаптеры площадок отдают нормализованные метрики, коллектор пишет snapshots.
 */

/** Опубликованная версия поста — вход для адаптера (что собирать). */
export interface PublishedRef {
  postId: string
  postVersionId: string
  externalPostId: string          // VK post_id / Postmypost publication id
  publicationType: string         // POST | STORY | REELS (из Post.postType)
  externalUrl?: string | null
}

/** Нормализованная метрика поста, собранная с площадки. */
export interface CollectedPostMetric {
  source: string                  // VK | POSTMYPOST | TELEGRAM
  platform: Platform
  publicationType: string         // POST | STORY | REELS
  externalId: string              // VK post_id / IG media id (канонический id у площадки)
  externalUrl?: string | null
  postId?: string | null          // best-effort связь с CF Post
  postVersionId?: string | null
  impressions?: number | null
  reach?: number | null
  views?: number | null
  likes?: number | null
  comments?: number | null
  shares?: number | null
  saves?: number | null
  storyExits?: number | null
  storyReplies?: number | null
  engagementRate?: number | null
  raw: unknown
}

/** Метрика аккаунта/профиля (time-series): подписчики, охват профиля и т.п. */
export interface CollectedAccountMetric {
  source: string
  platform: Platform
  accountExternalId: string
  metricCode: string              // followers | reach | profile_views | ...
  value: number
  metricDate: string              // YYYY-MM-DD
  raw?: unknown
}

/** Веб-трафик из Яндекс.Метрики по UTM (мост соцтрафик → конверсии). */
export interface CollectedSiteTraffic {
  counterId: string
  utmSource?: string | null
  utmMedium?: string | null
  utmCampaign?: string | null
  utmContent?: string | null      // = postId
  postId?: string | null
  metricDate: string              // YYYY-MM-DD
  visits: number
  users?: number | null
  bounceRate?: number | null
  goalReaches?: Record<string, number>
  raw: unknown
}

/** Утилита: разбить массив на чанки. */
export function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = []
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size))
  return out
}

/** Формат даты YYYY-MM-DD (UTC). */
export function ymd(d: Date): string {
  return d.toISOString().slice(0, 10)
}

/** Округление до 2 знаков. */
export function round2(n: number): number {
  return Math.round(n * 100) / 100
}
