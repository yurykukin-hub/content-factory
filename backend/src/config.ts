import { z } from 'zod'

const envSchema = z.object({
  DATABASE_URL: z.string(),
  JWT_SECRET: z.string().min(32),
  PORT: z.coerce.number().default(3800),
  OPENROUTER_API_KEY: z.string().default(''),  // Можно задать через UI (Settings → AI)

  // LLM-канал. Из РФ-ноды (СПб) openrouter.ai отдаёт 403 (Cloudflare geo-block),
  // Anthropic/OpenAI недопустимы по ToS → чат идёт через litellm-шлюз на EU-ноде.
  // Пусто = прежнее прямое поведение. На шлюзе wildcard-passthrough, поэтому
  // id моделей и таблица MODEL_PRICING остаются без изменений.
  LLM_BASE_URL: z.string().default(''),
  LLM_API_KEY: z.string().default(''),          // на шлюзе это LITELLM_MASTER_KEY
  // Отдельный канал для OpenRouter-специфичных ручек (/credits — баланса у litellm нет).
  // Через Caddy-шлюз это passthrough-путь: https://gw.yurykukin.ru/api/v1
  OPENROUTER_PASSTHROUGH_URL: z.string().default('https://openrouter.ai/api/v1'),
  KIE_API_KEY: z.string().default(''),            // KIE.ai — image editing, video generation
  OPENAI_API_KEY: z.string().default(''),          // OpenAI Whisper (voice transcription)
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),

  // --- Хранилище медиа (services/storage) ---
  // Драйвер: 'local' — файлы в uploads-volume (текущее поведение). 's3' появится в Фазе 2
  // миграции на Beget S3 (сейчас фабрика на него бросает).
  STORAGE_DRIVER: z.enum(['local', 's3']).default('local'),
  // Override корня локального хранилища. Пусто = <backend>/uploads. Нужен тестам
  // и снимает причину хака `existsSync('/app/uploads')` в одноразовых fix-*.ts.
  UPLOADS_DIR: z.string().default(''),
  // База абсолютных URL медиа для ВНЕШНИХ потребителей: KIE.ai скачивает по ней
  // референсы, vision-модели — картинки, satori — фон сторис (self-fetch).
  // Пусто = прежнее поведение (prod-домен / localhost:PORT), поэтому переменную
  // не обязательно заводить в .env.prod.
  // ⚠️ Это ДОМЕН ПРИЛОЖЕНИЯ, и при драйвере `s3` он таким и остаётся: бакет приватный,
  // раздача идёт прокси-стримом через `GET /uploads/*`. Подставить сюда S3-эндпоинт —
  // значит разом сломать всех внешних потребителей (KIE.ai, vision, satori): они
  // получат 403 от приватного бакета.
  PUBLIC_BASE_URL: z.string().default(''),

  // --- Beget S3 (драйвер `s3`, Фаза 2) ---
  // Читаются только при STORAGE_DRIVER=s3; при `local` пустые значения безвредны.
  S3_ENDPOINT: z.string().default(''),
  S3_BUCKET: z.string().default(''),
  S3_REGION: z.string().default('ru1'),
  S3_ACCESS_KEY: z.string().default(''),
  S3_SECRET_KEY: z.string().default(''),
  // Префикс ключей внутри бакета. Единственное, что изолирует dev от прод-объектов:
  // `makeKey` порождает одинаковые ключи для одинаковых businessId, а `/rotate`
  // и EXIF-нормализация перезаписывают объект ПО ТОМУ ЖЕ ключу. Прод — пусто, dev — `dev/`.
  S3_KEY_PREFIX: z.string().default(''),

  // Каталог временных файлов для ffmpeg (он не умеет ни буферы, ни URL).
  // Пусто = `<uploadsRoot>/.tmp`. НЕ `os.tmpdir()`: в контейнере это overlay-фс
  // корневого диска (84%, там же postgres), а времянка от 500-МБ видео дала бы
  // туда 0.5–1 ГБ. Требование к значению: тот же том, что uploads, — иначе
  // `rename()` в локальном драйвере выродится в копирование целого файла.
  STORAGE_TMP_DIR: z.string().default(''),
})

const parsed = envSchema.safeParse(process.env)

if (!parsed.success) {
  console.error('Invalid environment variables:', parsed.error.flatten().fieldErrors)
  process.exit(1)
}

// В production JWT_SECRET не должен быть плейсхолдером/предсказуемым dev-ключом — иначе токены подделываются.
if (parsed.data.NODE_ENV === 'production') {
  const s = parsed.data.JWT_SECRET
  const weak = s.startsWith('change-this') || /-dev-|dev-key/i.test(s)
  if (weak) {
    console.error('[SECURITY] JWT_SECRET выглядит как плейсхолдер/dev-ключ. Сгенерируйте: openssl rand -base64 48')
    process.exit(1)
  }
}

export const config = {
  ...parsed.data,
  isProd: parsed.data.NODE_ENV === 'production',

  // База публичных URL медиа. Пусто в env => та же формула, что была захардкожена
  // в 5 местах (kie.ts, image-describer.ts, html-render.ts, routes/ai.ts ×2).
  publicBaseUrl:
    parsed.data.PUBLIC_BASE_URL.replace(/\/+$/, '') ||
    (parsed.data.NODE_ENV === 'production'
      ? 'https://content.yurykukin.ru'
      : `http://localhost:${parsed.data.PORT}`),

  // LLM-канал (см. services/ai/openrouter.ts). baseUrl задан => чат идёт через
  // EU-шлюз и ключ берём из env (master-key шлюза), а НЕ из БД: в БД лежит
  // прямой ключ OpenRouter, шлюз его не примет.
  llm: {
    baseUrl: parsed.data.LLM_BASE_URL || '',
    apiKey: parsed.data.LLM_API_KEY || '',
    chatUrl: (parsed.data.LLM_BASE_URL || 'https://openrouter.ai/api/v1') + '/chat/completions',
  },

  // AI models
  models: {
    haiku: 'anthropic/claude-haiku-4.5', // 3.5-haiku снят с Bedrock (EOL → 404) 2026-06-20; 4.5 — актуальный Haiku
    sonnet: 'anthropic/claude-sonnet-4.6', // 4.6 — актуальный Sonnet, та же цена $3/$15 (был claude-sonnet-4, deprecated 15.06.2026)
    vision: 'google/gemini-2.5-flash-lite', // captioning галереи: быстрее/дешевле flash при том же качестве (тест Ф0.1, 19.06.2026)
    visionFallback: 'google/gemini-2.5-flash', // запасная (НЕ qwen — зацикливается)
    imageGen: 'google/gemini-2.5-flash-image',
    kieEditImage: 'nano-banana-2',
    kieRemoveBg: 'recraft/remove-background',
  },
}
