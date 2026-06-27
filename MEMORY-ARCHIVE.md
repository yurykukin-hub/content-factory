# Content Factory — Memory Archive

Архив записей из MEMORY.md. Перенесены для соблюдения лимита 100 строк.

---
## Ключевые факты 2026-06-04 … 06-23 (перенесено 2026-06-27)
- [2026-06-23] **Сессия боевой отладки дайджеста (постинг вживую) — серия фиксов, ВСЁ В ПРОДЕ.** После включения промо Юрий постил вживую и ловил косяки; чинили итеративно (деплой по каждому, playwright/Read PNG для визуала, 260 тестов).
  - **Sonnet 4.6** (`anthropic/claude-sonnet-4.6`, та же цена $3/$15; был `claude-sonnet-4` deprecated 15.06). Заменено везде: `config.models.sonnet` (daily-digest через него), хардкоды в auto-poster/analyst-agent, MODEL_PRICING. + **вычитка** в промптах копирайтера/роли (фикс опечаток «едут/едят»). Смоук на проде ОК.
  - **Фото по ПАПКАМ Светы** (`detectRouteFolder` в daily-digest): маршрут определяется из ТЕМЫ поста (не photoKeywords — там «сап/скалы», а «Беличьи» в теме), `searchGalleryPhotos(routeFolder)` берёт фото ЖЁСТКО из папки маршрута. Папки: Беличьи/Монрепо/Место Силы/Закат/Тапиола/… (фикс: под «Беличьи» брал Монрепо).
  - **VK booking-ссылки → система бронирования** (AppConfig, без кода): `nawode_booking_base_url=https://erp.nawode.ru/booking.html?ref=` → VK-сторис кнопка ведёт на `?ref=bron_vk_storis`. **VK-пост** (лента): ссылка в текст `?ref=bron_vk_fotopost` (`vk_post_booking_url`, append в `adaptForPlatforms` + idempotent в `publish-runner` после UTM). **IG**: link в сторис через Postmypost НЕЛЬЗЯ (API только content+file_ids) → PLATFORM_RULES.INSTAGRAM обязывает «бронь в шапке профиля», без URL.
  - **Дизайн-сторис фиксы:** плашка погоды опущена (`top:64→230`, залезала под шапку соцсети); лого убрано (свои аккаунты); `cleanStoryTitle` (utils/story-title) убирает из заголовка градусы+«температура»→«погода»+ведущий день (агент лепил «Вторник +20°C — идеальная температура»); **анти-выдумка дня недели** в `hotSlotsBlock` — день словами кодом (LLM писал «четверг» для субботы 27.06).
  - **Дневная (слот-филл) сторис — БЕЗ скидки** (`role!=='day'` гард на promoBlock/promoBadge): горячий слот часто на ДРУГОЙ день/продукт (суббота, прокат на скале), а скидка вт/пт Выборг → агент приклеивал «−10%» не к тому. Скидки — в утренней (про сегодня) + ленте.
  - **Урок:** правки рендера/подбора применяются при ГЕНЕРАЦИИ — старые предложения в /digest не перерисовываются; после деплоя ОБЯЗАТЕЛЬНО перегенерировать, иначе «не поменялось». + дизайн-сторис проверять визуально (Read PNG/playwright), не по тексту в БД.

- [2026-06-23] **Фаза 3 промо (этапы 1-2) — В РЕПО, НЕ задеплоено (ждёт команду). Анонс ДЕЙСТВУЮЩИХ скидок + погодный flash в дайджесте.** План `~/.claude/plans/robust-scribbling-harp.md` (Фаза 3). 250 тестов (+44 к 206), typecheck-дельта 0, миграций нет, прод-ритм не тронут (всё за opt-in флагами, default off). 6 коммитов.
  - **`getActiveDiscounts(onDate?)`** (`nawode-data.ts` + DataSourceAdapter): 3 источника ERP read-only — `price_lists.discount_days` (скидки по дням, прокат −10% вт/пт), `service_slot_overrides.discount_price` (разовые Светы), `promo_codes` (помечены note — анонс по решению; ЙОГА5/VYBORG5 партнёрские 5%). Pure-мапперы + `dayOfWeekOf` (UTC getDay 0=вс, сверено с pg dow + ERP). Деньги в копейках. Смоук на боевых: вт→прокат −10%+промокоды, пн→отфильтровано.
  - **`getRedLine(...)`** (`services/promo/red-lines.ts`, чистый, переиспользуем Sales Bot): красные линии плейбука — `mass` −40% потолок / `fill` добивка (RENTAL 75/WALK 80/SUNSET 88/BREAKFAST 70/TOUR 87, тур на переходе ступени 4-й/8-й→75). `redLineCategoryOf` (productId>label>serviceType: WALK дробится на прогулку/закат/завтрак) + `isDiscountWithinRedLine`/`clampDiscountToRedLine`.
  - **Подача (этап 1 = ТОЛЬКО существующие скидки, без flash):** `services/promo/promo-block.ts buildPromoBlock` форматирует скидки→блок промпта (промокоды по умолчанию НЕ анонсирует; getRedLine sanity-метит ⚠ глубже −40%). `promoBlock` прокинут в `DigestContext`+role-story/strategist (через `{...ctx}`). Сбор под флагом: вечер→скидки на завтра, иначе сегодня. **Анти-галлюцинация:** «упоминай ТОЛЬКО скидки из блока, не выдумывай %/цены». Слабый −10% не выносим в отдельный пост ленты. Q2 (куда подавать) — на моё усмотрение (Юрий спал): утро мягко + день добивка + лента опц., 4-ю сторис НЕ плодим.
  - **Этап 2 погодный flash (ПОЛУ-РУЧНОЙ, решение Юрия):** `services/promo/weather-flash.ts evaluateWeatherFlash` (pure) — triggered при тепло+штиль+сухо И день свободен (мало броней); глубина обрезается getRedLine (mass −40%). CF только ПРЕДЛАГАЕТ flash-сторис (`runFlashStory`+`buildFlashStoryPrompt`, рубрика 'акция'), reasoning несёт ⚠-инструкцию «заведи скидку в ERP ДО публикации» (CF read-only, не пишет). В утреннем прогоне под `digest_flash_enabled` (дедуп общий с morning, раз/день). Пороги/глубина — AppConfig `digest_flash_{min_temp,max_wind,max_precip,percent,max_bookings}` (дефолты 18°/7мс/1мм/−25%/≤5). Смоук: распогодилось+свободно→−25%; холод/дождь/распродано→молчит; −90%→обрезано до 40%.
  - **Фиксы по боевому фидбеку (задеплоено, digest_promo_enabled ВКЛ на проде):** (1) промо-подача усилена — роли morning/day ОБЯЗАНЫ вплести скидку дня в текст (была мягкая «можешь» → агент пропускал −10%); (2) **скидка теперь НА КАРТИНКЕ дизайн-сторис** — `buildPromoBadge`→белая плашка «Прокат −10% · 900₽» над заголовком в `buildStoryDesign` (раньше скидка жила в `proposedText`, который в сторис НЕ виден — поймал Юрий; проверил визуально через рендер PNG + Read). `RenderStoryOpts.promo` во всех 3 рендерах (role/feed/flash); badge детерминирован из ERP (не AI). (3) **фикс бага «одни фото 3 дня»** — `getRecentlyUsedPhotoIds(10д, разворот baked→sourceMediaId)` сеет excludeIds во ВСЕ генераторы + within-run накопление общим Set + fallback на повтор если дедуп исчерпал кандидатов (иначе сторис без фото). 254 теста.
  - **Полировка дизайн-сторис (2-й раунд фидбека, задеплоено):** (1) **лого убрано** из baked-сторис (`buildStoryDesign` — для своих аккаунтов лишнее; logoUri в opts оставлен для обратимости); (2) **температура только в виджете** — `stripTemperature()` программно вырезает «+20°C» из заголовка (агент упрямо дублировал мимо промпта → конфликт с виджетом +21°); (3) нарисованный CTA «· nawode.ru» оставлен (нужен для IG, где ссылка некликабельна) + **пометка в превью `/digest`** «В VK добавится живая кнопка Забронировать» (VK сторис: нативная кнопка через `link_url`, нарисованный текст — указатель для IG). Все правки проверены ВИЗУАЛЬНО (рендер PNG + Read), не только по БД.
  - **Включить (без передеплоя):** AppConfig `digest_promo_enabled=true` (этап 1) + `digest_flash_enabled=true` (этап 2). **Отложено:** этап 3 — CF сам пишет скидку в ERP при одобрении flash (нужен endpoint `POST /flash-discount` в nawode-erp, другой репозиторий — отдельная сессия, ERP сам найдёт слот). **Фаза 4** (конкуренты VK + доска вдохновения IG) — нужны handles/ссылки Юрия.
- [2026-06-22] **SMM-ритм + фиксы постинга — В ПРОДЕ + ритм ВКЛЮЧЁН + проверено вживую** (план `~/.claude/plans/robust-scribbling-harp.md`). 3 фазы, 204 теста, typecheck-дельта 0, миграций нет. Коммиты: hashtag-fix+vk-button, getHotSlots, rhythm-engine.
  - **Ф0 баги:** (A) дубль хэштегов — `utils/hashtags.stripInlineHashtags` (URL-фрагмент-safe, ловит смешанные `#НаWоде`) применён в дайджесте (копирайтер/adapt/single-shot) + **защитный чокпоинт в `publish-runner`** (стрипает текст ТОЛЬКО если массив тегов непустой → ручные посты с тегами в теле целы) + IG-кап 5 + копирайтеру запрещён инлайн-`#`. (B) VK-кнопка брони в сторис из дайджеста — `auto-post.ts approve-publish` для VK+STORIES авто-резолвит ERP-ссылку (`getBookingLinks`, scope story+vk→vk→story), graceful.
  - **Ф1 слот-филл:** `nawode-data.getHotSlots(daysAhead)` — CTE по bookings (статус NOT IN CANCELLED/PROBLEM) GROUP BY date+time+product; вместимость best-effort из `service_slots.max_clients` (match по product_id + **фолбэк по service_type** — у проката product_id NULL в 96/104 слотах). Чистый `mapHotSlotRows` (map/filter/sort: есть люди И есть места; ближайший день→групповые форматы→почти-заполнен) — юнит-тесты. В `DataSourceAdapter` (types/nawode/null). Прод-смоук: 6 слотов, прокат 8:00 = занято 2/9, остаток 7.
  - **Ф2 ритм-движок (правка Юрия — НЕ пачкой утром):** 3 прогона/день по ролям (утро=погода+слоты+бронь, день=слот-филл из СВЕЖЕГО getHotSlots, вечер=рекап+завтра), КАЖДЫЙ генерит в своё время по свежим данным. `checkAndRunDigestRoles` (opt-in `digest_roles_enabled`, per-slot дедуп `digest_last_run_<role>`), `runRoleStory` (1 Sonnet стратегия+копия → арт-директор → satori-дизайн). Лента в утреннем прогоне на feed-день (`digest_feed_days`). Легаси единый дайджест НЕ тронут (гард `if digest_roles_enabled return`). `buildDigestRoleStoryPrompt`.
  - **Включено конфигом (без передеплоя):** `digest_roles_enabled=true`, слоты 04/10/16 UTC (=07/13/19 МСК), `digest_feed_days=1,2,3,4,5`. Тест-прогон утра вживую → сторис «+24°C, ясно, штиль… прокат в 8:00 уже стартовал, присоединяйтесь!» (реальная погода+горячий слот) + лента «SUP как кардио».
  - **Промо отложено (Ф3 автопостинг скидок+погодный flash / Ф4 конкуренты+доска вдохновения):** механики/экономика/красные линии зафиксированы — `docs/nawode-promo-playbook.md` + ADR `~/.claude/knowledge/decisions/2026-06-nawode-promo-mechanics.md`. Скидки УЖЕ в ERP (`price_lists.discount_days`=[5,2] вт/пт, `service_slot_overrides.discount_price`, `promo_codes`). Оплата инструктора в `compensation_rules` → закат +2250₽/доп.чел, тур +3600₽ внутри ступени; массовый потолок −40%.
  - **🔴 Проверить руками (за Юрием, необратимо):** реальная публикация сторис из дайджеста в VK (нативная кнопка «Забронировать») + тест-пост (один набор хэштегов, IG ≤5).
- [2026-06-22] **Боевой тест дайджеста (Юрий постил из дайджеста) → план доработок.** План новой сессии: `docs/plans/2026-06-22-smm-rhythm-and-fixes.md`. Нашли вживую: **(A) дубль хэштегов** VK+IG — AI инлайнит теги в текст, а паблишер клеит ещё и массив `version.hashtags` (подтверждено: body заканчивается тегами + массив сверху). Фикс: strip инлайн-тегов из AI-текста (массив=источник правды) + IG кап 5 (лимит IG с 12.2025). **(B) VK-сторис без живой кнопки** из дайджеста — `auto-post.ts approve-publish` шлёт `storiesOptions={skipOverlay}` без linkUrl. Фикс: VK+STORIES авто-подставлять «Бронь ВК Сторис» (getBookingLinks scope story+vk). **Ритм (решение):** 3 сторис/день (утро погода+слоты+кнопка / день слот-филл / вечер рекап) + лента 5-6/нед из реального материала, Reels приоритет, «нет кадра — пропуск». **Слот-филл** (ради денег): туры где УЖЕ есть люди → max загрузка (`getHotSlots` из `service_slots`+`bookings`, паттерн `getBookingRoiByRef`). **IG-конкуренты:** автомониторинг нельзя → «доска вдохновения» (ручной рилс → AI-разбор) + тренд-ресёрч. VK-мониторинг есть, расширить.
- [2026-06-21] **SMM-петля Фаза 1 (ROI до денег) — CF читает реальные брони из ERP. КОД ГОТОВ, НЕ задеплоено (ждёт команду).** Разведкой выяснено: атрибуция ДВУХуровневая — `referral_source` (ссылка/канал) РАБОТАЕТ + деньги джойнятся (`payments`, логика `isSettledPayment` 1:1 с ERP: исключаем онлайн pending/canceled, возвраты минусуем); `utm_data`/postId НЕ долетает (живая БД: `with_utm=0` у всех) — `embed.js` не пробрасывает utm родителя в iframe → это Фаза 2. Сделано: `nawode-data.getBookingRoiByRef(start,end)` (брони/гости/bookedKopecks/paidKopecks по referral_source, CTE settled-платежей); `routes/analytics.ts /overview` → блок `bookingRoi` (gate `erpType='nawode'` + helpers `prettyRef`/`channelOfRef`); `AnalyticsView.vue` секция «Брони и доход из ERP» (4 KPI + таблица по источникам, `formatRub`); агент-аналитик (`analyst-agent.ts`) получает `реальные_брони_erp` в контекст+промпт. **Bonus-фикс:** `nawode-data` → lazy `await import('bun')` + `import type` (top-level `import {SQL} from 'bun'` роняло vitest) → починены 8 давно падавших тест-файлов, **185 тестов зелёные** (было 97). typecheck delta 0. TODO: деплой (по команде Юрия) → playwright smoke `/analytics` → обновить CLAUDE.md. Развилка «атрибуция до конкретного поста» = Фаза 2 (проброс utm в embed.js / прямые erp-ссылки). План: `~/.claude/plans/nawode-erp-metrika-prompt.md`.
- [2026-06-21] **Сессия «дайджест + постинг до боевого» — 4 блока В ПРОДЕ + проверено playwright.** Деплой ок, 185 тестов, миграций нет (схему CF не трогали). Коммиты: digest-fix, video-upload, booking-links, stories-ui, gitignore.
  - **Дайджест больше не зацикливается (Блок 1):** причина — анти-повтор `recentSummary` читал только одобренные `db.post` (юзер их не одобряет → сигнал пуст каждый день) + не было температуры. Фикс: стратегу подаётся `recentProposals` (AutoPostTask за 7 дней, ВСЕ статусы) + секция «уже предлагалось, дай другое» + ротация рубрик + `temperature: 0.9` (добавлен проброс в `aiComplete`/openrouter). Затронуты `daily-digest.ts`, `prompt-builder.ts`, `openrouter.ts` (+ fallback runSingleShot). **Проверять:** /digest пересоздать → темы должны отличаться.
  - **Большие видео грузятся до 500 МБ (Блок 2):** причина — `MAX_FILE_SIZE=100МБ` + дефолт Bun `maxRequestBodySize` 128МБ + двойная копия файла в памяти (`Buffer.from(arrayBuffer())` поверх blob) при 1ГБ Docker → рилз/видео туров отваливались. Фикс: `index.ts` maxRequestBodySize=600МБ; `media.ts` MAX_FILE_SIZE=500МБ + стриминг `Bun.write(blob)` (убрана 2× копия), thumbnail из файла; `video-thumbnail.ts` fast-seek (`-ss` ДО `-i`)+30с+`-threads 1`; Docker backend память 1→2ГБ. Чинит загрузку ВЕЗДЕ (сторис/рилз/клипы/посты — один эндпоинт). Caddy лимита тела НЕТ (проверено).
  - **Готовые ссылки из НаWоде ERP (Блок 3, LIVE):** новый `GET /api/businesses/:id/booking-links` читает таблицу `booking_links` nawode ERP (id,name,ref) → `{label,ref,url,scope}` (scope из названия: story/vk/instagram/cert), URL из базы `nawode_booking_base_url` (AppConfig, дефолт `https://nawode.ru/?ref=`). Fallback на `BrandProfile.links`. `nawode-data.getBookingLinks()`. Проверено live: 46 ссылок, «Бронь ВК Сторис»→scope[story,vk], авто-подстановка в редакторе работает. **URL-формат дефолтный — Юрий подтвердит/поправит в Settings (без передеплоя).**
  - **Редактор Stories модернизирован (Блок 4, LIVE):** `StoryEditorView.vue` приведён к новому UI. Раскладка 12-кол: слева редактирование (медиа/холст/текст/музыка/ссылка), справа sticky — **превью «как в соцсети» табы VK/IG** (`StoriesPreview`) + единая **«Опубликовать ▾»** (Сейчас/Запланировать/Черновик). Убрана старая Preview Modal (рендер canvas/видео теперь прямо при публикации, без промежуточного previewBlob). Ссылка-карточка = дропдаун ERP-ссылок + авто-дефолт «Бронь ВК Сторис» для VK. Ядро (canvas drag/zoom, видео-сторис+музыка, baked `isBakedStory`, AI image/video, SSE) сохранено. Проверено playwright на проде: baked (холст скрыт) + не-baked (холст рендерит фото+текст) оба ок, дропдаун публикации открывается, консоль чистая (только штатный SSE-реконнект).
  - **Открыто:** реальный клик «Опубликовать» в VK/IG из нового редактора (UI отрендерен, но публикацию в соцсеть не жал — за Юрием); дропдаун ERP-ссылок в обычных VK-постах (`PostEditorView`, эндпоинт готов) — по желанию.
- [2026-06-12] **Сессия «продакшн-разворот»: ночные фиксы + конкуренты + дизайн-слой + дайджест — ВСЁ В ПРОДЕ.** (`feature/cf-night-1` + `feature/cf-design-layer` → слиты в `main`, задеплоено 2 этапа, origin/main в синке). Статус/план/next-шаги: `~/.claude/plans/refactored-baking-kahan.md` (раздел «Статус»).
  - **Ночные фиксы:** баг экспорта сторис = НЕ было CORS на `/uploads` (canvas tainted → SecurityError) → добавлен `Access-Control-Allow-Origin` (`app.ts`); + `document.fonts.ready` + `onerror` (StoryEditorView). Автосейв мастер-текста в PostEditorView (debounce 1.5с, флаш при уходе, `savePost(silent)`). `/ai/hashtags`+`/ai/rewrite` реализованы (были 501). Чистка: удалены CalendarView (роут-призрак) + SsModeTabs (мёртвый); console.*→logger (vk/vk-oauth/scheduler).
  - **Конкуренты-MVP (прод, работает LIVE):** `CompetitorAccount`/`CompetitorPost` (миграция `20260612032421` применена), `competitor-poller.ts` (VK `wall.get` тем же app-токеном — scope НЕ нужен; ER; виральность ER≥медиана×2, истинная медиана), хук в scheduler (03:30 UTC, opt-in `competitor_monitor_enabled`). Сид `seed-competitors.ts` = 8 SUP-пабликов (ЛО/СПб/Карелия) + включил модуль. **Live: токен авто-рефреш, 235 постов, 26 виральных.** IG/TG-мониторинг НЕ делаем (серо).
  - **Единый дизайн-слой (Фаза 1, прод):** `design-layer.ts` + `POST /media/bake-design-layer` (фото→`sharp.composite` EXIF-aware, видео→ffmpeg+опц.муз); фронт `useDesignLayerCanvas.ts` + `DesignLayerEditor.vue`; вход Медиатека→«Дизайн-слой». `/overlay-video` (сторис) НЕ тронут. ⚠️ **Нужен живой визуальный тест** (canvas-UI залит в прод, глазами не проверен). TODO: интеграция в композер постов + бренд-кит шаблоны.
  - **Дайджест UX:** даты; одобренные НЕ исчезают (бейдж «Черновик создан» + «Открыть»); отклонённые → сворачиваемый архив + «Вернуть» (`POST /auto-posts/:id/restore`); блок «Вдохновлено у конкурентов» (`GET /auto-posts/competitor-inspiration`); `GET /auto-posts` multi-status (`?status=proposed,approved`). **TG-бот одобрения НЕ включён** (нет токена) — работаем в UI `/digest`.
  - Opus code-review пройдено (фикс бага медианы для чётной длины + owner_id fallback + UTC-дедуп). 178 тестов.
- [2026-06-06] **Проактивность (утренний дайджест → TG/MAX) — СТАТУС:** Дайджест-агент РАБОТАЕТ (`digest_enabled=true`, 04:00 UTC=07:00 МСК, отрабатывает — 14 `proposed` накопилось в `/digest`). **Доставка/пинг в Telegram: код готов (`sendApprovalToTelegram`, graceful), но ДОРМАНТ — НЕТ `telegram_approval_bot_token`+`telegram_approval_chat_id` в AppConfig.** Активировать = бот в @BotFather + chat_id (2 мин Юрия) → утром агент пишет в TG. **MAX (мессенджер): НЕ реализовано** — нужен отдельный адаптер по образцу `telegram-approval.ts`. Итог: проактивность-генерация ✅, проактивность-пинг ⚠️ (висит на токене). 14 непрочитанных идей в UI = симптом отсутствия утреннего пинга.
- [2026-06-06] **Метрика финал + находка про бронь:** токен read+**WRITE** подтверждён (создание/удаление целей работает; Yandex API нюанс: DELETE цели = `/counter/{id}/goal/{id}` ЕД.ч., список/создание = `/goals` мн.ч.; auth `OAuth {token}`). **Счётчик 92916147 стоит ТОЛЬКО на nawode.ru, НЕ на `erp.nawode.ru`** (0 pageviews по booking) → конверсию «бронь» Метрика напрямую не видит (кнопки брони → внешний `erp.nawode.ru/booking.html`). **Нужен счётчик НА виджете** → заход в nawode-erp (промпт `~/.claude/plans/nawode-erp-metrika-prompt.md`: счётчик+cross-domain+цели-шаги+Webvisor). Интерим-конверсия НаWоде = звонок 294764085 + мессенджер 290266307 (booking-intent). yclients убран со ВСЕХ 14 страниц сайта (со Светой) → везде свой ERP-виджет.
- [2026-06-05] **Per-business Метрика** (Business.metrikaCounterId/metrikaGoalIds + AppConfig metrika_token_{id} секрет → глобальный fallback; убран хардкод DEFAULT_COUNTERS) + код-ревью (фикс H1/H2 collector VK-via-PMP; **C1 security pre-existing: `GET /businesses/:id/platforms` отдаёт accessToken во фронт → нужна маска, BusinessDetailView.vue:246**) + сайт nawode.ru на свой ERP-виджет (yclients убран, 14 страниц). Полные детали → MEMORY-ARCHIVE.md + CLAUDE.md.
- [2026-06-04] **Полировка:** VK фото/стена через Postmypost (generic PostmypostPublisher, обход scope photos, PMP-токен в .env.prod) + недельный аналитик вкл + арх-долг B снят (strategy-as-data Rubric/Occasion в БД + services/datasource/ DataSourceAdapter). Полные детали → MEMORY-ARCHIVE.md + CLAUDE.md.


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
