# Content Factory — AI-контент-фабрика

## Назначение
AI-контент-фабрика для автоматизации SMM. Генерирует контент-планы, тексты постов, адаптирует под платформы (VK, Telegram, Instagram), публикует автоматически. Мультибизнес: KB, НаWоде, Inpulse, личный бренд.

## Production
- **URL:** https://content.yurykukin.ru
- **VPS:** Латвия (91.193.25.104), Docker Compose + Caddy
- **Деплой:** `bash /home/dev/projects/content-factory/scripts/deploy.sh`
- **Бэкапы:** cron 2x/день, `/opt/backups/content-factory/`

## Стек
- **Backend:** Bun + Hono + TypeScript
- **Frontend:** Vue 3 + Tailwind CSS + Lucide Icons + Pinia
- **ORM/DB:** Prisma + PostgreSQL 16
- **AI:** OpenRouter (Haiku для адаптации, Sonnet для генерации, Gemini Flash для vision) + KIE.ai (Nano Banana 2 + **Nano Banana Pro** для text2img/img2img, FLUX Kontext Pro для img2img, recraft для удаления фона, Seedance 2 для видео, **Suno V4/V4_5/V5_5 для музыки — API v2**) + **OpenAI Whisper** (голосовой ввод)
- **Audio:** wavesurfer.js v7 (waveform visualization)
- **Testing:** Vitest (96 тестов — 7 файлов)
- **Deploy:** Docker Compose + Caddy (SSL auto)

## Порты
| Сервис | Порт |
|---|---|
| Backend | :3800 |
| Frontend dev | :5176 |
| PostgreSQL | :5441 |

## Структура

```
content-factory/
├── backend/
│   ├── prisma/schema.prisma    # 23 модели, 8 enums
│   ├── src/
│   │   ├── app.ts              # Hono app (routes, middleware, error handler)
│   │   ├── index.ts            # Server start + scheduler + graceful shutdown
│   │   ├── db.ts               # PrismaClient singleton
│   │   ├── config.ts           # Env validation (zod)
│   │   ├── eventBus.ts         # SSE events
│   │   ├── middleware/
│   │   │   ├── auth.ts         # JWT httpOnly cookie + requireRole + sectionAccess
│   │   │   ├── section-access.ts   # requireSection(section, level) — per-section access control
│   │   │   ├── business-access.ts  # requireBusinessAccess + getUserBusinessIds
│   │   │   └── resource-access.ts  # verifyPost/Plan/Media/PostVersionAccess
│   │   ├── routes/             # API endpoints (~18 файлов)
│   │   │   ├── auth.ts         # login/logout/me/refresh (access+refresh tokens)
│   │   │   ├── users.ts        # CRUD пользователей (ADMIN-only)
│   │   │   ├── businesses.ts   # CRUD + brand profile + isActive toggle (ADMIN sees inactive)
│   │   │   ├── platforms.ts    # platformsByBiz + platformsById
│   │   │   ├── posts.ts        # CRUD + approve + versions (access checks)
│   │   │   ├── content-plans.ts # CRUD + create-post/ai-generate + batch
│   │   │   ├── ai.ts           # generate-post/image/video/scenario, adapt, enhance-prompt, describe-image, suggest-templates, agent-chat, transcribe (Whisper)
│   │   │   ├── publish.ts      # publish + schedule (access checks)
│   │   │   ├── media.ts        # upload/delete/attach + library + tags
│   │   │   ├── settings.ts     # AppConfig CRUD (ADMIN-only, .env fallback)
│   │   │   ├── vk-oauth.ts     # VK OAuth 2.1 PKCE
│   │   │   ├── ideas.ts        # CRUD идей (per-user, ownership check)
│   │   │   ├── characters.ts   # CRUD AI-персонажей (person/mascot/avatar/object/location, per-business)
│   │   │   ├── scenarios.ts    # CRUD сценариев (scenes JSON, AI-генерация)
│   │   │   ├── sessions.ts     # CRUD GenerationSession (video + music + photo sessions, type filter)
│   │   │   ├── music.ts        # Sound Studio: generate, enhance-prompt (8 modes), agent-chat, personas CRUD, from-track
│   │   │   ├── photos.ts       # Photo Studio: generate (batch 1/2/4), enhance-prompt (8 modes), agent-chat, edit-image, remove-bg
│   │   │   ├── dashboard.ts    # metrics (scoped by business access)
│   │   │   ├── ai-logs.ts     # AI usage logs (list, stats, summary, error-count, export CSV)
│   │   │   └── sse.ts          # Server-Sent Events
│   │   ├── services/
│   │   │   ├── scheduler.ts    # Отложенная публикация
│   │   │   ├── video-poller.ts # Background poller: video + music + photo KIE tasks → download → SSE (10 сек)
│   │   │   ├── vk-oauth.ts     # VK OAuth service (PKCE, auto-refresh)
│   │   │   ├── ai/
│   │   │   │   ├── openrouter.ts      # OpenRouter + cost calculation + logAndCharge DRY helper
│   │   │   │   ├── prompt-builder.ts  # Промпт-конструктор + video/music/photo agent prompts + 8 enhance modes per studio
│   │   │   │   ├── suno.ts           # KIE.ai Suno client: createMusicTask, processMusicResult, generatePersona
│   │   │   │   ├── image-generation.ts # AI image gen (Gemini 2.5 Flash Image)
│   │   │   │   ├── fal.ts            # FAL.ai SDK (image editing, remove bg)
│   │   │   │   └── whisper.ts        # OpenAI Whisper STT (voice transcription, AppConfig + .env key)
│   │   │   └── publishers/
│   │   │       ├── base.ts     # Publisher interface
│   │   │       ├── vk.ts       # VK wall.post + photo/video + Stories
│   │   │       └── telegram.ts # TG sendPhoto/Video/MediaGroup
│   │   └── utils/
│   │       ├── paths.ts        # getModuleDir (Bun/Node compat)
│   │       └── logger.ts       # Structured logging (JSON prod, pretty dev)
│   ├── vitest.config.ts, vitest-setup.ts
│   ├── package.json, Dockerfile
│   └── .env.example
├── src/                        # Vue 3 frontend
│   ├── api/client.ts           # HTTP client (auto-refresh on 401)
│   ├── router/index.ts         # 16 routes + auth guard + section access guard
│   ├── stores/                 # auth (+ sectionAccess), businesses, theme, sidebar
│   ├── composables/            # useToast, useFormatters, useStatus, usePlatform, useSectionAccess, useRates, useVoiceInput
│   ├── views/
│   │   ├── BusinessesView      # Grid карточек проектов (клик → detail)
│   │   ├── BusinessDetailView  # Хаб проекта: 3 таба (профиль/каналы/обзор+доступы)
│   │   ├── PostEditorView      # Редактор постов (текст + медиа + платформы)
│   │   ├── StoryEditorView     # Stories (canvas WYSIWYG + шаблоны, lock after publish)
│   │   ├── ContentPlansView    # AI планы (таблица + календарь)
│   │   ├── MediaLibraryView    # Медиа-библиотека (grid, click-to-preview modal, AI describe)
│   │   ├── VideoStudioView     # Видео-студия (Kling-style 50/50 layout, sessions, rich prompt)
│   │   ├── PhotoStudioView    # Фото-студия (50/50, NB2/Pro, batch 1/2/4, 1K/2K/4K, AI Agent)
│   │   ├── IdeasView           # Личный блокнот идей (inline edit, auto-save)
│   │   └── ...                 # Dashboard, Login, Settings
│   └── components/
│       ├── layout/             # TheSidebar (mobile overlay), TheHeader (hamburger)
│       ├── BusinessFilter.vue  # Pill-кнопки выбора бизнеса (везде кроме VideoStudio/Media)
│       ├── MediaPickerModal.vue # Выбор файла из медиатеки (модальное окно)
│       ├── ToastContainer.vue  # Toast notifications
│       ├── MediaUpload.vue     # Drag & drop + AI edit/remove bg buttons
│       ├── ai/
│       │   └── ImageEditModal.vue  # AI image editing modal (FLUX Kontext)
│       ├── video/              # Видео-студия компоненты
│       │   ├── VsModeTabs.vue         # Табы режимов (Референсы/Кадры/Текст)
│       │   ├── VsCharacterCarousel.vue # Карусель референсов + hover popup + create
│       │   ├── VsPromptTabs.vue       # Табы Agent/Editor в промпт-зоне
│       │   ├── VsAgentChat.vue        # AI Agent чат (multi-turn, quick replies, Simple/Advanced)
│       │   ├── VsAgentMessage.vue     # Сообщение в чате (markdown, XSS-safe escapeHtml)
│       │   ├── VsPreGenModal.vue      # Модалка подтверждения перед генерацией (formatted prompt)
│       │   ├── VsPromptArea.vue       # Промпт + ref images + шаблоны + VsEnhanceMenu
│       │   ├── VsEnhanceMenu.vue     # Split-button dropdown: 8 режимов enhance (basic+pro)
│       │   ├── VsRichPrompt.vue       # Contenteditable с draggable badge chips (@ImageN)
│       │   ├── VsSettingsPanel.vue    # Resolution/Duration/Ratio/Audio + Generate + timer
│       │   ├── VsSessionBar.vue       # Список сессий (вверху левой панели, status dots, delete)
│       │   ├── VsGallery.vue          # Галерея: видео/промпты/избранное (inline player)
│       │   ├── VsConstructorDrawer.vue # Drawer с PromptConstructor
│       │   ├── VsRefModal.vue         # Модалка создания/просмотра референса + AI Auto
│       │   └── PromptConstructor.vue  # Конструктор промптов (6 секций)
│       ├── sound/              # Звуковая студия компоненты
│       │   ├── SsModeTabs.vue         # Simple/Custom режим
│       │   ├── SsTrackPlayer.vue      # Waveform player (wavesurfer.js, fuchsia brand)
│       │   ├── SsLyricsEditor.vue     # Textarea + [Verse]/[Chorus] section markers
│       │   ├── SsStylePanel.vue       # Genre/Mood/BPM + negative tags
│       │   ├── SsEnhanceMenu.vue      # Split-button: 8 music enhance modes
│       │   ├── SsSettingsPanel.vue    # Model/weights/cost + Generate button
│       │   ├── SsSessionBar.vue       # Список музыкальных сессий
│       │   ├── SsGallery.vue          # Галерея треков с waveform players
│       │   ├── SsAgentChat.vue        # AI Agent чат для музыки (multi-turn)
│       │   ├── SsPromptTabs.vue       # Agent/Editor табы
│       │   ├── SsPreGenModal.vue      # Подтверждение перед генерацией
│       │   ├── SsPersonaSelector.vue  # Выбор голосовой персоны (Voice Clone)
│       │   └── SsCreatePersonaModal.vue # Создание персоны из трека (Suno V5.5)
│       ├── photo/              # Фото-студия компоненты
│       │   ├── PsSettingsPanel.vue    # Model/Resolution/Batch/AspectRatio + Generate
│       │   ├── PsSessionBar.vue       # Список фото-сессий
│       │   ├── PsPromptTabs.vue       # Agent/Editor табы
│       │   ├── PsAgentChat.vue        # AI Agent чат для фото
│       │   ├── PsEnhanceMenu.vue      # Split-button: 8 photo enhance modes
│       │   ├── PsGallery.vue          # Галерея изображений (grid + lightbox)
│       │   └── PsPreGenModal.vue      # Подтверждение перед генерацией
│       └── settings/           # VkOAuthTab, ProfileTab, AiTab, UsersTab
├── docker-compose.yml          # Dev (postgres only)
├── docker-compose.prod.yml     # Prod (postgres + backend, healthchecks)
└── scripts/deploy.sh, backup-db.sh
```

## Schema (25 моделей, 8 enums)
User, UserBusiness, Business, BrandProfile, PlatformAccount, ContentPlan, ContentPlanItem, Post, PostVersion, PublishLog, MediaFolder, MediaFile, AiUsageLog, WebhookRule, AppConfig, Idea, StoryTemplate, Character, CharacterBusiness, Scenario, PromptEntry, PromptTemplate, GenerationSession, BalanceTransaction, **MusicPersona**

Enums: UserRole, Platform, AccountType, PostType, PostStatus, ContentPlanStatus, PublishStatus

## RBAC
- **ADMIN** — полный доступ ко всем проектам и настройкам (bypass sectionAccess)
- **EDITOR** — только привязанные проекты (через UserBusiness), может редактировать бренд-профиль, не может управлять каналами
- **VIEWER** — только чтение
- **Section Access** — гранулярный доступ по разделам (User.sectionAccess JSON). 13 секций × 3 уровня (full/view/none). Дефолты по роли, кастомизация через Settings → Пользователи
- Все routes проверяют доступ через `resource-access.ts` + `section-access.ts`

## Пользователи (production)
| Логин | Роль | Бизнесы |
|-------|------|---------|
| admin | ADMIN | Все |
| sveta | EDITOR | НаWоде |
| anton | EDITOR | НаWоде, SMMER.RU |

## Команды разработки

```bash
# Backend
cd backend && bun install && bun run dev

# Frontend
bun install && bun run dev

# Database
docker compose up -d                    # Start PostgreSQL
cd backend && bunx prisma migrate dev   # Run migrations
cd backend && bunx prisma studio        # DB GUI
cd backend && bun src/seed.ts           # Seed demo data

# Tests
cd backend && bun run test              # 96 tests (7 files)
cd backend && bun run test:watch        # Watch mode

# Deploy
bash scripts/deploy.sh                  # rsync + build + docker up + migrate

# .env для backend
cp backend/.env.example backend/.env
# Заполнить: DATABASE_URL, JWT_SECRET, OPENROUTER_API_KEY, FAL_API_KEY
```

## AI Pipeline
1. **Генерация поста** (Sonnet) → мастер-текст 500-1500 символов
2. **AI-картинка** (KIE.ai Nano Banana 2) → PNG, гибридные шаблоны (БД per-business + AI suggest через Haiku)
3. **Адаптация** (Haiku x N платформ) → VK/TG/IG версии + хештеги
4. **Контент-план** (Haiku) → JSON [{date, topic, postType}]
5. **Stories** → canvas WYSIWYG (drag, zoom, text overlay, шаблоны, export JPEG без кнопки — VK рисует нативную)
6. **Редактирование фото** (FAL.ai FLUX Kontext Pro) → img2img по промпту (смена фона, стилизация)
7. **Удаление фона** (FAL.ai rembg) → PNG с прозрачностью, одна кнопка
8. **Видео-генерация** (KIE.ai Seedance 2) → **async** (background poller), 480p/720p, 4-15 сек, 9:16/1:1/16:9, audio toggle
9. **AI-описание фото** (Gemini 2.0 Flash Vision) → auto-describe на русском для референсов и медиатеки
10. **AI Agent чат** (Haiku Simple / Sonnet Advanced) → multi-turn диалог для крафта видео-промптов. Знает контекст (refs, duration, resolution, audio). Quick reply suggestions. Промпт переносится в Editor одной кнопкой
11. **Музыка-генерация** (KIE.ai Suno V4/V4_5/V5_5) → **async** (background poller), Custom mode (Simple скрыт), lyrics+style, до 8 мин, voice clone (V5.5 Generate Persona), **2 трека на генерацию** (results JSON append)
12. **Music AI Agent** (Haiku/Sonnet) → multi-turn диалог для крафта музыкальных промптов, текстов, стилей. 8 enhance modes (lyrics, improve, rhyme, structure, style, translate, enhance, simplify)
13. **Голосовой ввод** (OpenAI Whisper) → микрофон в Agent Chat (Video + Sound + Photo Studio), toggle recording → transcribe → текст в textarea. useVoiceInput composable. ~$0.006/мин
14. **Фото-генерация** (KIE.ai Nano Banana 2 / Pro) → **async** (background poller), batch 1/2/4, 1K/2K/4K, 10 aspect ratios, character references (img2img). 8 enhance modes (style, lighting, composition, mood, detail, translate, enhance, simplify). Photo AI Agent (Haiku/Sonnet)

API keys: OpenRouter — из БД (AppConfig) или .env. FAL — из .env (FAL_API_KEY). KIE — из .env (KIE_API_KEY). **OpenAI** — AppConfig `openai_api_key` или .env `OPENAI_API_KEY` (Whisper STT)

## Auth
- Access token: 1 час (httpOnly cookie `token`)
- Refresh token: 30 дней (httpOnly cookie `refresh_token`, path `/api/auth`)
- Frontend: автоматический refresh при 401

## Billing
- **Наценка**: AppConfig `ai_markup_percent` (default 50%), configurable in Settings → AI
- **User.balanceKopecks**: баланс в копейках (integer). ADMIN exempt (безлимит)
- **USD/RUB курс**: AppConfig `usd_rub_rate` (default 95), `getUsdRubRate()`, `GET /api/settings/public`
- **Auto-charge**: каждый AI-вызов списывает `costUsd × usdRubRate × (1 + markup%)` из баланса. Атомарная транзакция: `$transaction` + `updateMany WHERE balanceKopecks >= cost` (race condition safe)
- **Balance check**: middleware в /api/ai/* → 402 при балансе ≤ 0 (non-ADMIN)
- **BalanceTransaction**: audit trail (topup/charge/refund), связь с AiUsageLog
- **Top-up**: Settings → Users → кнопка ⊕ → модалка с суммой
- **AiUsageLog**: +markupPercent (snapshot), +chargedRub (итого с наценкой)
- **UI**: баланс в header (badge), admin видит Себестоимость/С наценкой/Профит в AI Логах

## Brand Colors
- Primary: Fuchsia/Magenta (#d946ef)
- Dark mode supported

## Video Studio Architecture
- **GenerationSession** — DB-backed sessions: prompt + refs + settings + results + promptHistory + chatHistory (agent messages JSON) + status (draft/generating/completed/failed) + kieTaskId + kieTaskCreatedAt
- **Async generation** — POST /generate-video создаёт задачу в KIE (2-5 сек), возвращает 202. Background `video-poller.ts` каждые 10 сек проверяет pending задачи, скачивает готовые видео, шлёт SSE. Deploy-safe: задачи в PostgreSQL, переживают перезапуск
- **SSE sync** — `session_updated` события для синхронизации между вкладками/устройствами. Фронтенд подключается через `EventSource(/api/sse)`
- **generating computed** — определяется из `session.status` в БД (не in-memory). Переживает F5, навигацию, смену устройства
- **Timer** — считает от `kieTaskCreatedAt` (реальное время начала), не сбрасывается при переключении сессий
- **VsRichPrompt** — contenteditable + draggable @ImageN badge chips (desktop drag + mobile touch drag), resize-y
- **VsEnhanceMenu** — split-button dropdown: 8 режимов enhance. Промпты на языке ввода (русский/английский), auto-translate при генерации
- **Auto-save** — debounced 2sec PUT for draft sessions, chatHistory-only for failed. beforeunload (fetch+keepalive) + onBeforeUnmount flush. No auto-create empty sessions
- **Missing refs hint** — кнопка "Вставить референсы" когда бейджи потеряны из промпта
- **KeepAlive** — VideoStudioView + SoundStudioView preserved on navigation (App.vue)
- **AI Agent mode** — два таба (Agent / Editor) в VsPromptTabs. Agent: multi-turn чат (aiChat endpoint, Haiku/Sonnet), контекст-aware system prompt (buildAgentSystemPrompt — refs, duration, resolution, audio, Seedance 2.0 expert). Quick reply suggestions. Кнопка "Использовать промпт" переносит в Editor. Chat history persisted в GenerationSession.chatHistory (JSON)
- **Pre-gen modal** — VsPreGenModal показывается перед каждой генерацией, отображает formatted prompt sections для подтверждения
- **Security** — escapeHtml в markdown-рендеринге (XSS-safe), Zod validation на agent-chat, assertBusinessAccess checks

## Sound Studio Architecture (2026-04-17, updated 17.04)
- **GenerationSession type="music"** — расширение той же модели (type discriminator). 18 music-полей: customMode, instrumental, lyrics, musicStyle, musicTitle, negativeTags, vocalGender, styleWeight, weirdnessConstraint, audioWeight, personaId, coverImageUrl, audioUrl, streamAudioUrl, sunoModel, completedTaskId, kieAudioId
- **MusicPersona** — голосовая персона для voice cloning (name, description, gender, sampleMediaId, sunoPersonaId). Dropdown: Teleport to body (z-50, auto-direction up/down)
- **KIE.ai Suno API v2** (migrated 17.04.2026):
  - Генерация: `POST /api/v1/generate` (model: V4, V4_5, V5_5, callBackUrl required)
  - Статус: `GET /api/v1/generate/record-info` (ждём SUCCESS, не FIRST_SUCCESS)
  - Persona: `POST /api/v1/generate/generate-persona` (только из сгенерированных треков)
  - Модели: V4 (4мин), V4_5 (8мин), V5_5 (voice clone). Маппинг старых имён в MODEL_MAP
  - Стоимость: ~$0.11/песня. **2 трека** на генерацию (sunoData[] массив)
- **Multi-track results** — поллер сохраняет оба варианта в `results` JSON. При повторной генерации в сессии — append, не overwrite
- **Async generation** — тот же поллер (video-poller.ts), ветвление по session.type. Сохраняет completedTaskId + kieAudioId для Generate Persona
- **8 enhance modes**: enhance, lyrics (Sonnet), improve (Sonnet), style, structure, rhyme, translate, simplify
- **Music AI Agent** — buildMusicAgentSystemPrompt (Suno expert, знает стили/lyrics-формат/weights). Два режима: Simple/Advanced. Collapse 3+ blank lines в renderContent
- **Lyrics Editor** — textarea с [Verse]/[Chorus]/[Bridge] section markers, подсветка секций. flex-1 min-h-0 (резиновая высота)
- **Waveform player** — wavesurfer.js v7 composable (useSurfer.ts), fuchsia brand color
- **Voice Persona flow**: Generate track → Track completes (save completedTaskId + kieAudioId) → Create Persona (SsCreatePersonaModal) → Use in future generations (SsPersonaSelector)
- **Auto-save** — debounced 2sec PUT, only for draft sessions. **Flush before session switch** (onLoadSession, onBusinessChange). chatMessages в watch array
- **Layout desktop** — 50/50, KeepAlive, SSE. Lyrics/Agent chat — elastic height (flex-1). Gallery: right panel
- **Layout mobile** — full-height (100vh-5rem), collapsible session list (default collapsed), gallery hidden (collapsible "Треки" toggle above settings), settings in 2 rows (lg:contents pattern), agent chat 92% width, compact padding
- **Mode switcher** — Simple/Custom скрыт, forced Custom mode (SsModeTabs commented out). Легко вернуть
- **Session type isolation** — VideoStudio: `&type=video`, SoundStudio: `&type=music` (фикс mixing bug)

## Photo Studio Architecture (2026-04-18)
- **GenerationSession type="photo"** — расширение той же модели (type discriminator). 5 photo-полей: photoModel, photoResolution, batchSize, photoAspectRatio, batchTaskIds
- **Две модели:** `nano-banana-2` (быстрая, 4-6 сек, $0.04-0.09) и `nano-banana-pro` (качественная, 10-20 сек, $0.07-0.12)
- **Три разрешения:** 1K, 2K (default), 4K. Цена зависит от модели + разрешения (`PHOTO_PRICING`)
- **Batch генерация:** 1/2/4 изображения за запрос. Параллельные вызовы `createPhotoTask()` через `Promise.allSettled()`. TaskIds хранятся в `batchTaskIds` JSON
- **10 aspect ratios:** 1:1, 2:3, 3:2, 3:4, 4:3, 4:5, 5:4, 9:16, 16:9, 21:9
- **Async generation** — тот же поллер (video-poller.ts), ветвление по session.type='photo'. `pollPhotoSession()` ждёт завершения ВСЕХ задач batch перед completed
- **8 enhance modes:** enhance, style, lighting, composition, mood, detail, translate, simplify
- **Photo AI Agent** — buildPhotoAgentSystemPrompt (NB2/Pro expert, aspect ratios, resolution, character references). Simple/Advanced modes
- **Character references** — переиспользует Character model, enrichment prompt + image_input для img2img
- **img2img + remove-bg** — делегируют в существующие `editImage()` и `removeBackground()` через `/api/photos/edit-image` и `/api/photos/remove-background`
- **Layout** — 50/50, KeepAlive, SSE. Auto-save 2s debounce. Gallery: responsive grid (1 col mobile, 2 cols desktop) + lightbox
- **Session type isolation** — PhotoStudio: `&type=photo`

## Media Library
- **Upload MIME detection**: extensionToMime() fallback when blob.type is empty/octet-stream (MOV, AVI, MKV etc.)
- **Cursor pagination**: GET /media/library/:bizId returns `{ files, hasMore, totalCount }` (NOT a plain array). Limit 40/page, cursor-based
- **Grid**: video files show WebP thumbnail (ffmpeg first frame), images use `loading="lazy"`. Placeholder icon only if thumbUrl is null
- **Video thumbnails**: ffmpeg in Dockerfile, `extractVideoThumbnail()` (1s frame → sharp WebP 400×400). Auto on upload + KIE generation. `fix-video-thumbs.ts` for migration
- **Frontend helpers**: `isImage(mime, filename?)` / `isVideo(mime, filename?)` — fallback to file extension for octet-stream files
- **Consumers**: MediaLibraryView, MediaPickerModal, VsRefModal, VideoStudioView — all must use `res.files` from response
- **Migration script**: `bun src/fix-mime-types.ts` — one-time fix for existing octet-stream files

## Security Hardening (16.04.2026)
- **Path traversal**: `/uploads/*` — `path.resolve()` + `startsWith(uploadsRoot)` check
- **Zod validation**: все PUT endpoints валидируют через schema (platforms, brand-profile)
- **Business access**: GET /businesses/:id + brand-profile проверяют `getUserBusinessIds`
- **CSRF**: X-Tab-ID header required на POST/PUT/DELETE/PATCH (auth routes exempt)
- **Rate limiting**: login — 5 attempts / 15 min per IP (in-memory Map)
- **Graceful shutdown**: SIGTERM/SIGINT → clearInterval schedulers + db.$disconnect()
- **Frontend 401**: shared promise pattern (concurrent refreshes don't logout)
- **Docker limits**: backend 1G RAM / 1.5 CPU, postgres 512M / 0.5 CPU
- **Backup verification**: `gunzip -t` after each backup

## Conventions
- Паттерны из nawode-erp: Hono routes, JWT httpOnly, Prisma, SSE eventBus
- AI-промпты включают BrandProfile (тон, ЦА, стиль, примеры)
- Проект (Business) = единый хаб (BusinessDetailView): бренд-профиль + каналы + обзор (с управлением доступами). UI: "Проекты" (не "Бизнесы")
- BusinessFilter = pills в большинстве views, но VideoStudio и MediaLibrary используют inline dropdown в header
- Settings = системные вещи (VK OAuth, пользователи + sectionAccess UI, профиль, AI). Не-админы видят табы по sectionAccess
- AI prompt templates: hybrid pattern — БД-шаблоны (PromptTemplate, per-business) + кнопка "✨ Подобрать по контексту" (Haiku, brandContext). Применено к image + video
- Все routes с businessId проверяют доступ (resource-access middleware)
- Stories-first UI: навигация "Stories" (не "Посты"), только STORIES тип, lock после публикации
- Business isActive toggle: ADMIN видит неактивные, toggle на карточках
- VK Stories: кнопка-ссылка рисуется ТОЛЬКО в превью canvas, НЕ в JPEG (VK рисует нативную)
- Webhook для ERP-интеграции: POST /api/webhooks/erp
