/**
 * Группа объектов, материализованных на локальном диске для одного ffmpeg-пайплайна.
 *
 * Зачем: у overlay-операций несколько входов (видео + аудио + слой), и все они должны
 * быть файлами — ffmpeg не умеет ни буферы, ни URL. Локально материализация бесплатна
 * (файл уже на диске, `dispose()` — no-op), но в Фазе 2 каждый вход будет скачиваться
 * из S3 во временный файл, и его придётся удалить в любом случае — включая падение
 * ffmpeg на середине. Scope собирает хендлы и чистит их одним `dispose()` в `finally`,
 * поэтому переход на S3 не потребует переписывать управление временными файлами.
 */

import { getStorage } from './base'
import type { LocalFileHandle } from './base'
import { keyFromUrl } from './keys'

export class LocalFileScope {
  private readonly handles: LocalFileHandle[] = []

  /**
   * `MediaFile.url` (или `GenerationSession.audioUrl`) → локальный путь.
   * `null`, если URL не наш или объекта нет — вызывающий сам решает, это 404 или
   * «просто нет музыки» (ровно та же семантика, что была у `if (existsSync(p))`).
   */
  async resolve(url: string | null | undefined): Promise<string | null> {
    const key = keyFromUrl(url)
    if (!key) return null
    const handle = await getStorage().localFile(key)
    if (!handle) return null
    this.handles.push(handle)
    return handle.path
  }

  /** Освободить все материализованные файлы. Идемпотентно, не бросает. */
  async dispose(): Promise<void> {
    while (this.handles.length > 0) {
      const handle = this.handles.pop()!
      try {
        await handle.dispose()
      } catch {
        // Очистка временных файлов — best-effort: она не должна ронять запрос,
        // который уже успешно отдал результат.
      }
    }
  }
}
