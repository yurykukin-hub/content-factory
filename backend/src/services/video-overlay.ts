/**
 * Наложение статичного текстового оверлея (прозрачный PNG) на видео через ffmpeg.
 *
 * Зачем: видео-сторис оживляются Seedance (вода/небо движется), а дизайнерский текст
 * должен оставаться НЕПОДВИЖНЫМ. Поэтому текст накладывается ПОСЛЕ генерации видео —
 * прозрачный PNG-слой композитится поверх каждого кадра (видео движется под текстом).
 *
 * PNG масштабируется под фактический размер видео (scale2ref), т.к. canvas отдаёт
 * 1080×1920, а Seedance — 720×1280 или 480×854. Аудио сохраняется если есть.
 * Выход — VK/IG-совместимый H.264 (yuv420p + faststart).
 */

import { exec } from 'child_process'
import { promisify } from 'util'
import { existsSync } from 'fs'
import { log } from '../utils/logger'

const execAsync = promisify(exec)
const RENDER_TIMEOUT = 90_000 // 90с — запас на холодный старт ffmpeg + 15с видео под нагрузкой
const EXEC_OPTS = { timeout: RENDER_TIMEOUT, maxBuffer: 1024 * 1024 * 16 } // ffmpeg шумит в stderr

/**
 * Наложить прозрачный PNG-оверлей на видео.
 * @param videoPath   абсолютный путь к исходному видео (mp4)
 * @param overlayPath абсолютный путь к прозрачному PNG (текст-дизайн)
 * @param outPath     абсолютный путь для результата (.mp4)
 * @throws если ffmpeg не справился обоими методами или файл не создан
 */
export async function overlayImageOnVideo(
  videoPath: string,
  overlayPath: string,
  outPath: string,
): Promise<void> {
  // Основной путь: scale2ref подгоняет PNG под размер видео.
  // ВАЖНО про порядок выходов scale2ref: первым идёт МАСШТАБИРОВАННЫЙ вход ([1:v] → [ovr]),
  // вторым — нетронутый референс ([0:v] → [base]). Перепутать = краш/текст не отрисуется.
  const primary =
    `ffmpeg -y -i "${videoPath}" -i "${overlayPath}" ` +
    `-filter_complex "[1:v][0:v]scale2ref=w=iw:h=ih[ovr][base];[base][ovr]overlay=0:0:format=auto[outv]" ` +
    `-map "[outv]" -map "0:a?" ` +
    `-c:v libx264 -profile:v high -level 4.0 -pix_fmt yuv420p -preset veryfast -crf 20 -movflags +faststart ` +
    `-c:a aac -b:a 128k -max_muxing_queue_size 1024 "${outPath}"`

  try {
    await execAsync(primary, EXEC_OPTS)
  } catch (primaryErr) {
    // Fallback: узнать размеры видео через ffprobe и масштабировать PNG фиксированно.
    log.warn('[VideoOverlay] scale2ref failed, trying ffprobe+scale fallback', {
      error: String(primaryErr).slice(0, 200),
    })
    let w = 720
    let h = 1280
    try {
      const { stdout } = await execAsync(
        `ffprobe -v error -select_streams v:0 -show_entries stream=width,height -of csv=p=0 "${videoPath}"`,
        { timeout: 10_000 },
      )
      const [pw, ph] = stdout.trim().split(',').map(Number)
      if (pw && ph) { w = pw; h = ph }
    } catch { /* keep defaults */ }

    const fallback =
      `ffmpeg -y -i "${videoPath}" -i "${overlayPath}" ` +
      `-filter_complex "[1:v]scale=${w}:${h}[ovr];[0:v][ovr]overlay=0:0:format=auto[outv]" ` +
      `-map "[outv]" -map "0:a?" ` +
      `-c:v libx264 -pix_fmt yuv420p -preset veryfast -crf 20 -movflags +faststart ` +
      `-c:a aac -b:a 128k "${outPath}"`
    await execAsync(fallback, EXEC_OPTS)
  }

  if (!existsSync(outPath)) {
    throw new Error('ffmpeg завершился без ошибки, но выходной файл не создан')
  }
}
