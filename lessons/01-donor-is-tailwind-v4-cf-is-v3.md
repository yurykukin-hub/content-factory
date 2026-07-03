# Урок 01 — Донор UI-кита на Tailwind v4, CF на v3

**Дата:** 2026-07-03 (Фаза A рефактора)

## Факт
- **Донор** `sales-bot/admin` = **Tailwind v4**: `@import "tailwindcss"` + токены в CSS через `@theme { --color-brand-500: … }`, брендовый цвет = indigo `#6366f1`, шрифт Inter. Транзишены (`.fade`, `.slide-up`, `.toast-*`) объявлены в `src/style.css`.
- **CF** = **Tailwind v3.4.17**: `@tailwind base/components/utilities` в `src/style.css`, токены в `tailwind.config.js` (`theme.extend.colors`), брендовый цвет = fuchsia `#d946ef`.

## Грабли при переносе примитивов
1. **НЕ копировать донорский `@theme` CSS.** Семантические токены CF объявлять в `tailwind.config.js` (v3-идиома), а не CSS-переменными v4.
2. **Бренд остаётся fuchsia** `#d946ef` (цвет НаWоде/CF, не менять на indigo донора).
3. **Транзишены `.fade`/`.slide-up` в CF ОТСУТСТВУЮТ**, а донорские `UiModal`/`UiDropdown` их используют (`<Transition name="fade">`). При переносе — добавить keyframes/классы в `src/style.css`, иначе модалки появляются/исчезают без анимации (или мигают).
4. Классы вида `bg-brand-600`, `focus-visible:ring-brand-500` **портируются как есть** (это имена классов) — работают в обеих версиях, т.к. токен `brand` есть у обоих. Проблема только в слое определения токенов и в CSS-транзишенах.

## Вывод для делегирования
Sonnet-субагенту на перенос примитивов давать явную инструкцию: «CF = Tailwind v3, токены в tailwind.config.js, добавь .fade/.slide-up транзишены в style.css, бренд = fuchsia». Иначе он вслепую скопирует v4-подход донора.
