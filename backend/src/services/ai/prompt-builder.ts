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
- Write in ENGLISH (Seedance works better in English)
- Use specific camera terms: "slow dolly push" not "beautiful movement"
- For audio: weave sound descriptions inline, not as a separate section
${IMAGE_REF_RULE}

## Examples

Input: "SUP на закате"
Output: "A young athletic man standing on a SUP board, paddling slowly across calm lake water. Steady tracking shot from behind, medium wide, smooth gimbal movement at eye level. Golden hour sunset light reflecting on water surface, warm orange and amber tones, 35mm film grain. Gentle water splashing from paddle strokes, distant birds calling. Smooth motion, high detail, consistent water physics. No text overlays, no watermarks."

Input (advanced, 200+ words with timeline): preserve the timeline structure and length, only fix specific weak spots.

Return ONLY the improved prompt in English, no explanations, no quotes.`
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

Return ONLY the timeline prompt in English, no explanations.`
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
- Maintain the original language (English or mixed)
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
- Write in English
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
