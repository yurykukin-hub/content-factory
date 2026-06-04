import { describe, it, expect } from 'vitest'
import {
  buildUtmUrl, platformUtmSource, utmCampaign, hostsFromLinks, tagBusinessLinks, tagBusinessUrl,
} from '../utm'

describe('platformUtmSource', () => {
  it('maps known platforms', () => {
    expect(platformUtmSource('VK')).toBe('vk')
    expect(platformUtmSource('TELEGRAM')).toBe('telegram')
    expect(platformUtmSource('INSTAGRAM')).toBe('instagram')
  })
  it('lowercases unknown', () => {
    expect(platformUtmSource('THREADS')).toBe('threads')
  })
})

describe('utmCampaign', () => {
  it('formats cf_YYYY_MM (UTC)', () => {
    expect(utmCampaign(new Date('2026-06-04T12:00:00Z'))).toBe('cf_2026_06')
    expect(utmCampaign(new Date('2026-01-31T23:59:00Z'))).toBe('cf_2026_01')
  })
})

describe('buildUtmUrl', () => {
  it('appends utm params', () => {
    const out = buildUtmUrl('https://nawode.ru/booking', { source: 'vk', campaign: 'cf_2026_06', content: 'abc123' })
    expect(out).toContain('utm_source=vk')
    expect(out).toContain('utm_medium=social')
    expect(out).toContain('utm_campaign=cf_2026_06')
    expect(out).toContain('utm_content=abc123')
  })
  it('preserves existing query params', () => {
    const out = buildUtmUrl('https://nawode.ru/?ref=x', { source: 'telegram' })
    expect(out).toContain('ref=x')
    expect(out).toContain('utm_source=telegram')
  })
  it('is idempotent (keeps existing utm_source)', () => {
    const tagged = buildUtmUrl('https://nawode.ru/', { source: 'vk' })
    const again = buildUtmUrl(tagged, { source: 'telegram' })
    expect(again).toBe(tagged)
    expect(again).toContain('utm_source=vk')
    expect(again).not.toContain('utm_source=telegram')
  })
  it('returns invalid url unchanged', () => {
    expect(buildUtmUrl('not a url', { source: 'vk' })).toBe('not a url')
  })
})

describe('hostsFromLinks', () => {
  it('extracts hostnames', () => {
    const hosts = hostsFromLinks([{ label: 'Сайт', url: 'https://nawode.ru' }, { label: 'Бронь', url: 'https://book.nawode.ru/x' }])
    expect(hosts).toEqual(['nawode.ru', 'book.nawode.ru'])
  })
  it('handles non-array / bad urls', () => {
    expect(hostsFromLinks(null)).toEqual([])
    expect(hostsFromLinks([{ label: 'x', url: 'broken' }])).toEqual([])
  })
})

describe('tagBusinessLinks', () => {
  const opts = { hosts: ['nawode.ru'], source: 'vk', campaign: 'cf_2026_06', content: 'p1' }

  it('tags business-domain links in text', () => {
    const out = tagBusinessLinks('Бронируй: https://nawode.ru/booking сейчас', opts)
    expect(out).toContain('utm_source=vk')
    expect(out).toMatch(/https:\/\/nawode\.ru\/booking\?/)
  })
  it('leaves foreign links untouched', () => {
    const out = tagBusinessLinks('Смотри https://vk.com/wall1_1 тут', opts)
    expect(out).toBe('Смотри https://vk.com/wall1_1 тут')
  })
  it('handles www. and trailing punctuation', () => {
    const out = tagBusinessLinks('Сайт https://www.nawode.ru.', opts)
    expect(out).toContain('utm_source=vk')
    expect(out.endsWith('.')).toBe(true) // точка осталась вне URL
  })
  it('does not tag bare domains (no scheme)', () => {
    const out = tagBusinessLinks('Заходи на nawode.ru', opts)
    expect(out).toBe('Заходи на nawode.ru')
  })
  it('no hosts → returns text unchanged', () => {
    expect(tagBusinessLinks('https://nawode.ru', { ...opts, hosts: [] })).toBe('https://nawode.ru')
  })
})

describe('tagBusinessUrl', () => {
  const opts = { hosts: ['nawode.ru'], source: 'vk' }
  it('tags matching host', () => {
    expect(tagBusinessUrl('https://nawode.ru/x', opts)).toContain('utm_source=vk')
  })
  it('leaves non-matching host', () => {
    expect(tagBusinessUrl('https://other.com/x', opts)).toBe('https://other.com/x')
  })
})
