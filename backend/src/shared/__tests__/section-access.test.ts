import { describe, it, expect } from 'vitest'
import { intersectAccess, resolveAccess, SECTIONS } from '../section-access'

describe('intersectAccess — права API-ключа', () => {
  it('ключ сужает права администратора до одного раздела', () => {
    // Ровно случай приёмника обращений: ключ выдан админом, но умеет только тикеты
    const merged = intersectAccess('ADMIN', null, { tickets: 'full' })

    expect(merged.tickets).toBe('full')
    expect(merged.settings).toBe('none')
    expect(merged.posts).toBe('none')
    expect(merged.media).toBe('none')
  })

  it('раздел, не упомянутый в скоупе, недоступен — это белый список', () => {
    const merged = intersectAccess('ADMIN', null, { tickets: 'view' })
    for (const s of SECTIONS) {
      if (s !== 'tickets') expect(merged[s]).toBe('none')
    }
  })

  it('ключ НЕ может дать больше, чем есть у владельца', () => {
    // Владелец — VIEWER (всюду только чтение), ключ просит полный доступ
    const merged = intersectAccess('VIEWER', null, { posts: 'full', tickets: 'full' })

    expect(merged.posts).toBe('view')
    expect(merged.tickets).toBe('view')
  })

  it('ключ не обходит точечный запрет у владельца', () => {
    // У пользователя явно закрыты медиа — ключ не должен их открыть
    const merged = intersectAccess('EDITOR', { media: 'none' }, { media: 'full', posts: 'full' })

    expect(merged.media).toBe('none')
    expect(merged.posts).toBe('full')
  })

  it('понижает уровень до меньшего из двух', () => {
    const merged = intersectAccess('EDITOR', { posts: 'full' }, { posts: 'view' })
    expect(merged.posts).toBe('view')
  })

  it('админские разделы не открываются ключу редактора', () => {
    // EDITOR по умолчанию не имеет settings — ключ этого не изменит
    const merged = intersectAccess('EDITOR', null, { settings: 'full' })
    expect(merged.settings).toBe('none')
  })

  it('результат согласуется с resolveAccess при роли EDITOR', () => {
    // Middleware понижает роль до EDITOR и подставляет merged — проверяем,
    // что итоговая проверка доступа даёт то же самое.
    const merged = intersectAccess('ADMIN', null, { tickets: 'full' })

    expect(resolveAccess('EDITOR', 'tickets', merged)).toBe('full')
    expect(resolveAccess('EDITOR', 'settings', merged)).toBe('none')
    expect(resolveAccess('EDITOR', 'posts', merged)).toBe('none')
  })
})
