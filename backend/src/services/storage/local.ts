/**
 * Локальный драйвер хранилища — текущее поведение (файлы в uploads-volume),
 * завёрнутое в интерфейс `StorageDriver`. Это единственная реализация в Фазе 1;
 * `s3.ts` появится в Фазе 2 и заменит её переключением `STORAGE_DRIVER`.
 */

import { createReadStream } from 'fs'
import { copyFile, mkdir, readFile, stat, unlink } from 'fs/promises'
import { Readable } from 'stream'
import { dirname, join, resolve, sep } from 'path'
import { getModuleDir } from '../../utils/paths'
import { urlFromKey, type StorageKey } from './keys'
import type {
  LocalFileHandle,
  PutOpts,
  PutResult,
  StorageDriver,
  StorageKind,
  StorageWritable,
} from './base'

/**
 * `Bun.write(path, blob)` пишет Blob потоком, не поднимая вторую полную копию в память —
 * это осознанный анти-OOM выбор для видео до 500 МБ при лимите контейнера 2 ГБ
 * (см. историю `routes/media.ts` POST /upload). Прод работает на Bun, поэтому байт-путь
 * остаётся прежним; фолбэк нужен только для Node/Vitest, где `Bun.write` не полифиллен
 * (`vitest-setup.ts` подменяет лишь `Bun.password` и `Bun.file`).
 *
 * Детект один раз на импорте модуля и попадает в boot-лог: если в проде вдруг
 * окажется `writer: "node"`, это видно сразу, а не по OOM под нагрузкой.
 */
type BunLike = {
  write?: (path: string, data: unknown) => Promise<number>
  file?: (path: string) => { exists(): Promise<boolean>; stream?(): ReadableStream<Uint8Array> }
}
const bun = (globalThis as { Bun?: BunLike }).Bun
const hasBunWrite = typeof bun?.write === 'function'

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

/**
 * PHASE-2 DEBT. Локальный каталог бизнеса. Нужен местам, где ffmpeg пишет ВРЕМЕННЫЕ
 * файлы рядом с результатом (`overlay_*.png`, `*_txt.mp4`, `*_raw.png`): у S3 такого
 * каталога не существует, поэтому метод намеренно НЕ на интерфейсе `StorageDriver`.
 *
 * В Фазе 2 заменяется на выделенный temp-каталог. Сейчас перенос в `os.tmpdir()`
 * был бы регрессией: сегодня temp живёт на uploads-volume, а `/tmp` в контейнере —
 * это overlay-фс корневого диска (занят на 81%, там же postgres), и промежуточный
 * файл от 500-МБ видео дал бы туда 0.5–1 ГБ.
 *
 * Вызывающие: routes/media.ts (overlay-video), services/overlay/render-overlay.ts.
 */
export async function localBizDir(businessId: string): Promise<string> {
  const dir = join(uploadsRoot(), businessId)
  await mkdir(dir, { recursive: true })
  return dir
}

/** Запись байтов: прод — `Bun.write`, Node/Vitest — стримовый фолбэк (тоже без буферизации Blob). */
async function writeBytes(absPath: string, data: StorageWritable): Promise<number> {
  if (hasBunWrite) return await bun!.write!(absPath, data)

  if (data instanceof Blob) {
    // Стрим и в фолбэке — чтобы его нельзя было случайно сделать прод-путём
    // и незаметно получить материализацию 500 МБ в памяти.
    const { pipeline } = await import('stream/promises')
    const { createWriteStream } = await import('fs')
    await pipeline(Readable.fromWeb(data.stream() as never), createWriteStream(absPath))
    return data.size
  }

  const { writeFile } = await import('fs/promises')
  const buf =
    typeof data === 'string'
      ? Buffer.from(data)
      : data instanceof ArrayBuffer
        ? Buffer.from(data)
        : Buffer.from(data as Uint8Array)
  await writeFile(absPath, buf)
  return buf.length
}

function isMissing(err: unknown): boolean {
  return (err as { code?: string })?.code === 'ENOENT'
}

export class LocalStorageDriver implements StorageDriver {
  readonly kind: StorageKind = 'local'

  describe(): Record<string, unknown> {
    return { driver: 'local', root: uploadsRoot(), writer: hasBunWrite ? 'bun' : 'node' }
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

  async put(key: StorageKey, data: StorageWritable, _opts?: PutOpts): Promise<PutResult> {
    const absPath = this.pathFor(key)
    await mkdir(dirname(absPath), { recursive: true })
    const size = await writeBytes(absPath, data)
    return { key, url: urlFromKey(key), size }
  }

  async putFromLocalFile(key: StorageKey, sourcePath: string, _opts?: PutOpts): Promise<PutResult> {
    const absPath = this.pathFor(key)
    await mkdir(dirname(absPath), { recursive: true })
    // Источник уже лежит по целевому пути (ffmpeg писал сразу в него) — копировать нечего.
    if (resolve(sourcePath) !== absPath) {
      await copyFile(sourcePath, absPath) // потоком внутри, без подъёма файла в память
    }
    const { size } = await stat(absPath)
    return { key, url: urlFromKey(key), size }
  }

  async get(key: StorageKey): Promise<Buffer> {
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
    const file = bun?.file?.(absPath)
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
