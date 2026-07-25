/**
 * Соответствие MIME ⇄ расширение файла.
 *
 * Вынесено из `routes/media.ts` в утилиту, потому что с переходом на объектное хранилище
 * MIME перестал быть чисто входной характеристикой загрузки: он записывается в `ContentType`
 * объекта и ровно в этом виде возвращается браузеру при раздаче. А поскольку на всех ответах
 * стоит `nosniff`, объект с `application/octet-stream` не отрисуется и не проиграется —
 * значит подставлять тип по расширению нужно в каждой точке записи, а не только в upload.
 */

const MIME_TO_EXT: Record<string, string> = {
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp',
  'image/gif': '.gif',
  'image/svg+xml': '.svg',
  'image/heic': '.heic',
  'video/mp4': '.mp4',
  'video/webm': '.webm',
  'video/quicktime': '.mov',
  'video/x-msvideo': '.avi',
  'video/x-matroska': '.mkv',
  'audio/mpeg': '.mp3',
  'audio/ogg': '.ogg',
  'audio/wav': '.wav',
}

const EXT_TO_MIME: Record<string, string> = {
  '.mov': 'video/quicktime',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.avi': 'video/x-msvideo',
  '.mkv': 'video/x-matroska',
  '.m4v': 'video/x-m4v',
  '.wmv': 'video/x-ms-wmv',
  '.3gp': 'video/3gpp',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.heic': 'image/heic',
  '.mp3': 'audio/mpeg',
  '.ogg': 'audio/ogg',
  '.wav': 'audio/wav',
}

/** MIME → расширение (с точкой). Неизвестный тип → `.bin`. */
export function mimeExtension(mime: string): string {
  return MIME_TO_EXT[mime] || '.bin'
}

/** Расширение (с точкой) → MIME. Неизвестное → `null`. */
export function extensionToMime(ext: string): string | null {
  return EXT_TO_MIME[ext.toLowerCase()] || null
}

/**
 * MIME для объекта хранилища: заявленный тип, а если он пустой или обобщённый —
 * определённый по имени файла. Именно этот тип уедет в `ContentType` и вернётся браузеру.
 */
export function contentTypeFor(declared: string | null | undefined, filename: string): string {
  if (declared && declared !== 'application/octet-stream') return declared
  const dot = filename.lastIndexOf('.')
  const byExt = dot >= 0 ? extensionToMime(filename.slice(dot)) : null
  return byExt || 'application/octet-stream'
}
