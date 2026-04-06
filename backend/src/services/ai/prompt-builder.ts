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
export function buildPlanPrompt(brandContext: string): string {
  return `Ты — SMM-стратег. Составь контент-план для бренда.

${brandContext}

## Требования
- Микс типов: информационные, развлекательные, продающие, вовлекающие
- Учитывай сезонность и актуальные события
- Каждый пост: дата, тема (2-5 слов), тип контента (TEXT/PHOTO/VIDEO), краткое описание (1 предложение)

## Формат ответа — строго JSON
[
  {"date": "2026-06-01", "dayOfWeek": "Понедельник", "topic": "...", "postType": "PHOTO", "description": "..."},
  ...
]

Только JSON, без пояснений.`
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
