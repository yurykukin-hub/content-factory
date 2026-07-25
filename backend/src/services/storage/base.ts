/**
 * Абстракция хранилища медиа: интерфейс + фабрика по драйверу.
 * Структура повторяет `services/publishers/base.ts` (типы и фабрика в одном файле,
 * реализации рядом, наружу — только через фабрику) — знакомый в проекте паттерн.
 *
 * Главное правило интерфейса: наружу отдаются только КЛЮЧИ и БАЙТЫ, ни одного
 * файлового пути — кроме явного шлюза `localFile()`/`putFromLocalFile()`. Причина:
 * sharp умеет работать с буферами, а ffmpeg — только с путями на диске. Всё, что
 * умеет буферы, S3-адаптер (Фаза 2) закрывает без правок вызывающих; всё, что
 * требует путь, собрано в двух методах, и именно там S3 будет качать во временный файл.
 */

import { config } from '../../config'
import { log } from '../../utils/logger'
import type { StorageKey } from './keys'
import { LocalStorageDriver } from './local'

export type StorageKind = 'local' | 's3'

/** Всё, что можно записать. `Blob` стримится, а не материализуется (видео до 500 МБ). */
export type StorageWritable = Blob | Buffer | Uint8Array | ArrayBuffer | string

export interface PutOpts {
  /** MIME → `ContentType` в S3. Локальный драйвер игнорирует (тип отдаёт Bun по расширению). */
  contentType?: string
  /** `Cache-Control` в S3. Локальный драйвер игнорирует (заголовок ставится в `serve`). */
  cacheControl?: string
}

export interface PutResult {
  key: StorageKey
  /** Канонический `/uploads/{key}` — ровно это значение кладётся в `MediaFile.url`. */
  url: string
  size: number
}

/**
 * Объект, материализованный на локальном диске для инструментов, умеющих только файлы (ffmpeg).
 * local: `path` — сам файл в uploads, `dispose()` ничего не делает.
 * s3 (Фаза 2): скачивание во временный файл, `dispose()` его удаляет. `dispose()` идемпотентен.
 */
export interface LocalFileHandle {
  readonly path: string
  dispose(): Promise<void>
}

export interface StorageDriver {
  readonly kind: StorageKind

  /**
   * Диагностика для boot-лога: корень/бакет и способ записи. Печатается один раз
   * при создании синглтона — по ней на проде видно, что драйвер и путь те, что ожидались.
   */
  describe(): Record<string, unknown>

  /** Записать объект. Создаёт промежуточные каталоги. */
  put(key: StorageKey, data: StorageWritable, opts?: PutOpts): Promise<PutResult>

  /**
   * Записать объект из уже существующего локального файла — результат работы ffmpeg.
   * Копирует потоком, не поднимая файл в память.
   */
  putFromLocalFile(key: StorageKey, sourcePath: string, opts?: PutOpts): Promise<PutResult>

  /** Весь объект в память (паблишеры → FormData, sharp → pipeline). Бросает, если объекта нет. */
  get(key: StorageKey): Promise<Buffer>

  /** Поток на чтение — без материализации (большие видео). */
  getStream(key: StorageKey): Promise<ReadableStream<Uint8Array>>

  exists(key: StorageKey): Promise<boolean>

  /** Размер в байтах или `null`, если объекта нет. Заменяет пару `existsSync()` + `stat()`. */
  size(key: StorageKey): Promise<number | null>

  /** Best-effort: никогда не бросает. `true` — объект действительно удалён. */
  delete(key: StorageKey): Promise<boolean>

  /**
   * Ответ для `GET /uploads/*`. `null` — объекта нет (роут отдаёт 404).
   * local: `Bun.file` (Range и Content-Type бесплатно). s3 (Фаза 2): 302 на presigned URL,
   * поэтому в сигнатуре есть `req` — из него будет проксироваться Range.
   */
  serve(key: StorageKey, req: Request): Promise<Response | null>

  /** Шлюз для ffmpeg. `null`, если объекта нет (заменяет `if (existsSync(p))`). */
  localFile(key: StorageKey): Promise<LocalFileHandle | null>

  /** `localFile` с гарантированным `dispose()`. Бросает, если объекта нет. */
  withLocalFile<T>(key: StorageKey, fn: (localPath: string) => Promise<T>): Promise<T>
}

/**
 * Фабрика драйверов. Точная копия паттерна `getPublisher()`: switch + осмысленный throw
 * в `default`, чтобы новый драйвер нельзя было забыть подключить.
 */
export function createStorage(kind: StorageKind): StorageDriver {
  switch (kind) {
    case 'local':
      return new LocalStorageDriver()
    case 's3':
      // Фаза 2 миграции на Beget S3. Шов существует, реализации ещё нет —
      // лучше упасть на старте, чем тихо писать в локальный диск при STORAGE_DRIVER=s3.
      throw new Error('S3 storage driver not implemented (Phase 2)')
    default:
      throw new Error(`Unknown storage driver: ${String(kind)}`)
  }
}

let singleton: StorageDriver | null = null

/** Синглтон по `config.STORAGE_DRIVER`. В Фазе 1 всегда `local`. */
export function getStorage(): StorageDriver {
  if (!singleton) {
    singleton = createStorage(config.STORAGE_DRIVER)
    // Одна строка в логе прода закрывает два незаметных риска: активацию
    // не-Bun-фолбэка записи (материализация 500 МБ в RAM → OOM) и неверно
    // посчитанный корень uploads (сервер здоров, но всё 404-ит).
    if (config.NODE_ENV !== 'test') log.info('[storage] driver ready', singleton.describe())
  }
  return singleton
}

/** Только для тестов: сбросить синглтон между кейсами. */
export function resetStorageForTests(): void {
  singleton = null
}
