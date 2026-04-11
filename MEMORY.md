# Content Factory — Memory

## Ключевые факты
- [2026-04-05] Порты: backend :3800, frontend :5176, postgres :5441
- [2026-04-05] Brand color: Fuchsia/Magenta (#d946ef)
- [2026-04-05] AI: OpenRouter (Haiku для адаптации, Sonnet для генерации)
- [2026-04-05] VK фото-постинг: Community Token limitation (error 27), нужен User Token через OAuth

## Блокеры
- [2026-04-05] VK OAuth: заявка подана, ожидаем. До получения — фото в VK не публикуются

## Schema (15 моделей, 8 enums)
User, UserBusiness, Business, BrandProfile, PlatformAccount, ContentPlan, ContentPlanItem, Post, PostVersion, PublishLog, MediaFile, AiUsageLog, WebhookRule, AppConfig, **Idea** (NEW)

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

## Паттерны
- HTTP client: fetch + httpOnly cookie + X-Tab-ID (из nawode-erp)
- Auth: JWT в httpOnly cookie, requireAuth middleware
- SSE: eventBus → ReadableStream
- AI prompts: system prompt = base + brandContext
- RBAC: UserBusiness join table, getUserBusinessIds()
- Testing: Vitest + vitest-setup.ts, mock Prisma via vi.hoisted()
- Mobile sidebar: Pinia store + Teleport + Transition (slide + backdrop)
