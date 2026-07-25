/**
 * Тесты ключей хранилища. Чистые функции, без fs/сети/БД — по образцу
 * utils/__tests__/utm.test.ts и publishers/__tests__/postmypost.test.ts.
 *
 * Часть кейсов — ПИНЫ на дырки, которые были в прежних 26 копиях
 * `url.replace('/uploads/', '')` (без якоря `^`): они помечены в комментариях.
 */

import { describe, it, expect } from 'vitest'
import {
  UPLOADS_URL_PREFIX,
  keyFromUrl,
  keyFromRequestPath,
  urlFromKey,
  makeKey,
  buildPublicUrl,
} from '../keys'

// Реальные формы из прод-БД (2054 записи — все ровно такие).
const REAL_URLS = [
  '/uploads/biz-1/abc123def456.jpg',
  '/uploads/biz-1/abc123def456_thumb.webp',
  '/uploads/cmb1x2y3z/design_Ab-9_xY.png',
  '/uploads/cmb1x2y3z/story_video_QwErTyUiOpAs.mp4',
  '/uploads/cmb1x2y3z/suno_cover_1234567890ab.jpg',
]

describe('UPLOADS_URL_PREFIX', () => {
  it('совпадает с форматом колонок в БД и с роутом', () => {
    expect(UPLOADS_URL_PREFIX).toBe('/uploads/')
  })
})

describe('keyFromUrl — реальные формы', () => {
  it('срезает префикс', () => {
    expect(keyFromUrl('/uploads/biz-1/abc.jpg')).toBe('biz-1/abc.jpg')
    expect(keyFromUrl('/uploads/biz-1/abc_thumb.webp')).toBe('biz-1/abc_thumb.webp')
  })

  it('допускает вложенность глубже двух уровней', () => {
    expect(keyFromUrl('/uploads/a/b/c.png')).toBe('a/b/c.png')
  })

  it('допускает dot-сегмент в имени каталога (.google-photos-thumbs)', () => {
    expect(keyFromUrl('/uploads/.google-photos-thumbs/x.webp')).toBe('.google-photos-thumbs/x.webp')
  })

  it('допускает плоский ключ без businessId', () => {
    expect(keyFromUrl('/uploads/design_Ab-9_x.mp4')).toBe('design_Ab-9_x.mp4')
  })

  it('выбрасывает сегменты "." — паритет с path.resolve()', () => {
    expect(keyFromUrl('/uploads/biz-1/./abc.jpg')).toBe('biz-1/abc.jpg')
  })
})

describe('keyFromUrl — злые и пустые входы → null', () => {
  const cases: Array<[string, string | null | undefined]> = [
    ['пустая строка', ''],
    ['null', null],
    ['undefined', undefined],
    ['нет префикса', 'abc.jpg'],
    ['относительный путь', 'biz-1/abc.jpg'],
    // ПИН: раньше .replace без якоря давал 'https:/evil.com/x.jpg' → join(UPLOAD_DIR, …)
    ['внешний URL с /uploads/ внутри', 'https://evil.com/uploads/x.jpg'],
    ['внешний http-URL', 'http://cdn.example/img.png'],
    // ПИН: раньше .replace без якоря давал '/x/y.jpg' → абсолютный путь вне uploads
    ['префикс не в начале', '/x/uploads/y.jpg'],
    ['traversal сразу', '/uploads/../../etc/passwd'],
    ['traversal вложенный', '/uploads/a/../../etc/passwd'],
    ['traversal на один уровень', '/uploads/a/../b'],
    ['двойной слэш', '/uploads//x.jpg'],
    ['только префикс со слэшем', '/uploads/'],
    ['префикс без слэша', '/uploads'],
    ['другой регистр', '/UPLOADS/x.jpg'],
    ['вложен в /api', '/api/uploads/x.jpg'],
    ['backslash-traversal', '/uploads/a\\..\\b.jpg'],
    ['ведущий пробел', '  /uploads/a.jpg'],
    ['слэш-точка-точка в конце', '/uploads/a/..'],
  ]

  for (const [label, input] of cases) {
    it(label, () => {
      expect(keyFromUrl(input)).toBeNull()
    })
  }

  it('NUL внутри имени', () => {
    expect(keyFromUrl(`/uploads/x${String.fromCharCode(0)}.jpg`)).toBeNull()
  })

  it('перевод строки внутри имени', () => {
    expect(keyFromUrl(`/uploads/biz${String.fromCharCode(10)}1/x.jpg`)).toBeNull()
  })
})

describe('roundtrip key ⇄ url', () => {
  it('urlFromKey(keyFromUrl(u)) === u на реальных формах', () => {
    for (const url of REAL_URLS) {
      const key = keyFromUrl(url)
      expect(key).not.toBeNull()
      expect(urlFromKey(key as string)).toBe(url)
    }
  })

  it('keyFromUrl(urlFromKey(k)) === k', () => {
    for (const key of ['biz-1/a.jpg', 'a/b/c.png', 'flat.mp4']) {
      expect(keyFromUrl(urlFromKey(key))).toBe(key)
    }
  })
})

describe('urlFromKey', () => {
  it('добавляет префикс', () => {
    expect(urlFromKey('biz-1/a.jpg')).toBe('/uploads/biz-1/a.jpg')
  })

  it('бросает на невалидном ключе (баг вызывающего, не пользовательский ввод)', () => {
    expect(() => urlFromKey('')).toThrow(/Invalid storage key/)
    expect(() => urlFromKey('../x')).toThrow(/Invalid storage key/)
    expect(() => urlFromKey('/abs/x')).toThrow(/Invalid storage key/)
    expect(() => urlFromKey('a//b')).toThrow(/Invalid storage key/)
    expect(() => urlFromKey('a/./b')).toThrow(/Invalid storage key/)
  })
})

describe('makeKey', () => {
  it('склеивает businessId и имя файла на диске', () => {
    expect(makeKey('biz-1', 'abc123.jpg')).toBe('biz-1/abc123.jpg')
  })

  it('бросает на разделителях и traversal', () => {
    expect(() => makeKey('biz/1', 'a.jpg')).toThrow(/businessId/)
    expect(() => makeKey('..', 'a.jpg')).toThrow(/businessId/)
    expect(() => makeKey('', 'a.jpg')).toThrow(/businessId/)
    expect(() => makeKey('biz', '')).toThrow(/filename/)
    expect(() => makeKey('biz', '../a.jpg')).toThrow(/filename/)
    expect(() => makeKey('biz', 'sub/a.jpg')).toThrow(/filename/)
  })
})

describe('keyFromRequestPath', () => {
  it('отдаёт ключ для существующей формы', () => {
    expect(keyFromRequestPath('/uploads/biz-1/a.jpg')).toBe('biz-1/a.jpg')
  })

  it('отдаёт ключ для несуществующего файла — роут обязан ответить 404, а не 403', () => {
    // Пин на security-hardening.test.ts: '/uploads/nonexistent.jpg' → ровно 404.
    expect(keyFromRequestPath('/uploads/nonexistent.jpg')).toBe('nonexistent.jpg')
    expect(keyFromRequestPath('/uploads/business-1/photo.jpg')).toBe('business-1/photo.jpg')
  })

  it('нормализует "." как resolve()', () => {
    expect(keyFromRequestPath('/uploads/a/./b.jpg')).toBe('a/b.jpg')
  })

  it('отвергает traversal и мусор → 403', () => {
    expect(keyFromRequestPath('/uploads/sub/../../etc/passwd')).toBeNull()
    expect(keyFromRequestPath('/uploads/../../backend/.env')).toBeNull()
    expect(keyFromRequestPath('/uploads/')).toBeNull()
    expect(keyFromRequestPath('/other/x')).toBeNull()
  })

  it('percent-кодирование НЕ декодируется (иначе появился бы %2e%2e-траверсал)', () => {
    expect(keyFromRequestPath('/uploads/..%2f..%2fetc/passwd')).toBe('..%2f..%2fetc/passwd')
  })
})

describe('buildPublicUrl', () => {
  it('префиксует абсолютный путь базой', () => {
    expect(buildPublicUrl('https://cdn.x', '/uploads/a/b.jpg')).toBe('https://cdn.x/uploads/a/b.jpg')
  })

  it('префиксует голый ключ базой + /uploads/', () => {
    expect(buildPublicUrl('http://localhost:3800', 'a/b.jpg')).toBe('http://localhost:3800/uploads/a/b.jpg')
  })

  it('уже абсолютный URL возвращает как есть — фикс склейки в kie.ts', () => {
    // Раньше resolvePublicUrl давал 'https://content.yurykukin.ruhttps://cdn.other/z.png' → KIE 4xx.
    expect(buildPublicUrl('https://content.yurykukin.ru', 'https://cdn.other/z.png')).toBe(
      'https://cdn.other/z.png',
    )
    expect(buildPublicUrl('https://content.yurykukin.ru', 'http://cdn.other/z.png')).toBe(
      'http://cdn.other/z.png',
    )
  })

  it('регистр схемы не обманывает guard', () => {
    expect(buildPublicUrl('https://cdn.x', 'HTTPS://CDN/z.png')).toBe('HTTPS://CDN/z.png')
  })

  it('не даёт двойного слэша при базе с завершающим слэшем', () => {
    expect(buildPublicUrl('https://cdn.x/', '/uploads/a.jpg')).toBe('https://cdn.x/uploads/a.jpg')
    expect(buildPublicUrl('https://cdn.x///', 'a.jpg')).toBe('https://cdn.x/uploads/a.jpg')
  })

  it('не-uploads абсолютный путь тоже префиксуется (осознанная унификация guard-ов)', () => {
    expect(buildPublicUrl('https://cdn.x', '/api/x')).toBe('https://cdn.x/api/x')
  })
})
