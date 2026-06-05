# Content Factory — Memory

## Ключевые факты
- [2026-06-05] **Автономная сессия (per-business Метрика + код-ревью + сайт-уборка):**
  - **Per-business Метрика-архитектура (масштабируемо под KB/Inpulse/личный):** `Business.metrikaCounterId` + `metrikaGoalIds` (БД, не секрет, во фронт ок) + токен в AppConfig `metrika_token_{businessId}` (СЕКРЕТ, admin-only) → глобальный `metrika_oauth_token` fallback. Убран хардкод `DEFAULT_COUNTERS{nawode}`. `metrika-adapter`: `getMetrikaToken(businessId)` + `getMetrikaConfigForBusiness` читает поля Business → fallback `metrika_config` JSON. `businesses` route принимает counter/goals. Migration `add_business_metrika_config` (аддитивная). **Онбординг бизнеса = заполнить поля Business + (если другой Яндекс-аккаунт) `metrika_token_{id}`, не код.** НаWоде засижен (92916147 + цели звонок 294764085/мессенджер 290266307). 176 тестов, в проде, verified (config из Business-полей, collect site=5 errors=0). Коммиты ea02d50+e016783.
  - **Код-ревью (агент) диффа сессии:** архитектура чистая, утечек токенов в логи/контроля доступа нет. Фикс **H1/H2** (collector.ts): VK-via-PMP при неудачном `resolvePmpExternalId` оставлял PMP-pub-id → `wall.getById` привязывал бы метрики к ЧУЖОМУ посту; теперь нерезолвленные refs отбрасываются (как IG) + ошибка при пустом `POSTMYPOST_API_TOKEN`. **M4:** дайджест `erpType:{not:null}` (generic, NullAdapter для неизвестных ERP — graceful). **C1 (SECURITY, pre-existing, НЕ фикшено):** `GET /businesses/:id/platforms` отдаёт `accessToken` (VK/TG/PMP токены) во фронт → нужен сериализатор-маска (отдельная задача, фронт-импакт `BusinessDetailView.vue:246`).
  - **Сайт nawode.ru:** yclients убран со всех 14 страниц (со Светой) → везде свой ERP-виджет `erp.nawode.ru/booking.html?ref=X&serviceType={WALK|TOUR|RENTAL|LESSON}&productId=Z`. Бронь = собственный ERP (НЕ yclients). Продукты: RENTAL=cmnmf7e4o…(Прокат), WALK=tour-aroma/tour-vyborg-walk/tour-sunset, TOUR=tour-belichi/tour-sila(Тапиола)/tour-monrepo, LESSON=tour-fountain-lesson. План инструментации виджета (цели-шаги+Webvisor+cross-domain): `~/.claude/plans/nawode-erp-metrika-prompt.md`.
- [2026-06-04] **Полировочная сессия (хвосты до блеска):**
  - **VK фото/стена через Postmypost — РАЗБЛОКИРОВАНО.** Generic `PostmypostPublisher` (`publishers/postmypost.ts`) — один класс для IG и VK-стены; `instagram.ts`→обёртка. `getPublisher(platform,{postType,config})` гибрид: VK+неSTORIES+`config.viaPostmypost`→PMP (обход scope photos), VK+STORIES→прямой VK (нативная кнопка/оверлей не регрессим), обратимо. VK-аккаунт НаWоде: `config={viaPostmypost:true,postmypostAccountId:2164096}` (PMP id VK-канала, chanel_id=2). **PMP-токен в `.env.prod` POSTMYPOST_API_TOKEN** (env, НЕ config — `GET /businesses/:id/platforms` отдаёт config+accessToken во фронт = утечка). getToken: IG→accessToken, VK→env. Smoke реального VK-поста за Юрием (UI). Коммиты 0299d95+a9eec46.
  - **Аналитика:** недельный агент включён (`analytics_agent_enabled=true`, Mon 06:00 UTC). Данные живут: 18 IG-снапшотов, 1 отчёт. VK-статы/Метрика gated на ре-авторизацию VK (scope stats) + Метрика OAuth (за Юрием).
  - **Арх-долг B СНЯТ (commit 4a0f822):** Phase 3 strategy-as-data — рубрики/поводы/стратегия/сезон из кода→БД (`Rubric`,`Occasion` + `BrandProfile.contentStrategy`/`seasonHints`); generic `services/ai/strategy.ts`; сидер `seed-nawode-strategy.ts` (идемпотентный, seed=константы→вывод идентичен); убран литерал `erpType==='nawode'`. Phase 2 — `services/datasource/` (`DataSourceAdapter`+`NawodeErpAdapter` обёртка над nawode-data+Null+реестр по erpType, lazy bun-import). digest: `where erpType:{not:null},isActive` (в проде=nawode, identical). HTTP-контракт `/public/daily-summary` (ERP) — кросс-репо, отложен. Прод-смоук no-AI зелёный (рубрик 10, поводов 8, стратегия 1097, погода 4). 167 тестов.
- [2026-06-05] **Метрика подключена (SMM-ROI визиты):** OAuth-токен (implicit flow, Yandex app ClientID `170069440d094cddaf1ec026c37fb849`, scope `metrika:read`, ~1 год) в AppConfig `metrika_oauth_token`; `metrika_config={"nawode":{"counterId":"92916147","goalIds":[]}}`. Verified live: 262 визита/30д, адаптер 5 строк по utm, коллектор site=5, errors=0. Визиты по `utm_content=postId` джойнятся к постам (сейчас трафик link_in_bio = органика IG, postId=null). **Цель-конверсия настроена автономно** (через Management API, токен metrika:read): `goalIds=["302969632"]` = «Зашли на страницу РАСПИСАНИЕ» (booking-intent — точной цели «бронь» в счётчике НЕТ, всего 5 целей: соц.сеть 290098747 / мессенджер 290266307 / телефон 294764085 / РАСПИСАНИЕ 302969632 / поиск 315998715). Собирается (goalReaches по utm), сейчас 0 reaches (мало SMM-меченого трафика). «Брони» в дашборде = дошли до расписания. Реальные брони (деньги) = ERP (Phase 2 контракт).
- [2026-06-05] **VK ре-авторизация + VK-аналитика (продолжение polish):** Ре-авторизация дала свежий токен, но VK **молча НЕ выдал `stats` И `photos`** (granted-маска 73808 = wall+video+stories+offline) — эти scope требуют **модерации VK-приложения** (Юрий подаёт параллельно). Поэтому `stats.get`→error 7, `stories.getStats`→error 15 (account/story-статы VK заблокированы). **Решение для пост-метрик:** scope `wall` выдан → `wall.getById` работает; VK-via-Postmypost посты хранят PMP-pub-id, коллектор резолвит его в VK-post-id (`resolvePmpExternalId` в postmypost-adapter, общий с IG) ПЕРЕД `wall.getById` (scope `stats` НЕ нужен). Verified live: пост 835 → resolve → views=10; коллектор posts=9(IG) errors=0. VK сторис/account-reach — ждут модерации VK-аппа.
- [2026-06-04] **SMM-аналитика (Эпик B Phase 4+5) — в проде.** Миграция `20260604185535_add_smm_analytics` (4 модели: SocialPostMetricSnapshot append-only, SocialAccountMetricSnapshot, SiteTrafficSnapshot, AnalyticsReport). `services/analytics/` (типы+vk/postmypost/metrika адаптеры+collector+analyst-agent+analyst-telegram), `metrics-poller.ts` (2×/день через scheduler, `metrics_times_utc` default 05:00,15:00), `routes/analytics.ts` (collect/overview/report/reports), `AnalyticsView.vue` (/analytics). Verified live: IG 9 снапшотов, отчёт НаWоде (ER 5.18%). Коммиты 669140d+6e9cc3f. ADR `decisions/2026-06-smm-analytics-architecture` → accepted.
- [2026-06-04] **Postmypost analytics — ключи сняты вживую:** `/analytics/publications?project_id&account_id&date_from&date_to&per_page&page&type` → `analytics:{likes,shares,engagements,views,reach,engagement_rate_reach,engagement_rate_views}` + поля `id`(pm),`external_id`(IG media),`external_url`,`type`(1=post/3=story/4=reels). **Джойн к CF:** `externalPostId`(pm pub id) → `GET /publications/{id}` → `posts[0].external_id` + реальный IG-url → матч с analytics-строкой. `/analytics/accounts` требует ещё `metrics` (коды не сняты — account-level IG отложен). **PMP accounts проекта 347349:** VK НаWоде=`2164096` (chanel_id 2), IG nawode.ru=`2163599`, IG yurykukin=`2163523`.
- [2026-06-04] **VK-метрики:** `wall.getById` требует **USER-токен** (community/per-channel → error 27, как и wall-photos); читать через `ensureValidToken()` (авто-рефреш), НЕ `PlatformAccount.accessToken` (там community NAWODE). `stats.get`/`stories.getStats` → scope `stats` (добавлен в OAuth `vk-oauth.ts`, нужна ре-авторизация; сейчас code 15/100). **CF VK-контент = СТОРИС** (id `story-...`), статы живут ~24ч → поллер ловит в день публикации. Метрика-счётчик nawode.ru = **92916147**.
- [2026-06-04] **ИНЦИДЕНТ:** `docker compose up` из `/home/dev/projects/content-factory` уронил прод-БД (dev и prod = один compose-проект `content-factory` по basename → общие сети/volumes). Восстановлено, данные целы. **Правило:** локальную dev-БД — ТОЛЬКО standalone (`docker run --name cf-dev-pg -p 5441:5432 postgres:16-alpine`, без compose-лейблов); НИКОГДА не `compose up/down` из dev-папки. Детали: [[incidents/2026-06]].
- [2026-06-03] Instagram-постинг через **Postmypost** (НЕ Meta Graph — обходит Business+FB+App Review). API base `https://api.postmypost.io/v4.1` (НЕ /v4!). Upload: byFile (init→Yandex S3 multipart→complete?id→poll status?id) — byUrl сломан (422). publication_type: POST=1/STORY=2/REELS=4, publication_status PENDING=5. PlatformAccount: accessToken=токен, accountId=postmypost account_id, config.postmypostProjectId. Публикация асинхронная (воркер Postmypost). Токен/project_id также в .env (POSTMYPOST_API_TOKEN/PROJECT_ID — теперь и в проде .env.prod для VK-через-PMP).
- [2026-06-03] НаWоде каналы: IG @nawode.ru (account_id 2163599, consent — НЕ логин/пароль) + VK группа NAWODE (group_id 150371202). PlatformAccounts: pmp_ig_nawode, pmp_ig_yurykukin, vk_personal_yurykukin
- [2026-06-04] **Отложка сторис (A1):** новое поле `PostVersion.publishOptions Json?` хранит `{skipOverlay,linkText,linkUrl,photoPosition,audioUrl?,musicSessionId?}`. `/schedule` принимает storiesOptions (Zod), scheduler читает их (раньше хардкодил skipOverlay:true → кнопка ВК ТЕРЯЛАСЬ). **A2:** isPublished только для PUBLISHED, isScheduled отдельно; post.status rollup при schedule/cancel; PostsView показывает время+отмену.
- [2026-06-04] **Утренний AI-агент (Эпик C):** `daily-digest.ts` (Sonnet) + данные погода/брони через `DataSourceAdapter` (раньше прямой `nawode-data.ts` Bun.sql, env `NAWODE_DATABASE_URL`=nawode PG 155.212.219.88:5436). Триггер `checkAndRunDailyDigest()` в scheduler (`digest_enabled`/`digest_time_utc` AppConfig, 04:00 UTC=07:00 МСК, ВКЛЮЧЁН). `AutoPostTask` (source='digest'). Одобрение (`/auto-posts/:id/approve`) создаёт ЧЕРНОВИК Post (НЕ авто-публикует). UI: `/digest`. Telegram graceful (нужны `telegram_approval_bot_token`+`telegram_approval_chat_id`).
- [2026-06-04] **Музыка в видео-сторис (A4):** `overlayAudioOnVideo()` (ffmpeg мукс, -shortest) в video-overlay.ts; `/media/overlay-video` принимает `musicSessionId`/`audioMediaFileId` → текст-оверлей затем аудио («bake once»). Нативную музыку VK/IG сторис через API нельзя — вшиваем в видео.
- [2026-06-04] **Все форматы:** `PostType.CLIPS` добавлен (enum migration). VK: клипы публикуются как ВЕРТИКАЛЬНОЕ видео (video.save+wall.post — публичного API «Клипов» у VK НЕТ). IG: REELS+CLIPS→Postmypost type=4. TG: видео по mimeType (sendVideo).
- [2026-06-04] **ИНЦИДЕНТ (утренняя VK-отложка):** скрипт `bun file.js` с `as any` (TS-синтаксис в `.js`) → Bun крашится. **Урок:** скрипты для `bun file.js` = чистый JS ИЛИ `.ts`.
- [2026-06-04] **Интеллект контент-плана (Эпик D):** `generate-plan` для НаWоде подставляет рубрики/поводы (теперь из БД, generic — см. strategy-as-data); items допускают REELS/CLIPS/STORIES. `buildPostPrompt` принимает `recentPosts` (анти-повтор, последние 8). `POST /plan-items/:id/regenerate {direction}` (Haiku) — кнопка ⟳ в ContentPlansView. **strategy-as-data 2026-06-04:** `nawode-strategy.ts` теперь только сидер; рантайм читает БД через `services/ai/strategy.ts` (getRubricNames/getOccasionsInRange/getStrategyBlock/getSeasonHint).

## Блокеры
- [2026-06-05] VK scope `photos` + `stats` застряли (требуют модерации VK-приложения — ре-авторизация их НЕ даёт, выдаёт только wall/video/stories/offline). `photos` ОБОЙДЁН через Postmypost (постинг). `stats` (сторис/account-статы) — Юрий подаёт VK-апп на модерацию; пост-метрики VK уже идут через `wall.getById` (scope wall есть).

## Schema (35 моделей, 8 enums)
User, UserBusiness, Business, BrandProfile, PlatformAccount, ContentPlan, ContentPlanItem, Post, PostVersion, PublishLog, MediaFile, MediaFolder, AiUsageLog, WebhookRule, AppConfig, Idea, StoryTemplate, Character, CharacterBusiness, CharacterImage, Scenario, PromptEntry, PromptTemplate, GenerationSession, BalanceTransaction, MusicPersona, PhotoCatalog, AutoPostTask, SocialPostMetricSnapshot, SocialAccountMetricSnapshot, SiteTrafficSnapshot, AnalyticsReport, **Rubric**, **Occasion** (strategy-as-data)

## Endpoints (~20 route-файлов)
auth, users, businesses, platforms, posts, content-plans, ai, publish, media, settings, vk-oauth, ideas, characters, scenarios, sessions, music, photos, dashboard, sse, ai-logs, analytics, auto-posts

## strategy-as-data + DataSourceAdapter (Эпик B Phase 2/3, 2026-06-04)
- **strategy.ts** (generic): getRubricNames, getOccasionsInRange, getStrategyBlock, getSeasonHint — рубрики/поводы/стратегия/сезон из БД per-business
- **Модели:** Rubric (name/sortOrder/isActive), Occasion (monthDay/topic/rubric/postType), BrandProfile.contentStrategy/seasonHints
- **Сидер:** `bun src/seed-nawode-strategy.ts` (идемпотентный, не затирает кастомизацию; seed=nawode-strategy.ts константы)
- **datasource/**: DataSourceAdapter интерфейс + NawodeErpAdapter (lazy-import nawode-data, обёртка) + NullAdapter + getDataSourceAdapter(business) по erpType
- **Добавить бизнес = данные (сидер/UI) + адаптер**, не ветки `if erpType` в коде
- HTTP-контракт `GET /public/daily-summary` (ERP-сторона, auth Business.erpApiKey) + NawodeHttpAdapter — Deferred (кросс-репо nawode-erp)

## SaaS-Ready (2026-04-11)
- RBAC (UserBusiness), Section Access (14 секций), refresh tokens, health endpoint
- Security: resource-access, CSRF X-Tab-ID, rate limiting, path traversal, Zod, 167 тестов

## Photo Studio (2026-04-18, updated 19.04)
- GenerationSession type='photo', 5 полей (photoModel, photoResolution, batchSize, photoAspectRatio, batchTaskIds)
- Модели: nano-banana-2 ($0.04-0.09) + nano-banana-pro ($0.07-0.12) + gpt-image-2. Batch 1/2/4. 10 aspect ratios. 3 resolutions
- Routes: /api/photos/* (generate, enhance-prompt 8 modes, agent-chat, edit-image, remove-bg)
- Frontend: PhotoStudioView + 7 Ps* компонентов. 50/50 layout, KeepAlive, SSE, auto-save
- Reference images: VideoStudio-style UI (56x56 thumbs, @N метки, dropdown загрузить/медиатека, preview popup с AI-описание). MediaPickerModal multi-select. До 14 refs NB2, 8 Pro
- **ВАЖНО:** Generate payload — фронтенд шлёт `model`/`resolution`/`aspectRatio` (НЕ photoModel/photoResolution/photoAspectRatio)

## AI Agent + Sound Studio + Voice Input (2026-04-17) -> MEMORY-ARCHIVE
- AI Agent: Simple (Haiku) / Advanced (Sonnet), chatHistory JSON per-session, prompt transfer
- Sound Studio: suno.ts, 13 Ss*, wavesurfer.js. MusicPersona voice clone. 8 enhance modes
- Voice Input: useVoiceInput, Whisper STT, ~$0.006/мин. AppConfig openai_api_key

## Reference System v2 (2026-04-19)
- **CharacterImage** — модель: неограниченная галерея фото на персонажа (isMain, sortOrder, source, description)
- **SharedCharacterCarousel** + **SharedRefModal** — общие компоненты (src/components/shared/)
- **@CharName автокомплит** в VsRichPrompt. Character Sheet: AI-генерация model sheet (4 views)
- **ВАЖНО:** Character.referenceMediaId/additionalAngles пока НЕ удалены из schema (backward compat)

## Prisma Migrations — КРИТИЧНЫЕ ПРАВИЛА (2026-04-20)
- **НИКОГДА** не использовать `db push` на dev-БД с историей миграций. Только `bunx prisma migrate dev --name описание`
- **НИКОГДА** не редактировать SQL файл миграции ПОСЛЕ apply (ломает checksum → drift)
- Если миграция упала "already exists" → `bunx prisma migrate resolve --applied имя_миграции` (НЕ правка SQL)

## Видео-сторис с текстом (ffmpeg overlay) — 2026-06-03
- **Цепочка:** чистое фото → Seedance оживляет → текст НАКЛАДЫВАЕТСЯ поверх видео статично (ffmpeg) → публикация VK+IG. Текст НЕ оживляется
- **"bake once":** текст вшивается в видео ОДИН раз перед циклом публикации, publishers НЕ трогаются, baked-видео переиспользуется
- **services/video-overlay.ts:** `overlayImageOnVideo()` — ffmpeg `scale2ref`+`overlay`, `-map 0:a?`, libx264 yuv420p +faststart. Порядок выходов scale2ref: `[ovr][base]`
- **scheduler.ts фикс:** догрузка mediaFiles + storiesOptions{skipOverlay} для scheduled STORIES

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
- Publishers: getPublisher(platform, {postType, config}) — VK гибрид (PMP по флагу viaPostmypost / direct), IG→PMP, TG
- Testing: Vitest, 167 tests, 15 files. Mock Prisma via vi.hoisted()
