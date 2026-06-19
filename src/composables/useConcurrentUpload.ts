// Параллельная загрузка файлов с ограничением конкуренции (worker-pool).
// Зачем: backend на каждый upload синхронно гоняет sharp (фото) или ffmpeg (видео, timeout 15s).
// Агрессивный параллелизм на VPS (6 ГБ RAM) = риск OOM, поэтому лимит по умолчанию — 3.
// Падение одного файла НЕ прерывает пачку: ошибка попадает в результат, остальные грузятся дальше.

export interface UploadResult<T> {
  file: File
  ok: boolean
  data?: T
  error?: string
}

export interface ConcurrentUploadOptions<T> {
  concurrency?: number
  onProgress?: (done: number, total: number) => void
  onResult?: (result: UploadResult<T>, index: number) => void
}

export async function uploadConcurrent<T>(
  files: File[],
  uploadOne: (file: File) => Promise<T>,
  opts: ConcurrentUploadOptions<T> = {},
): Promise<UploadResult<T>[]> {
  const concurrency = Math.max(1, opts.concurrency ?? 3)
  const total = files.length
  const results: UploadResult<T>[] = new Array(total)
  let done = 0
  let next = 0

  async function worker() {
    while (next < total) {
      const i = next++
      const file = files[i]
      let result: UploadResult<T>
      try {
        const data = await uploadOne(file)
        result = { file, ok: true, data }
      } catch (e: any) {
        result = { file, ok: false, error: e?.message || String(e) }
      }
      results[i] = result
      done++
      opts.onProgress?.(done, total)
      opts.onResult?.(result, i)
    }
  }

  const workers = Array.from({ length: Math.min(concurrency, total) }, () => worker())
  await Promise.all(workers)
  return results
}
