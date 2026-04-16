/**
 * Shared constants for AI action categories and labels.
 * Used by ai-logs routes (backend) and AiLogsView (frontend duplicates).
 */

export const ACTION_CATEGORIES = {
  text: [
    'generate_plan', 'generate_post', 'adapt_platform', 'generate_hashtags',
    'enhance_image_prompt', 'suggest_image_templates', 'suggest_video_templates',
    'generate_story_title', 'generate_story_text', 'generate_scenario',
    'generate_edit_prompt', 'translate_prompt',
    'enhance_video_prompt_enhance', 'enhance_video_prompt_director',
    'enhance_video_prompt_structure', 'enhance_video_prompt_focus',
    'enhance_video_prompt_audio', 'enhance_video_prompt_camera',
    'enhance_video_prompt_translate', 'enhance_video_prompt_simplify',
  ],
  image: ['generate_image', 'edit_image', 'remove_background'],
  video: ['generate_video'],
  vision: ['describe_reference', 'merge_references'],
} as const

export type ActionCategory = keyof typeof ACTION_CATEGORIES

export const ACTION_LABELS: Record<string, string> = {
  generate_plan: 'Генерация плана',
  generate_post: 'Генерация поста',
  adapt_platform: 'Адаптация под платформу',
  generate_hashtags: 'Генерация хештегов',
  enhance_image_prompt: 'Улучшение промпта (фото)',
  suggest_image_templates: 'Подбор шаблонов (фото)',
  suggest_video_templates: 'Подбор шаблонов (видео)',
  generate_story_title: 'Заголовок Stories',
  generate_story_text: 'Текст Stories',
  generate_scenario: 'Генерация сценария',
  generate_edit_prompt: 'Промпт редактирования',
  translate_prompt: 'Перевод промпта',
  generate_image: 'Генерация изображения',
  edit_image: 'Редактирование фото',
  remove_background: 'Удаление фона',
  generate_video: 'Генерация видео',
  describe_reference: 'Описание референса',
  merge_references: 'Объединение референсов',
  // enhance_video_prompt_* — handled by getActionLabel()
}

/** Get action category */
export function getActionCategory(action: string): ActionCategory {
  for (const [cat, actions] of Object.entries(ACTION_CATEGORIES)) {
    if ((actions as readonly string[]).includes(action)) return cat as ActionCategory
  }
  // Fallback: enhance_video_prompt_* are text operations
  if (action.startsWith('enhance_video_prompt_')) return 'text'
  return 'text'
}

/** Get human-readable label for action */
export function getActionLabel(action: string): string {
  if (ACTION_LABELS[action]) return ACTION_LABELS[action]
  if (action.startsWith('enhance_video_prompt_')) {
    const mode = action.replace('enhance_video_prompt_', '')
    const modeLabels: Record<string, string> = {
      enhance: 'базовое', director: 'режиссёр', structure: 'структура',
      focus: 'фокус', audio: 'аудио', camera: 'камера',
      translate: 'перевод', simplify: 'упрощение',
    }
    return `Улучшение видео-промпта (${modeLabels[mode] || mode})`
  }
  return action
}

export const CATEGORY_LABELS: Record<ActionCategory, string> = {
  text: 'Текст',
  image: 'Фото',
  video: 'Видео',
  vision: 'Vision',
}
