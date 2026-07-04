# Урок 03 — Унификация студий: composables-first, не god-shell

**Дата:** 2026-07-04 (Фаза C3)

## Что было (боль)
Три студии (Video/Photo/Sound) = тройное зеркало: `{Video,Photo,Sound}StudioView.vue` + параллельные наборы `Vs*`/`Ps*`/`Ss*` компонентов. Дубли по разведке: `PromptTabs` 100% зеркало, `AgentChat`/`EnhanceMenu`/`SessionBar` 50-70%, `SettingsPanel`/`Gallery` доменные. Каждая студия ВЕЛА инлайн: session-CRUD, autosave (debounce 2с), SSE-подключение, таймер генерации — ~180-200 строк скрытой логики на студию, разошедшихся между собой. Плюс двойные UI-режимы (вкладки Агент/Редактор + Простой/Продвинутый) путали: неясно, какой текст реально уйдёт в генерацию.

## Решение (работает)
- **3 composables вместо god-shell:** `useStudioSession.ts` (304 стр — session-CRUD + autosave с гвардами + lifecycle + SSE-синк), `useStudioSSE.ts` (55 стр — одно соединение, авто-reconnect, `onScopeDispose`-чистка), `useElapsedTimer.ts` (48 стр — таймер генерации от `kieTaskCreatedAt`, фикс утечки интервала).
- **Чат-центричный `StudioChat.vue`** (общий, вырос из `SsAgentChat`): постоянный композер ВНИЗУ чата = ровно то, что уйдёт в генерацию; карточка-предложение агента с кнопкой **«Взять»** кладёт промпт в композер. Убраны вкладки Агент/Редактор и dropdown Простой/Продвинутый (режим агента жёстко advanced/Sonnet).
- **`SharedEnhanceMenu.vue`** (общий split-button «Улучшить»): режимы пропом, `accent` + `gateProModes/isAdmin/isProMode` (Video гейтит Pro-режимы; Photo/Sound — fuchsia, ungated, байт-идентичны).
- **Video сохранил @ImageN-референсы:** `VsRichPrompt` (contenteditable @mention) переиспользован ЦЕЛИКОМ внутри `StudioChat` — не разбирался. FLUX убран из edit-image (→ nano-banana).
- Итог: ≈−1821 стр net, снесено 12-13 компонентов, создано 5 общих активов. Волны 0-4: `5de9cd5`/`ede3b89`/`df96456`/`d01ec5e`/`d8efcb3`. Playwright + build ✓, StoryEditor не тронут.

## Грабли/follow-up
1. **composables-first > god-shell.** Скептик-opus показал: реальный дубль сидит в СКРЫТОЙ логике (session/autosave/SSE/timer, ~180-200 стр/студию), а не в ~15 строках layout-хрома. Единый `StudioShell.vue` (изначальная идея плана) сознательно НЕ строили — он дал бы ложное «сходство по оболочке» без устранения настоящего дубля.
2. **`flush()` перед генерацией** = связь промпт↔результат: снапшот промпта успевает сохраниться в `results[]`/`promptHistory` до оптимистичного `generating`, иначе ✓-маркер и текст расходятся.
3. **Sound форс-`custom`** (`applySession` форсит `musicMode='custom'`) — иначе редактор текста/стиля прячется.
4. **Высота композера:** высокий (Sound/Video) → `flex-1 min-h-0 overflow-y-auto` (делит высоту с чатом); низкий (Photo) → `shrink-0`.
5. **@badge round-trip:** `insertBadge` при add-ref, `setContentWithBadges` при restore/enhance/«Взять» — иначе @ImageN-чипы теряются.
6. **`VsAgentChat`/`VsAgentMessage` НЕ удалять** — их прямой владелец `StoryEditorView` (регрессионный периметр вне студий).
7. **Долги оставлены НАМЕРЕННО** (не тех-долг по недосмотру): видео-модели (per-model KIE-схемы, не allowlist-строка), полиш-бэклог (layout Sound, welcome-строка, иконки в enhance-меню, Video pro-debug-readout), предсуществующий баг edit-image (`submitted` vs `@edited`).

## Вывод для делегирования
Прежде чем строить общую «оболочку» по внешнему сходству — спроси скептика-opus «а где РЕАЛЬНЫЙ дубль?». Внешнее сходство layout ≠ дубль логики; настоящая экономия — в извлечении скрытой повторяющейся механики в composables. Мелкий UI-полиш выноси в явный бэклог, не блокируй им волну.
