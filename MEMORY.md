# Content Factory — Memory

## Ключевые факты
- [2026-04-05] Порты: backend :3800, frontend :5176, postgres :5441
- [2026-04-05] Brand color: Fuchsia/Magenta (#d946ef)
- [2026-04-05] AI: OpenRouter (Haiku для адаптации, Sonnet для генерации)
- [2026-04-05] VK фото-постинг: Community Token limitation (error 27), нужен User Token через OAuth

## Блокеры
- [2026-04-05] VK OAuth: заявка подана, ожидаем. До получения — фото в VK не публикуются

## Schema (25 модели, 8 enums)
User, UserBusiness, Business, BrandProfile, PlatformAccount, ContentPlan, ContentPlanItem, Post, PostVersion, PublishLog, MediaFile, MediaFolder, AiUsageLog, WebhookRule, AppConfig, Idea, StoryTemplate, Character, CharacterBusiness, Scenario, PromptEntry, PromptTemplate, GenerationSession, BalanceTransaction, **MusicPersona**

- [2026-04-16] **AiUsageLog расширена:** +userId, +status, +errorMessage, +prompt, +durationMs, +markupPercent, +chargedRub
- [2026-04-16] **User.balanceKopecks** — баланс в копейках. **BalanceTransaction** — история пополнений/списаний (24-я модель)

## Endpoints (~20 route-файлов)
- auth, users, businesses, platforms, posts, content-plans, ai, publish, media, settings, vk-oauth, ideas, characters, scenarios, sessions, music, **photos**, dashboard, sse, ai-logs
- [2026-04-17] POST /api/ai/agent-chat — multi-turn AI Agent чат (aiChat in openrouter.ts, logAndCharge DRY helper)
- GET /api/media/library/:bizId — **cursor pagination** `{ files, hasMore, totalCount }` (НЕ массив!) (16.04)
- [2026-04-16] **AI Logs API** (5 endpoints): GET /ai-logs (paginated list), /ai-logs/stats, /ai-logs/summary (groupBy), /ai-logs/error-count, /ai-logs/export (CSV)

## SaaS-Ready (2026-04-11)
- Split app.ts + index.ts, health endpoint
- Error handler, RBAC (UserBusiness), refresh tokens (1h+30d)
- Security: resource-access checks на 30+ endpoints
- Section Access: **13 секций** × 3 уровня (full/view/none), requireSection middleware. `photoStudio` + `aiLogs` в ADMIN_SECTIONS

## Security Hardening + Code Review (2026-04-16)
- [2026-04-16] **96 тестов** (7 файлов): auth, users, security, security-hardening, prompt-builder, posts, routes-rbac
- [2026-04-16] Path traversal fix: `/uploads/*` — `resolve()` + `startsWith(uploadsRoot)` check
- [2026-04-16] Zod validation: все PUT endpoints валидируют (platforms, brand-profile)
- [2026-04-16] Business access: GET /businesses/:id + brand-profile проверяют `getUserBusinessIds`
- [2026-04-16] CSRF: X-Tab-ID header required на POST/PUT/DELETE/PATCH (auth/webhooks exempt)
- [2026-04-16] Rate limiting: login — 5 attempts / 15 min per IP (in-memory Map, x-real-ip от Caddy)
- [2026-04-16] Billing race condition: `$transaction` + `updateMany WHERE balanceKopecks >= cost`
- [2026-04-16] Graceful shutdown: SIGTERM/SIGINT → clearInterval schedulers + db.$disconnect()
- [2026-04-16] Frontend 401 race: shared promise pattern (concurrent refreshes don't logout)
- [2026-04-16] Docker limits: backend 1G/1.5cpu, postgres 512M/0.5cpu
- [2026-04-16] Backup verification: `gunzip -t` after each backup
- [2026-04-16] USD/RUB: AppConfig `usd_rub_rate` (default 95), `getUsdRubRate()`, `useRates` composable, `GET /api/settings/public`

## Русификация AI-промптов (2026-04-16)
- [2026-04-16] Стратегия: "Русский UI + автоперевод перед генерацией" через translatePrompt()
- [2026-04-16] Enhance промпты — "Пиши на том же языке", describe-image на русском
- [2026-04-16] PromptConstructor: .label (рус.), translatePrompt() усилен (15 камерных терминов, @Image/@timeline preservation)

## Fix: Media Library (2026-04-16)
- [2026-04-16] MIME: MOV-файлы загружались как octet-stream → extensionToMime() fallback по расширению
- [2026-04-16] Миграция: fix-mime-types.ts — исправлены 16 файлов в проде
- [2026-04-16] Пагинация: cursor-based, 40/page, кнопка "Показать ещё" (было 200 за раз)
- [2026-04-16] Grid: images `loading="lazy"`, видео показывают thumbUrl (ffmpeg first frame → WebP)
- [2026-04-16] **Video thumbnails:** ffmpeg в Dockerfile, extractVideoThumbnail() утилита (1сек → sharp WebP 400×400). Auto при upload + KIE generation. fix-video-thumbs.ts — 89/90 существующих видео обновлены
- [2026-04-16] isImage()/isVideo() + displayType() — fallback на расширение файла
- [2026-04-16] **4 консьюмера API:** MediaLibraryView, MediaPickerModal, VsRefModal, VideoStudioView — все используют `res.files`

## Photo Studio (2026-04-18)
- [2026-04-18] **Photo Studio:** GenerationSession type='photo', 5 новых полей (photoModel, photoResolution, batchSize, photoAspectRatio, batchTaskIds)
- [2026-04-18] **Модели:** nano-banana-2 ($0.04-0.09, 4-6 сек) + nano-banana-pro ($0.07-0.12, 10-20 сек). PHOTO_PRICING в kie.ts
- [2026-04-18] **Batch:** 1/2/4 параллельных задачи через Promise.allSettled(). Poller ждёт ВСЕ задачи batch
- [2026-04-18] **Routes:** /api/photos/* — generate (202), enhance-prompt (8 modes), agent-chat, edit-image, remove-bg
- [2026-04-18] **Frontend:** PhotoStudioView.vue + 7 Ps* компонентов. 50/50 layout, KeepAlive, SSE, auto-save

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
- Testing: Vitest + vitest-setup.ts, mock Prisma via vi.hoisted(). **7 test files, 96 tests**
- Mobile sidebar: Pinia store + Teleport + Transition (slide + backdrop)
- Media library API: `{ files, hasMore, totalCount }` — НЕ массив. Все консьюмеры → `res.files`
- Video generation: async (video-poller) — никогда не блокировать HTTP-запрос на минуты
- AI logging: все AI-вызовы логируют userId, prompt, durationMs, status, markupPercent, chargedRub. ADMIN видит всех, user — только свои
- Billing: AppConfig `ai_markup_percent` (default 50%), `usd_rub_rate` (default 95). Auto-charge с $transaction + WHERE guard (race-safe). ADMIN exempt. Balance check middleware в /api/ai/* (402). Top-up через Settings → Users
- Security: path traversal → resolve+startsWith, CSRF → X-Tab-ID, rate limit → in-memory Map, graceful shutdown → SIGTERM handler

## AI Agent Mode — Video Studio (2026-04-17)
- [2026-04-17] feat: AI Agent mode in Video Studio — VsAgentChat + VsAgentMessage + VsPreGenModal + VsPromptTabs. aiChat() multi-turn. buildAgentSystemPrompt (Seedance 2.0 expert). Pre-gen modal always shown. logAndCharge DRY refactor in openrouter.ts. Security: escapeHtml in markdown, assertBusinessAccess fix, Zod limits reduced
- [2026-04-17] GenerationSession.chatHistory �� JSON field для хранени�� истории чата агента per-session
- [2026-04-17] Два режима: Simple (Haiku) / Advanced (Sonnet). Quick reply suggestions. Prompt transfer Agent→Editor одной кнопкой

## Sound Studio — AI Music Generation (2026-04-17)
- [2026-04-17] feat: Sound Studio MVP — full-stack module (suno.ts, music.ts routes, 13 Ss* components, SoundStudioView, useSurfer composable)
- [2026-04-17] KIE.ai Suno API: POST /api/v1/jobs/createTask model "suno/v4.5". Стоимость ~$0.11/песня. Тот же KIE_API_KEY
- [2026-04-17] GenerationSession расширена: type="music", 18 nullable music-полей (customMode, lyrics, musicStyle, vocalGender, weights, persona, completedTaskId, kieAudioId)
- [2026-04-17] MusicPersona модель: name, description, gender, sunoPersonaId. Voice Clone через Suno V5.5 Generate Persona API
- [2026-04-17] Generate Persona flow: POST /api/v1/generate/generate-persona (taskId+audioId+vocalStart/End 10-30с). Поллер сохраняет completedTaskId+kieAudioId при завершении
- [2026-04-17] 8 music enhance modes: enhance, lyrics (Sonnet), improve (Sonnet), style, structure, rhyme, translate, simplify
- [2026-04-17] wavesurfer.js v7 — useSurfer.ts composable для waveform visualization (fuchsia brand)
- [2026-04-17] Section access: soundStudio (ADMIN-only по умолчанию). Routes: /api/music/* с requireSection guard
- [2026-04-17] VIDEO-POLLER переименован логически в generation-poller (обрабатывает video+music). Ветвление по session.type

## Voice Input — Whisper Transcription (2026-04-17)
- [2026-04-17] feat: голосовой ввод в Agent Chat (Video Studio + Sound Studio). Кнопка микрофона: toggle recording → Whisper → текст в textarea
- [2026-04-17] Backend: whisper.ts сервис (getOpenAiKey из AppConfig + .env fallback), POST /api/ai/transcribe (multipart, 25MB limit, billing)
- [2026-04-17] Frontend: useVoiceInput composable (MediaRecorder, MIME detection, auto-stop 120s, cleanup). useRates +voiceInputEnabled
- [2026-04-17] Активация: AppConfig key `openai_api_key` или env `OPENAI_API_KEY`. Кнопка скрыта если ключ не задан
- [2026-04-17] Billing: action `transcribe_voice`, model `whisper-1`, ~$0.006/мин. AiUsageLog + chargeUser

## AI Logs Improvements + Billing Bugfix (2026-04-18)
- [2026-04-18] **BUGFIX: USD/RUB курс** — calculateChargedRub() всегда использовал default 95, игнорируя AppConfig. Добавлен `getChargedRub()` async (читает из AppConfig). Обновлены все 8 callers + chargeUser()
- [2026-04-18] feat: колонка API в логах (OpenRouter/OpenAI/KIE.ai) — computed из action+model, цветные бейджи, фильтр pills
- [2026-04-18] feat: себестоимость в рублях (ADMIN) — `$0.06 / 5 ₽` в таблице, динамический курс
- [2026-04-18] feat: категории music/voice/agent_chat в ai-actions.ts + labels + CATEGORY_BADGES
- [2026-04-18] feat: Settings → AI — карточки OpenAI Key, KIE.ai Key, курс USD/RUB (5 карточек итого)
- [2026-04-18] refactor: KIE_CREDIT_PRICE вынесен в billing.ts, убрано дублирование из ai-logs.ts/dashboard.ts
- [2026-04-18] refactor: KIE API key из AppConfig + .env fallback (kie.ts, suno.ts) — управление через Settings UI

## Sound Studio UX Fixes (2026-04-18)
- [2026-04-18] fix: стоимость округлена до рублей (везде кроме логов). Генерация: "14 ₽ / 2 трека"
- [2026-04-18] fix: стоимость делится на 2 трека (было: первый $0.11, второй $0.00)
- [2026-04-18] feat: раскрывающиеся подробности трека (ChevronDown) — модель, вокал, промпт, текст песни
- [2026-04-18] fix: треки отсортированы по дате (новые вверху), было: без сортировки
- [2026-04-18] fix: musicStyle/lyrics/prompt снапшотятся в results JSON при генерации (раньше брались из текущей сессии)

## Chat Persistence Fix (2026-04-18)
- [2026-04-18] fix: beforeunload handler — fetch с keepalive:true сохраняет чат при F5/закрытии вкладки
- [2026-04-18] fix: onBeforeUnmount flush — saveSession() вызывается при навигации (раньше clearTimeout без save)
- [2026-04-18] fix: chatMessages добавлен в watch VideoStudioView (раньше auto-save не триггерился при изменении чата)
- [2026-04-18] fix: saveSession() сохраняет chatHistory для failed сессий (раньше пропускал всё кроме draft)
- [2026-04-18] fix: loadDraftSession() не создаёт пустую сессию автоматически — загружает последнюю вместо этого

## Poller Error Handling (2026-04-18)
- [2026-04-18] fix: поллер обрабатывает статус ERROR (помимо FAILURE/FAILED) от KIE.ai
- [2026-04-18] fix: расширено извлечение ошибки из ответа KIE (failMsg, errorMessage, error, message, response.errorMessage)
- [2026-04-18] feat: логирование rawStatus в checkMusicTaskStatus() для отладки
