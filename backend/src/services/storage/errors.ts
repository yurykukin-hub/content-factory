/**
 * Единственное место, где решается вопрос «объекта нет» против «хранилище не ответило».
 *
 * Зачем отдельный модуль: различие определяет поведение вызывающих — 404 пользователю
 * против 503, удаление записи БД против отказа, «просто нет музыки» против падения
 * публикации. Пока классификация жила внутри драйверов, вызывающим оставалось только
 * `catch(() => null)`, из-за чего сетевой блип выглядел как пропавший файл.
 *
 * Формы отказа у драйверов разные:
 *   local: `ENOENT` от `fs`;
 *   s3 (Ceph RGW): `NoSuchKey` на GET, `NotFound` на HEAD (у HEAD тела нет, кода в нём тоже),
 *   а вот `NoSuchBucket` — тоже 404, но это ОШИБКА КОНФИГУРАЦИИ: притворяться, что
 *   «файла нет», нельзя, иначе опечатка в имени бакета молча превратит всё медиа в 404.
 *   Урезанные права дают 403 `AccessDenied`, сеть — `ECONNRESET`/`ETIMEDOUT` вовсе без статуса.
 */

/** `true` только если объект действительно отсутствует. Всё остальное — реальная ошибка. */
export function isMissingObjectError(err: unknown): boolean {
  const code = (err as { code?: string })?.code
  if (code === 'ENOENT') return true

  const name = (err as { name?: string })?.name
  if (name === 'NoSuchBucket') return false
  if (name === 'NoSuchKey' || name === 'NotFound') return true

  const status = (err as { $metadata?: { httpStatusCode?: number } })?.$metadata?.httpStatusCode
  return status === 404
}
