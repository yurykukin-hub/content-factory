/**
 * Лимиты символов и валидация формата по платформам.
 * Переиспользуется в композере (PostEditorView) и списках.
 */

/** Лимит символов подписи/поста по платформе */
export const PLATFORM_LIMITS: Record<string, number> = {
  VK: 4096,
  TELEGRAM: 4096,
  INSTAGRAM: 2200,
}

export function platformLimit(platform: string): number {
  return PLATFORM_LIMITS[platform] ?? 4096
}

/** Цвет счётчика символов: красный — превышен, жёлтый — близко (>90%), серый — ок */
export function charCountColor(len: number, limit: number): string {
  if (len > limit) return 'text-red-500'
  if (len > limit * 0.9) return 'text-yellow-500'
  return 'text-gray-400'
}

/** Форматы, требующие видеофайл */
export function formatNeedsVideo(postType: string): boolean {
  return ['VIDEO', 'REELS', 'CLIPS'].includes(postType)
}

/** Форматы, требующие изображение */
export function formatNeedsImage(postType: string): boolean {
  return postType === 'PHOTO'
}

/** Подсказка по формату (для UI) */
export function formatHint(postType: string): string {
  switch (postType) {
    case 'REELS':
      return 'Reels: вертикальное видео 9:16, до 90 сек. Привяжите видео ниже.'
    case 'CLIPS':
      return 'Клипы (VK): вертикальное видео 9:16, до 60 сек. Публикуется как видео ВК (отдельного API клипов нет).'
    case 'VIDEO':
      return 'Видео-пост: привяжите видеофайл ниже.'
    case 'PHOTO':
      return 'Фото-пост: привяжите изображение(я) ниже.'
    default:
      return ''
  }
}
