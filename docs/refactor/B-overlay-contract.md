# Фаза B — Контракт единого модуля запекания (OverlaySpec)

_Цель: «что вижу = что публикуется». ОДИН spec (persist на Post) → ОДИН рендерер (satori) → редактор показывает реальный запечённый медиа. Сносим 4 из 5 запеканий._

## Диагноз (из разведки)
5 запеканий: (1) старое MVP `image-overlay.ts`→`sharp`+SVG (DejaVu) в `vk.ts:355`; (2) canvas flat-JPEG фото-сторис; (3) canvas PNG видео-сторис (оба в `StoryEditorView`); (4) **satori-дизайн** `design-templates/html-render/story-design` (Montserrat/Cormorant) — чистый, персистит через MediaFile tags+`sourceMediaId`; (5) `design-layer.ts`+`useDesignLayerCanvas`. Рассинхрон: `isBakedStory` не узнаёт свой canvas-вывод (тег `story`) → текст-на-тексте; стейт оверлея не персистится; 3 движка × 3 шрифта; «верх»=погода захардкожен.

**Выбор движка = satori (#4)** — он уже единственный, который персистит и красив. Расширяем его и делаем ЕДИНСТВЕННЫМ. Остальные 4 сносим.

## 1. Тип OverlaySpec (единый источник правды)
Хранится в **`Post.overlaySpec Json?`** (миграция Prisma). TS-тип в `backend/src/services/overlay/overlay-spec.ts` (+ реэкспорт на фронт).
```ts
interface OverlaySpec {
  version: 1
  template: 'story' | 'clean' | 'bold'   // layout-пресеты (2-3)
  sourceMediaId: string                   // ИСХОДНОЕ фото/видео — ВСЕГДА бейкаем из него (не design-over-design)
  photoPosition: string                   // objectPosition кадра, напр. '50% 40%'
  font: 'montserrat' | 'cormorant'        // семейство заголовка (есть в assets/fonts; добавить ещё = drop .ttf + регистрация)
  topText?: string | null                 // РЕДАКТИРУЕМЫЙ верх (сейчас верх = только погода — теперь ещё и текст)
  bottomText?: string | null              // главный заголовок (низ)
  weather?: { temp?: string; desc?: string; show: boolean } | null  // погодный виджет (авто из дайджеста; можно скрыть)
  cta?: string | null                     // «Записаться · nawode.ru»
  promo?: string | null                   // плашка скидки
}
```
- Дефолты при создании из фото: `{version:1, template:'story', sourceMediaId, photoPosition:'50% 50%', font:'montserrat', weather:null}`.
- Дайджест заполняет `topText/weather/bottomText/cta/promo` при генерации (перенос текущей логики).

## 2. Рендерер (satori, расширить)
- `design-templates.ts buildStoryDesign`: добавить (а) `topText` как редактируемый верхний заголовок (над/вместо погоды — по `weather.show`); (б) `font` → `fontFamily` заголовков (montserrat=Montserrat, cormorant=Cormorant); (в) `template` — 2-3 пресета раскладки (story=текущий, clean=минимал без плашек, bold=крупный заголовок).
- `html-render.ts loadFonts`: уже грузит Montserrat+Cormorant — параметризовать выбор семейства.
- **Видео:** satori рендерит ПРОЗРАЧНЫЙ PNG-слой (верх+низ, без фото-фона) → `overlayImageOnVideo(video, pngLayer, out)` (+ опц. `overlayAudioOnVideo`). «Bake once» переиспользуем.
- **Фото:** satori рендерит поверх фото-фона (как сейчас) → PNG.

## 3. Endpoint `POST /api/media/render-overlay`
Заменяет `render-design` (тот оставить тонкой обёрткой для обратной совместимости дайджеста ИЛИ мигрировать вызовы).
- Body: `{ postId?: string; mediaId: string; spec: OverlaySpec }`.
- Логика: резолвит оригинал из `spec.sourceMediaId` (fallback mediaId если он и есть оригинал); фото→satori PNG, видео→satori-слой+ffmpeg; сохраняет MediaFile (`design_*.{png,mp4}`, теги `['overlay','ai-generated']`, `sourceMediaId`=оригинал); если `postId` — пишет `Post.overlaySpec = spec` и привязывает baked-медиа к посту.
- Идемпотентно: повторный вызов бейкает из оригинала (никогда design-over-design). Возвращает `{ id, url, thumbUrl, mediaFileId, spec }`.

## 4. Фронт: `useOverlaySpec` + `OverlayEditor.vue`
- `composables/useOverlaySpec.ts`: реактивный `spec`, `bakedUrl`, `render()` (debounce 500мс POST render-overlay → `bakedUrl`=реальный PNG). `dirty`-флаг, автосейв spec на Post.
- `components/overlay/OverlayEditor.vue` (кит-компоненты): поля **верх (UiTextarea)**, **низ (UiTextarea)**, **шрифт (UiSelect)**, **шаблон (UiTabs segmented)**, **погода (UiSwitch)**, **CTA (UiInput)**, **drag-кадр** (перетаскивание фото → photoPosition, живой). Превью = `<img :src="bakedUrl">` (WYSIWYG = запечённый). Поглощает `StoryDesignModal`.
- Интеграция: StoryEditorView (вместо canvas-оверлея), карточка дайджеста «поправить кадр/текст», опц. PostEditor.
- **Публикация всегда постит baked-медиа** (по `Post.overlaySpec.sourceMediaId` → baked). Развилка `isBakedStory` исчезает — всё есть overlay-медиа.

## 5. Снос (B3, после проверки нового пути)
- Backend: `image-overlay.ts` + вызов в `vk.ts:355` (форсить `skipOverlay:true` всегда); `design-layer.ts` (или переключить `bake-design-layer` на новый модуль). **Оставить** `video-overlay.ts` (примитивы переиспользуются), `story-design.ts`/satori (ядро).
- Frontend: canvas-оверлей в `StoryEditorView` (`drawTextOverlay`/`drawScene`-текст/`exportCanvas`/`exportOverlayPng`), `useDesignLayerCanvas.ts`, `DesignLayerEditor.vue`, `StoryDesignModal.vue`.

## Порядок B: B1 backend (схема+satori+endpoint+publish-wiring) → verify рендер вживую → B2 фронт (useOverlaySpec+OverlayEditor+интеграция) → verify Playwright → B3 снос старого → verify регрессия.

## Verify
- Прямой вызов render-overlay на реальном dev-медиа → проверить PNG (верх+низ+шрифт+кадр).
- Playwright: сторис из дайджеста → править верх/низ/шрифт/кадр → превью=запечённый PNG → опубликовать (dev) → переоткрыть → идентично.
- Регрессия дайджеста: авто-генерация сторис всё ещё оформляется.
