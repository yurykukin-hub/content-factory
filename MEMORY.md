# Content Factory — Memory

## Ключевые факты
- [2026-04-05] Порты: backend :3800, frontend :5176, postgres :5441
- [2026-04-05] Brand color: Fuchsia/Magenta (#d946ef)
- [2026-04-05] AI: OpenRouter (Haiku для адаптации, Sonnet для генерации)
- [2026-04-05] VK фото-постинг: Community Token limitation (error 27), нужен User Token через OAuth

## Блокеры
- [2026-04-05] VK OAuth: заявка подана, ожидаем. До получения — фото в VK не публикуются

## Schema (25 моделей, 8 enums)
User, UserBusiness, Business, BrandProfile, PlatformAccount, ContentPlan, ContentPlanItem, Post, PostVersion, PublishLog, MediaFile, MediaFolder, AiUsageLog, WebhookRule, AppConfig, Idea, StoryTemplate, Character, CharacterBusiness, Scenario, PromptEntry, PromptTemplate, GenerationSession, BalanceTransaction, MusicPersona

## Endpoints (~20 route-файлов)
auth, users, businesses, platforms, posts, content-plans, ai, publish, media, settings, vk-oauth, ideas, characters, scenarios, sessions, music, photos, dashboard, sse, ai-logs

## SaaS-Ready (2026-04-11)
- RBAC (UserBusiness), Section Access (14 секций), refresh tokens, health endpoint
- Security: resource-access, CSRF X-Tab-ID, rate limiting, path traversal, Zod, 96 тестов

## Photo Studio (2026-04-18, updated 19.04)
- GenerationSession type='photo', 5 полей (photoModel, photoResolution, batchSize, photoAspectRatio, batchTaskIds)
- Модели: nano-banana-2 ($0.04-0.09) + nano-banana-pro ($0.07-0.12). Batch 1/2/4. 10 aspect ratios. 3 resolutions
- Routes: /api/photos/* (generate, enhance-prompt 8 modes, agent-chat, edit-image, remove-bg)
- Frontend: PhotoStudioView + 7 Ps* компонентов. 50/50 layout, KeepAlive, SSE, auto-save
- Reference images: VideoStudio-style UI (56x56 thumbs, @N метки, dropdown загрузить/медиатека, preview popup с AI-описание). MediaPickerModal multi-select. До 14 refs NB2, 8 Pro
- **ВАЖНО:** Generate payload — фронтенд шлёт `model`/`resolution`/`aspectRatio` (НЕ photoModel/photoResolution/photoAspectRatio)

## AI Agent + Sound Studio + Voice Input (2026-04-17) -> MEMORY-ARCHIVE
- AI Agent: Simple (Haiku) / Advanced (Sonnet), chatHistory JSON per-session, prompt transfer
- Sound Studio: suno.ts, 13 Ss*, wavesurfer.js. MusicPersona voice clone. 8 enhance modes
- Voice Input: useVoiceInput, Whisper STT, ~$0.006/мин. AppConfig openai_api_key

## AI Logs + Billing + Sound UX (2026-04-18)
- BUGFIX: getChargedRub() async (AppConfig, не hardcoded 95). Обновлены все 8 callers
- AI Logs: API column, cost in RUB, categories, CSV export. Settings -> AI: 5 карточек
- Sound UX: стоимость /2 трека, снапшоты params в results, сортировка по дате

## Chat/State Persistence (2026-04-18, updated 19.04)
- beforeunload -> fetch keepalive, onBeforeUnmount flush, chatMessages в watch, failed session chat save
- [2026-04-19] **v-show вместо v-if** для Agent/Editor табов во ВСЕХ 3 студиях + VsPromptArea
- [2026-04-19] **watch(activeTab) -> немедленный flush** (не ждёт 2с debounce)
- [2026-04-19] **onDeactivated flush** — KeepAlive навигация сохраняет состояние в БД

## CSRF Upload Fix (2026-04-19)
- **ВСЕ fetch('/api/media/upload')** теперь с X-Tab-ID header. Затронуто: VideoStudioView (2), VsRefModal (1), MediaLibraryView (1), StoryEditorView (5), PhotoStudioView (1)

## Архитектурные решения
- Async generation: video-poller.ts (10 сек) обрабатывает video+music+photo. kieTaskId в PostgreSQL (deploy-safe)
- generating из БД (session.status), SSE session_updated, timer от kieTaskCreatedAt
- Русификация: UI на русском + translatePrompt() перед генерацией

## Паттерны
- HTTP client: fetch + httpOnly cookie + X-Tab-ID
- Auth: JWT httpOnly cookie, requireAuth middleware, refresh 1h+30d
- SSE: eventBus -> ReadableStream. session_updated для студий
- AI prompts: system prompt = base + brandContext. Русский UI + auto-translate
- Billing: AppConfig markup + usd_rub_rate. Auto-charge $transaction. ADMIN exempt
- Media library API: `{ files, hasMore, totalCount }` — НЕ массив
- Testing: Vitest, 96 tests, 7 files. Mock Prisma via vi.hoisted()
