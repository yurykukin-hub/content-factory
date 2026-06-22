import { describe, it, expect } from 'vitest'
import { stripInlineHashtags, hasInlineHashtags } from '../hashtags'

describe('stripInlineHashtags', () => {
  it('removes trailing hashtag block (mixed cyrillic+latin)', () => {
    const out = stripInlineHashtags('Отличный день на воде!\n\n#НаWоде #SUP #Выборг')
    expect(out).toBe('Отличный день на воде!')
  })

  it('removes a single inline hashtag mid-text and collapses the space', () => {
    expect(stripInlineHashtags('приходи #сап кататься')).toBe('приходи кататься')
  })

  it('removes multiple consecutive hashtags', () => {
    expect(stripInlineHashtags('Текст #a #b #c')).toBe('Текст')
    expect(stripInlineHashtags('#one #two слова #three')).toBe('слова')
  })

  it('leaves text without hashtags unchanged', () => {
    expect(stripInlineHashtags('Просто текст без тегов')).toBe('Просто текст без тегов')
  })

  it('preserves a URL fragment (# not preceded by whitespace)', () => {
    const t = 'Подробнее https://nawode.ru/page#section тут'
    expect(stripInlineHashtags(t)).toBe(t)
  })

  it('does not strip a markdown-style "# " (space after hash)', () => {
    expect(stripInlineHashtags('# Заголовок')).toBe('# Заголовок')
  })

  it('collapses 3+ newlines left after removing a tag block', () => {
    expect(stripInlineHashtags('Текст\n\n\n#тег')).toBe('Текст')
  })

  it('handles empty / falsy input', () => {
    expect(stripInlineHashtags('')).toBe('')
    expect(stripInlineHashtags(undefined as any)).toBe(undefined)
  })

  it('keeps inner punctuation of the surrounding text', () => {
    expect(stripInlineHashtags('Закат на заливе. #закат #вода')).toBe('Закат на заливе.')
  })
})

describe('hasInlineHashtags', () => {
  it('detects inline hashtags', () => {
    expect(hasInlineHashtags('текст #тег')).toBe(true)
    expect(hasInlineHashtags('#старт текста')).toBe(true)
  })
  it('returns false when there are none', () => {
    expect(hasInlineHashtags('текст без тегов')).toBe(false)
    expect(hasInlineHashtags('url https://x.ru/a#b')).toBe(false)
    expect(hasInlineHashtags('')).toBe(false)
  })
})
