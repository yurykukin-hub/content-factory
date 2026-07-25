/**
 * Хранилище медиа. Точка входа для всего остального кода:
 *
 *   import { getStorage, keyFromUrl, makeKey } from '../services/storage'
 *
 * Реализации (`local.ts`, в Фазе 2 — `s3.ts`) напрямую не импортируются нигде,
 * кроме фабрики и тестов — так же, как устроены `services/publishers`.
 */

export {
  UPLOADS_URL_PREFIX,
  buildPublicUrl,
  keyFromRequestPath,
  keyFromUrl,
  makeKey,
  publicUrl,
  urlFromKey,
  type StorageKey,
} from './keys'

export {
  createStorage,
  getStorage,
  resetStorageForTests,
  type LocalFileHandle,
  type PutOpts,
  type PutResult,
  type StorageDriver,
  type StorageKind,
  type StorageWritable,
} from './base'

export { localBizDir, uploadsRoot } from './local'
