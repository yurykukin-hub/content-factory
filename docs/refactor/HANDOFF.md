# CF-рефактор — HANDOFF (передача в новую сессию)

_Обновлено 2026-07-04 (автономная сессия: закрыты долги C3). Оркестратор: Fable, effort high. План: `~/.claude/plans/goal-atomic-cake.md`._

## Что это
Полный рефактор Content Factory по 3 измерениям (ПРОДУКТ + UI + ЛОГИКА). North-star: **рабочий 2-клика автопостинг НаWоде** (дайджест предложил → правка на месте → чик → опубликовано). Сезон идёт — надёжность постинга критична. Осознанный большой рефактор (не Boy Scout).

## Статус фаз (всё в `main`, НЕ задеплоено)
- **Фаза A ✅** — дизайн-система: 18 UI-примитивов (`src/components/ui/`) + семантические токены (`tailwind.config.js`: success/danger/warning/info + brand=fuchsia) + a11y (focus-trap, ARIA, tooltips). Витрина `/ui-kit`. Донор был Tailwind v4, CF v3 (см. `lessons/01`).
- **Фаза B ✅** — боль №1: 5 запеканий → **один `OverlaySpec` (JSON на Post) + satori-рендерер** (`backend/src/services/overlay/render-overlay.ts`, `design-templates.ts buildStoryDesign`). Endpoint `POST /media/render-overlay` (бейкает из `sourceMediaId`, никогда design-over-design). Фронт `OverlayEditor.vue` + `useOverlaySpec.ts` → превью = реальный запечённый PNG (WYSIWYG). Проверено фото+видео. Baker #1 (`image-overlay.ts`) СНЕСЁН. См. `lessons/02`.
- **Фаза C2 ✅** — 4 бага: SCHEDULED-разблокировка (`PostEditorView`), лейбл gpt-image-2 (`PhotoStudioView`), видео-модель как param (`kie.ts`), дедуп фото дайджеста (`photo-search.ts`/`daily-digest.ts`).
- **Фаза C1 ✅** — кокпит **«Лента»** (`FeedView.vue`): слил Контент+Дайджест, `GET /feed` (реконсиляция+дедуп по postId), `canPublishNow` (backend, `can-publish.ts`), правка на месте (текст/фото/OverlayEditor), «Опубликовать сейчас ▾», `DigestSettingsModal` (вкл/выкл, утро/день/вечер, автопилот-тумблер `digest_autopilot_enabled`, дефолт OFF). Автопилот-проводка `publish-digest-task.ts`. Nav: «Дайджест»+«Контент»→«Лента»; мёртвые разделы (Идеи/Сценарии/Контент-планы) убраны из nav.
- **Фаза C3 ✅** — унификация 3 студий (Video/Photo/Sound) на общих composables (`useStudioSession`/`useStudioSSE`/`useElapsedTimer`) + чат-центричный `StudioChat` («Взять»→композер, убраны вкладки Агент/Редактор + Простой/Продвинутый) + `SharedEnhanceMenu`. Video сохранил @ImageN (`VsRichPrompt` целиком); FLUX убран из edit-image (→nano-banana). ≈−1821 стр, снесено 12-13 компонентов, 5 общих активов. Коммиты `5de9cd5`/`ede3b89`/`df96456`/`d01ec5e`/`d8efcb3`. Playwright+build ✓, StoryEditor не тронут. См. `lessons/03`.

## В работе / осталось
- **▶ СЛЕДУЮЩАЯ СЕССИЯ = Фаза D** (последняя крупная; готовый промпт для plan-режима: `docs/refactor/NEXT-SESSION-PHASE-D.md`).
- **🚫 ПРОД НЕ ТРОГАЕМ до конца Фазы D** (решение Юрия 04.07). Прод отстал с ~02.07 → `deploy.sh` выкатит ВЕСЬ рефактор (A/B/C/C3 + миграции БД), а не только фиксы; live-путь запекание→публикация вживую не обкатан. Деплой — ОДНИМ контролируемым событием ПОСЛЕ Фазы D: бэкап БД → тихое окно → сразу тест-пост в VK → откат наготове. В сезон мид-рефактор не катим.
- **✅ C-story ЗАВЕРШЕНО (4d332ef):** `StoryEditorView.vue` 1754→1241 стр — переведён на `OverlayEditor` (левая колонка = «Оформление сторис» = единый satori-модуль, превью=запечённый кадр). Canvas-запекание + `StoryDesignModal.vue` + `DigestView.vue` + `PostsView.vue` УДАЛЕНЫ. Публикация постит baked-медиа (`ensureBaked`, `skipOverlay` всегда). Проверено Playwright (рендер+консоль чистая, /posts→/feed редирект). **Боль №1 закрыта: 5 запеканий → 1.**
- **C3-долги — ЗАКРЫТЫ автономной сессией 2026-07-04** (5 волн, всё в `main`, НЕ задеплоено; docs `94adf80`): ✅ баг edit-image «Применить» (`6db4513`, Playwright: запрос `/ai/edit-image` уходит — раньше нет); ✅ 2 бэк-теста → зелёный сьют **361/361** (`7abc78a`, мок `db.post`); ✅ полиш меню «Улучшить» — иконки+описания восстановлены из git + порядок welcome (действие→настройки) + чистка Sound (`64fd016`); ✅ видео-модели — ресёрч+recipe (`docs/refactor/video-models-research.md`) + персист `model` в роуте (`c52afdb`). **Остаток:** реальная интеграция моделей (Kling 3.0 первым/Veo3 по recipe) ждёт **прод KIE-ключ** (у KIE нет catalog-API, dev-ключ пуст → живой прогон невозможен); субъективное на глаз Юрия — layout чата/композера Sound + Video pro-debug-readout (осознанно НЕ восстановлен).
- **Фаза D:** тултипы/хинты сквозняком (UiTooltip есть), распил god-компонентов (MediaLibrary 1265), удаление мёртвого кода (Ideas/Scenarios/ContentPlans views), консолидация design-layer стека (#5, MediaLibrary «Дизайн-слой») в OverlayEditor, аналитика — прояснить.
- **Фаза 2 (не сейчас):** latency-полировка запекания — показывать исходное фото мгновенно + накладывать ТОЛЬКО текст-satori-слой (прозрачный PNG, бэкенд уже умеет) → почти мгновенно, WYSIWYG сохраняется. «Оживить фото→видео».

## Как поднять dev (для проверки/Playwright)
- Dev DB (docker) на :5441 (`contentfactory_dev`) — обычно уже up. **Прод НЕ трогать** (`content.yurykukin.ru`→:3800 docker, NODE_ENV=production; `/opt/content-factory`).
- Dev backend: `cd backend && PORT=3801 bun run dev` (читает `backend/.env`→dev DB). vite: `VITE_BACKEND_URL=http://localhost:3801 bun run dev` (:5176).
- **Внешний превью-порт 8095 ОТКРЫТ** (`ufw allow 8095`, vite `--host 0.0.0.0 --port 8095 VITE_ALLOW_ALL_HOSTS=1`) → http://91.193.25.104:8095. **ЗАКРЫТЬ когда не нужен:** `ufw delete allow 8095/tcp`.
- Тест-логин (dev DB): `tvtest` / `uikit-verify-2026` (ADMIN). Переключить бизнес на «НаWоде SUP Club».
- Тест-фикстуры в dev DB: media `lab_media_sup1` (фото), `lab_video_1` (видео), предложение `lab_prop_1` (НаWоде STORIES).

## Не ломать
Тосты (`useToast`+ToastContainer, Teleport) · тёмная тема (theme-store, `.dark` на html, `cf_theme`) · `MediaPickerModal` (6× reuse) · брендовый fuchsia · design-layer стек MediaLibrary (пока).

## Правила
Коммит+пуш проактивно на каждый проверенный кусок (main напрямую, соло). Деплой — ТОЛЬКО по явной команде Юрия. Уроки — по одному в `lessons/`. Playwright before/after на каждый экран, консоль чистая. Делегировать: механику — sonnet, тяжёлую логику/god-компоненты — opus; Fable держит контекст компактным.
