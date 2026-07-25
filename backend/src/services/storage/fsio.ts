/**
 * Запись байтов на локальный диск без материализации второй копии в памяти.
 *
 * Вынесено из `local.ts` отдельно, потому что нужно двум разным потребителям:
 * локальному драйверу (запись объекта) и коду, который готовит вход для ffmpeg
 * во временном каталоге (ffmpeg не умеет ни буферы, ни URL). Дублировать
 * рантайм-детект Bun в двух местах нельзя — разъедется.
 *
 * `Bun.write(path, blob)` пишет Blob потоком: это осознанный анти-OOM выбор для видео
 * до 500 МБ при лимите контейнера 2 ГБ. Прод работает на Bun, поэтому байт-путь там
 * прежний; фолбэк нужен только для Node/Vitest, где `Bun.write` не полифиллен
 * (`vitest-setup.ts` подменяет лишь `Bun.password` и `Bun.file`), и он тоже стримовый —
 * чтобы его нельзя было случайно сделать прод-путём и незаметно получить 500 МБ в памяти.
 */

import { Readable } from 'stream'
import type { StorageWritable } from './base'

type BunLike = {
  write?: (path: string, data: unknown) => Promise<number>
  file?: (path: string) => { exists(): Promise<boolean>; stream?(): ReadableStream<Uint8Array> }
}

const bun = (globalThis as { Bun?: BunLike }).Bun
const hasBunWrite = typeof bun?.write === 'function'

/** Для boot-лога: `bun` — прод-путь, `node` — фолбэк (виден сразу, а не по OOM под нагрузкой). */
export function writerKind(): 'bun' | 'node' {
  return hasBunWrite ? 'bun' : 'node'
}

/** Доступ к `Bun.file` для тех мест, где он даёт Range и Content-Type бесплатно. */
export function bunFile(path: string) {
  return bun?.file?.(path)
}

/** Записать данные в файл. Blob — потоком, остальное — одним буфером. */
export async function writeStreamedFile(absPath: string, data: StorageWritable): Promise<number> {
  if (hasBunWrite) return await bun!.write!(absPath, data)

  if (data instanceof Blob) {
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
