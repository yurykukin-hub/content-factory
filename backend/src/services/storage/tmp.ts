/**
 * Временные файлы для инструментов, которые умеют только пути на диске (ffmpeg).
 *
 * Зачем отдельный модуль: до Фазы 2 такие файлы писались `localBizDir()` — прямо в каталог
 * бизнеса внутри uploads. При локальном драйвере это было даже выгодно (ffmpeg писал сразу
 * в целевой путь, и «загрузка» результата сводилась к нулю), но у S3 каталога бизнеса
 * не существует, а времянки не должны попадать в раздачу и в перенос данных.
 *
 * Почему НЕ `os.tmpdir()`: в контейнере это overlay-фс корневого диска (занят на 84%,
 * там же postgres), и промежуточный файл от 500-МБ видео дал бы туда 0.5–1 ГБ.
 * Дефолт — `<uploadsRoot>/.tmp`, то есть тот же том, что и uploads. Это важно ещё и для
 * `putFromLocalFile`: локальный драйвер перемещает файл `rename()`-ом, а он работает
 * только в пределах одной файловой системы.
 *
 * Раздача времянок закрыта в `keys.ts`: `keyFromRequestPath` отвергает сегменты,
 * начинающиеся с точки, поэтому `GET /uploads/.tmp/...` — это 403, а не файл.
 */

import { mkdir, mkdtemp, rm } from 'fs/promises'
import { join } from 'path'
import { config } from '../../config'
import { log } from '../../utils/logger'
import { uploadsRoot } from './local'

/** Корень времянок. `STORAGE_TMP_DIR` пусто ⇒ `<uploadsRoot>/.tmp`. */
export function tmpRoot(): string {
  const override = config.STORAGE_TMP_DIR.trim()
  return override || join(uploadsRoot(), '.tmp')
}

/**
 * Одновременных тяжёлых пайплайнов. До Фазы 2 ограничителя не было вовсе, и это сходило
 * с рук: входы ffmpeg уже лежали на диске, а результат писался прямо в целевой файл.
 * Теперь одна overlay-операция материализует исходное видео (на проде до 166 МБ), аудио,
 * слой, промежуточный и итоговый файлы — 3–4× размера исходника, и всё это на разделе,
 * где свободно ~6 ГБ. Два параллельных запроса помещаются, неограниченное число — нет.
 */
const MAX_CONCURRENT_JOBS = 2

/** Неснижаемый запас: на этом же разделе живёт postgres, ронять его нельзя. */
const DISK_RESERVE_BYTES = 1024 * 1024 * 1024

let activeJobs = 0
const waiters: Array<() => void> = []

async function acquireSlot(): Promise<void> {
  if (activeJobs < MAX_CONCURRENT_JOBS) {
    activeJobs++
    return
  }
  await new Promise<void>((resolve) => waiters.push(resolve))
  activeJobs++
}

function releaseSlot(): void {
  activeJobs--
  waiters.shift()?.()
}

/** «Нет места на диске» — по этой ошибке вызывающий отдаёт 503, а не 500. */
export class StorageSpaceError extends Error {
  readonly code = 'STORAGE_NO_SPACE'
}

/**
 * Хватает ли места. `statfs` есть не во всех рантаймах, поэтому при его отсутствии
 * проверку пропускаем: отказать в работе из-за неумения измерить хуже, чем не измерить.
 */
async function assertSpace(root: string, needBytes: number): Promise<void> {
  if (needBytes <= 0) return
  try {
    const { statfs } = await import('fs/promises')
    if (typeof statfs !== 'function') return
    const st = await statfs(root)
    const free = Number(st.bavail) * Number(st.bsize)
    if (free < needBytes + DISK_RESERVE_BYTES) {
      throw new StorageSpaceError(
        `Недостаточно места: свободно ${Math.round(free / 1e6)} МБ, ` +
          `нужно ~${Math.round((needBytes + DISK_RESERVE_BYTES) / 1e6)} МБ`,
      )
    }
  } catch (e) {
    if (e instanceof StorageSpaceError) throw e
    // Любая другая ошибка — просто не смогли измерить, это не повод отказывать.
  }
}

/**
 * Выделить временный каталог и гарантированно снести его вместе со всем содержимым.
 *
 * Каталог, а не файл: у ffmpeg-пайплайнов несколько промежуточных артефактов
 * (`overlay_*.png`, `*_txt.mp4`, превью), и раньше каждый требовал своего `unlink`
 * в `finally` — при исключении между шагами часть из них утекала. Один `rm -rf`
 * на каталог закрывает все ветки, включая падение ffmpeg на середине.
 *
 * `estimatedBytes` — размер исходника; под пайплайн резервируется четырёхкратный запас.
 * Отказать сразу честнее, чем поймать ENOSPC на середине ffmpeg и оставить битый файл.
 */
export async function withTempDir<T>(
  fn: (dir: string) => Promise<T>,
  opts?: { estimatedBytes?: number },
): Promise<T> {
  const root = tmpRoot()
  await mkdir(root, { recursive: true })
  await acquireSlot()
  try {
    await assertSpace(root, (opts?.estimatedBytes ?? 0) * 4)
    const dir = await mkdtemp(join(root, 'cf-'))
    try {
      return await fn(dir)
    } finally {
      await rm(dir, { recursive: true, force: true }).catch((e) => {
        // Не роняем уже успешный запрос из-за неудачной уборки, но и молчать нельзя:
        // накопление времянок — это медленная утечка диска, а он на 84%.
        log.warn('[storage] не удалось удалить временный каталог', { dir, error: String(e) })
      })
    }
  } finally {
    releaseSlot()
  }
}

/**
 * Снести всё содержимое корня времянок. Вызывается один раз на старте: инстанс
 * приложения единственный, ничего кроме брошенных времянок там не живёт, поэтому
 * сканировать по возрасту незачем — после рестарта любой остаток заведомо сирота
 * (процесс, который его держал, уже мёртв).
 */
export async function cleanTmpRootOnBoot(): Promise<void> {
  const root = tmpRoot()
  try {
    await rm(root, { recursive: true, force: true })
    await mkdir(root, { recursive: true })
  } catch (e) {
    log.warn('[storage] не удалось очистить каталог времянок на старте', {
      root,
      error: String(e),
    })
  }
}
