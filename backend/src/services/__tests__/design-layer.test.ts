import { describe, it, expect } from 'vitest'
import sharp from 'sharp'
import { join } from 'path'
import { tmpdir } from 'os'
import { mkdtemp, rm, stat } from 'fs/promises'
import { bakeDesignLayerOnPhoto } from '../design-layer'

describe('bakeDesignLayerOnPhoto', () => {
  it('запекает PNG-слой в фото, сохраняя размеры фото и реально композитя слой', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'cf-design-'))
    const photoPath = join(dir, 'photo.jpg')
    const overlayPath = join(dir, 'overlay.png')
    const outPath = join(dir, 'out.jpg')

    // Фото 400×600 (красное)
    await sharp({ create: { width: 400, height: 600, channels: 3, background: { r: 200, g: 30, b: 30 } } })
      .jpeg().toFile(photoPath)

    // Слой ДРУГОГО размера 200×300, полупрозрачный синий — проверяем ресайз под фото + composite
    await sharp({ create: { width: 200, height: 300, channels: 4, background: { r: 0, g: 0, b: 255, alpha: 0.5 } } })
      .png().toFile(overlayPath)

    await bakeDesignLayerOnPhoto(photoPath, overlayPath, outPath)

    const meta = await sharp(outPath).metadata()
    expect(meta.format).toBe('jpeg')
    expect(meta.width).toBe(400)   // размеры фото сохранены (слой подогнан под фото, не наоборот)
    expect(meta.height).toBe(600)

    const { size } = await stat(outPath)
    expect(size).toBeGreaterThan(0)

    // Центральный пиксель: был чистый красный (синий≈0), после полупрозрачного синего слоя — поднялся
    const { data, info } = await sharp(outPath).raw().toBuffer({ resolveWithObject: true })
    const cx = Math.floor(info.width / 2)
    const cy = Math.floor(info.height / 2)
    const idx = (cy * info.width + cx) * info.channels
    expect(data[idx + 2]).toBeGreaterThan(40) // синий канал заметно вырос → слой композитнулся

    await rm(dir, { recursive: true, force: true })
  })

  it('падает с ошибкой, если исходное фото отсутствует', async () => {
    await expect(
      bakeDesignLayerOnPhoto('/nonexistent/photo.jpg', '/nonexistent/overlay.png', join(tmpdir(), 'out.jpg')),
    ).rejects.toThrow()
  })
})
