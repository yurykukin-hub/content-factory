# Content Factory — Memory

## Ключевые факты
- [2026-04-05] Порты: backend :3800, frontend :5176, postgres :5441
- [2026-04-05] Brand color: Fuchsia/Magenta (#d946ef)
- [2026-04-05] AI: OpenRouter (Haiku для адаптации, Sonnet для генерации)
- [2026-04-05] VK фото-постинг: Community Token limitation (error 27), нужен User Token через OAuth
- [2026-06-03] Instagram-постинг через **Postmypost** (НЕ Meta Graph — обходит Business+FB+App Review). API base `https://api.postmypost.io/v4.1` (НЕ /v4!). Upload: byFile (init→Yandex S3 multipart→complete?id→poll status?id) — byUrl сломан (422). publication_type: POST=1/STORY=2/REELS=4, publication_status PENDING=5. PlatformAccount: accessToken=токен, accountId=postmypost account_id, config.postmypostProjectId. Публикация асинхронная (воркер Postmypost). Токен/project_id также в backend/.env (POSTMYPOST_API_TOKEN/PROJECT_ID)
- [2026-06-03] Фикс vk.ts: `import('../vk-oauth')` (был `../services/vk-oauth` — неверный путь → app-level VK-токен не резолвился для каналов с пустым accessToken). VK сторис на ЛИЧНУЮ страницу через API работают (publishStory без group_id, owner_id юзера)
- [2026-06-03] Тест VK+Instagram сторис одновременно из CF — успешен (личный бренд: VK личная 77596 + IG @yurykukin 2163523)
- [2026-06-03] UI-мультипостинг в StoryEditorView: чипы выбора каналов VK+IG (selectedChannels[]), цикл публикации/планирования с частичным успехом (per-канал try/catch), статусы per-версия. Готовый сторис СОХРАНЯЕТСЯ в медиатеку (тег 'story', uploadRendered — больше не удаляется), пост виден с превью. ensureVersion (find-or-create). MediaPickerModal: навигация по папкам (breadcrumbs + folders, как MediaLibraryView). Задеплоено.
- [2026-06-03] Текст на сторис вшивается в картинку (canvas/sharp) → идентично в VK+IG (не платформенный оверлей). Кнопка-ссылка: VK нативная (работает), IG через Postmypost — link-стикер не гарантирован.
- [2026-06-03] Видео-сторис: ffmpeg-оверлей текста готов (video-overlay.ts, POST /media/overlay-video — см. секцию ниже). Seedance img2video PRICING в kie.ts (720p img2video без звука ~$0.63/5с, $1/8с). Правило: НЕ оживлять картинку с вшитым текстом (поплывёт) — чистое фото→Seedance→PNG-слой поверх ffmpeg.
- [2026-06-03] Редизайн модалки «AI Видео» в StoryEditor: автоподхват фото сториса (videoBaseImage→firstFrameUrl, img2video по умолчанию), кнопка «Оживить» (describe-image Gemini → agent-chat генерит промпт движения), встроенный AI-агент (переиспользован VsAgentChat + новый проп heightClass; backend /ai/agent-chat). Убраны шаблоны/режимы frames-references/персонаж/enhance. **Async-fix (был баг — видео не появлялось):** generateAiVideo создаёт GenerationSession type=video → передаёт sessionId в /ai/generate-video → SSE connectSSE слушает session_updated → attachVideoFromSession(completed) привязывает видео к посту; sessionStorage 'story-video-{postId}' переживает F5. Layout: широкая модалка 2 колонки (превью+Оживить+настройки | AI-агент справа), mobile-стек. buildAgentSystemPrompt + AgentContext: optional storyText/photoDescription/animateMode (обратносовместимо — VideoStudio не шлёт).
- [2026-06-03] НаWоде каналы: IG @nawode.ru (account_id 2163599, официальное подключение через consent — НЕ логин/пароль, иначе Instagram блокирует прокси-вход) + VK группа NAWODE (group_id 150371202). Боевая сторис-вакансия инструкторов SUP Лето 2026 опубликована в оба канала. PlatformAccounts: pmp_ig_nawode, pmp_ig_yurykukin, vk_personal_yurykukin
- [2026-06-03] VK сторис в группу работает (publishStory с group_id, юзер-токен админа группы). Фикс vk.ts: безопасный JSON.parse upload-ответа (был generic SyntaxError при сбое)
- [2026-06-03] Дизайн сторис без нейронок: sharp-композиция (реальное фото-кроп флаера + бирюзовая панель + коралловый CTA-акцент + бейдж сезона). AI-генерация (Nano Banana) НЕ годится для текстовых сторис — кривой русский текст. Скрипт-паттерн: docker exec backend bun /app/story_gen.js (sharp из /app/node_modules, шрифты DejaVu в образе)
- [2026-06-04] **Отложка сторис (A1):** новое поле `PostVersion.publishOptions Json?` хранит `{skipOverlay,linkText,linkUrl,photoPosition,audioUrl?,musicSessionId?}`. `/schedule` принимает storiesOptions (Zod), scheduler читает их (раньше хардкодил skipOverlay:true → кнопка ВК ТЕРЯЛАСЬ). **A2:** isPublished только для PUBLISHED, isScheduled отдельно (запланированный редактируем); post.status rollup при schedule/cancel; PostsView показывает время+отмену.
- [2026-06-04] **Утренний AI-агент (Эпик C):** `daily-digest.ts` (Sonnet, рубрики НаWоде встроены) + `nawode-data.ts` (read-only погода/брони через `Bun.sql`, env `NAWODE_DATABASE_URL`=nawode PG 155.212.219.88:5436). Триггер `checkAndRunDailyDigest()` в scheduler (`digest_enabled`/`digest_time_utc` AppConfig, 04:00 UTC=07:00 МСК, ВКЛЮЧЁН). `AutoPostTask` расширен (catalogId nullable + source/postType/title/visualIdea), source='digest'. Одобрение (`/auto-posts/:id/approve`) создаёт ЧЕРНОВИК Post (НЕ авто-публикует). UI: `/digest` (DigestView, sidebar «Дайджест»). Telegram graceful (нужны `telegram_approval_bot_token`+`telegram_approval_chat_id`). Проверено: 4 погода-aware предложения.
- [2026-06-04] **Пресеты сторис (A3):** `StoryTemplate` businessId nullable + `isSystem` + `textAlign`/`bgRadius`. GET отдаёт глобальные (businessId=null)+per-business. 5 системных пресетов (seed-story-presets.ts). Глобальные правит только ADMIN.
- [2026-06-04] **Музыка в видео-сторис (A4):** `overlayAudioOnVideo()` (ffmpeg мукс, -shortest) в video-overlay.ts; `/media/overlay-video` принимает `musicSessionId`/`audioMediaFileId` → текст-оверлей затем аудио («bake once»). Picker треков Sound Studio в StoryEditor. Нативную музыку VK/IG сторис через API нельзя — вшиваем в видео.
- [2026-06-04] **Все форматы (Эпик B):** `PostType.CLIPS` добавлен (enum migration). VK: клипы публикуются как ВЕРТИКАЛЬНОЕ видео (video.save+wall.post — публичного API «Клипов» у VK НЕТ). IG: REELS+CLIPS→Postmypost type=4. TG: видео по mimeType (sendVideo). PostsView показывает все типы (фильтр+бейдж, sidebar «Stories»→«Контент»). PostEditorView: выбор типа + format-hint + предупреждение «нужно видео» + планирование (datetime + «В план», reuse /schedule). useLabels/ContentPlans/typeColor: CLIPS.
- [2026-06-04] **SMM-аналитика (на будущее, отдельная build-сессия):** ADR `~/.claude/knowledge/decisions/2026-06-smm-analytics-architecture.md` + готовый бриф `~/.claude/plans/smm-analytics-build-prompt.md`. Суть: контент-метрики→CF, конверсии/деньги→ERP, джойн по **UTM**; адаптеры VK (`wall.get` per-post / `stats.get` нужен admin user-токен+scope `stats`) / **Postmypost** (`/analytics/publications` type 1/3/4 — у них ЕСТЬ API аналитики, IG без Meta) / **Яндекс.Метрика** (визиты+цели по utm); snapshot-модель (append-only, raw jsonb); агент-аналитик (недельная петля обратной связи). Долги текущей связки: прямой `Bun.sql` к nawode + стратегия в коде → перевести на контракт `/public/daily-summary` + strategy-as-data (рубрики/события в БД) ДО 2-го бизнеса. Предусловия: VK admin-токен+stats, проверить Postmypost analytics-ключи вживую, счётчик+токен Метрики.
- [2026-06-04] **ИНЦИДЕНТ (утренняя VK-отложка):** `vk-story-morning.timer` сработал 08:00 UTC, но `service` упал — в скрипте `/app/uploads/_scripts/vk_publish.js` был `storiesOptions: {…} as any` (TS-синтаксис в `.js` → Bun парсит как чистый JS → `error: Expected "}" but found "as"`). Пред-существующий баг (не из ночной сессии). Фикс: `sed -i 's/ as any//g'`, переопубликовал вручную → success: https://vk.com/story-150371202_456239213 (кнопка «Забронировать»→nawode.ru). **Урок:** скрипты для `bun file.js` = чистый JS ИЛИ `.ts`. Таймер был одноразовый (отработал и исчез) — для будущих утр нужен новый механизм (cron/scheduler CF).
- [2026-06-04] **Авто-импорт ERP-событий в план (D, доп.):** `NAWODE_EVENTS` (праздники/поводы по md) + `getEventsInRange` + `getBookingsInRange` (nawode-data). `generate-plan` для НаWоде вставляет события+брони в промпт и ГАРАНТИРУЕТ их даты в плане (post-merge). Тесты: 121 (integration: regenerate, digest pipeline, events).
- [2026-06-04] **Интеллект контент-плана (Эпик D):** общий `services/ai/nawode-strategy.ts` (10 рубрик + getSeasonHint) — daily-digest рефакторен на него. `generate-plan`: для НаWоде (erpType='nawode') рубрики по умолчанию; items допускают REELS/CLIPS/STORIES. `buildPostPrompt` принимает `recentPosts` (анти-повтор) — ai-generate/generate-all шлют последние 8 постов. Новый `POST /plan-items/:id/regenerate {direction}` (Haiku) — переписывает ячейку плана с направлением; кнопка ⟳ в ContentPlansView.

## Блокеры
- [2026-04-05] VK OAuth: заявка подана, ожидаем. До получения — фото в VK не публикуются

## Schema (26 моделей, 8 enums)
User, UserBusiness, Business, BrandProfile, PlatformAccount, ContentPlan, ContentPlanItem, Post, PostVersion, PublishLog, MediaFile, MediaFolder, AiUsageLog, WebhookRule, AppConfig, Idea, StoryTemplate, Character, CharacterBusiness, **CharacterImage**, Scenario, PromptEntry, PromptTemplate, GenerationSession, BalanceTransaction, MusicPersona

## Endpoints (~20 route-файлов)
auth, users, businesses, platforms, posts, content-plans, ai, publish, media, settings, vk-oauth, ideas, characters, scenarios, sessions, music, photos, dashboard, sse, ai-logs

## SaaS-Ready (2026-04-11)
- RBAC (UserBusiness), Section Access (14 секций), refresh tokens, health endpoint
- Security: resource-access, CSRF X-Tab-ID, rate limiting, path traversal, Zod, 96 тестов

## Photo Studio (2026-04-18, updated 19.04)
- GenerationSession type='photo', 5 полей (photoModel, photoResolution, batchSize, photoAspectRatio, batchTaskIds)
- Модели: nano-banana-2 ($0.04-0.09) + nano-banana-pro ($0.07-0.12). Batch 1/2/4. 10 aspect ratios. 3 resolutions
- Routes: /api/photos/* (generate, enhance-prompt 8 modes, agent-chat, edit-image, remove-bg)
- Frontend: PhotoStudioView + 7 Ps* компонентов. 50/50 layout, KeepAlive, SSE, auto-save
- Reference images: VideoStudio-style UI (56x56 thumbs, @N метки, dropdown загрузить/медиатека, preview popup с AI-описание). MediaPickerModal multi-select. До 14 refs NB2, 8 Pro
- **ВАЖНО:** Generate payload — фронтенд шлёт `model`/`resolution`/`aspectRatio` (НЕ photoModel/photoResolution/photoAspectRatio)

## AI Agent + Sound Studio + Voice Input (2026-04-17) -> MEMORY-ARCHIVE
- AI Agent: Simple (Haiku) / Advanced (Sonnet), chatHistory JSON per-session, prompt transfer
- Sound Studio: suno.ts, 13 Ss*, wavesurfer.js. MusicPersona voice clone. 8 enhance modes
- Voice Input: useVoiceInput, Whisper STT, ~$0.006/мин. AppConfig openai_api_key

## AI Logs + Billing + Sound UX (2026-04-18)
- BUGFIX: getChargedRub() async (AppConfig, не hardcoded 95). Обновлены все 8 callers
- AI Logs: API column, cost in RUB, categories, CSV export. Settings -> AI: 5 карточек
- Sound UX: стоимость /2 трека, снапшоты params в results, сортировка по дате

## Chat/State Persistence (2026-04-18, updated 19.04)
- beforeunload -> fetch keepalive, onBeforeUnmount flush, chatMessages в watch, failed session chat save
- [2026-04-19] **v-show вместо v-if** для Agent/Editor табов во ВСЕХ 3 студиях + VsPromptArea
- [2026-04-19] **watch(activeTab) -> немедленный flush** (не ждёт 2с debounce)
- [2026-04-19] **onDeactivated flush** — KeepAlive навигация сохраняет состояние в БД

## Reference System v2 (2026-04-19)
- **CharacterImage** — новая модель: неограниченная галерея фото на персонажа (isMain, sortOrder, source, description)
- Заменяет старые Character.referenceMediaId + additionalAngles (JSON, макс 3)
- Миграция данных: `bun src/migrate-character-images.ts`
- **5 новых endpoints:** POST/PUT/DELETE /characters/:id/images, reorder, generate-sheet
- **SharedCharacterCarousel** + **SharedRefModal** — общие компоненты (src/components/shared/)
- Video Studio: emerald colorScheme. Photo Studio: fuchsia colorScheme + карусель добавлена
- **@CharName автокомплит** в VsRichPrompt: ввод @ → dropdown → badge chip с именем персонажа
- CharactersView: SharedRefModal, image preview strip, search + type filter
- Character Sheet: AI-генерация model sheet (4 views) через Photo Studio pipeline
- **ВАЖНО:** Character.referenceMediaId/additionalAngles пока НЕ удалены из schema (backward compat)

## CSRF Upload Fix (2026-04-19)
- **ВСЕ fetch('/api/media/upload')** теперь с X-Tab-ID header. Затронуто: VideoStudioView (2), VsRefModal (1), MediaLibraryView (1), StoryEditorView (5), PhotoStudioView (1)

## Prisma Migrations — КРИТИЧНЫЕ ПРАВИЛА (2026-04-20)
- **НИКОГДА** не использовать `db push` на dev-БД с историей миграций. Только `bunx prisma migrate dev --name описание`
- **НИКОГДА** не редактировать SQL файл миграции ПОСЛЕ apply (ломает checksum → drift)
- Если миграция упала "already exists" → `bunx prisma migrate resolve --applied имя_миграции` (НЕ правка SQL)
- `db push` допустим ТОЛЬКО на пустой/тестовой БД без миграционной истории
- Причина бага: `db push` создаёт таблицу без записи в `_prisma_migrations` → следующий `migrate dev` падает

## Видео-сторис с текстом (ffmpeg overlay) — 2026-06-03
- **Цепочка:** чистое фото → Seedance оживляет → текст НАКЛАДЫВАЕТСЯ поверх видео статично (ffmpeg) → публикация VK+IG. Текст НЕ оживляется Seedance (иначе исказится)
- **Архитектура "bake once":** текст вшивается в видео ОДИН раз перед циклом публикации (как фото uploadRendered), publishers НЕ трогаются, baked-видео переиспользуется для VK+IG
- **services/video-overlay.ts:** `overlayImageOnVideo()` — ffmpeg `scale2ref` (PNG 1080×1920 → размер видео) + `overlay`, `-map 0:a?` (аудио опционально), libx264 yuv420p +faststart. Fallback ffprobe+scale, таймаут 90с. Порядок выходов scale2ref: `[ovr][base]` (сначала масштабированный вход!)
- **POST /api/media/overlay-video:** multipart (overlay PNG + videoMediaFileId + businessId) → ffmpeg → новый baked-mp4 MediaFile (тег story + thumbnail). Sync ~3-12с
- **StoryEditorView:** `exportOverlayPng()` (прозрачный текст-слой, PNG alpha), overlay-canvas поверх `<video>` (WYSIWYG, pointer-events-none) в редакторе и preview-модалке, `renderVideoForPublish()`, ветки isVideoMedia в preparePreview/confirmPublish/schedulePublish
- **scheduler.ts фикс:** догрузка mediaFiles + storiesOptions{skipOverlay} для scheduled STORIES (был баг — scheduled сторис уходили БЕЗ медиа, касалось и фото)
- **base.ts:** тип storiesOptions честный (+skipOverlay, +photoPosition) — Bun не тайпчекает, vk.ts читал необъявленные поля

## Архитектурные решения
- Async generation: video-poller.ts (10 сек) обрабатывает video+music+photo. kieTaskId в PostgreSQL (deploy-safe)
- generating из БД (session.status), SSE session_updated, timer от kieTaskCreatedAt
- Русификация: UI на русском + translatePrompt() перед генерацией

## Паттерны
- HTTP client: fetch + httpOnly cookie + X-Tab-ID
- Auth: JWT httpOnly cookie, requireAuth middleware, refresh 1h+30d
- SSE: eventBus -> ReadableStream. session_updated для студий
- AI prompts: system prompt = base + brandContext. Русский UI + auto-translate
- Billing: AppConfig markup + usd_rub_rate. Auto-charge $transaction. ADMIN exempt
- Media library API: `{ files, hasMore, totalCount }` — НЕ массив
- Testing: Vitest, 96 tests, 7 files. Mock Prisma via vi.hoisted()
