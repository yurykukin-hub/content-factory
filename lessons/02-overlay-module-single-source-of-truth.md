# Урок 02 — Единый модуль запекания: server-render как единственная правда

**Дата:** 2026-07-03 (Фаза B)

## Что было (боль №1)
5 запеканий (старое MVP `image-overlay.ts`, 2 canvas в StoryEditorView, satori-дизайн, design-layer) с 3 шрифтами. Рассинхрон редактор↔пост, т.к. стейт оверлея не персистился, а превью рисовал ДРУГОЙ движок, чем публикация.

## Решение (работает)
- **`OverlaySpec` (JSON на `Post.overlaySpec`)** — единственный источник правды: `{template, sourceMediaId, photoPosition, font, topText, bottomText, weather, cta, promo}`.
- **Один рендерер = satori-бэкенд** (`services/overlay/render-overlay.ts` + расширенный `design-templates.buildStoryDesign`). Фото → PNG поверх фото; видео → прозрачный satori-слой → `overlayImageOnVideo`.
- **`POST /media/render-overlay`** бейкает ВСЕГДА из `sourceMediaId` (оригинала) → никогда design-over-design; персистит spec на Post.
- **Фронт `OverlayEditor` + `useOverlaySpec`:** правка → debounce 500мс → render-overlay → превью = вернувшийся PNG. **WYSIWYG by construction** — рассинхрон невозможен, т.к. превью ЕСТЬ то, что опубликуется.

## Грабли/follow-up для интеграции (Фаза C)
1. **`cleanStoryTitle` срезает день недели** (Пятница/Суббота…) из заголовка — это утилита для АВТО-заголовков дайджеста. В ручном `OverlayEditor` (bottomText) её надо НЕ применять (иначе «Пятница на воде» → «На воде», сюрприз для пользователя). Развести: авто-путь дайджеста чистит, ручной — нет.
2. ~~Видео-путь реализован, но не прогнан вживую~~ **✅ ПРОВЕРЕН 03.07** (autonomous-тик): `renderOverlay` на тестовом 1080×1920 mp4 → satori прозрачный слой (верх+низ+погода+CTA) → `overlayImageOnVideo` → кадр из выходного mp4 подтверждает вшитый текст. Видео-путь корректен, фикс не нужен.
3. При интеграции в экраны **сносим старые запекания** (`image-overlay.ts`+вызов в `vk.ts` → всегда `skipOverlay`; canvas в StoryEditorView; `design-layer`/`useDesignLayerCanvas`/`DesignLayerEditor`; `StoryDesignModal` поглощён `OverlayEditor`). Публикация постит baked-медиа; развилка `isBakedStory` исчезает.
4. Дайджест продолжает звать `renderAndSaveStoryDesign` напрямую (аддитивно совместимо) — при желании позже перевести и его на `renderOverlay(spec)`.
