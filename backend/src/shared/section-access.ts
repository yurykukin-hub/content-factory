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
  'photoStudio',
  'settings',
  'publishing',
  'aiLogs',
  'tickets',
] as const

export type Section = (typeof SECTIONS)[number]
export type AccessLevel = 'full' | 'view' | 'none'
export type SectionAccess = Partial<Record<Section, AccessLevel>>

/** Секции, доступные только ADMIN по умолчанию */
const ADMIN_SECTIONS: Section[] = ['scenarios', 'characters', 'videoStudio', 'soundStudio', 'photoStudio', 'settings', 'aiLogs']

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

  // Defense-in-depth: неизвестная роль (например, токен без поля role) → нет доступа,
  // вместо проваливания в EDITOR-дефолт ниже.
  if (role !== 'EDITOR' && role !== 'VIEWER') return 'none'

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

const LEVEL_RANK: Record<AccessLevel, number> = { none: 0, view: 1, full: 2 }

/**
 * Права API-ключа = пересечение прав его владельца и собственного скоупа ключа.
 *
 * Ключ может только СУЗИТЬ доступ. Иначе выдача ключа стала бы способом обойти
 * ограничения пользователя: завёл ключ с полными правами — и обошёл свою роль.
 *
 * Скоуп — белый список: раздел, не упомянутый в нём, недоступен ключу вовсе.
 * Для машинного доступа это правильное умолчание — интеграция получает ровно
 * то, что ей выдали, и ничего сверх.
 *
 * Возвращает готовую карту разделов; вызывающий обязан также понизить роль,
 * иначе ADMIN-байпас в resolveAccess сделает скоуп бессмысленным.
 */
export function intersectAccess(
  ownerRole: string,
  ownerAccess: SectionAccess | null | undefined,
  keyScope: SectionAccess,
): SectionAccess {
  const merged: SectionAccess = {}
  for (const section of SECTIONS) {
    const ownerLevel = resolveAccess(ownerRole, section, ownerAccess)
    const keyLevel = keyScope[section] ?? 'none'
    merged[section] = LEVEL_RANK[keyLevel] < LEVEL_RANK[ownerLevel] ? keyLevel : ownerLevel
  }
  return merged
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
  photoStudio: 'Фото-студия',
  settings: 'Настройки',
  publishing: 'Публикация',
  aiLogs: 'AI Логи',
  tickets: 'Тикеты',
}
