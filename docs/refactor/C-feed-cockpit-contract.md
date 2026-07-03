# Фаза C1 — Контракт кокпита «Лента» (слияние Контент + Дайджест)

_North-star: дайджест предложил → правка на месте → «чик» → опубликовано, без захода в редактор. Один экран вместо двух._

## Диагноз (из разведки)
Две сущности: `Post` (+`PostVersion` на платформу, реальный публикуемый объект) и `AutoPostTask` (эфемерное AI-предложение, `source='digest'`, `status: proposed/approved/rejected/published/archived`), связь `AutoPostTask.postId?→Post` (создаётся `approveDigestTask`). Публикация уже общая: `services/publish-runner.ts` (`publishPostVersion`/`schedulePostVersion`). `GET /auto-posts` уже собирает `previews[]` (PostVersion→adaptation→master). Блокеры слияния: (1) два словаря статусов; (2) предложения без Post; (3) два list-endpoint'а; (4) двойной показ одобренных; (5) три разных `canPublishNow` (DigestView:77, PostEditorView:488, StoryEditorView:876).

## 1. Backend `GET /api/feed?businessId=&status=`
Единый источник для кокпита. Реконсиляция:
- **Предложения:** `AutoPostTask` где `status='proposed'` И `postId IS NULL` → items `kind:'proposal'`.
- **Посты:** `Post` (DRAFT/SCHEDULED/PUBLISHED) → items `kind:'post'`. Одобренное предложение уже стало Post → показываем Post, НЕ AutoPostTask (**дедуп по `AutoPostTask.postId`**: если у Post есть связанный task — это тот же контент, task не дублируем).
- Нормализованный item: `{ kind, id, postId?, taskId?, status: 'proposed'|'draft'|'scheduled'|'published', postType, title, text, previews[], media[], platforms[], canPublishNow, createdAt, aiReasoning? }`.
- Маппинг статусов в единый словарь: `proposed`(task) · `draft`(Post DRAFT) · `scheduled`(любая версия SCHEDULED) · `published`(есть PUBLISHED-версия). Табы кокпита = эти 4.
- Переиспользовать enrichment из `GET /auto-posts` (previews) и из PostsView (`/businesses/:id/posts`).

## 2. Backend `canPublishNow` — единый (заменяет 3 фронтовых)
`services/publish-runner.ts` (или рядом) → `canPublishNow(item): { ok, reason? }`: STORIES/PHOTO с baked/медиа → ok; текстовый пост с ≥1 каналом и текстом в лимите → ok. Отдаётся в `/feed` item. Фронт больше НЕ считает сам.

## 3. Настройки дайджеста (сейчас НИГДЕ в UI — все ключи только в БД)
Панель (UiCard в кокпите ИЛИ раздел в Настройках) пишет `digest_*` через существующий `PUT /api/settings/config` (admin, generic upsert):
- **Вкл/выкл** дайджеста (`digest_enabled`) — UiSwitch.
- **Ритм-роли** (`digest_roles_enabled`) + времена **утро/день/вечер** (`digest_time_utc_{morning,day,evening}`) — UiSwitch + время.
- **Ключевые факты** (`digest_key_facts`) — UiTextarea.
- **Тумблер Human-in-loop ↔ Автопилот** (`digest_autopilot_enabled`) — UiSwitch (дефолт OFF), с явным предупреждением «автопилот публикует сам».
- Опц. флаги (flash/recruitment/promo) — вторично.
- Нужен `GET /api/settings/config?keys=digest_*` (или расширить public/settings) для чтения текущих значений в UI.

## 4. Backend автопилот (`digest_autopilot_enabled`)
В `daily-digest.generateDigestForBusiness` после создания `AutoPostTask(proposed)`: если `digest_autopilot_enabled==='true'` → авто-`approveDigestTask` + `publishPostVersion`/`schedulePostVersion` (переиспуч. `auto-post approve-publish` логику / publish-runner). Дефолт OFF (human-in-loop). Логировать каждое авто-действие. Без тумблера поведение = как сейчас (черновики).

## 5. Frontend `FeedView.vue` (заменяет DigestView + PostsView)
- Кит-компоненты. **Статус-табы** (UiTabs): Предложения / Черновики / Запланировано / Опубликовано (+счётчики).
- Карточка (UiCard, стиль = красивая лента дайджеста — эталон Юрия): **превью «как в соцсети»** (существующие `components/posts/preview/{Vk,Telegram,Instagram}Preview` + табы), для предложения — `aiReasoning`.
- **Правка на месте** (без редактора): текст — `EditableText`; фото — `MediaPickerModal` (переиспользуемый, 6× reuse — НЕ трогать); **кадр/оверлей — `OverlayEditor`** (из Фазы B, WYSIWYG). 
- **«Опубликовать сейчас ▾»** (UiDropdown: Сейчас / Запланировать) → `POST /auto-posts/:id/approve-publish` (предложение) или publish существующего Post. Для предложений — «Одобрить» (в черновики) / «Отклонить».
- «В редактор» (deep edit) ведёт в `/posts/:id` / `/stories/:id` (оставляем как углублённый режим).
- Дедуп/архив по `postId`; никакого двойного показа.
- **Nav:** пункты «Дайджест»+«Контент» → один **«Лента»** (`/feed`) в `components/layout/TheSidebar`. Роуты `/digest`,`/posts` → редирект на `/feed` (обратная совместимость ссылок).

## Порядок C1: C1a backend (`GET /feed` + canPublishNow + digest config read + autopilot wiring) → verify → C1b frontend (FeedView + настройки + nav + интеграция OverlayEditor в карточку) → Playwright verify.
## Отдельно (C-story): интеграция OverlayEditor в StoryEditorView + СНОС старых запеканий (B3) + видео-путь на реальном видео.

## Verify
- `GET /feed` в dev: предложения+черновики+запланированные+опубликованные, без двойного показа одобренных.
- Playwright: Лента → карточка предложения → правка текста + оверлей на месте → «Опубликовать» (dev) → уходит; тумблер автопилота виден и пишет конфиг.
- Регрессия: дайджест-генерация всё ещё кладёт предложения в Ленту.
