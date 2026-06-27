import { describe, it, expect, beforeEach, vi } from 'vitest'

const { mockDb } = vi.hoisted(() => {
  const m = () => ({ findMany: vi.fn().mockResolvedValue([]) })
  return { mockDb: { mediaFolder: m(), mediaFile: m(), autoPostTask: m() } }
})
vi.mock('../../../db', () => ({ db: mockDb }))

import { detectRouteFolder, searchGalleryPhotos, getRecentlyUsedPhotoIds } from '../photo-search'

beforeEach(() => vi.clearAllMocks())

describe('detectRouteFolder — папка-маршрут по тексту поста', () => {
  it('матчит папку, если все значимые слова (≥4) названия есть в тексте', async () => {
    mockDb.mediaFolder.findMany.mockResolvedValue([{ name: 'Беличьи' }, { name: 'Монрепо' }])
    expect(await detectRouteFolder('b1', 'Беличьи скалы на закате')).toBe('Беличьи')
  })

  it('самое длинное (специфичное) совпадение приоритетно', async () => {
    mockDb.mediaFolder.findMany.mockResolvedValue([{ name: 'Место' }, { name: 'Место Силы' }])
    expect(await detectRouteFolder('b1', 'тур «Место Силы» с причала')).toBe('Место Силы')
  })

  it('null, если маршрут не распознан', async () => {
    mockDb.mediaFolder.findMany.mockResolvedValue([{ name: 'Беличьи' }])
    expect(await detectRouteFolder('b1', 'просто прокат сап')).toBeNull()
  })

  it('null на пустом тексте — без запроса в БД', async () => {
    expect(await detectRouteFolder('b1', '')).toBeNull()
    expect(mockDb.mediaFolder.findMany).not.toHaveBeenCalled()
  })

  it('игнорирует короткие (<4 букв) слова в названии папки', async () => {
    mockDb.mediaFolder.findMany.mockResolvedValue([{ name: 'СУП' }])
    expect(await detectRouteFolder('b1', 'СУП прокат сегодня')).toBeNull()
  })
})

describe('searchGalleryPhotos — поиск фото в галерее', () => {
  it('из папки-маршрута: ранжирует кандидатов по совпадению keywords в altText', async () => {
    mockDb.mediaFile.findMany.mockResolvedValue([
      { id: 'a', altText: 'сап на воде' },
      { id: 'b', altText: 'закат над заливом' },
    ])
    const res = await searchGalleryPhotos('b1', ['закат'], 12, 'Беличьи')
    expect(res.map(r => r.id)).toEqual(['b', 'a'])
  })

  it('пустые keywords без папки → пустой массив, без запроса в БД', async () => {
    const res = await searchGalleryPhotos('b1', [], 12, null)
    expect(res).toEqual([])
    expect(mockDb.mediaFile.findMany).not.toHaveBeenCalled()
  })

  it('по keywords (без папки) возвращает найденные фото', async () => {
    mockDb.mediaFile.findMany.mockResolvedValue([{ id: 'x', altText: 'сап тур' }])
    const res = await searchGalleryPhotos('b1', ['сап'], 12)
    expect(res).toEqual([{ id: 'x', altText: 'сап тур' }])
  })
})

describe('getRecentlyUsedPhotoIds — анти-повтор кадра за N дней', () => {
  it('собирает mediaFileId + развёрнутые sourceMediaId дизайн-сторис', async () => {
    mockDb.autoPostTask.findMany.mockResolvedValue([
      { mediaFileId: 'm1' }, { mediaFileId: 'm2' }, { mediaFileId: null },
    ])
    mockDb.mediaFile.findMany.mockResolvedValue([{ sourceMediaId: 's1' }])
    const used = await getRecentlyUsedPhotoIds('b1', 10)
    expect(used).toBeInstanceOf(Set)
    expect([...used].sort()).toEqual(['m1', 'm2', 's1'])
  })

  it('пустой результат → пустой Set, без второго запроса', async () => {
    mockDb.autoPostTask.findMany.mockResolvedValue([])
    const used = await getRecentlyUsedPhotoIds('b1')
    expect(used.size).toBe(0)
    expect(mockDb.mediaFile.findMany).not.toHaveBeenCalled()
  })
})
