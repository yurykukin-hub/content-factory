/**
 * Platform color, label, and icon utilities.
 * Eliminates duplication across PostsView, PostEditorView, BusinessesView, ChannelsTab.
 */

/** Get Tailwind text color class for a platform */
export function platformColor(platform: string): string {
  const map: Record<string, string> = {
    VK: 'text-blue-600',
    TELEGRAM: 'text-sky-500',
    INSTAGRAM: 'text-pink-500',
  }
  return map[platform] || 'text-gray-500'
}

/** Get Tailwind background color class for a platform badge */
export function platformBgColor(platform: string): string {
  const map: Record<string, string> = {
    VK: 'bg-blue-500',
    TELEGRAM: 'bg-sky-500',
    INSTAGRAM: 'bg-gradient-to-r from-purple-500 to-pink-500',
  }
  return map[platform] || 'bg-gray-500'
}

/** Get short label for a platform */
export function platformLabel(platform: string): string {
  const map: Record<string, string> = {
    VK: 'VK',
    TELEGRAM: 'TG',
    INSTAGRAM: 'IG',
  }
  return map[platform] || platform
}

/** Get account type label */
export function accountTypeLabel(type: string): string {
  const map: Record<string, string> = {
    GROUP: 'Группа',
    PERSONAL: 'Личная страница',
    CHANNEL: 'Канал',
    BOT: 'Бот',
    BUSINESS: 'Бизнес-аккаунт',
  }
  return map[type] || type
}
