/**
 * Ключи хранилища медиа: единственное место, где web-URL превращается в путь объекта
 * и обратно. До этого модуля логика была скопирована ~60 раз
 * (35 темплейтов `/uploads/${businessId}/${filename}` + 26 обратных `.replace('/uploads/','')`),
 * причём обратные — без якоря `^` и без валидации.
 *
 * Инварианты:
 *  - `MediaFile.url` / `thumbUrl` / `GenerationSession.audioUrl` = `/uploads/{key}`;
 *  - `key` = `{businessId}/{filename}` — БЕЗ ведущего слэша, БЕЗ префикса;
 *  - формат колонок НЕ меняется (проверено на проде: 2054 записи, все ровно этой формы).
 *
 * Модуль чистый: ни `fs`, ни сети. Единственный импорт с побочкой — `config` в `publicUrl()`
 * (ядро `buildPublicUrl()` остаётся чистым и тестируется без env).
 */

import { config } from '../../config'

/** Публичный префикс медиа-URL. Совпадает с роутом `GET /uploads/*` и с колонками в БД. */
export const UPLOADS_URL_PREFIX = '/uploads/'

/** Путь объекта в хранилище: `biz-1/abc123.jpg`. Без ведущего слэша. */
export type StorageKey = string

/**
 * Управляющие символы (включая NUL) и DEL. В путях недопустимы: часть рантаймов
 * на них падает, а NUL исторически используется для обрезания пути.
 * Проверка через коды, а не регексп — чтобы в исходнике не было невидимых байтов.
 */
function hasControlChars(value: string): boolean {
  for (let i = 0; i < value.length; i++) {
    const code = value.charCodeAt(i)
    if (code < 32 || code === 127) return true
  }
  return false
}

/**
 * Нормализация «хвоста» после префикса в валидный ключ.
 *
 * Отвергает (→ null): пустое, ведущий слэш, пустые сегменты (`a//b`), `..`, backslash,
 * управляющие символы. Сегменты `.` выбрасываются — так же, как это делает
 * `path.resolve()`, через который до сих пор шла раздача (паритет поведения).
 *
 * Percent-декодирования НЕТ намеренно: раздача его никогда не делала, а имена на диске
 * всегда ASCII (`nanoid(12)` + расширение). Декодировать здесь — значит открыть
 * `%2e%2e%2f`-траверсал, которого сейчас нет.
 */
function normalizeKey(raw: string): StorageKey | null {
  if (!raw) return null
  if (hasControlChars(raw)) return null
  // Backslash: на Windows — разделитель, у нас — способ спрятать traversal.
  if (raw.includes('\\')) return null
  // Ведущий слэш → resolve() трактует как абсолютный путь и уходит из uploads.
  if (raw.startsWith('/')) return null

  const out: string[] = []
  for (const seg of raw.split('/')) {
    if (seg === '.') continue
    if (seg === '' || seg === '..') return null
    out.push(seg)
  }
  if (out.length === 0) return null
  return out.join('/')
}

/**
 * `MediaFile.url` | `thumbUrl` | `GenerationSession.audioUrl` → ключ.
 * `null` для всего, что не наш объект: пустое, внешний `http(s)://`, отсутствие префикса,
 * traversal. Не бросает — вызывающий обязан обработать `null` (404 / warn / отказ публикации).
 *
 * Отличие от прежнего `url.replace('/uploads/', '')`: там не было якоря `^`, поэтому
 * `https://evil.com/uploads/x.jpg` превращался в `https:/evil.com/x.jpg` и уходил
 * в `join(UPLOAD_DIR, …)`, а `/x/uploads/y.jpg` — в `/x/y.jpg`. Здесь оба → `null`.
 */
export function keyFromUrl(url: string | null | undefined): StorageKey | null {
  if (!url) return null
  if (!url.startsWith(UPLOADS_URL_PREFIX)) return null
  return normalizeKey(url.slice(UPLOADS_URL_PREFIX.length))
}

/**
 * То же, что `keyFromUrl`, но бросает вместо `null`. Для мест, где у «не наш URL»
 * нет осмысленной ветки и ошибка всё равно поднимется выше: раньше там формировался
 * мусорный путь и `readFile` падал с ENOENT, который перехватывался тем же catch.
 * Так что бросок сохраняет прежнее поведение, но с внятным сообщением.
 */
export function requireKeyFromUrl(url: string | null | undefined): StorageKey {
  const key = keyFromUrl(url)
  if (key === null) throw new Error(`Медиафайл недоступен: ${JSON.stringify(url)}`)
  return key
}

/**
 * HTTP-путь запроса (`c.req.path`, уже без query-строки) → ключ.
 * `null` ⇒ роут отдаёт 403 (как и прежняя проверка префикса после `resolve()`).
 *
 * Дополнительно к `keyFromUrl` отвергает сегменты, начинающиеся с точки. Это только
 * про HTTP-поверхность: внутри uploads живут служебные каталоги, которые раздавать
 * нельзя — `.tmp` (времянки ffmpeg с Фазы 2) и `.google-photos-thumbs` (превью
 * каталогизатора). В `keyFromUrl` тот же запрет ставить НЕЛЬЗЯ: там он сломал бы
 * контракт колонок БД, где dot-каталог — легальный ключ.
 */
export function keyFromRequestPath(reqPath: string): StorageKey | null {
  if (!reqPath.startsWith(UPLOADS_URL_PREFIX)) return null
  const key = normalizeKey(reqPath.slice(UPLOADS_URL_PREFIX.length))
  if (key === null) return null
  if (key.split('/').some((seg) => seg.startsWith('.'))) return null
  return key
}

/**
 * Ключ → URL для БД и фронта. Бросает на невалидном ключе: сюда попадают только
 * значения, порождённые `makeKey()`/`keyFromUrl()`, поэтому невалидный ключ — баг
 * вызывающего, который лучше увидеть сразу, чем записать битый URL в БД.
 */
export function urlFromKey(key: StorageKey): string {
  const normalized = normalizeKey(key)
  if (normalized === null || normalized !== key) {
    throw new Error(`Invalid storage key: ${JSON.stringify(key)}`)
  }
  return UPLOADS_URL_PREFIX + key
}

/** Компонент ключа: не пустой, без разделителей и traversal. */
function assertKeySegment(value: string, label: string): void {
  if (!value) throw new Error(`Invalid storage key ${label}: empty`)
  const bad =
    value.includes('/') ||
    value.includes('\\') ||
    value === '.' ||
    value === '..' ||
    hasControlChars(value)
  if (bad) throw new Error(`Invalid storage key ${label}: ${JSON.stringify(value)}`)
}

/**
 * Единственный способ породить НОВЫЙ ключ. `filename` — имя на диске
 * (`nanoid(12)` + расширение), НЕ человекочитаемое `MediaFile.filename`.
 */
export function makeKey(businessId: string, filename: string): StorageKey {
  assertKeySegment(businessId, 'businessId')
  assertKeySegment(filename, 'filename')
  return `${businessId}/${filename}`
}

/**
 * Абсолютный URL для внешних потребителей: KIE.ai (обязан скачать наш файл),
 * vision-модели через OpenRouter, self-fetch satori в `html-render.ts`.
 *
 * Чистая — база передаётся аргументом, поэтому тестируется без env и без config.
 * Уже абсолютный URL возвращается как есть: это фикс латентного бага
 * `kie.ts::resolvePublicUrl`, где guard отсутствовал и внешний referenceImageUrl
 * склеивался в `https://content.yurykukin.ruhttps://cdn…` → KIE 4xx.
 */
export function buildPublicUrl(base: string, src: string): string {
  if (/^https?:\/\//i.test(src)) return src
  const cleanBase = base.replace(/\/+$/, '')
  if (src.startsWith('/')) return cleanBase + src
  return cleanBase + UPLOADS_URL_PREFIX + src
}

/** `buildPublicUrl` с базой из `config.publicBaseUrl`. Единственная точка внешних URL. */
export function publicUrl(src: string): string {
  return buildPublicUrl(config.publicBaseUrl, src)
}
