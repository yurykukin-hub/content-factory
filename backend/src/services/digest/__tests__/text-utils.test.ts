import { describe, it, expect } from 'vitest'
import { windLabel, parseJsonLoose } from '../text-utils'

describe('parseJsonLoose — безопасный парс JSON из ответа LLM', () => {
  it('парсит чистый JSON-объект', () => {
    expect(parseJsonLoose<{ a: number }>('{"a":1}')).toEqual({ a: 1 })
  })

  it('срезает markdown-обёртку ```json … ```', () => {
    const raw = '```json\n{"ideas":[{"theme":"sup"}]}\n```'
    expect(parseJsonLoose<{ ideas: any[] }>(raw)).toEqual({ ideas: [{ theme: 'sup' }] })
  })

  it('срезает обёртку ``` без языка', () => {
    expect(parseJsonLoose<{ x: boolean }>('```\n{"x":true}\n```')).toEqual({ x: true })
  })

  it('обрезает ведущие/хвостовые пробелы и переводы строк', () => {
    expect(parseJsonLoose<{ ok: number }>('   \n {"ok":2}\n  ')).toEqual({ ok: 2 })
  })

  it('возвращает null на невалидном JSON (а не бросает)', () => {
    expect(parseJsonLoose('это не json, просто текст модели')).toBeNull()
  })

  it('возвращает null на оборванном/частичном JSON', () => {
    expect(parseJsonLoose('{"ideas":[{"theme":')).toBeNull()
  })

  it('возвращает null на пустой строке', () => {
    expect(parseJsonLoose('')).toBeNull()
  })

  it('не падает на null/undefined входе → null', () => {
    expect(parseJsonLoose(null as unknown as string)).toBeNull()
    expect(parseJsonLoose(undefined as unknown as string)).toBeNull()
  })

  it('парсит массив верхнего уровня', () => {
    expect(parseJsonLoose<number[]>('[1,2,3]')).toEqual([1, 2, 3])
  })
})

describe('windLabel — скорость ветра (м/с) → словами', () => {
  it('null/undefined → «ветер спокойный»', () => {
    expect(windLabel(null)).toBe('ветер спокойный')
    expect(windLabel(undefined)).toBe('ветер спокойный')
  })

  it('границы диапазонов', () => {
    expect(windLabel(0)).toBe('штиль')        // < 2
    expect(windLabel(1.9)).toBe('штиль')
    expect(windLabel(2)).toBe('слабый ветер')  // [2,4)
    expect(windLabel(3.9)).toBe('слабый ветер')
    expect(windLabel(4)).toBe('умеренный ветер') // [4,7)
    expect(windLabel(6.9)).toBe('умеренный ветер')
    expect(windLabel(7)).toBe('свежий ветер')   // [7,10)
    expect(windLabel(9.9)).toBe('свежий ветер')
    expect(windLabel(10)).toBe('сильный ветер')  // >= 10
    expect(windLabel(25)).toBe('сильный ветер')
  })
})
