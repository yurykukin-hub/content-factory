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

---

## Архив: UI Refactoring 2026-04-11

- Mobile sidebar (overlay+backdrop), hamburger menu, Stories-first nav
- PostsView → только STORIES, BusinessFilter pills, StoryEditor fixes
- IdeasView (inline edit, auto-save), Idea модель + CRUD route
- VK Stories: кнопка-ссылка НЕ рисуется в JPEG (VK рисует нативную)
- Lock after publish, Business isActive toggle, BusinessDetailView доступы
- AI Image: gemini-2.5-flash-image, шаблоны промптов, FAL.ai SDK (FLUX Kontext Pro, rembg)

## Архив: Content Factory v2 AI-воркспейс 2026-04-13

- Character (person/mascot/avatar) + Scenario модели, AI-генерация сценариев
- KIE.ai: Nano Banana 2 (img2img), Seedance 2 (видео), generateVideo()
- AI Video modal: шаблоны, enhance, история промптов, slider 4-15 сек
- MediaFolder, AI metadata (aiModel/aiCostUsd), Scenario→Stories pipeline
- Characters: глобальные (CharacterBusiness M2M), отдельная страница

## Архив: Content Factory v2 продолжение 2026-04-14

- Видео-студия (VideoStudioView): 3 режима (Референсы/Кадры/Текст), 2/3+1/3 layout
- PromptConstructor (6 секций), PromptEntry (auto-save, рейтинг), PromptTemplate (БД per-business)
- AI Vision merge (Gemini Flash), динамическая стоимость видео, Image-to-video
- Референсы с ролями, ADMIN-only разделы, Schema +PromptEntry +PromptTemplate (22 модели)

## Архив: Section Access + Hybrid Templates 2026-04-14

- Section Access: 11 секций × 3 уровня, requireSection middleware, UsersTab radio-таблица
- Canvas preview race condition fix, UI rename "Бизнесы"→"Проекты"
- Hybrid AI prompt templates: БД + "Подобрать" (Haiku + brandContext)
- SMMER.RU бизнес добавлен (Антон Григорьев)

## Архив: Video Studio Pro Enhancement 2026-04-15

- 8 режимов enhance (enhance/director/structure/focus/audio/camera/translate/simplify)
- analyzeVideoPrompt() — анализ сложности, адаптивный enhance
- Director mode (Sonnet, timeline), VsEnhanceMenu split-button, debug info bar
- Seedance 2.0 best practices в промптах

## Архив: Security Hardening + Code Review 2026-04-16

- 96 тестов (7 файлов). Path traversal fix (resolve+startsWith). Zod все PUT
- CSRF X-Tab-ID. Rate limiting login. Billing race condition ($transaction)
- Graceful shutdown. Frontend 401 shared promise. Docker limits. Backup gunzip -t
- USD/RUB: AppConfig + getUsdRubRate(). AiUsageLog +userId +status +prompt +chargedRub

## Архив: Русификация AI + Media Library 2026-04-16

- translatePrompt() с 15 камерных терминов. Enhance на языке ввода. describe-image на русском
- MIME extensionToMime() fallback. Cursor pagination 40/page. ffmpeg thumbnails
- isImage()/isVideo() fallback. 4 консьюмера → res.files

## Архив: AI Agent + Sound Studio + Voice Input 2026-04-17

- AI Agent Mode: VsAgentChat + multi-turn aiChat(). Simple (Haiku) / Advanced (Sonnet)
- Sound Studio MVP: suno.ts, 13 Ss* компонентов, wavesurfer.js. KIE Suno API v2
- MusicPersona voice clone (V5.5 Generate Persona). 8 music enhance modes
- Voice Input: useVoiceInput composable, Whisper STT, ~$0.006/мин
