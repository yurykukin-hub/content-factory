/**
 * Рендер HTML → PNG для дизайн-слоя соцсетей (Ф2). satori (HTML→SVG) → resvg (SVG→PNG).
 * Лёгкий, без браузера — работает в Bun+Alpine. CSS: flexbox + inline-стили (satori-ограничения).
 * Шрифты бренда (Montserrat/Cormorant) из src/assets/fonts (копия print-kit).
 */
import satori from 'satori'
import { Resvg } from '@resvg/resvg-js'
import { readFile } from 'fs/promises'
import { join } from 'path'
import { getModuleDir } from '../utils/paths'
import { getStorage, keyFromUrl, publicUrl } from './storage'

const FONT_DIR = join(getModuleDir(import.meta), '../assets/fonts')

let fontCache: any[] | null = null
async function loadFonts() {
  if (fontCache) return fontCache
  const [montBold, montSemi, cormBold, cormSemi] = await Promise.all([
    readFile(join(FONT_DIR, 'Montserrat-Bold.ttf')),
    readFile(join(FONT_DIR, 'Montserrat-SemiBold.ttf')),
    readFile(join(FONT_DIR, 'Cormorant-Bold.ttf')),
    readFile(join(FONT_DIR, 'Cormorant-SemiBold.ttf')),
  ])
  fontCache = [
    { name: 'Montserrat', data: montBold, weight: 700, style: 'normal' },
    { name: 'Montserrat', data: montSemi, weight: 600, style: 'normal' },
    { name: 'Cormorant', data: cormBold, weight: 700, style: 'normal' },
    { name: 'Cormorant', data: cormSemi, weight: 600, style: 'normal' },
  ]
  return fontCache
}

/**
 * Скачать изображение (URL или /uploads-путь) и вернуть data URI для встраивания в satori.
 *
 * Своё медиа берём НАПРЯМУЮ из хранилища. Раньше здесь был self-fetch по собственному
 * публичному адресу, то есть backend → публичный DNS → Caddy → backend → раздача → диск.
 * С объектным хранилищем к этому добавился бы ещё и поход в S3 из собственного же
 * обработчика — пять хопов ради байтов, которые лежат в одном вызове. Заодно уходит
 * целый класс отказов: self-deadlock при исчерпании воркеров, таймауты Caddy, DNS.
 * Внешние `http(s)://` (KIE CDN и прочее) по-прежнему качаются через fetch.
 */
export async function imageToDataUri(src: string): Promise<string | null> {
  try {
    const key = keyFromUrl(src)
    if (key) {
      const buf = await getStorage().get(key)
      return `data:${mimeFromKey(key)};base64,${buf.toString('base64')}`
    }
    const res = await fetch(publicUrl(src))
    if (!res.ok) return null
    const buf = Buffer.from(await res.arrayBuffer())
    const mime = res.headers.get('content-type') || 'image/jpeg'
    return `data:${mime};base64,${buf.toString('base64')}`
  } catch {
    return null
  }
}

/** MIME по расширению ключа: раздача его больше не сообщает, а satori тип нужен. */
function mimeFromKey(key: string): string {
  const ext = key.slice(key.lastIndexOf('.') + 1).toLowerCase()
  if (ext === 'png') return 'image/png'
  if (ext === 'webp') return 'image/webp'
  if (ext === 'gif') return 'image/gif'
  return 'image/jpeg'
}

/**
 * Хелпер построения satori-узлов (вместо HTML-строк — satori-html/ultrahtml глючит в Bun).
 * el('div', {display:'flex', ...}, [дети | строка]).
 */
export function el(type: string, style: Record<string, any>, children?: any): any {
  return { type, props: { style, ...(children !== undefined ? { children } : {}) } }
}

/** Рендер satori-узла → PNG buffer (satori → SVG → resvg → PNG). */
export async function renderToPng(node: any, width: number, height: number): Promise<Buffer> {
  const fonts = await loadFonts()
  const svg = await satori(node, { width, height, fonts })
  const resvg = new Resvg(svg, { fitTo: { mode: 'width', value: width } })
  return Buffer.from(resvg.render().asPng())
}
