/**
 * Реестр платформ (паттерн Postiz): единое место для платформо-специфичных
 * подсказок. Лимиты/цвета/лейблы — в usePlatformLimits / usePlatform,
 * превью-компоненты — в components/posts/preview/PostPreview.vue.
 */

/** Платформо-специфичная подсказка для редактора (кликабельность ссылок и т.п.) */
export function platformNote(platform: string): string {
  const notes: Record<string, string> = {
    VK: 'Ссылки кликабельны, хештеги работают.',
    TELEGRAM: 'Поддерживает Markdown/HTML, ссылки кликабельны.',
    INSTAGRAM: 'Ссылки в подписи НЕ кликабельны (только «в шапке»). До 30 хештегов.',
  }
  return notes[platform] || ''
}
