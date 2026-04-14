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
- **AI:** OpenRouter (Haiku для адаптации, Sonnet для генерации, Gemini Flash для vision) + KIE.ai (Nano Banana 2 для text2img/img2img, FLUX Kontext Pro для img2img, recraft для удаления фона, Seedance 2 для видео)
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
│   ├── prisma/schema.prisma    # 16 моделей, 8 enums
│   ├── src/
│   │   ├── app.ts              # Hono app (routes, middleware, error handler)
│   │   ├── index.ts            # Server start + scheduler
│   │   ├── db.ts               # PrismaClient singleton
│   │   ├── config.ts           # Env validation (zod)
│   │   ├── eventBus.ts         # SSE events
│   │   ├── middleware/
│   │   │   ├── auth.ts         # JWT httpOnly cookie + requireRole + sectionAccess
│   │   │   ├── section-access.ts   # requireSection(section, level) — per-section access control
│   │   │   ├── business-access.ts  # requireBusinessAccess + getUserBusinessIds
│   │   │   └── resource-access.ts  # verifyPost/Plan/Media/PostVersionAccess
│   │   ├── routes/             # API endpoints (~16 файлов)
│   │   │   ├── auth.ts         # login/logout/me/refresh (access+refresh tokens)
│   │   │   ├── users.ts        # CRUD пользователей (ADMIN-only)
│   │   │   ├── businesses.ts   # CRUD + brand profile + isActive toggle (ADMIN sees inactive)
│   │   │   ├── platforms.ts    # platformsByBiz + platformsById
│   │   │   ├── posts.ts        # CRUD + approve + versions (access checks)
│   │   │   ├── content-plans.ts # CRUD + create-post/ai-generate + batch
│   │   │   ├── ai.ts           # generate-post/image/scenario, adapt, enhance-prompt, suggest-image/video-templates
│   │   │   ├── publish.ts      # publish + schedule (access checks)
│   │   │   ├── media.ts        # upload/delete/attach + library + tags
│   │   │   ├── settings.ts     # AppConfig CRUD (ADMIN-only, .env fallback)
│   │   │   ├── vk-oauth.ts     # VK OAuth 2.1 PKCE
│   │   │   ├── ideas.ts        # CRUD идей (per-user, ownership check)
│   │   │   ├── characters.ts   # CRUD AI-персонажей (person/mascot/avatar, per-business)
│   │   │   ├── scenarios.ts    # CRUD сценариев (scenes JSON, AI-генерация)
│   │   │   ├── dashboard.ts    # metrics (scoped by business access)
│   │   │   └── sse.ts          # Server-Sent Events
│   │   ├── services/
│   │   │   ├── scheduler.ts    # Отложенная публикация
│   │   │   ├── vk-oauth.ts     # VK OAuth service (PKCE, auto-refresh)
│   │   │   ├── ai/
│   │   │   │   ├── openrouter.ts      # OpenRouter + cost calculation
│   │   │   │   ├── prompt-builder.ts  # Промпт-конструктор
│   │   │   │   ├── image-generation.ts # AI image gen (Gemini 2.5 Flash Image)
│   │   │   │   └── fal.ts            # FAL.ai SDK (image editing, remove bg)
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
│   ├── router/index.ts         # 15 routes + auth guard + section access guard
│   ├── stores/                 # auth (+ sectionAccess), businesses, theme, sidebar
│   ├── composables/            # useToast, useFormatters, useStatus, usePlatform, useSectionAccess
│   ├── views/
│   │   ├── BusinessesView      # Grid карточек проектов (клик → detail)
│   │   ├── BusinessDetailView  # Хаб проекта: 3 таба (профиль/каналы/обзор+доступы)
│   │   ├── PostEditorView      # Редактор постов (текст + медиа + платформы)
│   │   ├── StoryEditorView     # Stories (canvas WYSIWYG + шаблоны, lock after publish)
│   │   ├── ContentPlansView    # AI планы (таблица + календарь)
│   │   ├── MediaLibraryView    # Медиа-библиотека (grid, теги, фильтры)
│   │   ├── IdeasView           # Личный блокнот идей (inline edit, auto-save)
│   │   └── ...                 # Dashboard, Login, Settings
│   └── components/
│       ├── layout/             # TheSidebar (mobile overlay), TheHeader (hamburger)
│       ├── BusinessFilter.vue  # Pill-кнопки выбора бизнеса (везде pills)
│       ├── ToastContainer.vue  # Toast notifications
│       ├── MediaUpload.vue     # Drag & drop + AI edit/remove bg buttons
│       ├── ai/
│       │   └── ImageEditModal.vue  # AI image editing modal (FLUX Kontext)
│       └── settings/           # VkOAuthTab, ProfileTab, AiTab, UsersTab
├── docker-compose.yml          # Dev (postgres only)
├── docker-compose.prod.yml     # Prod (postgres + backend, healthchecks)
└── scripts/deploy.sh, backup-db.sh
```

## Schema (22 модели, 8 enums)
User, UserBusiness, Business, BrandProfile, PlatformAccount, ContentPlan, ContentPlanItem, Post, PostVersion, PublishLog, MediaFolder, MediaFile, AiUsageLog, WebhookRule, AppConfig, Idea, StoryTemplate, Character, CharacterBusiness, Scenario, PromptEntry, PromptTemplate

Enums: UserRole, Platform, AccountType, PostType, PostStatus, ContentPlanStatus, PublishStatus

## RBAC
- **ADMIN** — полный доступ ко всем проектам и настройкам (bypass sectionAccess)
- **EDITOR** — только привязанные проекты (через UserBusiness), может редактировать бренд-профиль, не может управлять каналами
- **VIEWER** — только чтение
- **Section Access** — гранулярный доступ по разделам (User.sectionAccess JSON). 11 секций × 3 уровня (full/view/none). Дефолты по роли, кастомизация через Settings → Пользователи
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
cd backend && bun run test              # 48 tests
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

API keys: OpenRouter — из БД (AppConfig) или .env. FAL — из .env (FAL_API_KEY)

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
- Проект (Business) = единый хаб (BusinessDetailView): бренд-профиль + каналы + обзор (с управлением доступами). UI: "Проекты" (не "Бизнесы")
- BusinessFilter = pills везде (горизонтальный скролл на мобиле)
- Settings = системные вещи (VK OAuth, пользователи + sectionAccess UI, профиль, AI). Не-админы видят табы по sectionAccess
- AI prompt templates: hybrid pattern — БД-шаблоны (PromptTemplate, per-business) + кнопка "✨ Подобрать по контексту" (Haiku, brandContext). Применено к image + video
- Все routes с businessId проверяют доступ (resource-access middleware)
- Stories-first UI: навигация "Stories" (не "Посты"), только STORIES тип, lock после публикации
- Business isActive toggle: ADMIN видит неактивные, toggle на карточках
- VK Stories: кнопка-ссылка рисуется ТОЛЬКО в превью canvas, НЕ в JPEG (VK рисует нативную)
- Webhook для ERP-интеграции: POST /api/webhooks/erp
