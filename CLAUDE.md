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
│   │   ├── routes/             # API endpoints
│   │   │   ├── auth.ts         # login/logout/me
│   │   │   ├── businesses.ts   # CRUD + brand profile
│   │   │   ├── platforms.ts    # VK/TG/IG accounts
│   │   │   ├── posts.ts        # CRUD + approve
│   │   │   ├── content-plans.ts
│   │   │   ├── ai.ts           # AI generation endpoints
│   │   │   ├── publish.ts      # publish + webhooks
│   │   │   ├── dashboard.ts    # metrics
│   │   │   └── sse.ts          # Server-Sent Events
│   │   └── services/
│   │       ├── scheduler.ts    # Отложенная публикация (setInterval)
│   │       ├── ai/
│   │       │   ├── openrouter.ts    # OpenRouter API wrapper
│   │       │   └── prompt-builder.ts # Промпт-конструктор
│   │       └── publishers/
│   │           ├── base.ts     # Publisher interface
│   │           ├── vk.ts       # VK API wall.post
│   │           └── telegram.ts # Telegram Bot API
│   ├── package.json
│   ├── Dockerfile
│   └── .env.example
├── src/                        # Vue 3 frontend
│   ├── api/client.ts           # HTTP client
│   ├── router/index.ts         # 9 routes
│   ├── stores/                 # auth, businesses, theme
│   ├── views/                  # 9 views
│   └── components/layout/      # Sidebar, Header
├── docker-compose.yml          # Dev (postgres only)
├── docker-compose.prod.yml     # Prod (postgres + backend)
└── scripts/deploy.sh, backup-db.sh
```

## Schema (12 моделей)
User, Business, BrandProfile, PlatformAccount, ContentPlan, ContentPlanItem, Post, PostVersion, PublishLog, MediaFile, AiUsageLog, WebhookRule

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
1. **Контент-план** (Haiku) → JSON [{date, topic, postType}]
2. **Генерация поста** (Sonnet) → мастер-текст 500-1500 символов
3. **Адаптация** (Haiku x3) → VK (длинный), TG (короткий), IG (эмоциональный)
4. **Хештеги** (Haiku) → 5-20 штук по правилам платформы

## Brand Colors
- Primary: Fuchsia/Magenta (#d946ef)
- Dark mode supported

## Conventions
- Паттерны из nawode-erp: Hono routes, JWT httpOnly, Prisma, SSE eventBus
- AI-промпты включают BrandProfile (тон, ЦА, стиль, примеры)
- Токены соцсетей хранятся в PlatformAccount.accessToken (TODO: шифрование)
- Webhook для ERP-интеграции: POST /api/webhooks/erp
