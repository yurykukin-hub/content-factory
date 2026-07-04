# CF-рефактор — HANDOFF (передача в новую сессию)

_Обновлено 2026-07-04. Оркестратор: Fable, effort high. План: `~/.claude/plans/goal-atomic-cake.md`._

## Что это
Полный рефактор Content Factory по 3 измерениям (ПРОДУКТ + UI + ЛОГИКА). North-star: **рабочий 2-клика автопостинг НаWоде** (дайджест предложил → правка на месте → чик → опубликовано). Сезон идёт — надёжность постинга критична. Осознанный большой рефактор (не Boy Scout).

## Статус фаз (всё в `main`, НЕ задеплоено)
- **Фаза A ✅** — дизайн-система: 18 UI-примитивов (`src/components/ui/`) + семантические токены (`tailwind.config.js`: success/danger/warning/info + brand=fuchsia) + a11y (focus-trap, ARIA, tooltips). Витрина `/ui-kit`. Донор был Tailwind v4, CF v3 (см. `lessons/01`).
- **Фаза B ✅** — боль №1: 5 запеканий → **один `OverlaySpec` (JSON на Post) + satori-рендерер** (`backend/src/services/overlay/render-overlay.ts`, `design-templates.ts buildStoryDesign`). Endpoint `POST /media/render-overlay` (бейкает из `sourceMediaId`, никогда design-over-design). Фронт `OverlayEditor.vue` + `useOverlaySpec.ts` → превью = реальный запечённый PNG (WYSIWYG). Проверено фото+видео. Baker #1 (`image-overlay.ts`) СНЕСЁН. См. `lessons/02`.
- **Фаза C2 ✅** — 4 бага: SCHEDULED-разблокировка (`PostEditorView`), лейбл gpt-image-2 (`PhotoStudioView`), видео-модель как param (`kie.ts`), дедуп фото дайджеста (`photo-search.ts`/`daily-digest.ts`).
- **Фаза C1 ✅** — кокпит **«Лента»** (`FeedView.vue`): слил Контент+Дайджест, `GET /feed` (реконсиляция+дедуп по postId), `canPublishNow` (backend, `can-publish.ts`), правка на месте (текст/фото/OverlayEditor), «Опубликовать сейчас ▾», `DigestSettingsModal` (вкл/выкл, утро/день/вечер, автопилот-тумблер `digest_autopilot_enabled`, дефолт OFF). Автопилот-проводка `publish-digest-task.ts`. Nav: «Дайджест»+«Контент»→«Лента»; мёртвые разделы (Идеи/Сценарии/Контент-планы) убраны из nav.

## В работе / осталось
- **⏳ C-story (in-flight):** opus-агент переводит `StoryEditorView.vue` (god-компонент 1753 стр) на `OverlayEditor` + сносит canvas-запекание + `StoryDesignModal` + ретайрит `DigestView.vue`/`PostsView.vue` (заменены FeedView). **Проверить его результат Playwright'ом (создать сторис→оформить→опубликовать→переоткрыть) ДО коммита.** Если процесс сессии вышел — работа агента на диске (транскрипт), но может быть НЕ закоммичена → проверь `git status`, доверши/откати.
- **C3 студии:** унифицировать video/photo/sound (тройное зеркало) через `StudioShell` + `studioType`; один умный чат (убрать простой/продвинутый + вкладки Агент/Редактор); выбор моделей (Seedance backend уже param — доделать UI-селектор). Файлы: `views/{Video,Photo,Sound}StudioView.vue`, `components/{video,photo,sound}/*`.
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
