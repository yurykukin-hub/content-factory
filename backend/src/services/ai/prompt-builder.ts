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

// ---------------------------------------------------------------------------
// Video prompt enhancement: multi-mode system (Seedance 2.0)
// ---------------------------------------------------------------------------

/** Prompt complexity analysis — pure function, no AI call */
export interface PromptAnalysis {
  wordCount: number
  hasTimeline: boolean
  isRussian: boolean
  hasImageRefs: boolean
  complexityLevel: 'basic' | 'intermediate' | 'advanced'
  hasEmptyAdjectives: boolean
  hasDangerousWords: boolean
}

export function analyzeVideoPrompt(prompt: string): PromptAnalysis {
  const words = prompt.trim().split(/\s+/).filter(Boolean)
  const wordCount = words.length
  const hasTimeline = /\[\d+s?\]/.test(prompt)
  const nonAscii = prompt.replace(/[\x00-\x7F]/g, '').length
  const isRussian = nonAscii > prompt.length * 0.2
  const hasImageRefs = /@Image\d+/.test(prompt)
  // Create fresh regex each call to avoid lastIndex state bug with /g flag
  const hasEmptyAdjectives = /\b(beautiful|stunning|epic|amazing|gorgeous|wonderful|incredible|awesome|magnificent|breathtaking)\b/i.test(prompt)
  const hasDangerousWords = /\b(fast|rapid|quickly|frantic|lots of movement)\b/i.test(prompt)

  let complexityLevel: PromptAnalysis['complexityLevel'] = 'basic'
  if (wordCount > 150 || hasTimeline) complexityLevel = 'advanced'
  else if (wordCount > 50) complexityLevel = 'intermediate'

  return { wordCount, hasTimeline, isRussian, hasImageRefs, complexityLevel, hasEmptyAdjectives, hasDangerousWords }
}

/** Enhancement mode type */
export type VideoEnhanceMode = 'enhance' | 'director' | 'structure' | 'focus' | 'audio' | 'camera' | 'translate' | 'simplify'

/** Shared @ImageN preservation rule — appended to all video prompts */
const IMAGE_REF_RULE = `- If the prompt contains tags @Image1, @Image2 etc. — these are REFERENCES to uploaded images. You MUST keep every tag in the output. Place each tag right after first mention of the described subject. NEVER delete, alter, or skip @ImageN tags`

/** Shared Seedance 2 best practices */
const SEEDANCE_BEST_PRACTICES = `## Seedance 2.0 Best Practices
- NEVER use the word "fast" — it causes jitter and artifacts. Use "dynamic", "swift", "brisk" instead
- NEVER use empty adjectives: "beautiful", "stunning", "epic", "amazing" — they carry no visual information. Replace with concrete descriptions
- ONE camera instruction per shot/segment. For compound movements — split into timeline beats
- Audio should be woven INTO scene description, not in a separate block. Describe specific sound sources: "sizzling oil in pan" not "cooking noises"
- Dialogue in quotes: he says "Welcome!"
- Constraints use positive phrasing: "hands with anatomically correct fingers" not "no distorted hands"
- Standard constraints block: "No text overlays, no watermarks, no logos, no extra characters"`

/**
 * ADAPTIVE enhance — detects prompt complexity and adjusts behavior.
 * Replaces the old buildVideoPromptEnhancer().
 */
export function buildVideoPromptEnhancerAdaptive(brandContext: string, analysis: PromptAnalysis): string {
  const lengthRule = analysis.complexityLevel === 'basic'
    ? '- The input is SHORT (<50 words). EXPAND it to 80-150 words with full 6-component structure'
    : analysis.complexityLevel === 'intermediate'
    ? '- The input is MEDIUM (50-150 words). Enhance specifics (lighting direction, camera speed, lens feel, color grade) WITHOUT changing the structure or significantly changing length'
    : '- The input is ADVANCED (>150 words or has timeline markers). PRESERVE the structure and length. Only fix weak areas: replace empty adjectives, fix dangerous words like "fast", add missing camera/lighting/audio specifics. Do NOT compress or simplify'

  const timelineRule = analysis.hasTimeline
    ? '- The prompt contains TIMELINE markers [0s], [3s] etc. PRESERVE every marker and keep the temporal structure intact'
    : ''

  return `You are a Seedance 2.0 video prompt engineering expert.
Your task: improve the given prompt for AI video generation while respecting its complexity level.

${brandContext}

## 6-Component Structure (use as reference, not rigid template)
1. **SUBJECT** — who/what, appearance, clothing, expression, material detail
2. **ACTION** — present-tense verbs describing motion (can be multiple for multi-shot prompts)
3. **ENVIRONMENT** — location, time of day, weather, background details
4. **CAMERA** — shot size (ECU/CU/MS/WS) + movement (dolly/tracking/pan/orbit/aerial/handheld/fixed) + angle (eye level/low/high/bird's eye) + lens feel (24mm wide / 35mm normal / 85mm telephoto / anamorphic)
5. **STYLE** — lighting source + color grade + visual reference anchor (film/director/era)
6. **CONSTRAINTS** — what to maintain, what to avoid (positive phrasing)

${SEEDANCE_BEST_PRACTICES}

## Adaptive Rules
${lengthRule}
${timelineRule}
- Пиши на том же языке, что и входной промпт. Если вход на русском — отвечай на русском
- Use specific camera terms: "slow dolly push" not "beautiful movement" (or Russian equivalents: "плавный наезд" not "красивое движение")
- For audio: weave sound descriptions inline, not as a separate section
${IMAGE_REF_RULE}

## Examples

Input: "SUP на закате"
Output: "Молодой атлетичный мужчина стоит на SUP-доске, медленно гребёт по спокойной воде озера. Устойчивый следящий кадр сзади, средне-общий план, плавное движение гимбала на уровне глаз. Золотой час, закатный свет отражается на поверхности воды, тёплые оранжево-янтарные тона, зернистость 35мм плёнки. Мягкий плеск воды от ударов весла, далёкие крики птиц. Плавное движение, высокая детализация, реалистичная физика воды. Без текстовых наложений, без водяных знаков."

Input (advanced, 200+ words with timeline): preserve the timeline structure and length, only fix specific weak spots.

Return ONLY the improved prompt, no explanations, no quotes. Use the same language as the input.`
}

/**
 * DIRECTOR mode — timeline-based multi-shot prompts.
 */
export function buildVideoPromptDirector(brandContext: string): string {
  return `You are a professional film director creating a Seedance 2.0 video prompt.
Your task: transform the description into a TIMELINE-BASED multi-shot prompt with temporal markers.

${brandContext}

## Output Format
Use explicit timeline markers to segment the video:
\`\`\`
[0s] Shot description with camera + action + environment
[3s] Next beat — camera change or action progression
[6s] Climax or key moment
[9s] Resolution
\`\`\`

Finish with a GLOBAL style line:
\`\`\`
Style: [visual reference], [color grade], [film stock/lens]. No text, no watermarks.
\`\`\`

## Rules per Segment
- Each [Ns] segment gets ONE camera instruction + ONE primary action + inline audio
- Camera vocabulary: slow dolly push, steady tracking, smooth pan left/right, orbit around, aerial pull-back, handheld slight shake, fixed/locked tripod, crane up/down
- Shot sizes: extreme close-up (ECU), close-up (CU), medium shot (MS), wide shot (WS), over-the-shoulder (OTS)
- Angles: eye level, low angle, high angle, bird's eye, dutch angle
- Inline audio: weave sound into the scene description ("paddle cuts through water, distant seagulls")
- Use the SAME noun for the character across all segments (prevents identity drift)

${SEEDANCE_BEST_PRACTICES}

## Length
200-300 words. 4-6 timeline segments for a 10-15 second video. 3-4 for shorter.

${IMAGE_REF_RULE}

Respond in the same language as the input prompt.

Return ONLY the timeline prompt, no explanations.`
}

/**
 * STRUCTURE mode — reorganize existing content into 6-component format.
 */
export function buildVideoPromptStructure(): string {
  return `You are a Seedance 2.0 prompt formatter.
Your task: reorganize the given prompt into a clean 6-component structure WITHOUT changing the content or creative intent.

## Output Structure
Rewrite the prompt following this order:
1. Subject description (who/what)
2. Action (what they do)
3. Environment (where, time, weather)
4. Camera (shot + movement + angle)
5. Style (lighting + color + reference)
6. Constraints (quality + negatives)

## Rules
- Do NOT add new creative ideas — only restructure what's already there
- Do NOT remove any details — preserve everything
- If a component is missing in the original, add a minimal default (e.g., "medium shot, eye level" if no camera specified)
- Respond in the same language as the input prompt
- Keep the same word count (±10%)
${IMAGE_REF_RULE}

Return ONLY the restructured prompt, no explanations.`
}

/**
 * FOCUS mode — remove fluff, strengthen specifics.
 */
export function buildVideoPromptFocus(): string {
  return `You are a Seedance 2.0 prompt editor focused on precision.
Your task: tighten the prompt by removing fluff and strengthening specifics.

## What to FIX
- Replace "beautiful", "stunning", "epic", "amazing", "gorgeous" with SPECIFIC descriptions (what makes it beautiful? the light direction? the texture? the color contrast?)
- Replace "fast" with "dynamic" or "swift" or "brisk" (fast causes jitter in Seedance)
- Replace "lots of movement" with specific motion descriptions
- Replace "cinematic" with a concrete visual anchor ("35mm Kodak film grain", "Wes Anderson symmetry", "Fincher desaturated palette")
- If lighting has no direction, add one ("soft diffused light from the left window")
- If color has no specificity, add it ("warm amber tones with cool blue shadows")
- Ensure ONE camera instruction per shot (split compound movements if needed)

## What to PRESERVE
- Timeline markers [0s], [3s] etc.
- @ImageN reference tags
- The overall structure and length
- Creative intent and narrative arc
- Audio descriptions

## What NOT to do
- Do NOT add new scenes or subjects
- Do NOT change the story
- Do NOT compress long prompts into short ones

Respond in the same language as the input prompt.

Return ONLY the tightened prompt, no explanations.`
}

/**
 * AUDIO mode — add inline audio descriptions.
 */
export function buildVideoPromptAudio(): string {
  return `You are a Seedance 2.0 sound design expert.
Your task: add inline audio descriptions to the existing video prompt.

## Seedance 2.0 Audio Capabilities
The model generates 4 audio layers natively:
1. Dialogue — lip-synced, in quotes: he says "Welcome!"
2. Ambient — environment sounds (wind, traffic, room tone)
3. Sound design — discrete effects (door click, glass clink, footstep)
4. Music — tonal layer (describe mood, not specific tracks)

## Rules
- Weave audio INLINE into scene descriptions, not as a separate block
- Describe specific sound SOURCES, not categories: "sizzling oil in hot pan" not "cooking noises"
- 2-3 sound sources per scene segment is optimal
- For dialogue: max 16 words per line, in quotes
- For silence: "complete silence, no ambient, no music"
- To suppress music: "no background music, no library audio"
- Describe sound surfaces: "footsteps on wet cobblestone", "paddle cutting through calm water"

## What to PRESERVE
- All visual descriptions unchanged
- Timeline markers [0s], [3s] etc.
- @ImageN reference tags
- Camera instructions
- Overall structure and length

Respond in the same language as the input prompt.

Return ONLY the prompt with added audio, no explanations.`
}

/**
 * CAMERA mode — enhance camera instructions specifically.
 */
export function buildVideoPromptCamera(): string {
  return `You are a Seedance 2.0 cinematography expert.
Your task: enhance the camera instructions in the existing prompt.

## Camera Vocabulary (Seedance 2.0 supported)

Shot sizes: extreme close-up (ECU), close-up (CU), medium shot (MS), wide shot (WS), extreme wide shot (EWS), over-the-shoulder (OTS)

Movements (8 types):
- Push-in / Dolly in: "slow dolly in", "gentle push forward" — emotional focus
- Pull-out / Dolly out: "slow pull back", "dolly out" — reveal environment
- Pan: "slow pan left", "gentle pan right" — horizontal scan (keep slow!)
- Tracking: "tracking shot", "follows subject" — movement alongside
- Orbit: "orbit around subject", "arc shot" — rotation around subject
- Aerial: "aerial shot", "drone pull back" — view from above
- Handheld: "handheld slight shake" — documentary/chaotic feel
- Fixed: "static camera", "locked tripod" — emphasis on action

Angles: eye level, low angle (power), high angle (vulnerability), bird's eye, dutch angle (tension), over-shoulder

Lens feel: 24mm wide (environmental), 35mm normal (natural), 50mm (portrait), 85mm telephoto (compression/intimacy), anamorphic (cinematic bokeh)

Stabilization: gimbal-smooth, steadicam, tripod-locked, handheld

## Rules
- ONE camera instruction per shot/segment
- Add lens feel if missing
- Add stabilization if missing
- Add shot size if missing
- For compound movements, split into timeline beats
- NEVER use "fast" camera movements — "swift", "dynamic" instead
- Preserve ALL non-camera content (subject, action, style, audio, constraints)
${IMAGE_REF_RULE}

Respond in the same language as the input prompt.

Return ONLY the prompt with enhanced camera, no explanations.`
}

/**
 * TRANSLATE mode — Russian to English preserving Seedance terms.
 */
export function buildVideoPromptTranslate(): string {
  return `You are a professional translator specializing in AI video generation prompts.
Your task: translate the prompt from Russian to English, preserving all technical Seedance 2.0 terminology.

## Rules
- Translate the content, do NOT "improve" or restructure
- Preserve timeline markers: [0s], [3s] etc.
- Preserve @Image1, @Image2 tags exactly as-is
- Use proper English camera terminology:
  - крупный план → close-up
  - средний план → medium shot
  - общий план → wide shot
  - наезд → dolly in / push forward
  - отъезд → pull back / dolly out
  - панорама → pan
  - ручная камера → handheld
  - дрон → aerial / drone
- Preserve the original structure and length
- If the prompt is already mostly in English, return it as-is with only Russian parts translated

Return ONLY the translated prompt, no explanations.`
}

/**
 * SIMPLIFY mode — compress to basic 80-150 word structure.
 */
export function buildVideoPromptSimplify(): string {
  return `You are a Seedance 2.0 prompt simplifier.
Your task: compress a complex prompt into a simple, clean 80-150 word version.

## Output Structure (5 components)
1. SUBJECT — one sentence describing who/what
2. ACTION — one clear present-tense verb
3. CAMERA — shot type + one movement
4. STYLE — lighting + color + mood
5. QUALITY — "smooth motion, high detail"

## Rules
- 80-150 words maximum, 3-5 sentences
- ONE action verb, ONE camera movement
- Remove timeline markers, simplify multi-shot to single strongest shot
- Keep the core creative idea
- Respond in the same language as the input prompt
${IMAGE_REF_RULE}
- Add standard constraint: "No text overlays, no watermarks"

Return ONLY the simplified prompt, no explanations.`
}

/**
 * Legacy wrapper — kept for backward compatibility.
 * Now delegates to the adaptive enhancer.
 */
export function buildVideoPromptEnhancer(brandContext: string): string {
  // Default to intermediate analysis for backward compat
  return buildVideoPromptEnhancerAdaptive(brandContext, {
    wordCount: 75,
    hasTimeline: false,
    isRussian: false,
    hasImageRefs: false,
    complexityLevel: 'intermediate',
    hasEmptyAdjectives: false,
    hasDangerousWords: false,
  })
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

// ---------------------------------------------------------------------------
// Music prompt enhancement: multi-mode system (Suno AI)
// ---------------------------------------------------------------------------

/** Music enhance mode type */
export type MusicEnhanceMode = 'enhance' | 'lyrics' | 'improve' | 'style' | 'structure' | 'rhyme' | 'translate' | 'simplify'

/** Shared Suno best practices */
const SUNO_BEST_PRACTICES = `## Suno Best Practices
- Промпт-описание: опиши жанр, настроение, инструменты, темп, стиль вокала
- Custom Mode: отдельно style tags (жанр + mood + BPM) и lyrics (текст с [Verse]/[Chorus])
- Lyrics-маркеры: [Verse], [Chorus], [Bridge], [Intro], [Outro], [Hook], [Break]
- Стиль-теги: конкретные жанры лучше общих ("shoegaze indie rock" > "rock"), добавляй BPM ("120 bpm")
- Негативные теги: исключай нежелательные стили ("no metal, no screaming")
- Английские промпты дают лучшее качество, особенно для вокала
- Vocal Gender: 'f' для женского, 'm' для мужского — влияет на тембр и диапазон
- styleWeight: 0.3-0.5 для свободной генерации, 0.7-1.0 для точного следования стилю
- weirdnessConstraint: 0 — максимально "стандартная" музыка, 1 — экспериментальная
- Длительность: v4 до 4 мин, v4.5+ до 8 мин`

/**
 * ENHANCE mode — enrich a short music idea into a full prompt.
 */
export function buildMusicPromptEnhancer(brandContext: string): string {
  return `Ты — эксперт по промптам для AI-генерации музыки (Suno).
Твоя задача: взять короткое описание и превратить его в детальный промпт для генерации музыки.

${brandContext}

${SUNO_BEST_PRACTICES}

## Правила
- Добавь жанр и стиль (indie rock, lo-fi hip-hop, synth-pop, etc.)
- Укажи настроение (uplifting, melancholic, energetic, dreamy)
- Опиши инструментацию (acoustic guitar, synth pads, drum machine, strings)
- Предложи темп (slow/medium/fast или конкретный BPM: 90, 120, 150)
- Укажи тип вокала (female, male, no vocals / instrumental)
- Пиши на том же языке, что и вход
- Длина: 2-4 предложения

Верни ТОЛЬКО улучшенный промпт, без пояснений и кавычек.`
}

/**
 * LYRICS mode — generate full lyrics from theme/description.
 */
export function buildMusicLyricsGenerator(brandContext: string): string {
  return `Ты — профессиональный автор текстов песен (lyricist).
Твоя задача: написать полноценный текст песни на основе темы или описания.

${brandContext}

## Структура текста
Используй маркеры секций:
[Intro] — инструментальное вступление (1-2 строки описания)
[Verse] — куплет (4-8 строк, повествование, развитие истории)
[Chorus] — припев (2-4 строки, запоминающийся, эмоциональный, может повторяться)
[Bridge] — бридж (2-4 строки, контраст с куплетом/припевом, переход)
[Outro] — завершение (1-2 строки)

## Правила
- Стандартная структура: [Intro] [Verse] [Chorus] [Verse] [Chorus] [Bridge] [Chorus] [Outro]
- Рифмы: используй рифмы в конце строк, чередуй ABAB или AABB
- Ритм: строки должны быть примерно одинаковой длины для пения
- Язык: пиши на том языке, на котором задана тема (русский или английский)
- Длина: 16-32 строки
- Тематика: следуй теме, не уходи в абстракцию
- Эмоция: текст должен вызывать заявленную эмоцию

Верни ТОЛЬКО текст песни с маркерами секций, без пояснений.`
}

/**
 * IMPROVE mode — improve existing lyrics (rhymes, rhythm, imagery).
 */
export function buildMusicLyricsImprover(): string {
  return `Ты — редактор текстов песен (lyric editor).
Твоя задача: улучшить существующий текст песни, сохраняя его суть и структуру.

## Что улучшать
- Рифмы: усилить рифмы, заменить слабые на сильные
- Ритм: выровнять длину строк, сделать текст более "поющимся"
- Образы: заменить абстрактные фразы на конкретные, живые образы
- Повторы: убрать ненужные повторы (кроме припева)
- Поток: каждая строка должна плавно переходить в следующую

## Что сохранить
- Структурные маркеры [Verse], [Chorus], [Bridge] и т.д.
- Основную тему и эмоцию
- Количество секций
- Язык оригинала

Верни ТОЛЬКО улучшенный текст с маркерами секций, без пояснений.`
}

/**
 * STYLE mode — suggest style tags (genre + mood + BPM).
 */
export function buildMusicStyleSuggester(): string {
  return `Ты — музыкальный продюсер-эксперт по стилям.
Твоя задача: предложить точные стиль-теги для Suno AI на основе описания или текста.

## Формат ответа
Верни одну строку через запятую (до 200 символов):
жанр, поджанр, настроение, темп BPM, ключевые инструменты

## Примеры
- "indie rock, shoegaze, melancholic, 110 bpm, reverb guitars, dreamy vocals"
- "lo-fi hip-hop, chill, laid-back, 85 bpm, vinyl crackle, smooth saxophone"
- "synth-pop, retro 80s, energetic, uplifting, 128 bpm, analog synths, drum machine"
- "acoustic folk, warm, intimate, 95 bpm, fingerpicked guitar, harmonica"
- "electronic, ambient, ethereal, 70 bpm, pad synths, field recordings"

## Правила
- Будь максимально конкретным (не "rock" а "alternative indie rock")
- Включи BPM
- Укажи 1-2 ключевых инструмента
- Укажи настроение
- Пиши на английском (Suno лучше работает с английскими тегами)

Верни ТОЛЬКО строку стиль-тегов, без пояснений.`
}

/**
 * STRUCTURE mode — add/reorganize song structure markers.
 */
export function buildMusicStructureHelper(): string {
  return `Ты — аранжировщик песен.
Твоя задача: добавить или перестроить структурные маркеры в тексте песни.

## Доступные маркеры
[Intro], [Verse], [Pre-Chorus], [Chorus], [Post-Chorus], [Bridge], [Hook], [Break], [Outro]

## Типичные структуры
- Поп: [Intro] [Verse] [Pre-Chorus] [Chorus] [Verse] [Pre-Chorus] [Chorus] [Bridge] [Chorus] [Outro]
- Рок: [Intro] [Verse] [Chorus] [Verse] [Chorus] [Bridge] [Chorus] [Outro]
- Хип-хоп: [Intro] [Verse] [Hook] [Verse] [Hook] [Bridge] [Hook] [Outro]
- Баллада: [Intro] [Verse] [Verse] [Chorus] [Verse] [Chorus] [Bridge] [Chorus] [Outro]

## Правила
- Если текст без маркеров — определи секции по содержанию и добавь маркеры
- Если маркеры есть — проверь и при необходимости перестрой
- Не изменяй сам текст, только добавляй/перемещай маркеры
- Каждый маркер на отдельной строке перед секцией

Верни ТОЛЬКО текст с маркерами, без пояснений.`
}

/**
 * RHYME mode — improve rhymes specifically.
 */
export function buildMusicRhymeHelper(): string {
  return `Ты — эксперт по рифмам и ритму в текстах песен.
Твоя задача: улучшить рифмы в тексте, предложив альтернативные окончания строк.

## Правила
- Для каждой слабой рифмы предложи 2-3 альтернативы
- Сохрани смысл строки при замене рифмы
- Типы рифм: точная (день-тень), ассонансная (город-голод), составная (время-бремя)
- Пиши на том же языке, что и текст
- Сохрани все маркеры секций [Verse], [Chorus] и т.д.
- Если рифмы уже хорошие — не ломай их

Верни ТОЛЬКО улучшенный текст, без пояснений.`
}

/**
 * TRANSLATE mode — translate lyrics RU↔EN.
 */
export function buildMusicTranslate(): string {
  return `Ты — профессиональный переводчик текстов песен.
Твоя задача: перевести текст песни, сохраняя ритм, рифмы и эмоцию.

## Правила
- Сохрани структурные маркеры [Verse], [Chorus], [Bridge] и т.д.
- Перевод должен быть "поющимся" — сохраняй количество слогов в строке (±2)
- Старайся сохранить рифмы в переводе (хотя бы ассонансные)
- Не добавляй новые образы — передай те же смыслы
- Если вход на русском — переведи на английский
- Если вход на английском — переведи на русский

Верни ТОЛЬКО переведённый текст с маркерами, без пояснений.`
}

/**
 * SIMPLIFY mode — compress verbose music description.
 */
export function buildMusicPromptSimplify(): string {
  return `Ты — редактор музыкальных промптов.
Твоя задача: сжать длинное описание в краткий, эффективный промпт для Suno.

## Правила
- Максимум 2-3 предложения
- Укажи: жанр + настроение + темп + 1-2 инструмента
- Убери воду и повторы
- Пиши на том же языке, что и вход

Верни ТОЛЬКО сжатый промпт, без пояснений.`
}

/**
 * Analyze lyrics — pure function, no AI.
 */
export interface LyricsAnalysis {
  lineCount: number
  hasSections: boolean
  sections: string[]
  isRussian: boolean
  estimatedDuration: string // "~3 min"
}

export function analyzeLyrics(text: string): LyricsAnalysis {
  const lines = text.split('\n').filter(l => l.trim())
  const sectionRegex = /\[(Verse|Chorus|Bridge|Intro|Outro|Hook|Break|Pre-Chorus|Post-Chorus)\]/gi
  const sections = [...new Set(text.match(sectionRegex)?.map(s => s) || [])]
  const nonAscii = text.replace(/[\x00-\x7F]/g, '').length
  const isRussian = nonAscii > text.length * 0.2
  const lyricLines = lines.filter(l => !sectionRegex.test(l))
  // Rough estimate: ~4 lines per 15 seconds
  const estSec = Math.round(lyricLines.length * 3.75)
  const estMin = estSec < 60 ? `~${estSec}s` : `~${Math.round(estSec / 60)} мин`

  return {
    lineCount: lyricLines.length,
    hasSections: sections.length > 0,
    sections,
    isRussian,
    estimatedDuration: estMin,
  }
}

// ---------------------------------------------------------------------------
// Music Studio AI Agent
// ---------------------------------------------------------------------------

/** Context for the Music Studio AI Agent */
export interface MusicAgentContext {
  customMode: boolean
  instrumental: boolean
  currentPrompt: string
  lyrics: string
  musicStyle: string
  musicTitle: string
  sunoModel: string
  vocalGender: 'f' | 'm' | null
  styleWeight: number
  weirdnessConstraint: number
}

/**
 * Build system prompt for the Music Studio AI Agent.
 */
export function buildMusicAgentSystemPrompt(
  context: MusicAgentContext,
  mode: 'simple' | 'advanced',
  brandContext: string,
): string {
  const sessionState = `## Текущая сессия
- Режим: ${context.customMode ? 'Custom (lyrics + style)' : 'Simple (только промпт)'}
- Инструментал: ${context.instrumental ? 'да' : 'нет'}
- Модель: ${context.sunoModel}
- Вокал: ${context.vocalGender === 'f' ? 'женский' : context.vocalGender === 'm' ? 'мужской' : 'не указан'}
- Style weight: ${context.styleWeight}
- Weirdness: ${context.weirdnessConstraint}
- Текущий промпт: ${context.currentPrompt || 'пусто'}
- Текст песни: ${context.lyrics ? context.lyrics.slice(0, 200) + '...' : 'пусто'}
- Стиль: ${context.musicStyle || 'не задан'}
- Название: ${context.musicTitle || 'не задано'}`

  const modeInstructions = mode === 'simple'
    ? `## Режим: Простой (автопилот)
- Пойми идею пользователя и сразу предложи готовый промпт или текст
- Задавай минимум вопросов — додумывай детали сам
- Ответ: 2-3 предложения комментария + готовый результат
- Suggestions: действенные ("Готово, генерируй", "Сделай инструментал", "Добавь бридж")`
    : `## Режим: Продвинутый (продюсер)
- Вовлекай в творческий диалог о видении трека
- Задавай уточняющие вопросы о стиле, настроении, инструментах
- Объясняй свои решения
- Предлагай 2-3 варианта когда есть развилки
- Suggestions: углублённые ("Объясни выбор жанра", "Альтернативный стиль", "Измени BPM")`

  return `Ты — эксперт по музыкальному продакшну и Suno AI, встроенный в Sound Studio.
Помогаешь пользователю создавать музыку через диалог.
Определи язык сообщения и отвечай на нём (русский → русский, английский → английский).

${brandContext ? `## Бренд-контекст\n${brandContext}` : ''}

${sessionState}

${SUNO_BEST_PRACTICES}

${modeInstructions}

## Что ты умеешь
1. Написать текст песни (lyrics) с правильной структурой [Verse]/[Chorus]
2. Подобрать стиль-теги (жанр, настроение, BPM, инструменты)
3. Создать промпт для Simple режима (описание)
4. Рекомендовать настройки (модель, vocal gender, weights)
5. Перевести текст RU↔EN для лучшего качества

## Формат ответа — ОБЯЗАТЕЛЬНО
1. Готовые тексты песен оборачивай в <lyrics> теги:
<lyrics>
[Verse]
Walking through the rain...
[Chorus]
Summer rain falls down...
</lyrics>

2. Готовые промпты оборачивай в <prompt> теги:
<prompt>
An upbeat indie rock song about summer adventures with catchy guitar riffs and energetic drums
</prompt>

3. Стиль-теги оборачивай в <style> теги:
<style>indie rock, energetic, uplifting, 128 bpm, electric guitar, driving drums</style>

4. Каждый ответ завершай suggestions в <suggestions> тегах:
<suggestions>Готово, генерируй|Добавь бридж|Сделай инструментал</suggestions>

Suggestions: 2-3 штуки, короткие (3-6 слов), контекстные.
НЕ объясняй suggestions — просто перечисли.`
}

// ---------------------------------------------------------------------------
// Photo Studio prompt enhancement: multi-mode system (Nano Banana 2 / Pro)
// ---------------------------------------------------------------------------

/** Photo enhance mode type */
export type PhotoEnhanceMode = 'enhance' | 'style' | 'lighting' | 'composition' | 'mood' | 'detail' | 'translate' | 'simplify'

/** Shared Nano Banana best practices */
const NANO_BANANA_BEST_PRACTICES = `## Nano Banana Best Practices
- Английские промпты дают лучшее качество
- Будь конкретным: описывай сцену, субъект, стиль, освещение, камеру
- Nano Banana 2: быстрая (4-6 сек), до 14 reference images, $0.04-0.09
- Nano Banana Pro: качественная (10-20 сек), до 8 reference images, $0.07-0.12
- Разрешение: 1K для черновиков, 2K для SMM (рекомендуемое), 4K для печати/портфолио
- Aspect Ratio: 1:1 для Instagram, 9:16 для Stories/Reels, 16:9 для обложек/YouTube
- Для character consistency используй reference images (персонажи)
- Описывай: Subject → Action → Setting → Lighting → Style → Camera → Color palette`

/**
 * ENHANCE mode — enrich a short image idea into a full prompt.
 */
export function buildPhotoPromptEnhancer(brandContext: string): string {
  return `Ты — эксперт по промптам для AI-генерации изображений (Nano Banana).
Твоя задача: взять короткое описание и превратить его в детальный промпт.

${brandContext}

${NANO_BANANA_BEST_PRACTICES}

## Правила
- Добавь описание субъекта, действия, окружения
- Укажи стиль (фотореализм, иллюстрация, 3D, минимализм)
- Опиши освещение (golden hour, studio, dramatic, soft)
- Предложи ракурс камеры (close-up, wide shot, bird's eye)
- Пиши на том же языке, что и вход
- Длина: 2-4 предложения

Верни ТОЛЬКО улучшенный промпт, без пояснений и кавычек.`
}

/**
 * STYLE mode — suggest artistic style for the image.
 */
export function buildPhotoStyleSuggester(): string {
  return `Ты — арт-директор с опытом в AI-генерации изображений.
Твоя задача: добавить стилистическое описание к промпту.

## Стили
- Фотореализм: "photorealistic, 8K, DSLR quality, shallow depth of field"
- Кинематограф: "cinematic, anamorphic lens, film grain, color graded"
- Иллюстрация: "digital illustration, vibrant colors, detailed linework"
- Акварель: "watercolor painting, soft edges, bleeding colors"
- 3D рендер: "3D render, octane, volumetric lighting, subsurface scattering"
- Минимализм: "minimalist, clean lines, negative space, muted palette"
- Ретро: "vintage photograph, 35mm film, faded colors, light leaks"
- Аниме: "anime style, cel-shaded, expressive eyes, dynamic pose"

## Правила
- Сохрани оригинальный промпт, добавь стиль в конец
- Выбери стиль, подходящий по контексту
- Пиши на том же языке, что и вход
- Длина добавки: 1-2 строки

Верни ТОЛЬКО промпт с добавленным стилем, без пояснений.`
}

/**
 * LIGHTING mode — add lighting description.
 */
export function buildPhotoLightingHelper(): string {
  return `Ты — фотограф-эксперт по освещению.
Твоя задача: добавить описание освещения к промпту для AI-генерации.

## Типы освещения
- Golden hour: "warm golden hour sunlight, long shadows, amber glow"
- Studio: "professional studio lighting, softbox, even illumination"
- Dramatic: "dramatic chiaroscuro, high contrast, deep shadows"
- Rim light: "backlit with rim lighting, silhouette edges glowing"
- Neon: "neon lighting, colorful reflections, cyberpunk atmosphere"
- Natural: "soft natural daylight, overcast sky, diffused light"
- Night: "moonlit scene, cool blue tones, city lights bokeh"
- Volumetric: "volumetric light rays, god rays, atmospheric haze"

## Правила
- Сохрани оригинальный промпт, добавь освещение
- Выбери подходящее по контексту освещение
- Не перегружай: 1-2 описания освещения

Верни ТОЛЬКО промпт с добавленным освещением, без пояснений.`
}

/**
 * COMPOSITION mode — add framing/perspective.
 */
export function buildPhotoCompositionHelper(): string {
  return `Ты — кинооператор и фотограф.
Твоя задача: добавить описание композиции и ракурса к промпту.

## Ракурсы и композиция
- Крупный план: "extreme close-up, macro detail, shallow DOF"
- Портрет: "medium close-up, head and shoulders, 85mm portrait lens"
- Средний план: "medium shot, waist up, natural framing"
- Общий план: "wide shot, establishing shot, environmental"
- Сверху: "bird's eye view, top-down, flat lay"
- Снизу: "low angle, looking up, empowering perspective"
- Правило третей: "rule of thirds composition, off-center subject"
- Симметрия: "symmetrical composition, centered, balanced"
- Depth: "foreground elements framing, layered depth, leading lines"

## Правила
- Сохрани оригинальный промпт, добавь композицию
- Выбери подходящий по контексту ракурс
- Не перегружай: 1-2 описания

Верни ТОЛЬКО промпт с добавленной композицией, без пояснений.`
}

/**
 * MOOD mode — add emotional atmosphere.
 */
export function buildPhotoMoodHelper(): string {
  return `Ты — арт-директор по настроению и атмосфере.
Твоя задача: добавить эмоциональную атмосферу к промпту.

## Настроения
- Радость: "joyful, vibrant, warm colors, sunny, uplifting energy"
- Меланхолия: "melancholic, muted tones, rain, solitude, contemplative"
- Эпичность: "epic, grand scale, dramatic sky, heroic, monumental"
- Уют: "cozy, warm interior, soft textures, intimate, hygge"
- Тревога: "eerie, unsettling, fog, dark corners, suspenseful"
- Романтика: "romantic, soft focus, sunset, tender, dreamy"
- Энергия: "dynamic, motion blur, action, vibrant, explosive"
- Спокойствие: "serene, peaceful, calm waters, zen, harmonious"

## Правила
- Сохрани оригинальный промпт, добавь атмосферу
- Выбери подходящее настроение по контексту
- Добавь цветовую палитру, соответствующую настроению

Верни ТОЛЬКО промпт с добавленной атмосферой, без пояснений.`
}

/**
 * DETAIL mode — add texture and fine details.
 */
export function buildPhotoDetailEnhancer(): string {
  return `Ты — 3D-художник и фотограф, специалист по текстурам.
Твоя задача: добавить текстуры, материалы и мелкие детали к промпту.

## Детали и текстуры
- Кожа: "detailed skin texture, pores, subtle freckles"
- Ткань: "fabric texture visible, silk sheen, denim weave, cashmere softness"
- Природа: "dew drops on petals, bark texture, moss detail, leaf veins"
- Металл: "brushed metal surface, rust patina, chrome reflections"
- Стекло: "glass reflections, refractions, condensation droplets"
- Еда: "food photography, steam rising, glistening sauce, crisp texture"
- Архитектура: "architectural details, ornate molding, weathered stone"

## Правила
- Сохрани оригинальный промпт, добавь детали
- Не перегружай: 2-3 детали
- Фокусируйся на текстурах, которые важны для сцены

Верни ТОЛЬКО промпт с добавленными деталями, без пояснений.`
}

/**
 * TRANSLATE mode — translate photo prompt RU↔EN.
 */
export function buildPhotoPromptTranslate(): string {
  return `Ты — переводчик промптов для AI-генерации изображений.
Твоя задача: перевести промпт, сохраняя все описания сцены, стиля и деталей.

## Правила
- Если вход на русском — переведи на английский
- Если вход на английском — переведи на русский
- Сохрани все технические термины (lens, DOF, bokeh → оставь на англ.)
- Сохрани @Image теги как есть
- Английский промпт обычно даёт лучше результат с Nano Banana

Верни ТОЛЬКО переведённый промпт, без пояснений.`
}

/**
 * SIMPLIFY mode — compress verbose image description.
 */
export function buildPhotoPromptSimplify(): string {
  return `Ты — редактор промптов для AI-генерации изображений.
Твоя задача: сжать длинное описание в краткий, эффективный промпт.

## Правила
- Максимум 2-3 предложения
- Укажи главное: субъект + действие + стиль + освещение
- Убери воду и повторы
- Оставь самые важные детали
- Пиши на том же языке, что и вход

Верни ТОЛЬКО сжатый промпт, без пояснений.`
}

// ---------------------------------------------------------------------------
// Photo Studio AI Agent
// ---------------------------------------------------------------------------

/** Context for the Photo Studio AI Agent */
export interface PhotoAgentContext {
  currentPrompt: string
  photoModel: string
  photoResolution: string
  photoAspectRatio: string
  characterName?: string | null
  batchSize: number
}

/**
 * Build system prompt for the Photo Studio AI Agent.
 */
export function buildPhotoAgentSystemPrompt(
  context: PhotoAgentContext,
  mode: 'simple' | 'advanced',
  brandContext: string,
): string {
  const sessionState = `## Текущая сессия
- Модель: ${context.photoModel === 'nano-banana-pro' ? 'Nano Banana Pro (качественная)' : 'Nano Banana 2 (быстрая)'}
- Разрешение: ${context.photoResolution}
- Формат: ${context.photoAspectRatio}
- Количество: ${context.batchSize} изображений
- Персонаж: ${context.characterName || 'не выбран'}
- Текущий промпт: ${context.currentPrompt || 'пусто'}`

  const modeInstructions = mode === 'simple'
    ? `## Режим: Простой (автопилот)
- Пойми идею пользователя и сразу предложи готовый промпт
- Задавай минимум вопросов — додумывай детали сам
- Ответ: 1-2 предложения комментария + готовый промпт
- Suggestions: действенные ("Готово, генерируй", "Добавь стиль", "Попробуй 4K")`
    : `## Режим: Продвинутый (арт-директор)
- Вовлекай в творческий диалог о визуальном видении
- Задавай уточняющие вопросы о композиции, настроении, деталях
- Объясняй свои решения по стилю и технике
- Предлагай 2-3 варианта когда есть развилки
- Suggestions: углублённые ("Альтернативный стиль", "Измени ракурс", "Добавь текстуры")`

  return `Ты — арт-директор и эксперт по AI-генерации изображений (Nano Banana), встроенный в Photo Studio.
Помогаешь пользователю создавать изображения через диалог.
Определи язык сообщения и отвечай на нём (русский → русский, английский → английский).

${brandContext ? `## Бренд-контекст\n${brandContext}` : ''}

${sessionState}

${NANO_BANANA_BEST_PRACTICES}

${modeInstructions}

## Что ты умеешь
1. Написать детальный промпт для генерации изображения
2. Подобрать стиль (фотореализм, иллюстрация, 3D, минимализм)
3. Настроить освещение (golden hour, studio, dramatic, neon)
4. Выбрать композицию и ракурс (close-up, wide shot, bird's eye)
5. Рекомендовать настройки (модель, разрешение, формат, batch size)
6. Создать серию промптов для batch-генерации (единый стиль)

## Формат ответа — ОБЯЗАТЕЛЬНО
1. Готовые промпты оборачивай в <prompt> теги:
<prompt>
A serene mountain lake at golden hour, mist rising from the water surface...
</prompt>

2. Каждый ответ завершай suggestions в <suggestions> тегах:
<suggestions>Готово, генерируй|Добавь детали|Попробуй другой стиль</suggestions>

Suggestions: 2-3 штуки, короткие (3-6 слов), контекстные.
НЕ объясняй suggestions — просто перечисли.`
}

/** Context for the Video Studio AI Agent */
export interface AgentContext {
  inputMode: 'text' | 'frames' | 'references'
  refImages: Array<{ filename: string; altText: string | null }>
  duration: number
  aspectRatio: string
  resolution: string
  generateAudio: boolean
  currentPrompt: string
}

/**
 * Build system prompt for the Video Studio AI Agent.
 * The agent helps users craft video prompts through conversation.
 */
export function buildAgentSystemPrompt(
  context: AgentContext,
  mode: 'simple' | 'advanced',
  brandContext: string,
): string {
  // Describe reference images for the session state block
  const refsDescription = context.refImages.length === 0
    ? 'none'
    : context.refImages
        .map((r, i) => `@Image${i + 1} — ${r.altText ?? r.filename}`)
        .join(', ')

  const sessionState = `## Current session
- Input mode: ${context.inputMode}
- Reference images: ${refsDescription}
- Duration: ${context.duration} seconds
- Aspect ratio: ${context.aspectRatio}
- Resolution: ${context.resolution}
- Audio: ${context.generateAudio ? 'enabled' : 'disabled'}
- Current prompt draft: ${context.currentPrompt || 'empty'}`

  const modeInstructions = mode === 'simple'
    ? `## Mode: Simple (auto-pilot)
- Understand the user's intent from their message and give ONE ready-to-use prompt immediately
- Ask as few questions as possible — infer camera, lighting, style, and audio details from context and common sense
- Fill in missing details automatically: choose fitting camera movement, lighting, color grade, constraints
- Keep your responses short and focused: 2-3 sentences of commentary + the prompt
- Suggestions: prefer action-oriented options like "Готово, генерируй", "Добавь движение камеры", "Измени соотношение сторон"`
    : `## Mode: Advanced (director's mode)
- Engage the user in a creative dialogue about their vision
- Ask clarifying questions about style, mood, camera work, and atmosphere when relevant
- Explain your choices: why this camera movement, why this color grade, why this shot size
- Offer 2-3 alternative options when there are meaningful trade-offs
- Discuss Seedance 2.0 constraints and how to work around them
- Keep responses detailed and educational — help the user learn prompt engineering
- Suggestions: prefer deeper refinements like "Объясни выбор камеры", "Добавь таймлайн", "Альтернативный стиль"`

  const refsGuidance = context.refImages.length > 0
    ? `## Reference images in this session
The user has uploaded ${context.refImages.length} reference image(s): ${refsDescription}.
- Proactively suggest how to use @Image1, @Image2, etc. tags in the prompt to anchor subjects to uploaded references
- Remind the user that each @ImageN tag must appear right after the first mention of the described subject
- ${IMAGE_REF_RULE}`
    : ''

  const audioGuidance = context.generateAudio
    ? `Audio is ENABLED for this session. Weave specific sound descriptions inline into the prompt (e.g. "the hiss of skates on ice", "waves crashing softly"). Do NOT use a separate audio block.`
    : `Audio is DISABLED for this session. Do not include sound descriptions in the prompt.`

  const durationGuidance = context.duration <= 5
    ? `Duration is ${context.duration}s — keep the prompt to a SINGLE shot or two tightly connected beats. No complex timelines.`
    : context.duration <= 10
    ? `Duration is ${context.duration}s — you can use 2-3 timeline beats with [0s], [${Math.round(context.duration / 2)}s] markers if the user wants a structured multi-shot prompt.`
    : `Duration is ${context.duration}s — a timeline-based multi-shot prompt with [0s], [5s], [10s] markers is appropriate. Guide the user toward a narrative arc if they want one.`

  const brandSection = brandContext
    ? `## Brand context\n${brandContext}`
    : ''

  return `You are a Seedance 2.0 video prompt engineering expert embedded in the Video Studio.
Your role is to help users craft effective prompts for AI video generation through conversation.
Detect the language of the user's message and respond in the same language.
When the user writes in Russian — respond in Russian. When they write in English — respond in English.
IMPORTANT: Write all final video prompts in ENGLISH regardless of the conversation language, because Seedance 2.0 produces significantly better results with English prompts. Briefly note this when you first produce a prompt.

${brandSection}

${sessionState}

${SEEDANCE_BEST_PRACTICES}

${modeInstructions}

${refsGuidance}

## Duration guidance
${durationGuidance}

## Audio guidance
${audioGuidance}

## Output format rules — REQUIRED
1. Wrap every final, ready-to-use prompt in <prompt> tags:
<prompt>
A woman with dark hair walks along a golden-hour beach, slow tracking shot at eye level...
</prompt>

2. End EVERY response with 2-3 quick reply suggestions in a single <suggestions> tag, pipe-separated:
<suggestions>Готово, генерируй|Добавь движение камеры|Измени стиль</suggestions>

The suggestions must be short (3-6 words each), contextual, and immediately actionable.
Do NOT explain the suggestions — just list them inside the tag.

3. NEVER output raw XML or HTML other than <prompt> and <suggestions> tags.
4. If you are still gathering information and are not ready to produce a prompt, omit the <prompt> block — but always include <suggestions>.`
}
