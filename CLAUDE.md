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
- **AI:** OpenRouter (Claude Haiku для адаптации, Sonnet для генерации)
- **Testing:** Vitest (48 тестов)
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
│   ├── prisma/schema.prisma    # 14 моделей, 8 enums
│   ├── src/
│   │   ├── app.ts              # Hono app (routes, middleware, error handler)
│   │   ├── index.ts            # Server start + scheduler
│   │   ├── db.ts               # PrismaClient singleton
│   │   ├── config.ts           # Env validation (zod)
│   │   ├── eventBus.ts         # SSE events
│   │   ├── middleware/
│   │   │   ├── auth.ts         # JWT httpOnly cookie + requireRole
│   │   │   ├── business-access.ts  # requireBusinessAccess + getUserBusinessIds
│   │   │   └── resource-access.ts  # verifyPost/Plan/Media/PostVersionAccess
│   │   ├── routes/             # API endpoints (~13 файлов)
│   │   │   ├── auth.ts         # login/logout/me/refresh (access+refresh tokens)
│   │   │   ├── users.ts        # CRUD пользователей (ADMIN-only)
│   │   │   ├── businesses.ts   # CRUD + brand profile (filtered by access)
│   │   │   ├── platforms.ts    # platformsByBiz + platformsById
│   │   │   ├── posts.ts        # CRUD + approve + versions (access checks)
│   │   │   ├── content-plans.ts # CRUD + create-post/ai-generate + batch
│   │   │   ├── ai.ts           # generate-post/image, adapt, generate-plan
│   │   │   ├── publish.ts      # publish + schedule (access checks)
│   │   │   ├── media.ts        # upload/delete/attach + library + tags
│   │   │   ├── settings.ts     # AppConfig CRUD (ADMIN-only, .env fallback)
│   │   │   ├── vk-oauth.ts     # VK OAuth 2.1 PKCE
│   │   │   ├── dashboard.ts    # metrics (scoped by business access)
│   │   │   └── sse.ts          # Server-Sent Events
│   │   ├── services/
│   │   │   ├── scheduler.ts    # Отложенная публикация
│   │   │   ├── vk-oauth.ts     # VK OAuth service (PKCE, auto-refresh)
│   │   │   ├── ai/
│   │   │   │   ├── openrouter.ts      # OpenRouter + cost calculation
│   │   │   │   ├── prompt-builder.ts  # Промпт-конструктор
│   │   │   │   └── image-generation.ts # AI image gen (Gemini)
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
│   ├── router/index.ts         # 12 routes + auth guard
│   ├── stores/                 # auth, businesses, theme
│   ├── composables/            # useToast, useFormatters, useStatus, usePlatform
│   ├── views/
│   │   ├── BusinessesView      # Grid карточек бизнесов (клик → detail)
│   │   ├── BusinessDetailView  # Хаб бизнеса: 3 таба (профиль/каналы/обзор)
│   │   ├── PostEditorView      # Редактор постов (текст + медиа + платформы)
│   │   ├── StoryEditorView     # Stories (canvas WYSIWYG + шаблоны)
│   │   ├── ContentPlansView    # AI планы (таблица + календарь)
│   │   ├── MediaLibraryView    # Медиа-библиотека (grid, теги, фильтры)
│   │   └── ...                 # Dashboard, Login, Settings, Analytics
│   └── components/
│       ├── layout/             # TheSidebar, TheHeader
│       ├── ToastContainer.vue  # Toast notifications
│       ├── MediaUpload.vue     # Drag & drop
│       └── settings/           # VkOAuthTab, ProfileTab, AiTab, UsersTab
├── docker-compose.yml          # Dev (postgres only)
├── docker-compose.prod.yml     # Prod (postgres + backend, healthchecks)
└── scripts/deploy.sh, backup-db.sh
```

## Schema (14 моделей, 8 enums)
User, UserBusiness, Business, BrandProfile, PlatformAccount, ContentPlan, ContentPlanItem, Post, PostVersion, PublishLog, MediaFile, AiUsageLog, WebhookRule, AppConfig

Enums: UserRole, Platform, AccountType, PostType, PostStatus, ContentPlanStatus, PublishStatus

## RBAC
- **ADMIN** — полный доступ ко всем бизнесам и настройкам
- **EDITOR** — только привязанные бизнесы (через UserBusiness), может редактировать бренд-профиль, не может управлять каналами
- **VIEWER** — только чтение
- Все routes проверяют доступ через `resource-access.ts`

## Пользователи (production)
| Логин | Роль | Бизнесы |
|-------|------|---------|
| admin | ADMIN | Все |
| sveta | EDITOR | НаWоде |
| anton | EDITOR | НаWоде |

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
cd backend && bun run test              # 48 tests
cd backend && bun run test:watch        # Watch mode

# Deploy
bash scripts/deploy.sh                  # rsync + build + docker up + migrate

# .env для backend
cp backend/.env.example backend/.env
# Заполнить: DATABASE_URL, JWT_SECRET, OPENROUTER_API_KEY
```

## AI Pipeline
1. **Генерация поста** (Sonnet) → мастер-текст 500-1500 символов
2. **AI-картинка** (Gemini) → PNG через OpenRouter image gen
3. **Адаптация** (Haiku x N платформ) → VK/TG/IG версии + хештеги
4. **Контент-план** (Haiku) → JSON [{date, topic, postType}]
5. **Stories** → canvas WYSIWYG (drag, zoom, text overlay, шаблоны, export JPEG)

API key: сначала из БД (AppConfig), fallback на .env

## Auth
- Access token: 1 час (httpOnly cookie `token`)
- Refresh token: 30 дней (httpOnly cookie `refresh_token`, path `/api/auth`)
- Frontend: автоматический refresh при 401

## Brand Colors
- Primary: Fuchsia/Magenta (#d946ef)
- Dark mode supported

## Conventions
- Паттерны из nawode-erp: Hono routes, JWT httpOnly, Prisma, SSE eventBus
- AI-промпты включают BrandProfile (тон, ЦА, стиль, примеры)
- Business = единый хаб (BusinessDetailView): бренд-профиль + каналы + обзор
- Settings = только системные вещи (VK OAuth, пользователи, профиль, AI)
- Все routes с businessId проверяют доступ (resource-access middleware)
- Webhook для ERP-интеграции: POST /api/webhooks/erp
