# Content Factory — Memory

## Ключевые факты
- [2026-04-05] Порты: backend :3800, frontend :5176, postgres :5441
- [2026-04-05] Brand color: Fuchsia/Magenta (#d946ef)
- [2026-04-05] AI: OpenRouter (Haiku для адаптации, Sonnet для генерации)
- [2026-04-05] VK фото-постинг: Community Token limitation (error 27), нужен User Token через OAuth

## Блокеры
- [2026-04-05] VK OAuth: заявка подана, ожидаем. До получения — фото в VK не публикуются

## Schema (23 модели, 8 enums)
User, UserBusiness, Business, BrandProfile, PlatformAccount, ContentPlan, ContentPlanItem, Post, PostVersion, PublishLog, MediaFile, MediaFolder, AiUsageLog, WebhookRule, AppConfig, Idea, StoryTemplate, Character, CharacterBusiness, Scenario, PromptEntry, PromptTemplate, GenerationSession

## Endpoints (~17 route-файлов)
- auth, users, businesses, platforms, posts, content-plans, ai, publish, media, settings, vk-oauth, ideas, characters, scenarios, sessions, dashboard, sse
- GET /api/media/library/:bizId — **cursor pagination** `{ files, hasMore, totalCount }` (НЕ массив!) (16.04)

## SaaS-Ready (2026-04-11)
- Split app.ts + index.ts, Vitest 48 тестов, health endpoint
- Error handler, RBAC (UserBusiness), refresh tokens (1h+30d)
- Security: resource-access checks на 30+ endpoints
- Section Access: 11 секций × 3 уровня (full/view/none), requireSection middleware

## Русификация AI-промптов (2026-04-16)
- [2026-04-16] Стратегия: "Русский UI + автоперевод перед генерацией" через translatePrompt()
- [2026-04-16] Enhance промпты — "Пиши на том же языке", describe-image на русском
- [2026-04-16] PromptConstructor: .label (рус.), translatePrompt() усилен (15 камерных терминов, @Image/@timeline preservation)

## Fix: Media Library (2026-04-16)
- [2026-04-16] MIME: MOV-файлы загружались как octet-stream → extensionToMime() fallback по расширению
- [2026-04-16] Миграция: fix-mime-types.ts — исправлены 16 файлов в проде
- [2026-04-16] Пагинация: cursor-based, 40/page, кнопка "Показать ещё" (было 200 за раз)
- [2026-04-16] Grid: видео-плейсхолдеры (без `<video>` тегов), images `loading="lazy"`
- [2026-04-16] isImage()/isVideo() + displayType() — fallback на расширение файла
- [2026-04-16] **4 консьюмера API:** MediaLibraryView, MediaPickerModal, VsRefModal, VideoStudioView — все используют `res.files`

## Архитектурные решения
- [2026-04-16] **Async video generation:** POST создаёт задачу в KIE (2-5 сек, 202), video-poller.ts каждые 10 сек проверяет pending, скачивает готовые, шлёт SSE. Deploy-safe: kieTaskId в PostgreSQL
- [2026-04-16] **generating из БД:** computed от session.status, НЕ in-memory Set. Переживает F5/навигацию
- [2026-04-16] **SSE session_updated:** синхронизация сессий между вкладками/устройствами
- [2026-04-16] **Русификация AI:** enhance промпты отвечают на языке ввода, describe-image на русском, PromptConstructor.label (рус) вместо .en, translatePrompt() с Seedance-словарём при генерации
- [2026-04-16] **Timer от kieTaskCreatedAt:** не сбрасывается при переключении сессий

## Паттерны
- HTTP client: fetch + httpOnly cookie + X-Tab-ID (из nawode-erp)
- Auth: JWT в httpOnly cookie, requireAuth middleware
- SSE: eventBus → ReadableStream. Типы: post_*, plan_*, business_*, settings_*, **session_updated**
- AI prompts: system prompt = base + brandContext. Русский UI + auto-translate при генерации
- RBAC: UserBusiness join table, getUserBusinessIds()
- Testing: Vitest + vitest-setup.ts, mock Prisma via vi.hoisted()
- Mobile sidebar: Pinia store + Teleport + Transition (slide + backdrop)
- Media library API: `{ files, hasMore, totalCount }` — НЕ массив. Все консьюмеры → `res.files`
- Video generation: async (video-poller) — никогда не блокировать HTTP-запрос на минуты
