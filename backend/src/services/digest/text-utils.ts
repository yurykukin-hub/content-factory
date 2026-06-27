// Чистые текст-утилиты дайджеста (без зависимостей).
// Вынесены из daily-digest.ts: parseJsonLoose имеет 9+ call sites (парсинг
// JSON-ответов LLM) — переиспользуемо и теперь под тестами.

/** Скорость ветра (м/с) → словесное описание. Цифры м/с люди не понимают — в тексте только словами. */
export function windLabel(ms: number | null | undefined): string {
  if (ms == null) return 'ветер спокойный'
  if (ms < 2) return 'штиль'
  if (ms < 4) return 'слабый ветер'
  if (ms < 7) return 'умеренный ветер'
  if (ms < 10) return 'свежий ветер'
  return 'сильный ветер'
}

/** Безопасный парс JSON из ответа LLM (срезает markdown-обёртку). */
export function parseJsonLoose<T>(raw: string): T | null {
  const cleaned = (raw || '').replace(/```json\n?/g, '').replace(/```\n?/g, '').trim()
  try { return JSON.parse(cleaned) as T } catch { return null }
}
