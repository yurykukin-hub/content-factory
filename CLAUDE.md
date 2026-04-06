# Content Factory — AI-контент-фабрика

## Назначение
AI-контент-фабрика для автоматизации SMM. Генерирует контент-планы, тексты постов, адаптирует под платформы (VK, Telegram, Instagram), публикует автоматически. Мультибизнес: KB, НаWоде, Inpulse, личный бренд.

## Стек
- **Backend:** Bun + Hono + TypeScript
- **Frontend:** Vue 3 + Tailwind CSS + Lucide Icons + Pinia
- **ORM/DB:** Prisma + PostgreSQL 16
- **AI:** OpenRouter (Claude Haiku для адаптации, Sonnet для генерации)
- **Deploy:** Docker Compose

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
│   ├── prisma/schema.prisma    # 12 моделей, 7 enums
│   ├── src/
│   │   ├── index.ts            # Hono app
│   │   ├── db.ts               # PrismaClient singleton
│   │   ├── config.ts           # Env validation (zod)
│   │   ├── eventBus.ts         # SSE events
│   │   ├── middleware/auth.ts  # JWT httpOnly cookie
│   │   ├── routes/             # API endpoints (~10 файлов)
│   │   │   ├── auth.ts         # login/logout/me (JWT вручную в /me)
│   │   │   ├── businesses.ts   # CRUD + brand profile
│   │   │   ├── platforms.ts    # platformsByBiz + platformsById (split routing)
│   │   │   ├── posts.ts        # CRUD + approve + POST /:id/versions
│   │   │   ├── content-plans.ts
│   │   │   ├── ai.ts           # generate-post, generate-image, adapt
│   │   │   ├── publish.ts      # publish (с медиа) + schedule + webhooks
│   │   │   ├── media.ts        # upload/delete/attach медиафайлов
│   │   │   ├── settings.ts     # AppConfig CRUD (API keys в БД)
│   │   │   ├── dashboard.ts    # metrics
│   │   │   └── sse.ts          # Server-Sent Events
│   │   └── services/
│   │       ├── scheduler.ts    # Отложенная публикация (setInterval)
│   │       ├── ai/
│   │       │   ├── openrouter.ts      # OpenRouter wrapper (DB key → .env fallback)
│   │       │   ├── prompt-builder.ts  # Промпт-конструктор
│   │       │   └── image-generation.ts # AI image gen (Gemini → PNG)
│   │       └── publishers/
│   │           ├── base.ts     # Publisher interface + MediaFileForPublish
│   │           ├── vk.ts       # VK API wall.post + photo/video upload
│   │           └── telegram.ts # TG sendPhoto/Video/MediaGroup/Audio
│   ├── package.json
│   ├── Dockerfile
│   └── .env.example
├── src/                        # Vue 3 frontend
│   ├── api/client.ts           # HTTP client (fetch + cookies + TAB_ID)
│   ├── router/index.ts         # 9 routes + auth guard
│   ├── stores/                 # auth, businesses, theme
│   ├── views/                  # 9 views (3 ready, 4 stubs, 2 placeholder)
│   ├── components/
│   │   ├── layout/             # TheSidebar, TheHeader
│   │   ├── MediaUpload.vue     # Drag & drop + gallery
│   │   └── settings/           # ChannelsTab, BrandProfilesTab, ProfileTab, AiTab
├── docker-compose.yml          # Dev (postgres only)
├── docker-compose.prod.yml     # Prod (postgres + backend)
└── scripts/deploy.sh, backup-db.sh
```

## Schema (13 моделей, 8 enums)
User, Business, BrandProfile, PlatformAccount, ContentPlan, ContentPlanItem, Post, PostVersion, PublishLog, MediaFile, AiUsageLog, WebhookRule, AppConfig

Enums: UserRole, Platform, AccountType, PostType, PostStatus, ContentPlanStatus, PublishStatus

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

# .env для backend
cp backend/.env.example backend/.env
# Заполнить: DATABASE_URL, JWT_SECRET, OPENROUTER_API_KEY
```

## AI Pipeline
1. **Генерация поста** (Sonnet) → мастер-текст 500-1500 символов ✅
2. **AI-картинка** (Gemini) → PNG через OpenRouter image gen ✅
3. **Адаптация** (Haiku x N платформ) → VK/TG/IG версии + хештеги ✅
4. **Контент-план** (Haiku) → JSON [{date, topic, postType}] (TODO)

API key: сначала из БД (AppConfig), fallback на .env

## Brand Colors
- Primary: Fuchsia/Magenta (#d946ef)
- Dark mode supported

## Conventions
- Паттерны из nawode-erp: Hono routes, JWT httpOnly, Prisma, SSE eventBus
- AI-промпты включают BrandProfile (тон, ЦА, стиль, примеры)
- Токены соцсетей хранятся в PlatformAccount.accessToken (TODO: шифрование)
- Webhook для ERP-интеграции: POST /api/webhooks/erp
