# Content Factory — Memory Archive

Архив записей из MEMORY.md. Перенесены для соблюдения лимита 100 строк.

---

## Архив: Решения 2026-04-05 (создание проекта)

- [2026-04-05] Проект создан. AI Content Factory — AI-контент-фабрика для SMM
- [2026-04-05] Стек: Bun + Hono + Prisma + Vue 3 + Tailwind (паттерны из nawode-erp)
- [2026-04-05] Brand color: Fuchsia/Magenta (#d946ef)
- [2026-04-05] AI: OpenRouter (Haiku для адаптации, Sonnet для генерации)
- [2026-04-05] ERP-интеграция: через webhooks (не общая БД, не микросервис)
- [2026-04-05] Платформы MVP: VK + Telegram. Instagram — Phase 2
- [2026-04-05] Seed: 4 бизнеса (KB, НаWоде, Inpulse, Личный) с бренд-профилями
- [2026-04-05] Мультитенантность — Phase 4 (SaaS). Пока без Tenant модели
- [2026-04-05] Инфраструктура поднята: PostgreSQL :5441, миграции, seed (admin/admin123)
- [2026-04-05] Починена фабрика publishers (base.ts): VkPublisher и TelegramPublisher подключены
- [2026-04-05] Реализован publish endpoint + scheduler
- [2026-04-05] AI generate-post, adapt, image generation реализованы
- [2026-04-05] Schema: AccountType enum, мультиканальность (@@unique businessId+platform+accountId)
- [2026-04-05] VK/TG Publishers: фото, видео, mediaGroup, audio
- [2026-04-05] PostEditor, MediaUpload, BusinessesView реализованы
- [2026-04-05] Fix /api/auth/me: reads JWT from cookie manually
- [2026-04-05] VK фото-постинг: Community Token limitation (error 27), User Token needed

## Архив: Решения 2026-04-06

- [2026-04-06] Content Plans: AI generate-plan (Haiku), Plan→Post endpoints
- [2026-04-06] ContentPlansView: таблица/календарь + AI модалка

## Архив: TODO (MVP) — Все выполнены
- [x] AI-генерация контент-плана, постов, адаптация
- [x] VK/TG Publishers подключены и протестированы
- [x] Frontend: PostsView, PostEditorView, BusinessesView, ContentPlansView
