/**
 * Composable для проверки доступа к разделам.
 * Дублирует логику backend/src/shared/section-access.ts на фронтенде.
 * Бэкенд — авторитетный источник; фронтенд — для удобства UI.
 */

import { useAuthStore } from '@/stores/auth'

export type Section =
  | 'dashboard'
  | 'posts'
  | 'plans'
  | 'media'
  | 'ideas'
  | 'businesses'
  | 'scenarios'
  | 'characters'
  | 'videoStudio'
  | 'settings'
  | 'publishing'

export type AccessLevel = 'full' | 'view' | 'none'

/** Секции, доступные только ADMIN по умолчанию */
const ADMIN_SECTIONS: Section[] = ['scenarios', 'characters', 'videoStudio', 'settings']

/** Все секции с русскими лейблами */
export const SECTION_LABELS: Record<Section, string> = {
  dashboard: 'Dashboard',
  posts: 'Stories / Посты',
  plans: 'Контент-планы',
  media: 'Медиа',
  ideas: 'Идеи',
  businesses: 'Бизнесы',
  scenarios: 'Сценарии',
  characters: 'Персонажи',
  videoStudio: 'Видео-студия',
  settings: 'Настройки',
  publishing: 'Публикация',
}

export const SECTIONS: Section[] = Object.keys(SECTION_LABELS) as Section[]

function resolveAccess(
  role: string,
  section: Section,
  sectionAccess?: Record<string, AccessLevel> | null,
): AccessLevel {
  if (role === 'ADMIN') return 'full'
  if (sectionAccess?.[section] !== undefined) return sectionAccess[section]
  if (role === 'VIEWER') return 'view'
  return ADMIN_SECTIONS.includes(section) ? 'none' : 'full'
}

/** Дефолт по роли (для UI — показать серым в таблице) */
export function getDefault(role: string, section: Section): AccessLevel {
  if (role === 'ADMIN') return 'full'
  if (role === 'VIEWER') return 'view'
  return ADMIN_SECTIONS.includes(section) ? 'none' : 'full'
}

export function useSectionAccess() {
  const auth = useAuthStore()

  /** Может ли текущий пользователь видеть раздел */
  function canView(section: Section): boolean {
    if (!auth.user) return false
    return resolveAccess(auth.user.role, section, auth.user.sectionAccess) !== 'none'
  }

  /** Может ли текущий пользователь редактировать в разделе */
  function canEdit(section: Section): boolean {
    if (!auth.user) return false
    return resolveAccess(auth.user.role, section, auth.user.sectionAccess) === 'full'
  }

  return { canView, canEdit }
}
