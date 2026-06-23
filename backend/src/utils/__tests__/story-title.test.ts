import { describe, it, expect } from 'vitest'
import { cleanStoryTitle } from '../story-title'

describe('cleanStoryTitle', () => {
  it('убирает температуру, «температура»→«погода», ведущий день, капитализирует', () => {
    expect(cleanStoryTitle('Вторник +20°C — идеальная температура для комфортного SUP'))
      .toBe('Идеальная погода для комфортного SUP')
  })

  it('убирает ведущий день недели', () => {
    expect(cleanStoryTitle('Понедельник — время на воду')).toBe('Время на воду')
    expect(cleanStoryTitle('Воскресенье +23°C на доске')).toBe('На доске')
  })

  it('не трогает живые заголовки без температуры/дня', () => {
    expect(cleanStoryTitle('Идеальное утро для SUP')).toBe('Идеальное утро для SUP')
    expect(cleanStoryTitle('Выборг зовёт на воду')).toBe('Выборг зовёт на воду')
    expect(cleanStoryTitle('Доброе утро, Выборг!')).toBe('Доброе утро, Выборг!')
  })

  it('«температура» заменяется на «погода» в любой форме', () => {
    expect(cleanStoryTitle('Комфортная температура сегодня')).toBe('Комфортная погода сегодня')
  })

  it('грейсфул на пустом', () => {
    expect(cleanStoryTitle('')).toBe('')
    expect(cleanStoryTitle(null as any)).toBe('')
  })

  it('не путает SUP/слова с числами без градуса', () => {
    expect(cleanStoryTitle('SUP-маршрут 2026 года')).toBe('SUP-маршрут 2026 года') // нет ° — число не трогаем
  })
})
