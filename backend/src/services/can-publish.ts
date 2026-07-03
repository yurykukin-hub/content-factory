// Единый источник правды «можно ли публиковать сейчас».
// Заменяет три расходившихся фронтовых определения (DigestView / PostEditorView / StoryEditorView).
// Вызывается из GET /api/feed → populate item.canPublishNow. Фронт больше сам не считает.

/** Лимиты символов по площадкам (совпадают с промптами адаптации prompt-builder.ts). */
export const PLATFORM_CHAR_LIMITS: Record<string, number> = {
  VK: 4000,
  TELEGRAM: 4096,
  INSTAGRAM: 2200,
}
const DEFAULT_CHAR_LIMIT = 4000

export interface CanPublishInput {
  postType?: string | null
  text?: string | null
  platforms?: string[] | null
  /** массив медиа (или один объект) — присутствие важнее содержимого */
  media?: unknown
  /** per-platform превью {platform, text} — для проверки лимита адаптированного текста */
  previews?: { platform?: string | null; text?: string | null }[] | null
}

export interface CanPublishResult {
  ok: boolean
  reason?: string
}

function hasMediaPresent(media: unknown): boolean {
  if (!media) return false
  if (Array.isArray(media)) return media.length > 0
  return true
}

/**
 * Можно ли опубликовать элемент прямо сейчас.
 * - STORIES/PHOTO: нужен baked/медиа (картинка/оформление присутствует).
 * - Текстовый пост: ≥1 выбранный канал И непустой текст в пределах лимита символов площадки.
 */
export function canPublishNow(item: CanPublishInput): CanPublishResult {
  const platforms = (item.platforms || []).filter(Boolean)
  const postType = (item.postType || 'TEXT').toUpperCase()

  if (!platforms.length) {
    return { ok: false, reason: 'Выберите хотя бы один канал' }
  }

  if (postType === 'STORIES' || postType === 'PHOTO') {
    if (!hasMediaPresent(item.media)) {
      return { ok: false, reason: 'Добавьте фото/оформление' }
    }
    return { ok: true }
  }

  // Текстовый пост (TEXT/VIDEO/REELS/CLIPS с подписью): нужен непустой текст в лимите.
  const master = (item.text || '').trim()
  if (!master) {
    return { ok: false, reason: 'Пустой текст' }
  }

  for (const platform of platforms) {
    const limit = PLATFORM_CHAR_LIMITS[platform.toUpperCase()] ?? DEFAULT_CHAR_LIMIT
    const preview = (item.previews || []).find(p => (p?.platform || '').toUpperCase() === platform.toUpperCase())
    const effectiveText = ((preview?.text ?? item.text) || '').trim()
    if (effectiveText.length > limit) {
      return { ok: false, reason: `Текст превышает лимит ${platform} (${limit})` }
    }
  }

  return { ok: true }
}
