/**
 * Russian labels for enums displayed in UI.
 * Pattern: same as useStatus.ts — Record map + export function.
 */

const POST_TYPE_LABELS: Record<string, string> = {
  TEXT: 'Текст',
  PHOTO: 'Фото',
  VIDEO: 'Видео',
  REELS: 'Reels',
  STORIES: 'Stories',
}

/** Get Russian label for a post type */
export function postTypeLabel(type: string): string {
  return POST_TYPE_LABELS[type] || type
}
