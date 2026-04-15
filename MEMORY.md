# Content Factory — Memory

## Ключевые факты
- [2026-04-05] Порты: backend :3800, frontend :5176, postgres :5441
- [2026-04-05] Brand color: Fuchsia/Magenta (#d946ef)
- [2026-04-05] AI: OpenRouter (Haiku для адаптации, Sonnet для генерации)
- [2026-04-05] VK фото-постинг: Community Token limitation (error 27), нужен User Token через OAuth

## Блокеры
- [2026-04-05] VK OAuth: заявка подана, ожидаем. До получения — фото в VK не публикуются

## Schema (18 моделей, 8 enums)
User, UserBusiness, Business, BrandProfile, PlatformAccount, ContentPlan, ContentPlanItem, Post, PostVersion, PublishLog, MediaFile, AiUsageLog, WebhookRule, AppConfig, Idea, StoryTemplate, **Character** (NEW 13.04), **Scenario** (NEW 13.04)

## Endpoints
- POST /api/auth/login, /logout, GET /me, POST /refresh
- GET/POST/PUT/DELETE /api/businesses, /brand-profile
- GET/POST/PUT/DELETE /api/businesses/:bizId/platforms, POST /test
- GET/POST/PUT/DELETE /api/posts, POST /approve, POST /versions
- GET /api/businesses/:bizId/posts — **+postType filter, +business name, +thumbnail** (11.04)
- GET/POST/PUT /api/businesses/:bizId/plans, /api/plans/:id, /api/plan-items/:id/*
- POST /api/ai/generate-post, /generate-image, /adapt, /generate-plan
- POST /api/post-versions/:id/publish, /schedule
- GET/POST/PUT/DELETE /api/media, /library/:bizId, /tags/:bizId
- GET/POST/PUT /api/users (ADMIN-only)
- GET /api/dashboard, /api/health, /api/sse
- **GET/POST/PUT/DELETE /api/ideas** — личный блокнот per-user (NEW 11.04)

## SaaS-Ready (2026-04-11)
- Split app.ts + index.ts, Vitest 48 тестов, health endpoint
- Error handler, RBAC (UserBusiness), refresh tokens (1h+30d)
- Security: resource-access checks on 30+ endpoints
- Structured logger, Docker healthchecks, DB indexes
- Story templates (5 presets), media library (tags, filters)
- Composables: useFormatters, useStatus, usePlatform

## UI Refactoring: Mobile-First + Stories-First (2026-04-11)
- [2026-04-11] Mobile sidebar: overlay + backdrop + slide transition (stores/sidebar.ts)
- [2026-04-11] Hamburger menu в TheHeader (md:hidden), убран глобальный business select
- [2026-04-11] Nav: "Посты"→"Stories" (Film icon), "Идеи" добавлен (Lightbulb), "Аналитика" убрана
- [2026-04-11] PostsView → Stories-first: только STORIES, убраны AI/Post кнопки+модалы
- [2026-04-11] Карточки: миниатюра + бизнес + дата + статус, skeleton loader, confirm-модал удаления
- [2026-04-11] BusinessFilter.vue: pill-кнопки (desktop) / select (mobile), добавлен в Posts/Plans/Media
- [2026-04-11] StoryEditor: "Настроить каналы" → /businesses/:id?tab=channels (было /settings)
- [2026-04-11] StoryEditor phone frame: max-w-[376px] w-full (было style="width:376px")
- [2026-04-11] PostEditor: lg:sticky (было sticky always)
- [2026-04-11] Settings: overflow-x-auto для табов на мобиле
- [2026-04-11] ContentPlans: календарь hidden md:block (на мобиле только таблица)
- [2026-04-11] IdeasView: inline edit + auto-save debounce 1s + skeleton + confirm delete
- [2026-04-11] Prisma: модель Idea (id, title, body, userId, timestamps)
- [2026-04-11] Route: ideas.ts (CRUD + ownership check + Zod validation)

## UI Refactoring Round 2 (2026-04-11)
- [2026-04-11] VK Stories fix: кнопка-ссылка drawScene(isExport=true) НЕ рисует кнопку в JPEG — VK рисует нативную через link_text/link_url API params
- [2026-04-11] Lock after publish: isPublished computed, opacity-60 pointer-events-none на все секции настроек, canvas drag/zoom disabled, кнопка публикации скрыта
- [2026-04-11] Business isActive toggle: updateSchema в businesses.ts (Zod + isActive), ADMIN видит неактивные, toggle на карточках (green/gray, @click.stop)
- [2026-04-11] BusinessFilter: pills везде (убран mobile dropdown), overflow-x-auto + flex-nowrap на мобиле
- [2026-04-11] Шаблоны: перенесены в блок "Текст на фото" (были в блоке Фото — баг)
- [2026-04-11] BusinessDetailView overview: секция "Доступ к бизнесу" (ADMIN only, grant/revoke access)
- [2026-04-11] Мелочи: "Назад к историям", "историй" вместо "постов"
- [2026-04-12] AI Image fix: модель google/gemini-2.0-flash-exp:free → google/gemini-2.5-flash-image (GA). Парсинг: message.images[] (не content)
- [2026-04-12] AI Image UX: шаблоны промптов (4 pills), кнопка "Улучшить промпт" (Haiku, buildImageEnhancerPrompt)
- [2026-04-12] FAL.ai SDK интегрирован: @fal-ai/client. FLUX Kontext Pro (img2img $0.04), rembg (remove bg $0.01)
- [2026-04-12] FAL.ai: images[] возвращает URL на CDN (не base64), нужен downloadAndSave. В prod — public URL, в dev — fal.storage.upload
- [2026-04-12] FAL.ai: баланс аккаунта нулевой, ждёт пополнения. Ключ настроен в .env.prod + docker-compose.prod.yml

## Content Factory v2: AI-воркспейс (2026-04-13)
- [2026-04-13] Character модель: person/mascot/avatar, referenceMediaId → MediaFile, CRUD /api/characters
- [2026-04-13] Scenario модель: title, scenes (JSON: sceneNumber/description/voiceover/durationSec/imagePrompt), status (DRAFT/READY/IN_PRODUCTION/COMPLETED)
- [2026-04-13] ScenariosView: AI-генерация сценария (Sonnet), inline-edit сцен, drag карточки, статусы
- [2026-04-13] Characters tab в BusinessDetailView: карточки с аватарами, upload reference photo, type badges
- [2026-04-13] StoryEditorView: дропдаун "Персонаж" при генерации картинки → characterId передаётся в KIE.ai generateImage
- [2026-04-13] KIE.ai generateImage: если characterId — подставляет reference image_input + описание в промпт (Nano Banana 2 img2img)
- [2026-04-13] buildScenarioPrompt() в prompt-builder.ts: структурированный JSON сценария с voiceover и imagePrompt
- [2026-04-13] Навигация: добавлен пункт "Сценарии" (Clapperboard icon) между Идеи и Контент-планы
- [2026-04-13] Провайдер AI-картинок: KIE.ai (Nano Banana 2 + FLUX Kontext Pro). FAL.ai → KIE.ai (миграция 12.04)
- [2026-04-13] Characters: глобальные (many-to-many через CharacterBusiness), отдельная страница /characters (CharactersView), убрана из BusinessDetailView
- [2026-04-13] AI-видео: generateVideo() в kie.ts, модель bytedance/seedance-2 (KIE.ai), POST /api/ai/generate-video
- [2026-04-13] AI Video modal: шаблоны (6 pills), enhance промпта (buildVideoPromptEnhancer, Haiku), история промптов, slider 4-15 сек, toggle звука (generate_audio)
- [2026-04-13] videoPrompt — отдельный ref от aiPrompt (фото), сохраняется при закрытии модала
- [2026-04-13] Scenario→Stories pipeline: POST /api/scenarios/:id/create-stories, создаёт Story-пост на каждую сцену
- [2026-04-13] Video playback: <video> в StoryEditor phone frame, MediaLibrary, Preview modal (было только <img>)
- [2026-04-13] AI metadata на MediaFile: aiModel, aiCostUsd — записываются при генерации, видны в UI (бейдж AI + модель + стоимость)
- [2026-04-13] POST /api/ai/enhance-video-prompt — улучшение видео-промптов (Subject→Action→Camera→Style→Quality)
- [2026-04-13] MediaFolder модель добавлена (folderId в MediaFile, FolderTree self-relation)

## Content Factory v2 продолжение (2026-04-14)
- [2026-04-14] Видео-студия: отдельная страница /video-studio (VideoStudioView), 2/3 генератор + 1/3 превью
- [2026-04-14] 3 режима входа: Референсы (до 9, @Image1..@Image9) / Кадры (first+last frame) / Только текст
- [2026-04-14] Prompt Constructor: PromptConstructor.vue — 6 секций (Subject/Action/Camera/Lighting/Style/Audio), auto-assembly на EN
- [2026-04-14] Prompt Library: PromptEntry модель, auto-save при генерации, 5-star рейтинг, click-to-reuse
- [2026-04-14] PromptTemplate модель: редактируемые шаблоны в БД (per-business + глобальные, isSystem)
- [2026-04-14] AI Vision merge: POST /api/ai/merge-references — Gemini Flash (vision) распознаёт фото и вставляет @Image теги в промпт
- [2026-04-14] aiVision() в openrouter.ts — multimodal messages с image_url для vision-моделей
- [2026-04-14] Динамическая стоимость видео: 41 кр/с (text) / 25 кр/с (image), audio ×2, computed в ₽ (курс 95)
- [2026-04-14] Image-to-video: firstFrameUrl + lastFrameUrl + referenceImageUrls параметры в generateVideo
- [2026-04-14] Референсы с ролями: dropdown (Лицо/Фон/Объект/Стиль/Одежда/Поза), конструктор вставляет "Using ... from @Image1"
- [2026-04-14] Стоимость и модель видны ДО генерации во всех модалах (фото, видео, edit)
- [2026-04-14] ADMIN-only: Video Studio, Scenarios, Characters, AI Video кнопка в StoryEditor
- [2026-04-14] Layout перестроен: Режим → Входные изображения → Промпт → Шаблоны → Настройки рендеринга
- [2026-04-14] Schema: +PromptEntry, +PromptTemplate (22 модели, 8 enums)
- [2026-04-14] Routes: +prompt-library.ts, +prompt-templates.ts (20 route-файлов)
- [2026-04-14] Haiku 3.5 НЕ поддерживает vision — для merge-references используется google/gemini-2.0-flash-001

## Session 14.04 (вечер): Section Access + UI Rename + Hybrid Templates
- [2026-04-14] Section Access: User.sectionAccess (Json?), 11 секций × 3 уровня (full/view/none). requireSection middleware. UsersTab UI с radio-таблицей. ADMIN bypass. Закрыта security gap (scenarios/characters не проверялись на бэкенде)
- [2026-04-14] Canvas preview fix: race condition — img.onload вызывал render() пока canvas скрыт v-if="loading". Fix: watch(canvasRef) + nextTick(render) в onload
- [2026-04-14] UI rename: "Бизнесы" → "Проекты" в 8 файлах (только UI-лейблы, API/модели без изменений)
- [2026-04-14] Hybrid AI prompt templates: хардкод IMAGE_TEMPLATES/VIDEO_TEMPLATES → БД (PromptTemplate per-business) + "✨ Подобрать" (Haiku + brandContext). 2 новых endpoint: suggest-image-templates, suggest-video-templates. Seeded: 4 global image + 5 global video + 5 SMMER.RU image
- [2026-04-14] SMMER.RU: бизнес Антона Григорьева (SMM). Brand profile заполнен, 6 story templates, VK канал (group 218656364). Нужны права редактора от Антона для VK API
- [2026-04-14] composables: useSectionAccess (canView/canEdit), SECTION_LABELS. shared/section-access.ts — серверная копия

## Video Studio: Pro Prompt Enhancement (2026-04-15)
- [2026-04-15] POST /api/ai/enhance-video-prompt расширен: +mode (8 режимов: enhance/director/structure/focus/audio/camera/translate/simplify), +debug (модель/токены/стоимость/время)
- [2026-04-15] analyzeVideoPrompt() — анализ сложности промпта (wordCount, timeline, кириллица, @ImageN, пустые прилагательные, "fast")
- [2026-04-15] Адаптивный enhance: короткие промпты расширяет, длинные (>150 слов / timeline) НЕ сжимает
- [2026-04-15] Director mode: timeline [0s][3s][6s], мультишот, 200-300 слов, Sonnet (остальные Haiku)
- [2026-04-15] VsEnhanceMenu.vue: split-button dropdown. EDITOR видит 2 режима, ADMIN+devMode — все 8
- [2026-04-15] Debug info bar: модель, токены in/out, стоимость USD, время ms — виден при devMode=on
- [2026-04-15] Seedance 2.0 best practices зашиты во все промпты: no "fast", no empty adjectives, inline audio, one camera per shot

## Паттерны
- HTTP client: fetch + httpOnly cookie + X-Tab-ID (из nawode-erp)
- Auth: JWT в httpOnly cookie, requireAuth middleware
- SSE: eventBus → ReadableStream
- AI prompts: system prompt = base + brandContext
- RBAC: UserBusiness join table, getUserBusinessIds()
- Testing: Vitest + vitest-setup.ts, mock Prisma via vi.hoisted()
- Mobile sidebar: Pinia store + Teleport + Transition (slide + backdrop)
