# Видео-модели KIE — ресёрч + recipe интеграции

**Дата:** 2026-07-04 (Fable-сессия, долг C3 №2). **Статус:** research, не реализовано. Автономный спайк.

## TL;DR
- **Живого catalog-API у KIE НЕТ** — модели перечислены в доках (`docs.kie.ai/market`), не отдаются эндпоинтом. Пробовал 5 путей (`/api/v1/models`, `/model/list`, `/jobs/models`, …) → все 404.
- **`KIE_API_KEY` пуст в dev** `backend/.env`, есть только в прод `/opt/content-factory/.env.prod`. → **живой прогон видео на dev невозможен**; для верификации нужен прод-ключ (Юрий) или dev-ключ.
- Интеграция модели = знать её **slug + per-model `input`-схему + прайс + endpoint-паттерн**, добавить в allowlist, написать per-model маппинг, **прогнать вживую** (сезон — не шипим неверифицированное).
- **Рекомендация: первым добавить Kling 3.0** — он на ТОМ ЖЕ `/api/v1/jobs/createTask`, что и наш Seedance (минимум кода). Veo3 — отдельный эндпоинт + иная схема (больше работы, но топ-качество).

## Как устроен KIE (2 паттерна)
- **(A) market / unified** — `POST /api/v1/jobs/createTask` c `{ model: 'vendor/slug', input: {...} }`. Так работает наш **Seedance** (`bytedance/seedance-2`) и **Kling 3.0** (`kling-3.0/video`). Статус — `GET /api/v1/jobs/recordInfo?taskId=…` (у нас уже есть `checkVideoTaskStatus`).
- **(B) dedicated** — у части моделей свой эндпоинт: **Veo3.1** (`/veo3-api/...`, slugи `veo3`/`veo3_fast`/`veo3_lite`), **Sora2**. Другой request-shape.
- callBackUrl везде опционален → наш polling-подход (video-poller) валиден для всех.

## Текущая плюмбинг-карта (точки правки)
| Что | Файл | Состояние |
|---|---|---|
| allowlist моделей | `backend/src/services/ai/kie.ts` `VIDEO_MODELS`/`DEFAULT_VIDEO_MODEL` (~571) | только `bytedance/seedance-2` |
| сборка запроса | `kie.ts` `createVideoTask` (~618) | ОДНА `input`-схема (seedance), `kiePost('/api/v1/jobs/createTask',{model,input})` |
| прайс | `kie.ts` PRICING (~625) | только 480p/720p seedance-кредиты |
| роут | `backend/src/routes/ai.ts` `POST /generate-video` (~912, схема ~909 `model` optional) | принимает `model`, прокидывает — **но НЕ персистит** `task.model` в сессию (fix ниже) |
| колонка | `backend/prisma/schema.prisma` `GenerationSession.model` (~687, default seedance-2) | есть, фактически всегда дефолт |
| UI-бейдж | `src/components/video/VsSettingsPanel.vue` (~47) | статичный текст seedance-2, пропа model нет |
| payload | `src/views/VideoStudioView.vue` `runGeneration` (~456) | `model` НЕ отправляется |

**Мелкий correctness-фикс (сделан в этой сессии, безопасный):** `ai.ts` `/generate-video` при апдейте сессии теперь пишет `model: task.model` → колонка становится правдивой (было: всегда дефолт). Плюмбинг «модель сквозь стек» готов принять новые значения.

## Per-model `input` — расхождения (ГЛАВНАЯ работа)
Нельзя слать одинаковый `input` — поля разные:

| Поле (наш UI) | Seedance 2 (есть) | Kling 3.0 (`kling-3.0/video`) | Veo3.1 (dedicated) |
|---|---|---|---|
| промпт | `prompt` | `prompt` (при `multi_shots:false`) | `prompt` |
| картинки | `reference_image_urls[]` / `first_frame_url` / `last_frame_url` | `image_urls[]` (first/last) | `imageUrls[]` (1-3) + `generationType` |
| длительность | `duration` (int, 4-15) | `duration` (**строка** '3'-'15') | `duration` ∈ {4,6,8} |
| разрешение | `resolution` 480p/720p | через `mode` std/pro/4K | `resolution` 720p/1080p/4k |
| аспект | `aspect_ratio` 1:1/16:9/9:16 | `aspect_ratio` 16:9/9:16/1:1 | `aspect_ratio` 16:9/9:16/Auto |
| звук | `generate_audio` (bool) | `sound` (bool) | — |
| формат | `output_format:'mp4'` | — | — |
| прочее | — | `multi_shots` (**required**), `multi_prompt[]`, `kling_elements[]` | `generationType`, `enableTranslation`, `watermark` |

Прайс: Kling — по `mode` (4K дороже, точных цифр в доке нет → снять эмпирически прод-ключом); Veo3 — «25% от Google-прайса» (kie.ai/pricing).

## Recipe (когда будет прод-ключ)
1. **Kling 3.0 (первый, минимум кода):**
   - `VIDEO_MODELS += 'kling-3.0/video'`.
   - В `createVideoTask` вынести `buildKieInput(model, params)` — ветка seedance (как сейчас) vs kling (маппинг: `duration→String`, `resolution→mode` (720p→std, «pro»→pro, 4K→'4K'), `generateAudio→sound`, refs→`image_urls`, добавить `multi_shots:false`,`multi_prompt:[]`,`kling_elements:[]`).
   - Прайс: ветка в PRICING по модели (снять реальные кредиты прод-ключом на 1 коротком клипе).
   - Endpoint тот же (`/api/v1/jobs/createTask`), poller не трогать.
2. **Frontend:** `VsSettingsPanel` — реальный `<select>` моделей (label+цена/сек), проп `model`+emit; `VideoStudioView.runGeneration` — добавить `model` в payload. (Валидация на бэке уже есть: невалидное → default.)
3. **Veo3.1 (второй, опц.):** отдельный клиент `createVeoTask` (dedicated endpoint), свой poller-путь ИЛИ адаптер к общему recordInfo (проверить, поддерживает ли). Больше работы.
4. **⚠️ Живой прогон ОБЯЗАТЕЛЕН перед шипом** (сезон, постинг критичен): каждую модель end-to-end (createTask→poll→download→превью), проверить стоимость и что аудио/референсы работают. Неверифицированные model-id НЕ добавлять (id извне не гарантируются).

## Блокер / что нужно от Юрия
- **Прод KIE-ключ для dev-теста** (или отдельный dev-ключ KIE) — без него видео-генерация на dev не гоняется, интеграцию не верифицировать.
- Выбор: какие 1-2 модели реально нужны (Kling 3.0 — баланс цена/качество, тот же endpoint; Veo3 — премиум, дороже и сложнее).

## Sources
- [KIE market gallery](https://kie.ai/market) · [KIE docs](https://docs.kie.ai/)
- [Veo3.1 generate](https://docs.kie.ai/veo3-api/generate-veo-3-video) · [Kling 3.0](https://docs.kie.ai/market/kling/kling-3-0) · [Seedance 2.0](https://docs.kie.ai/market/bytedance/seedance-2)
