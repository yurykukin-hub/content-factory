import sharp from 'sharp'

interface OverlayOptions {
  position?: 'top' | 'center' | 'bottom'
  fontSize?: number
  color?: string
  bgColor?: string
  maxWidth?: number
  padding?: number
}

/**
 * Наложить текст на изображение.
 * Используется для VK Stories — текстовые стикеры не поддерживаются через API.
 */
export async function overlayTextOnImage(
  imageBuffer: Buffer,
  text: string,
  options: OverlayOptions = {}
): Promise<Buffer> {
  const {
    position = 'bottom',
    fontSize = 48,
    color = '#ffffff',
    bgColor = 'rgba(0,0,0,0.5)',
    padding = 40,
  } = options

  // Получить размеры изображения
  const metadata = await sharp(imageBuffer).metadata()
  const width = metadata.width || 1080
  const height = metadata.height || 1920

  const maxTextWidth = width - padding * 2

  // Разбить текст на строки (примерно по ширине)
  const charsPerLine = Math.floor(maxTextWidth / (fontSize * 0.55))
  const lines = wrapText(text, charsPerLine)
  const lineHeight = fontSize * 1.3
  const blockHeight = lines.length * lineHeight + padding * 2

  // Определить позицию Y
  let yPos: number
  if (position === 'top') {
    yPos = padding * 2
  } else if (position === 'center') {
    yPos = Math.floor((height - blockHeight) / 2)
  } else {
    yPos = height - blockHeight - padding * 2
  }

  // Создать SVG overlay с текстом
  const textSvg = `
    <svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">
      <rect x="${padding}" y="${yPos}" width="${width - padding * 2}" height="${blockHeight}" rx="16" fill="${bgColor}" />
      ${lines.map((line, i) => `
        <text x="${width / 2}" y="${yPos + padding + (i + 0.8) * lineHeight}"
          text-anchor="middle"
          font-family="'Noto Color Emoji', Arial, Helvetica, sans-serif"
          font-size="${fontSize}"
          font-weight="bold"
          fill="${color}"
          filter="drop-shadow(0 2px 4px rgba(0,0,0,0.3))"
        >${escapeXml(line)}</text>
      `).join('')}
    </svg>
  `

  // Наложить SVG на изображение
  return sharp(imageBuffer)
    .composite([{
      input: Buffer.from(textSvg),
      top: 0,
      left: 0,
    }])
    .toBuffer()
}

function wrapText(text: string, maxChars: number): string[] {
  const words = text.split(' ')
  const lines: string[] = []
  let currentLine = ''

  for (const word of words) {
    if ((currentLine + ' ' + word).trim().length > maxChars) {
      if (currentLine) lines.push(currentLine.trim())
      currentLine = word
    } else {
      currentLine = currentLine ? currentLine + ' ' + word : word
    }
  }
  if (currentLine) lines.push(currentLine.trim())
  return lines
}

function escapeXml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}
