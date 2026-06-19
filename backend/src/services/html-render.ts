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

/** Скачать изображение (URL или /uploads-путь) и вернуть data URI для встраивания в satori. */
export async function imageToDataUri(src: string, isProd: boolean, port: number): Promise<string | null> {
  try {
    const url = src.startsWith('/uploads/')
      ? `${isProd ? 'https://content.yurykukin.ru' : `http://localhost:${port}`}${src}`
      : src
    const res = await fetch(url)
    if (!res.ok) return null
    const buf = Buffer.from(await res.arrayBuffer())
    const mime = res.headers.get('content-type') || 'image/jpeg'
    return `data:${mime};base64,${buf.toString('base64')}`
  } catch {
    return null
  }
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
