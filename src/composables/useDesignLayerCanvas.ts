/**
 * Переиспользуемая логика «дизайн-слоя»: рисование стилизованного текста на canvas
 * + экспорт прозрачного PNG для запекания в медиа (фото/видео) через
 * POST /api/media/bake-design-layer.
 *
 * Извлечено из проверенной логики StoryEditorView (drawTextOverlay/exportOverlayPng)
 * и обобщено под ЛЮБОЙ аспект (не только 9:16). Размеры — относительные к ширине
 * холста, поэтому слой одинаково корректен и для 1:1, и для 9:16, и для 16:9.
 */
export type TextPosition = 'top' | 'center' | 'bottom'
export type TextAlign = 'left' | 'center' | 'right'
export type BgStyle = 'none' | 'dark' | 'light'
export type BgRadius = 'sharp' | 'round'
export type FontSize = 'S' | 'M' | 'L'

export interface DesignTextOptions {
  text: string
  position: TextPosition
  align: TextAlign
  color: string
  bgStyle: BgStyle
  bgRadius: BgRadius
}

// Размер шрифта относительно ширины холста (S/M/L) — масштабируется на любой размер медиа.
export const FONT_FACTORS: Record<FontSize, number> = { S: 0.045, M: 0.06, L: 0.08 }

/** Размер шрифта (px) в координатах холста заданной ширины. */
export function fontPxFor(size: FontSize, canvasWidth: number): number {
  return Math.round(canvasWidth * FONT_FACTORS[size])
}

/**
 * Рисует стилизованный текст-слой на ctx размера w×h (прозрачный фон — для bake).
 * Чистая функция: не зависит от Vue-состояния, всё через параметры.
 */
export function drawTextLayer(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  fSize: number,
  opts: DesignTextOptions,
): void {
  const { text, align, position, color, bgStyle, bgRadius } = opts
  if (!text.trim()) return

  ctx.font = `bold ${fSize}px 'Segoe UI Emoji', 'Noto Color Emoji', sans-serif`
  ctx.textAlign = align

  // Перенос строк
  const padding = Math.round(w * 0.055) // относительный отступ (≈20px при w=360)
  const maxW = w - padding * 2 - 20
  const words = text.split(' ')
  const lines: string[] = []
  let line = ''
  for (const word of words) {
    const test = line ? line + ' ' + word : word
    if (ctx.measureText(test).width > maxW && line) {
      lines.push(line)
      line = word
    } else {
      line = test
    }
  }
  if (line) lines.push(line)

  const lineH = fSize * 1.3
  const blockH = lines.length * lineH + 24

  let y: number
  if (position === 'top') y = Math.round(h * 0.06) + fSize
  else if (position === 'center') y = (h - blockH) / 2
  else y = h - blockH - Math.round(h * 0.04)

  // Подложка
  if (bgStyle !== 'none') {
    ctx.fillStyle = bgStyle === 'dark' ? 'rgba(0,0,0,0.5)' : 'rgba(255,255,255,0.7)'
    const radius = bgRadius === 'round' ? Math.round(w * 0.033) : 0
    ctx.beginPath()
    ctx.roundRect(padding, y, w - padding * 2, blockH, radius)
    ctx.fill()
  }

  // X текста по выравниванию
  let textX: number
  if (align === 'left') textX = padding + 12
  else if (align === 'right') textX = w - padding - 12
  else textX = w / 2

  // Текст с мягкой тенью для читаемости поверх любого фона
  ctx.fillStyle = color
  ctx.shadowColor = 'rgba(0,0,0,0.5)'
  ctx.shadowBlur = bgStyle === 'none' ? Math.round(fSize * 0.12) : Math.round(fSize * 0.06)
  lines.forEach((ln, i) => {
    ctx.fillText(ln, textX, y + 14 + (i + 0.8) * lineH)
  })
  ctx.shadowBlur = 0
}

/**
 * Экспорт прозрачного PNG-слоя текста в разрешении exportW×exportH.
 * Бэкенд (bake-design-layer) сам подгонит слой под точный размер медиа,
 * поэтому достаточно правильного АСПЕКТА + высокого разрешения для чёткости.
 */
export async function exportTextLayerPng(
  exportW: number,
  exportH: number,
  fSizeExport: number,
  opts: DesignTextOptions,
): Promise<Blob> {
  const canvas = document.createElement('canvas')
  canvas.width = exportW
  canvas.height = exportH
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('canvas 2d context недоступен')

  await document.fonts.ready // корректный перенос строк
  ctx.clearRect(0, 0, exportW, exportH)
  drawTextLayer(ctx, exportW, exportH, fSizeExport, opts)

  return new Promise((resolve, reject) =>
    canvas.toBlob(
      b => (b ? resolve(b) : reject(new Error('не удалось сформировать слой текста'))),
      'image/png',
    ),
  )
}
