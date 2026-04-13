import { db } from '../../db'

/**
 * Правила адаптации текста по платформам.
 */
export const PLATFORM_RULES: Record<string, string> = {
  VK: `
- Длина: до 4000 символов (можно длинный текст)
- Стиль: более развёрнутый, можно абзацы
- Допустимы эмодзи, но умеренно
- Хештеги в конце (5-10 штук)
- Заголовок не нужен (ВК не показывает заголовки постов)
  `.trim(),

  TELEGRAM: `
- Длина: до 1000 символов (канал, люди читают быстро)
- Стиль: лаконичный, ёмкий, каждое слово на вес золота
- Допустимы эмодзи как визуальные маркеры
- Форматирование: **bold** для акцентов, можно ссылки
- Без хештегов (в TG они не работают для дискавери)
- Call-to-action в конце
  `.trim(),

  INSTAGRAM: `
- Длина: до 2200 символов
- Стиль: эмоциональный, вдохновляющий, личный
- Начни с "крючка" (первая строка видна без раскрытия)
- Обильные эмодзи допустимы
- Разбивай текст пустыми строками (читаемость)
- Хештеги: 15-20 штук, в конце через пустую строку
- Можно упомянуть "ссылка в шапке профиля"
  `.trim(),
}

/**
 * Собирает system prompt для AI, включая бренд-профиль.
 */
export async function buildBrandContext(businessId: string): Promise<string> {
  const business = await db.business.findUnique({
    where: { id: businessId },
    include: { brandProfile: true },
  })

  if (!business) throw new Error(`Business ${businessId} not found`)

  const parts: string[] = []

  parts.push(`## Бренд: ${business.name}`)
  if (business.description) parts.push(business.description)

  const bp = business.brandProfile
  if (bp) {
    if (bp.tone) parts.push(`Тон коммуникации: ${bp.tone}`)
    if (bp.targetAudience) parts.push(`Целевая аудитория: ${bp.targetAudience}`)
    if (bp.brandVoice) parts.push(`Стиль: ${bp.brandVoice}`)
    if (bp.keyTopics?.length) parts.push(`Ключевые темы: ${bp.keyTopics.join(', ')}`)
    if (bp.doNotMention?.length) parts.push(`НЕ упоминать: ${bp.doNotMention.join(', ')}`)
    if (bp.hashtags?.length) parts.push(`Постоянные хештеги: ${bp.hashtags.map(h => '#' + h).join(' ')}`)
    if (bp.examplePosts) parts.push(`Примеры хороших постов:\n${JSON.stringify(bp.examplePosts, null, 2)}`)
  }

  return parts.join('\n')
}

/**
 * System prompt для генерации контент-плана.
 */
export function buildPlanPrompt(
  brandContext: string,
  params?: { postsPerWeek?: number; focus?: string; rubrics?: string[] }
): string {
  const parts: string[] = [
    `Ты — опытный SMM-стратег. Составь детальный контент-план для бренда.`,
    '',
    brandContext,
    '',
    '## Требования',
  ]

  if (params?.postsPerWeek) {
    parts.push(`- Публикуй ${params.postsPerWeek} постов в неделю (равномерно распределяй по будням)`)
  } else {
    parts.push('- 3-5 постов в неделю')
  }

  if (params?.rubrics?.length) {
    parts.push(`- Используй эти рубрики: ${params.rubrics.join(', ')}`)
    parts.push(`- Чередуй рубрики для разнообразия`)
  } else {
    parts.push('- Микс типов: информационные, развлекательные, продающие, вовлекающие')
  }

  parts.push('- Учитывай сезонность и актуальные события')
  parts.push('- Каждый пост: дата, тема (2-5 слов), тип контента (TEXT/PHOTO/VIDEO), краткое описание (1 предложение)')

  if (params?.focus) {
    parts.push(`- Тематический фокус периода: ${params.focus}`)
  }

  parts.push('')
  parts.push('## Формат ответа — строго JSON массив')
  parts.push('[')
  parts.push('  {"date": "2026-06-01", "dayOfWeek": "Понедельник", "topic": "...", "postType": "PHOTO", "description": "..."},')
  parts.push('  ...')
  parts.push(']')
  parts.push('')
  parts.push('Только JSON, без пояснений, без markdown.')

  return parts.join('\n')
}

/**
 * System prompt для генерации текста поста.
 */
export function buildPostPrompt(brandContext: string): string {
  return `Напиши пост для социальных сетей.

${brandContext}

## Требования
- Длина: 500-1500 символов (универсальный текст, будет адаптирован под платформы)
- Включи call-to-action
- Не используй markdown разметку (текст для соцсетей)
- Хештеги НЕ добавляй (будут сгенерированы отдельно)
- Пиши живым языком, не канцелярским

Напиши только текст поста, без пояснений.`
}

/**
 * System prompt для адаптации под платформу.
 */
export function buildAdaptPrompt(platform: string, brandContext: string): string {
  const rules = PLATFORM_RULES[platform] || ''
  return `Адаптируй текст поста под платформу ${platform}.

${brandContext}

## Правила адаптации для ${platform}
${rules}

Напиши только адаптированный текст, без пояснений.`
}

/**
 * System prompt для генерации хештегов.
 */
export function buildHashtagPrompt(platform: string, brandContext: string): string {
  const count = platform === 'VK' ? '5-10' : platform === 'INSTAGRAM' ? '15-20' : '0'
  return `Сгенерируй хештеги для поста.

${brandContext}

## Требования
- ${count} хештегов
- Микс: 30% брендовые, 30% тематические, 40% широкие (для охвата)
- Только на русском языке
- Без #, просто слова через пробел

Только хештеги, по одному на строку, без номеров и пояснений.`
}

/**
 * System prompt для улучшения промпта генерации изображений.
 */
export function buildImageEnhancerPrompt(brandContext: string): string {
  return `Ты — эксперт по промптам для AI-генерации изображений.
Твоя задача: взять краткое описание и превратить его в детальный промпт для генерации изображения.

${brandContext}

## Правила
- Добавь описание стиля фотографии (editorial, lifestyle, product, drone shot, etc.)
- Укажи освещение (golden hour, studio light, natural, dramatic, backlit)
- Опиши композицию (close-up, wide shot, overhead, rule of thirds, centered)
- Добавь цветовую палитру (warm tones, cool blues, vibrant, muted pastels)
- Укажи настроение (energetic, calm, luxurious, adventurous, cozy)
- Пиши на русском языке (перевод будет выполнен автоматически)
- Длина: 2-4 предложения, максимум 200 слов
- НЕ добавляй текст/надписи/водяные знаки в изображение
- Учитывай контекст бренда при выборе стиля и настроения

Верни ТОЛЬКО улучшенный промпт, без пояснений и кавычек.`
}

/**
 * System prompt для улучшения промпта РЕДАКТИРОВАНИЯ изображения (img2img).
 * Не описывает содержание кадра — только инструкции по изменению.
 */
export function buildEditEnhancerPrompt(): string {
  return `Ты — эксперт по промптам для AI-редактирования изображений (img2img).
Тебе дают СУЩЕСТВУЮЩЕЕ изображение и краткую инструкцию что изменить. Твоя задача — превратить краткую инструкцию в точный промпт для редактирования.

## Важно
- НЕ описывай что изображено на фото — ты не знаешь содержания
- НЕ выдумывай сцену, объекты, людей — это уже есть на фото
- Пиши ТОЛЬКО инструкции по изменению: что сделать с фоном, стилем, цветами, освещением
- Будь конкретным в технических деталях изменений
- Пиши на русском языке
- Длина: 1-2 предложения, максимум 50 слов

## Примеры
Вход: "Сменить фон" → "Заменить фон на мягкий градиентный закат в тёплых оранжево-розовых тонах"
Вход: "Стилизовать" → "Стилизовать в яркий поп-арт стиль с чёткими контурами и насыщенными цветами"
Вход: "Улучшить" → "Повысить резкость, слегка увеличить контраст, улучшить яркость цветов и добавить тёплую коррекцию"

Верни ТОЛЬКО промпт редактирования, без пояснений.`
}

/**
 * System prompt для генерации заголовка Stories.
 */
export function buildStoryTitlePrompt(brandContext: string): string {
  return `Сгенерируй короткий цепляющий заголовок для Instagram/VK Stories.

${brandContext}

## Правила
- Максимум 3-5 слов
- Цепляющий, эмоциональный
- Без кавычек, без эмодзи
- На русском языке
- Подходящий для наложения на фото

Верни ТОЛЬКО заголовок, без пояснений.`
}

/**
 * System prompt для генерации сценария (структурированный набор сцен).
 */
export function buildScenarioPrompt(
  brandContext: string,
  params?: { sceneCount?: number; style?: string }
): string {
  const count = params?.sceneCount || 5
  const style = params?.style || 'динамичный, вовлекающий'

  return `Ты — опытный сценарист для видео-контента в социальных сетях.
Создай сценарий для короткого видео/серии Stories.

${brandContext}

## Требования
- Количество сцен: ${count}
- Стиль: ${style}
- Каждая сцена: описание визуала, закадровый текст (voiceover), длительность в секундах, промпт для генерации картинки/видео
- Длительность сцены: 3-10 секунд
- Общая длительность: 15-60 секунд
- Сценарий должен рассказывать историю (начало → развитие → кульминация → CTA)
- Закадровый текст — разговорный, живой, на русском
- Промпты для картинок — описательные, на русском (перевод автоматический)

## Формат ответа — строго JSON массив
[
  {
    "sceneNumber": 1,
    "description": "Описание визуала сцены",
    "voiceover": "Текст для озвучки",
    "durationSec": 5,
    "imagePrompt": "Детальное описание для генерации изображения/видео"
  },
  ...
]

Только JSON, без пояснений, без markdown.`
}
