# Content Factory

AI-контент-фабрика для автоматизации SMM (VK / Telegram / Instagram). Мультибизнес: KB, НаWоде, Inpulse, личный бренд.
Прод: <https://content.yurykukin.ru> · стек: Bun + Hono + Vue 3 + Prisma + PostgreSQL 16.

## Quick Start (локальная разработка)

Требования: Docker, Bun.

```bash
# 1. dev-БД — изолированная (contentfactory_dev на 127.0.0.1:5441, отдельный пароль)
docker compose -f docker-compose.dev.yml up -d

# 2. backend
cd backend
cp .env.example .env          # дефолты уже настроены под dev-БД
bun install
bun run db:fresh              # миграции + seed (admin + 4 демо-бизнеса)
bun run dev                   # API на :3800

# 3. frontend (новый терминал, из корня проекта)
bun install
bun run dev                   # UI на :5176
```

Вход: **admin / admin123**.

## Полезные команды (из `backend/`)

| Команда | Что делает |
|---------|-----------|
| `bun run db:fresh` | сброс dev-БД + миграции + seed-демо |
| `bun run db:reset` | сброс dev-БД + миграции (без seed) |
| `bun run db:migrate` | применить новые миграции (dev) |
| `bun run db:studio` | Prisma Studio (GUI БД) |
| `bun run test` | тесты (Vitest, 359 / 32 файла) |

## ⚠️ Важно

- dev-БД запускать **только** через `-f docker-compose.dev.yml`. Голый `docker compose up`
  ронял прод-БД из-за общего project-basename (инцидент 2026-06-04).
- dev и прод **изолированы**: разные имена БД (`contentfactory_dev` ↔ `contentfactory`)
  и разные пароли. Прод-секреты живут только в `.env.prod` на сервере.
- Деплой, архитектура, AI-агенты, история решений → `CLAUDE.md` и `MEMORY.md`.
