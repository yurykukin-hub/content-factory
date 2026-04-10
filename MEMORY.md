# Content Factory — Memory

## Решения
- [2026-04-05] Проект создан. AI Content Factory — AI-контент-фабрика для SMM
- [2026-04-05] Стек: Bun + Hono + Prisma + Vue 3 + Tailwind (паттерны из nawode-erp)
- [2026-04-05] Порты: backend :3800, frontend :5176, postgres :5441
- [2026-04-05] Brand color: Fuchsia/Magenta (#d946ef)
- [2026-04-05] AI: OpenRouter (Haiku для адаптации, Sonnet для генерации)
- [2026-04-05] ERP-интеграция: через webhooks (не общая БД, не микросервис)
- [2026-04-05] Платформы MVP: VK + Telegram. Instagram — Phase 2
- [2026-04-05] Seed: 4 бизнеса (KB, НаWоде, Inpulse, Личный) с бренд-профилями
- [2026-04-05] Мультитенантность — Phase 4 (SaaS). Пока без Tenant модели

## Решения (продолжение)
- [2026-04-05] Инфраструктура поднята: PostgreSQL :5441, миграции, seed (admin/admin123)
- [2026-04-05] Починена фабрика publishers (base.ts): VkPublisher и TelegramPublisher подключены
- [2026-04-05] Реализован publish endpoint (POST /api/post-versions/:id/publish) — вызывает VK/TG API, пишет PublishLog, обновляет PostVersion
- [2026-04-05] Добавлен POST /api/posts/:id/versions — создание PostVersion для привязки поста к платформе
- [2026-04-05] Реализован AI generate-post (POST /api/ai/generate-post) — Sonnet + BrandProfile → Post в БД
- [2026-04-05] Scheduler починен — реально публикует scheduled посты через publishers
- [2026-04-05] Исправлен импорт logger в index.ts (hono/middleware → hono/logger)
- [2026-04-05] Цепочка протестирована curl: login → businesses → platform → AI-генерация → PostVersion → publish → VK API отвечает корректно

## Endpoints (реализованные)
- POST /api/auth/login, /logout, GET /me — JWT httpOnly
- GET/POST/PUT/DELETE /api/businesses — CRUD + BrandProfile
- GET/POST/PUT/DELETE /api/businesses/:bizId/platforms — PlatformAccount
- GET/POST/PUT/DELETE /api/posts, POST /api/posts/:id/approve
- POST /api/posts/:id/versions — создание PostVersion (NEW)
- GET/POST/PUT /api/businesses/:bizId/plans, /api/plans/:id
- POST /api/ai/generate-post — AI-генерация (Sonnet) (NEW)
- POST /api/post-versions/:id/publish — публикация в VK/TG (NEW)
- POST /api/post-versions/:id/schedule — отложенная публикация
- GET /api/dashboard — метрики
- GET /api/sse — Server-Sent Events
- POST /api/webhooks/erp — приём webhook от ERP (partial)

## Решения (продолжение 2)
- [2026-04-05] VK-публикация протестирована: SUP клуб НаWоде, group_id 150371202, пост #826 опубликован
- [2026-04-05] Реализованы 3 frontend views: PostsView, PostEditorView, BusinessesView
- [2026-04-05] PostsView: список + фильтр по статусу + AI генерация (модал) + ручное создание
- [2026-04-05] PostEditorView: редактор мастер-текста + версии для платформ + кнопка Publish + ссылка на пост
- [2026-04-05] BusinessesView: аккордеон + табы (бренд-профиль / платформы) + форма добавления VK/TG/IG

## Решения (продолжение 3)
- [2026-04-05] Schema: добавлен AccountType enum (GROUP/PERSONAL/CHANNEL/BOT/BUSINESS), поле accountType в PlatformAccount
- [2026-04-05] Unique constraint сменён: @@unique([businessId, platform]) → @@unique([businessId, platform, accountId]) — мультиканальность
- [2026-04-05] Fix routing: platforms разделены на platformsByBiz (/api/businesses/:bizId/platforms) + platformsById (/api/platforms/:id)
- [2026-04-05] Реализован POST /api/platforms/:id/test — тест VK (groups.getById) и Telegram (getChat), возвращает name, photo, memberCount
- [2026-04-05] VkPublisher: accountType-aware owner_id (GROUP = -groupId, PERSONAL = без owner_id)
- [2026-04-05] Settings page: 4 таба (Каналы, Бренд-профили, Профиль и тема, AI), паттерн из nawode-erp
- [2026-04-05] ChannelsTab: карточки каналов по бизнесам, тест соединения, добавление VK/TG, удаление
- [2026-04-05] VK Personal page: заложено в schema (AccountType.PERSONAL), UI disabled — требует OAuth

## Решения (продолжение 4)
- [2026-04-05] Media upload: POST /api/media/upload (multipart), хранение ./uploads/{bizId}/, thumbnails через sharp
- [2026-04-05] VK Publisher: полная поддержка фото (photos.getWallUploadServer→saveWallPhoto) и видео (video.save→upload)
- [2026-04-05] TG Publisher: sendPhoto, sendVideo, sendMediaGroup (2+ медиа), sendAudio
- [2026-04-05] Publish pipeline: автоматически подтягивает mediaFiles поста и передаёт в publisher
- [2026-04-05] AI Image Generation: POST /api/ai/generate-image (OpenRouter Gemini → base64 → PNG → MediaFile)
- [2026-04-05] AI Adapt: POST /api/ai/adapt — адаптация мастер-текста под все платформы + генерация хештегов (Haiku)
- [2026-04-05] PostEditor полный редизайн: левая панель (текст + медиа + drag&drop) + правая панель (табы VK|TG|IG с превью)
- [2026-04-05] MediaUpload компонент: drag & drop, загрузка, галерея, удаление
- [2026-04-05] Fix /api/auth/me: читает JWT из cookie вручную (был баг — middleware не применялся)

## Блокеры
- [2026-04-05] VK фото-постинг: Community Token не поддерживает photos.getWallUploadServer (error 27). Нужен User Token через OAuth (VK Standalone App). Заявка на доступ подана — ждём ответ поддержки VK. До получения — фото в VK не публикуются, только текст.

## Решения (продолжение 5)
- [2026-04-06] Content Plans: POST /api/ai/generate-plan реализован (Haiku, JSON парсинг, ContentPlan + Items)
- [2026-04-06] buildPlanPrompt расширен: postsPerWeek, focus, rubrics параметры
- [2026-04-06] Plan→Post endpoints: POST /plan-items/:id/create-post и /ai-generate
- [2026-04-06] ContentPlansView: список + таблица/календарь + AI модалка (период, частота, 8 рубрик)
- [2026-04-06] CalendarView → redirect на ContentPlansView

## TODO (MVP)
- [x] Реализовать AI-генерацию контент-плана (routes/ai.ts → generate-plan)
- [x] Реализовать AI-генерацию поста (routes/ai.ts → generate-post)
- [x] Реализовать AI-адаптацию под платформы (routes/ai.ts → adapt)
- [x] Подключить VkPublisher к scheduler и publish route
- [x] Подключить TelegramPublisher к scheduler и publish route
- [x] Протестировать реальную публикацию в VK (пост #826 на стене НаWоде)
- [x] Фронтенд: PostsView (список + создание)
- [x] Фронтенд: PostEditorView (редактор + AI + превью платформ + медиа)
- [x] Фронтенд: BusinessesView (управление + бренд-профиль + платформы)
- [x] Фронтенд: ContentPlansView (AI генерация + таблица/календарь)
- [ ] Шифрование accessToken (AES-256-GCM)

## Паттерны
- HTTP client: fetch + httpOnly cookie + X-Tab-ID (из nawode-erp)
- Auth: JWT в httpOnly cookie, requireAuth middleware (из nawode-erp)
- SSE: eventBus → ReadableStream (из nawode-erp)
- AI prompts: system prompt = base + brandContext (из sales-bot)
