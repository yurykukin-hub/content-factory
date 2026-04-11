/**
 * Post status color and label utilities.
 * Eliminates duplication across PostsView, PostEditorView.
 */

const STATUS_COLORS: Record<string, string> = {
  DRAFT: 'bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300',
  REVIEW: 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900 dark:text-yellow-300',
  APPROVED: 'bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300',
  SCHEDULED: 'bg-amber-100 text-amber-700 dark:bg-amber-900 dark:text-amber-300',
  PUBLISHED: 'bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-300',
  FAILED: 'bg-red-100 text-red-700 dark:bg-red-900 dark:text-red-300',
}

const STATUS_LABELS: Record<string, string> = {
  DRAFT: 'Черновик',
  REVIEW: 'На проверке',
  APPROVED: 'Одобрен',
  SCHEDULED: 'Запланирован',
  PUBLISHED: 'Опубликован',
  FAILED: 'Ошибка',
}

/** Get Tailwind classes for a post status badge */
export function statusColor(status: string): string {
  return STATUS_COLORS[status] || STATUS_COLORS.DRAFT
}

/** Get Russian label for a post status */
export function statusLabel(status: string): string {
  return STATUS_LABELS[status] || status
}
