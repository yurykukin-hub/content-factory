# UTM-конвенция Content Factory

Мост между публикацией (Эпик A, редактор) и аналитикой (Эпик B). Редактор/публикатор
ставит UTM-метки на исходящие ссылки бренда, аналитика на стороне сайта/ERP читает их.

## Конвенция меток

| Параметр | Значение | Пример |
|---|---|---|
| `utm_source` | канал публикации | `vk` · `telegram` · `instagram` |
| `utm_medium` | всегда `social` | `social` |
| `utm_campaign` | `cf_{YYYY_MM}` (Content Factory + месяц) | `cf_2026_06` |
| `utm_content` | `postId` (атрибуция к посту) | `clxyz...` |

## Что помечается

- **Только ссылки на домены бренда** — хосты берутся из `BrandProfile.links` (`[{label,url}]`).
  Чужие ссылки (vk.com, t.me, сторонние) **не трогаем**.
- **Лента (VK/TG/IG посты):** `http(s)`-ссылки в тексте версии помечаются по каналу.
- **Сторис VK:** текст накладывается на фото (не кликабелен) → помечается **кнопка-ссылка**
  (`storiesOptions.linkUrl`), а не текст.
- **Идемпотентно:** если в URL уже есть `utm_source` — не перетираем.
- **Bare-домены без схемы** (`nawode.ru` без `https://`) не помечаются — нужен явный `http(s)://`.

## Где в коде

- Утилита: `backend/src/utils/utm.ts`
  - `buildUtmUrl(url, params)` — дописать UTM к одному URL (идемпотентно)
  - `platformUtmSource(platform)` — VK→vk, TELEGRAM→telegram, INSTAGRAM→instagram
  - `utmCampaign(date)` — `cf_YYYY_MM`
  - `hostsFromLinks(links)` — хосты из BrandProfile.links
  - `tagBusinessLinks(text, opts)` — пометить ссылки бренда в тексте
  - `tagBusinessUrl(url, opts)` — пометить одиночный URL, если host бренда
- Применение: `backend/src/routes/publish.ts` (`/post-versions/:id/publish`) — перед вызовом publisher.
- Тесты: `backend/src/utils/__tests__/utm.test.ts` (16 кейсов).

## Управление

- `AppConfig.utm_enabled` — `'false'` отключает пометку (по умолчанию включено).

## Для аналитики (Эпик B)

Сайт/ERP при входящем трафике читает `utm_source` / `utm_medium` / `utm_campaign` / `utm_content`
и атрибутирует визиты/брони к каналу и посту. Конвенция выше — контракт между фабрикой и аналитикой.
