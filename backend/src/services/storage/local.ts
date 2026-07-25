/**
 * Локальный драйвер хранилища: файлы в uploads-volume, завёрнутые в интерфейс
 * `StorageDriver`. Второй драйвер — `s3.ts`; какой из них активен, решает
 * `STORAGE_DRIVER`. Локальный остаётся путём отката на время миграции.
 */

import { createReadStream } from 'fs'
import { copyFile, mkdir, readFile, rename, stat, unlink } from 'fs/promises'
import { Readable } from 'stream'
import { dirname, resolve, sep } from 'path'
import { getModuleDir } from '../../utils/paths'
import { isMissingObjectError as isMissing } from './errors'
import { bunFile, writeStreamedFile, writerKind } from './fsio'
import { urlFromKey, type StorageKey } from './keys'
import type {
  LocalFileHandle,
  PutOpts,
  PutResult,
  StorageDriver,
  StorageKind,
  StorageWritable,
} from './base'

/** Корень по умолчанию: `<backend>/uploads` (в Docker — `/app/uploads`, WORKDIR=/app). */
const DEFAULT_UPLOADS_ROOT = resolve(getModuleDir(import.meta), '../../../uploads')

/**
 * Корень локального хранилища. `UPLOADS_DIR` читается из `process.env` напрямую
 * (как `NAWODE_DATABASE_URL`, `GOOGLE_PHOTOS_DIR` и прочие пути в этом проекте),
 * чтобы значение можно было переопределить в тестах и одноразовых скриптах.
 * В `config.ts` переменная объявлена для валидации и документации.
 */
export function uploadsRoot(): string {
  const override = process.env.UPLOADS_DIR?.trim()
  return override ? resolve(override) : DEFAULT_UPLOADS_ROOT
}

export class LocalStorageDriver implements StorageDriver {
  readonly kind: StorageKind = 'local'

  describe(): Record<string, unknown> {
    return { driver: 'local', root: uploadsRoot(), writer: writerKind() }
  }

  /**
   * Ключ → абсолютный путь. Проверка «не выходит за корень» дублирует валидацию
   * в `keys.ts` намеренно (defense in depth — ровно та же проверка, что стояла
   * в `app.ts` до рефактора). Сработать она может только на баге вызывающего,
   * поэтому бросает, а не возвращает null.
   */
  private pathFor(key: StorageKey): string {
    const root = uploadsRoot()
    const abs = resolve(root, key)
    if (abs !== root && !abs.startsWith(root + sep)) {
      throw new Error(`Storage key escapes uploads root: ${JSON.stringify(key)}`)
    }
    return abs
  }

  /**
   * Локальный аналог `HeadBucket`: корень должен быть доступен на запись.
   * Именно `mkdir`, а не `stat`: отсутствие каталога — не поломка (его создаёт любая
   * запись), а вот пустой том или права только на чтение — как раз то, что нужно поймать.
   */
  async ping(): Promise<void> {
    const root = uploadsRoot()
    await mkdir(root, { recursive: true })
    const st = await stat(root)
    if (!st.isDirectory()) throw new Error(`Uploads root не каталог: ${root}`)
  }

  async put(key: StorageKey, data: StorageWritable, _opts?: PutOpts): Promise<PutResult> {
    const absPath = this.pathFor(key)
    await mkdir(dirname(absPath), { recursive: true })
    const size = await writeStreamedFile(absPath, data)
    return { key, url: urlFromKey(key), size }
  }

  async putFromLocalFile(key: StorageKey, sourcePath: string, _opts?: PutOpts): Promise<PutResult> {
    const absPath = this.pathFor(key)
    await mkdir(dirname(absPath), { recursive: true })
    // Источник уже лежит по целевому пути — копировать нечего.
    if (resolve(sourcePath) !== absPath) {
      // Сначала `rename`: с Фазы 2 ffmpeg пишет в `<uploadsRoot>/.tmp`, то есть на тот же
      // том, и перемещение там — операция над метаданными, а не перекладывание 166 МБ.
      // Раньше копирования не было вовсе (ffmpeg писал прямо в целевой путь), и без этой
      // ветки локальный режим — то есть режим ОТКАТА — стал бы медленнее прежнего.
      // `EXDEV` возможен, если `STORAGE_TMP_DIR` увели на другую файловую систему.
      try {
        await rename(sourcePath, absPath)
      } catch (err) {
        if ((err as { code?: string })?.code !== 'EXDEV') throw err
        await copyFile(sourcePath, absPath) // потоком внутри, без подъёма файла в память
        await unlink(sourcePath).catch(() => {})
      }
    }
    const { size } = await stat(absPath)
    return { key, url: urlFromKey(key), size }
  }

  async get(key: StorageKey): Promise<Buffer<ArrayBuffer>> {
    return await readFile(this.pathFor(key))
  }

  async getStream(key: StorageKey): Promise<ReadableStream<Uint8Array>> {
    // node:fs работает и в Bun, и в Node — единый путь без рантайм-детекта.
    // Каст через unknown: node-типы отдают ReadableStream<any> без BYOB-перегрузки.
    return Readable.toWeb(createReadStream(this.pathFor(key))) as unknown as ReadableStream<Uint8Array>
  }

  async exists(key: StorageKey): Promise<boolean> {
    return (await this.size(key)) !== null
  }

  async size(key: StorageKey): Promise<number | null> {
    try {
      const st = await stat(this.pathFor(key))
      return st.isFile() ? st.size : null
    } catch (err) {
      if (isMissing(err)) return null
      throw err
    }
  }

  async delete(key: StorageKey): Promise<boolean> {
    // Best-effort: БД — источник правды, осиротевший файл на диске не должен ронять запрос.
    try {
      await unlink(this.pathFor(key))
      return true
    } catch {
      return false
    }
  }

  async serve(key: StorageKey, _req: Request): Promise<Response | null> {
    const absPath = this.pathFor(key)
    // Bun.file как Response даёт Range и Content-Type бесплатно — как и до рефактора.
    const file = bunFile(absPath)
    if (!file || !(await file.exists())) return null
    return new Response(file as unknown as BodyInit, {
      headers: {
        // CORS: canvas с crossOrigin='anonymous' должен читать пиксели без tainted-canvas
        // (экспорт сторис/дизайн-слоя). Файлы публичные, поэтому wildcard безопасен.
        'Access-Control-Allow-Origin': '*',
        // Умеренный кэш. При повороте файла фронт добавляет ?v=<ts> — URL меняется
        // и пробивает кэш, поэтому max-age не показывает старую версию.
        'Cache-Control': 'public, max-age=300',
      },
    })
  }

  async localFile(key: StorageKey): Promise<LocalFileHandle | null> {
    const absPath = this.pathFor(key)
    if ((await this.size(key)) === null) return null
    // Локально файл уже «материализован» — чистить нечего.
    return { path: absPath, dispose: async () => {} }
  }

  async withLocalFile<T>(key: StorageKey, fn: (localPath: string) => Promise<T>): Promise<T> {
    const handle = await this.localFile(key)
    if (!handle) throw new Error(`Storage object not found: ${key}`)
    try {
      return await fn(handle.path)
    } finally {
      await handle.dispose()
    }
  }
}
