/**
 * Гранулярный доступ по разделам.
 * Shared types + resolve logic (используется и бэкендом, и фронтендом через дублирование).
 */

export const SECTIONS = [
  'dashboard',
  'posts',
  'plans',
  'media',
  'ideas',
  'businesses',
  'scenarios',
  'characters',
  'videoStudio',
  'soundStudio',
  'settings',
  'publishing',
  'aiLogs',
] as const

export type Section = (typeof SECTIONS)[number]
export type AccessLevel = 'full' | 'view' | 'none'
export type SectionAccess = Partial<Record<Section, AccessLevel>>

/** Секции, доступные только ADMIN по умолчанию */
const ADMIN_SECTIONS: Section[] = ['scenarios', 'characters', 'videoStudio', 'soundStudio', 'settings', 'aiLogs']

/**
 * Определяет уровень доступа к разделу.
 * ADMIN всегда получает 'full' (bypass).
 * Если в sectionAccess есть явное значение — используется оно.
 * Иначе — дефолт по роли.
 */
export function resolveAccess(
  role: string,
  section: Section,
  sectionAccess?: SectionAccess | null,
): AccessLevel {
  // ADMIN bypass — всегда полный доступ
  if (role === 'ADMIN') return 'full'

  // Явное переопределение
  if (sectionAccess?.[section] !== undefined) {
    return sectionAccess[section]!
  }

  // Дефолты по роли
  if (role === 'VIEWER') return 'view'

  // EDITOR: основные секции = full, admin-секции = none
  return ADMIN_SECTIONS.includes(section) ? 'none' : 'full'
}

/** Может ли пользователь видеть раздел (view или full) */
export function canView(
  role: string,
  section: Section,
  sectionAccess?: SectionAccess | null,
): boolean {
  return resolveAccess(role, section, sectionAccess) !== 'none'
}

/** Может ли пользователь редактировать в разделе (только full) */
export function canEdit(
  role: string,
  section: Section,
  sectionAccess?: SectionAccess | null,
): boolean {
  return resolveAccess(role, section, sectionAccess) === 'full'
}

/** Русские лейблы для UI */
export const SECTION_LABELS: Record<Section, string> = {
  dashboard: 'Dashboard',
  posts: 'Stories / Посты',
  plans: 'Контент-планы',
  media: 'Медиа',
  ideas: 'Идеи',
  businesses: 'Проекты',
  scenarios: 'Сценарии',
  characters: 'Персонажи',
  videoStudio: 'Видео-студия',
  soundStudio: 'Звуковая студия',
  settings: 'Настройки',
  publishing: 'Публикация',
  aiLogs: 'AI Логи',
}
