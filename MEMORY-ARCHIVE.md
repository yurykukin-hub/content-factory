# Content Factory — Memory Archive

Архив записей из MEMORY.md. Перенесены для соблюдения лимита 100 строк.

---

## Ключевые факты 2026-06-03 … 06-08 (перенесено 2026-06-21)
- [2026-06-04] **SMM-аналитика (Эпик B Phase 4+5) — в проде.** Миграция `20260604185535_add_smm_analytics` (4 модели). `services/analytics/` + `metrics-poller.ts` (2×/день) + `routes/analytics.ts` + `AnalyticsView.vue`. ADR `decisions/2026-06-smm-analytics-architecture`.
- [2026-06-04] **Postmypost analytics:** `/analytics/publications` → analytics{likes,shares,engagements,views,reach,er}. Джойн: `externalPostId`→`GET /publications/{id}`→`external_id`(IG media). PMP accounts проекта 347349: VK НаWоде=2164096, IG nawode.ru=2163599, IG yurykukin=2163523.
- [2026-06-04] **VK-метрики:** `wall.getById` требует USER-токен (community→error 27); `ensureValidToken()` авто-рефреш. `stats.get`/`stories.getStats`→scope `stats`. CF VK-контент=СТОРИС, статы ~24ч. Счётчик nawode.ru=92916147.
- [2026-06-04] **ИНЦИДЕНТ:** `docker compose up` из dev-папки уронил прод-БД (общий compose-проект по basename). Правило: dev-БД только standalone `docker run --name cf-dev-pg -p 5441:5432`, НИКОГДА не compose из dev-папки.
- [2026-06-03] Instagram через **Postmypost** (не Meta Graph). API base `https://api.postmypost.io/v4.1`. Upload byFile (init→S3→complete→poll). type POST=1/STORY=2/REELS=4. PlatformAccount: accessToken+accountId+config.postmypostProjectId.
- [2026-06-03] НаWоде каналы: IG @nawode.ru (2163599) + VK NAWODE (group 150371202). PlatformAccounts: pmp_ig_nawode, pmp_ig_yurykukin, vk_personal_yurykukin.
- [2026-06-04] **Отложка сторис (A1):** `PostVersion.publishOptions Json?` = {skipOverlay,linkText,linkUrl,photoPosition,musicSessionId?}. `/schedule` принимает storiesOptions. **A2:** isPublished только PUBLISHED, isScheduled отдельно.
- [2026-06-04] **Утренний AI-агент (Эпик C):** `daily-digest.ts` (Sonnet) + DataSourceAdapter. Триггер scheduler 04:00 UTC. `AutoPostTask(source='digest')`. Approve→черновик Post. UI `/digest`.
- [2026-06-04] **Музыка в видео-сторис (A4):** `overlayAudioOnVideo()` (ffmpeg -shortest). Нативную музыку VK/IG сторис через API нельзя — вшиваем.
- [2026-06-04] **Все форматы:** `PostType.CLIPS`. VK клипы=вертикальное видео (нет публичного API Клипов). IG REELS+CLIPS→PMP type=4.
- [2026-06-04] **ИНЦИДЕНТ:** `bun file.js` с TS-синтаксисом (`as any`) крашит Bun. Скрипты для `bun file.js` = чистый JS ИЛИ `.ts`.
- [2026-06-04] **Интеллект контент-плана (Эпик D):** `generate-plan` подставляет рубрики/поводы из БД; `buildPostPrompt` анти-повтор (8 постов); `POST /plan-items/:id/regenerate`.
- [2026-06-06] **FIX зависание видео-генерации:** `/ai/generate-video` не оборачивал `createVideoTask()` в try/catch → сессия навсегда `generating`. Урок: все 3 студии откатывают статус при ошибке KIE. Баланс KIE: `GET /api/v1/chat/credit`.
- [2026-06-08] **FIX Cataloger EROFS:** `photo-cataloger.ts` писал в read-only `/app/google-photos` → `THUMBS_DIR`→`/app/uploads/.google-photos-thumbs`.
- [2026-06-05] **Метрика:** OAuth-токен в AppConfig `metrika_oauth_token`. Per-business: `Business.metrikaCounterId`+`metrikaGoalIds` + `metrika_token_{id}`. НаWоде счётчик 92916147, цель РАСПИСАНИЕ 302969632 (booking-intent). Счётчик на nawode.ru, НЕ на erp.nawode.ru.
- [2026-06-05] **VK ре-авторизация:** scope `stats`/`photos` требуют модерации VK-аппа. `photos` обойдён через Postmypost. Пост-метрики VK через `wall.getById`.
- [2026-06-06] **Метрика WRITE подтверждён** (цели: DELETE `/goal/{id}` ед.ч., создание `/goals` мн.ч.). yclients убран со всех 14 страниц nawode.ru → свой ERP-виджет `erp.nawode.ru/booking.html?ref=X&serviceType={WALK|TOUR|RENTAL|LESSON}&productId=Z`.

---

## Архив: базовые факты + сторис-сессия 2026-06-03 (перенесено 2026-06-04)
- [2026-04-05] Порты: backend :3800, frontend :5176, postgres :5441 (актуально в CLAUDE.md)
- [2026-04-05] Brand color: Fuchsia/Magenta (#d946ef)
- [2026-04-05] AI: OpenRouter (Haiku для адаптации, Sonnet для генерации)
- [2026-06-03] Фикс vk.ts: `import('../vk-oauth')` (был `../services/vk-oauth` — неверный путь). VK сторис на ЛИЧНУЮ страницу работают (publishStory без group_id)
- [2026-06-03] Тест VK+Instagram сторис одновременно из CF — успешен (VK личная 77596 + IG @yurykukin 2163523)
- [2026-06-03] UI-мультипостинг в StoryEditorView: чипы каналов VK+IG (selectedChannels[]), per-канал try/catch, готовый сторис сохраняется в медиатеку (тег 'story'), ensureVersion find-or-create
- [2026-06-03] Текст на сторис вшивается в картинку (canvas/sharp) → идентично VK+IG. Кнопка-ссылка: VK нативная, IG через Postmypost не гарантирован
- [2026-06-03] Редизайн модалки «AI Видео» в StoryEditor: автоподхват фото (img2video), «Оживить» (describe-image→agent-chat), встроенный VsAgentChat. Async через GenerationSession+SSE, sessionStorage переживает F5
- [2026-06-03] VK сторис в группу работает (publishStory с group_id, юзер-токен админа). Фикс vk.ts: безопасный JSON.parse upload-ответа
- [2026-06-03] Дизайн сторис без нейронок: sharp-композиция (фото-кроп + панель + CTA + бейдж). Nano Banana НЕ годится для текстовых сторис (кривой русский). Паттерн: docker exec backend bun /app/story_gen.js

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

## Архив 2026-06-04 (polish-сессия — перекрыто consolidated-записью в MEMORY)
- [2026-04-05] VK фото-постинг: Community Token error 27 → нужен User Token через OAuth. (Решено обходом через Postmypost — см. MEMORY.)
- [2026-06-04] VK фото на СТЕНУ диагностика: community→error 27, app-user-token→error 15 (нет scope photos). Обход — Postmypost (реализовано в polish-сессии). Сторис VK работают напрямую (community умеет stories, не wall-photos).
- [2026-06-04] Рефактор редактора Эпик A Фаза 4: PUT/DELETE /post-versions/:id (per-channel оверрайд, 409 PUBLISHED/SCHEDULED) + превью-компоненты components/posts/preview/* + usePlatformRegistry. effectiveText: черновик→оверрайд→мастер. (Детали в CLAUDE.md.)
- [2026-06-04] Рефактор редактора Эпик A Фазы 2/3/5 + UTM: одноколоночный композер, usePlatformLimits, createModal+CreateContentModal, Идея→Пост, utils/utm.ts+publish-utm.ts. (Детали в CLAUDE.md.)
- [2026-06-04] Пресеты сторис A3: StoryTemplate businessId nullable + isSystem + textAlign/bgRadius, 5 системных пресетов (seed-story-presets.ts).
- [2026-06-04] SMM-аналитика «на будущее» — реализовано в build-сессии (см. ADR + MEMORY Эпик B Phase 4+5).
- [2026-06-04] Авто-импорт ERP-событий D: NAWODE_EVENTS + getEventsInRange/getBookingsInRange. Перекрыто strategy-as-data (Occasion в БД + services/ai/strategy.ts getOccasionsInRange).

## Архив из «Ключевые факты» (перенесено 2026-06-22)
- [2026-06-05] **Автономная сессия (per-business Метрика + код-ревью + сайт-уборка):**
  - **Per-business Метрика-архитектура:** `Business.metrikaCounterId` + `metrikaGoalIds` (БД) + токен AppConfig `metrika_token_{businessId}` (СЕКРЕТ) → глобальный `metrika_oauth_token` fallback. Убран хардкод `DEFAULT_COUNTERS`. `metrika-adapter.getMetrikaToken/getMetrikaConfigForBusiness`. Migration `add_business_metrika_config`. Онбординг = поля Business, не код. НаWоде засижен (92916147 + цели 294764085/290266307). Коммиты ea02d50+e016783.
  - **Код-ревью:** фикс **H1/H2** (collector.ts VK-via-PMP: нерезолвленные refs отбрасываются + ошибка при пустом `POSTMYPOST_API_TOKEN`). **M4** дайджест `erpType:{not:null}`. **C1 (SECURITY, pre-existing):** `GET /businesses/:id/platforms` отдаёт `accessToken` во фронт → нужна маска (`BusinessDetailView.vue:246`).
  - **Сайт nawode.ru:** yclients убран (14 страниц) → свой ERP-виджет `erp.nawode.ru/booking.html?ref=X&serviceType={WALK|TOUR|RENTAL|LESSON}&productId=Z`. Продукты: RENTAL=cmnmf7e4o…, WALK=tour-aroma/tour-vyborg-walk/tour-sunset, TOUR=tour-belichi/tour-sila/tour-monrepo, LESSON=tour-fountain-lesson. План: `~/.claude/plans/nawode-erp-metrika-prompt.md`.
- [2026-06-04] **Полировочная сессия:**
  - **VK фото/стена через Postmypost:** generic `PostmypostPublisher` (IG + VK-стена); `getPublisher` гибрид (VK+неSTORIES+`config.viaPostmypost`→PMP обход scope photos; VK+STORIES→прямой VK). НаWоде `config={viaPostmypost:true,postmypostAccountId:2164096}`. PMP-токен в `.env.prod` (НЕ config). Коммиты 0299d95+a9eec46.
  - **Аналитика:** недельный агент вкл (`analytics_agent_enabled=true`, Mon 06:00 UTC). VK-статы/Метрика gated.
  - **Арх-долг B СНЯТ (4a0f822):** strategy-as-data (Rubric/Occasion в БД + `services/ai/strategy.ts` + сидер) + `services/datasource/` (DataSourceAdapter+NawodeErpAdapter+Null). 167 тестов.

---

# Архив сессий 06-19/06-20 (вынесено из MEMORY.md 2026-06-27)

## СММ-петля НаWоде — оживление + дизайн-слой (2026-06-19, Фазы 0–2c.1, прод, ~18 деплоев)
**Диагноз:** машинерия крутилась, но постинг встал (последний 11.06 — 8 дней тишины). Корень — человеческое звено: предложения без визуала (0/34 задач с фото) + нет пуша. Чинили это, не код-машинерию.
- **Ф0 «зрение» галереи:** vision `gemini-2.5-flash-lite` (тест на реальных фото: qwen зацикливается, lite быстрее/дешевле flash). `config.models.vision`/`visionFallback`. `buildGalleryVisionPrompt` (RU, сплошной текст). Авто-describe при загрузке: `services/image-describer.ts` поллер (флаг `aiModel='describe_pending'`→altText; `describe_failed` не ретраит). `batch-describe.ts`. Галерея **499/499 описаны**. Поиск `/media/library` OR filename+altText+tags.
- **Ф1 команда агентов:** `daily-digest.ts` 1 Sonnet → **стратег→копирайтер→арт-директор**. Арт-директор: `searchGalleryPhotos(keywords)` по altText → `mediaFileId` (null если нет). Fallback `runSingleShot`. Промпты `buildDigest{Strategist,Copywriter,ArtDirector}Prompt`. `AutoPostTask.mediaFileId`; approve привязывает фото (`MediaFile.postId`). Авто-архив вчерашних. `PATCH /auto-posts/:id`. `GET /auto-posts`→media+previews.
- **Ф1.5 адаптация под соцсети:** стратег даёт channels[]; `adaptForPlatforms` (Haiku, `buildAdaptPrompt`) мастер→VK/IG версии в `AutoPostTask.adaptations` (Json, миграция `20260619082843`). approve→PostVersion per канал. UI превью «как в соцсети» (Vk/Telegram/InstagramPreview из композера, табы платформ) + лайтбокс фото.
- **Ф1.6/1.7 качество:** только PHOTO/STORIES (TEXT/видео убраны + нормализация формата на сервере). Подбор строже: ранжирование кандидатов по числу совпавших keywords, исключение `ai-generated` (42 генерёных фото помечены тегом — отличаем по GenerationSession), предпочтение «людей на сапах». Сторис: вертикальный `StoriesPreview` 9:16 (был как лента), чёткое фото (url не thumb 200px), короткий оверлей без ленточной адаптации/хэштегов. Дедуп фото (последовательно + usedMediaIds). Ветер словами (`windLabel`, не м/с — люди не парсят). approved свёрнуты в /digest.
- **Ф2a дизайн-слой (satori, НЕ Playwright — лёгкий, без Chromium, работает в Bun+Alpine):** `html-render.ts` (satori-узлы→SVG→`@resvg/resvg-js`→PNG; шрифты Montserrat/Cormorant из print-kit в `src/assets/fonts`; **satori-html НЕ работает в Bun → строим узлы через `el()` напрямую**). `design-templates.ts` `buildStoryDesign` (фото-фон + погодный виджет + заголовок + CTA + реальное лого; эмодзи стрипаются — satori их не рисует). `story-design.ts` `renderAndSaveStoryDesign`/`savePngAsMedia`. `POST /media/render-design` + кнопка «Оформить дизайн» в /digest + **авто-генерация в дайджесте** (STORIES→дизайн с реальной погодой из `getDailySummary`). `StoriesPreview` `baked`-режим. VK `link_text` нормализован к CTA-константам (`vk.ts`).
- **Ф2c.1 карусель-рендер:** `buildCarouselSlide` (4:5, cover/content/cta), `renderAndSaveCarousel`→серия PNG, `POST /media/render-carousel`. ТОЛЬКО рендер (UI создания/публикация серией/свайп-фото ещё нет).
- **Отложено/осталось:** Ф2b нано-банана дорисовка (отложил Юрий); Ф2c.2 свайп-фото, Ф2c.3 UI создания карусели + агент-слайды + публикация серией, Ф2c.4 VK `clickable_stickers` (авто хештег/упоминание); докрутка промптов ролей на горячую; авто-Telegram-пинг (Ф3, код готов, нужен токен+chat_id). **API-факт:** подписи к сторис в API НЕТ (ни IG, ни VK) — только вшитый оверлей + VK CTA-кнопка/стикеры. План: `~/.claude/plans/breezy-imagining-orbit.md`. 185 тестов.

## Медиатека UX-фиксы (2026-06-19, жалоба Светы «галерея падает при загрузке»)
- **«Падает» = две причины:** последовательная загрузка (`for…await`) без обработки ошибок + список без виртуализации (фриз на сотнях файлов). Чинили обе.
- **Надёжная загрузка:** `composables/useConcurrentUpload.ts` (worker-pool, лимит 3 — sharp/ffmpeg синхронны, бережём VPS от OOM). Прогресс «N/M», per-file ошибки (падение одного ≠ срыв пачки) + панель упавших имён, оптимистичная вставка. Backend upload: атомарный cleanup файла+thumb при ошибке `create`.
- **Производительность:** серверные `counts` в `/library` (убрали 3× O(n) `.filter()`); debounce фильтров 250мс; CSS `content-visibility:auto` на карточки (без virtual-scroll — для 5-10 юзеров хватает).
- **Поворот:** `POST /media/:id/rotate {angle}` — sharp `.rotate()`(EXIF) **затем** `.rotate(angle)`, перезапись оригинала+thumb, фронт cache-bust `?v=`. `/uploads/*` теперь с `Cache-Control: max-age=300`. Кнопки ↺/↻ в preview.
- **EXIF-баг:** thumbnail при загрузке теперь с `.rotate()` (фото с телефона не «на боку»).
- **Live-описание:** `image-describer` эмитит SSE `media_described` → MediaLibraryView обновляет altText/индикацию без F5 (спиннер «описывает»/«не удалось»+повтор). MediaPicker получил cursor-пагинацию («Показать ещё»).
- Доступ: рассинхрон БД↔диск при delete теперь логируется (`log.warn` сирот). План: `~/.claude/plans/stateless-splashing-starlight.md`.

## Инцидент: дайджест перестал подбирать фото (2026-06-20)
- **Симптом:** дайджест НаWоде создаёт предложения БЕЗ фото (`media_file_id=null` у всех), хотя 513/516 фото описаны. Вчера (до 16:00) работало.
- **Корень:** OpenRouter slug `anthropic/claude-3.5-haiku` маршрутизировался на **Amazon Bedrock**, где версия достигла **EOL → 404** («This model version has reached the end of its life»). Арт-директор (`pickPhotoForPost`) и `adaptForPlatforms` зовут Haiku → падали → `.catch(()=>null)` **молча** возвращал null. Sonnet (стратег/копирайтер) работал → идеи и тексты были, фото нет. В `ai_usage_logs` 0 Haiku-вызовов (падал ДО записи лога).
- **НЕ связано с деплоем галереи** — совпало по времени (Bedrock задепрекейтил модель в тот же день). Диагностика: репликация flow по шагам в контейнере — стратег OK → keywords OK (`["сапборд","замок"]`) → `searchGalleryPhotos` находит 50 → прямой вызов Haiku даёт 404.
- **Фикс:** `config.models.haiku` → `anthropic/claude-haiku-4.5` (актуальный Haiku 4.5, $1/$5; сверено с claude-api skill + эмпирически). Убран хардкод слага в `daily-digest.ts` (2 места → `config.models.haiku`). Обновлён `MODEL_PRICING` в `openrouter.ts`. **Все модели теперь только через `config.models`** — менять в одном месте.
- **Урок:** провайдерские EOL ломают ТИХО (`catch→null`, fallback на runSingleShot без фото). Кандидат на алерт: рост `ai_usage_logs.status≠success` или 0 вызовов ожидаемой модели за период.

## Stories: фикс дубля текста + прямая публикация из дайджеста (2026-06-20)
- **Дубль текста в редакторе:** baked-сторис (дизайн вшит satori, тег `story-design`/url `design_`) открывалась в древнем canvas-редакторе (`StoryEditorView`, 1717 строк), который рисовал `overlayText` (Post.body) ПОВЕРХ уже-вшитого текста → каша. Фикс: computed `isBakedStory` → НЕ рисуем canvas-текст (`drawScene`/`drawOverlayLayer` гейтят `!isBakedStory`), скрываем древнюю панель «Текст на фото» + zoom, статус-баннер «Готовая сторис», автосейв не трогает body, публикация baked = оригинал напрямую (без canvas re-encode, body не перезаписывается).
- **2 пути из дайджеста** (жалоба: одобрение всегда в тяжёлый редактор): `DigestView` split-кнопка «Опубликовать ▾» (Сейчас / Запланировать инлайн) + «В редактор» — ТОЛЬКО для готовых сторис (`canPublishStory` = STORIES + `isDesigned`). Модалка подтверждения (bottom-sheet, mobile-first). Секция «Опубликовано». Прочее (PHOTO/сторис без дизайна) — прежнее «Одобрить → черновик».
- **Backend:** `services/publish-runner.ts` — вынесены `publishPostVersion`/`schedulePostVersion` (ЕДИНЫЙ источник для роутов `publish.ts` И прямой публикации из дайджеста — чтобы 3 копии логики не разошлись). Endpoint `POST /auto-posts/:id/approve-publish {when,scheduledAt,platforms}` — `approveDigestTask` + publish/schedule версий, `skipOverlay:true` для baked, `assertBusinessAccess`. `AutoPostTask.status='published'`.
- Проверено playwright на проде (admin-токен через JWT_SECRET): дубля нет, split-кнопка работает, текст-панель скрыта. 185 тестов. План: `~/.claude/plans/` (нет, инлайн).

## Stories Ф2: корректировка кадра фото + UX публикации (2026-06-20)
- **Фото обрезалось неудачно** (объект уходил за кадр): satori `objectFit:cover` режет по центру. Добавлен `objectPosition` (вертикальный фокус) в `buildStoryDesign`/`renderAndSaveStoryDesign`/`render-design`. **objectPosition в satori РАБОТАЕТ** (проверено: top/bottom дают разный кадр). У НаWоде фото в основном вертикальные (~9:16) → ползунок мало двигает; эффект на горизонтальных/квадратных.
- **Модалка `StoryDesignModal.vue`**: ползунок вертикального фокуса + живое CSS-превью (`object-position` совпадает с satori) + правка заголовка → перезапекание. Кнопка «Поправить кадр» в дайджесте (split-блок STORIES) и в редакторе baked-баннере.
- **Переоформление из baked**: `MediaFile.sourceMediaId` (миграция `add_media_source_id`) хранит исходное фото. `render-design` детектит baked → берёт оригинал (не дизайн-поверх). Дайджест авто-запекание сохраняет `sourceMediaId`. Старые baked (до миграции) — без source, превью покажет baked (дубль) — норма для легаси.
- **БАГ-урок:** модалка с `v-if` + `:visible="true"` (константа) — `watch(visible)` БЕЗ `immediate` НЕ срабатывает на mount → `loadSource` не звался («нет фото»). Фикс: `{immediate:true}`. **Поймано playwright-проверкой на проде** (без неё уехало бы сломанным).
- **UX публикации** (было непонятно «в обе или раздельно»): модалка — галочки каналов (☑ VK·Stories ☑ IG·Stories, выбор куда), текст «сторис в каждый выбранный канал», кнопка «Опубликовать (N)», результат ✓/✗ по каждому каналу. Всё проверено playwright.
- **Публикация PHOTO из дайджеста** (2026-06-20): split-кнопка «Опубликовать» теперь и для PHOTO-постов (`canPublishNow` = STORIES+designed ИЛИ PHOTO+media), не только сторис. Модалка адаптирует тексты: «пост/сторис», «VK · Лента / Stories». «Поправить кадр» — только у дизайн-сторис. Backend `approve-publish` универсален (publishPostVersion для любого типа).
- **Drag-кадрирование** (2026-06-20): в `StoryDesignModal` ползунок (только вертикаль) заменён на **перетаскивание фото пальцем/мышкой по ОБЕИМ осям** (`objectPosition` X+Y). Touch+mouse listeners на window, `preventDefault` на touchmove (не скроллить), `onUnmounted` cleanup. Проверено playwright: drag сдвигает object-position 50%→80%/64%.
- **Медиатека — UX-сессия (2026-06-24, фидбэк Светы/Юрия)**: 6 фич (сортировка / drag-drop / большое превью / ориентация / multi-select / bulk-delete) + 3 итерации по фидбэку. **Уроки на будущее:** (1) `position: sticky` НЕ липнет, если реально скроллится `<body>`, а не контейнер с `overflow` — в app-shell (`App.vue`) внешний `min-h-screen` + `main.overflow-auto` при длинном контенте скроллит body → `sticky` привязан к неподвижному `<main>`. Решение: панель = `Teleport`+`fixed`-поп-ап (низ на мобиле — вверху `fixed` дёргается из-за мобильной адресной строки). (2) Фото «на боку» БЕЗ EXIF-тега ориентации авто-повернуть нельзя (нет сигнала; landscape-пиксели неотличимы от настоящего горизонтального). Авто-норм. в `POST /upload` работает только для EXIF orient>1 (jpeg/png/webp; HEIC — лишь thumbnail). Миграция `fix-orientation.ts` выпрямила 158 старых (все orient=6), идемпотентна. Pixel `.trashed-` файлы EXIF теряют → авто не помогает, только ручной ↺/↻. (3) Natural-sort по имени — КЛИЕНТСКИ (`localeCompare numeric`), серверный ICU-collation на колонке ломает ILIKE-поиск, а Prisma `orderBy` не умеет inline `COLLATE`. (4) Модель выделения: desktop = клик-выделяет (Проводник, индикатор — рамка `ring-4` без чекбоксов), mobile = тап-превью + long-press-выделение (с `@contextmenu.prevent` + `-webkit-touch-callout:none` против нативного меню), чекбоксы только в режиме выделения. (5) Set в ref ПЕРЕПРИСВАИВАТЬ (не мутировать) — иначе computed не пересчитывается.
