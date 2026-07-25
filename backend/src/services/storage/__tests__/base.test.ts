/**
 * Фабрика драйверов хранилища. По образцу publishers/__tests__/base.test.ts.
 * Без обращений к ФС: проверяем только выбор реализации, синглтон и полноту интерфейса.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { createStorage, getStorage, resetStorageForTests, type StorageDriver } from '../base'
import { LocalStorageDriver, uploadsRoot } from '../local'

/** Все методы интерфейса. Ловит забытую реализацию при добавлении s3-адаптера. */
const DRIVER_METHODS = [
  'describe',
  'put',
  'putFromLocalFile',
  'get',
  'getStream',
  'exists',
  'size',
  'delete',
  'serve',
  'localFile',
  'withLocalFile',
] as const

describe('createStorage', () => {
  it('local → LocalStorageDriver', () => {
    const driver = createStorage('local')
    expect(driver).toBeInstanceOf(LocalStorageDriver)
    expect(driver.kind).toBe('local')
  })

  it('s3 → внятная ошибка вместо тихого падения в локальный диск (шов Фазы 2)', () => {
    expect(() => createStorage('s3')).toThrow(/not implemented/i)
  })

  it('неизвестный драйвер → ошибка', () => {
    expect(() => createStorage('bogus' as never)).toThrow(/Unknown storage driver/)
  })
})

describe('getStorage', () => {
  beforeEach(() => resetStorageForTests())
  afterEach(() => resetStorageForTests())

  it('в Фазе 1 отдаёт локальный драйвер', () => {
    expect(getStorage().kind).toBe('local')
  })

  it('синглтон — один и тот же инстанс', () => {
    expect(getStorage()).toBe(getStorage())
  })
})

describe('StorageDriver — полнота интерфейса', () => {
  it('локальный драйвер реализует все методы', () => {
    const driver: StorageDriver = createStorage('local')
    for (const method of DRIVER_METHODS) {
      expect(typeof (driver as unknown as Record<string, unknown>)[method]).toBe('function')
    }
  })

  it('describe() отдаёт корень и способ записи — это содержимое boot-лога', () => {
    const info = createStorage('local').describe()
    expect(info.driver).toBe('local')
    expect(info.root).toBe(uploadsRoot())
    expect(['bun', 'node']).toContain(info.writer)
  })
})

describe('uploadsRoot', () => {
  const original = process.env.UPLOADS_DIR

  afterEach(() => {
    if (original === undefined) delete process.env.UPLOADS_DIR
    else process.env.UPLOADS_DIR = original
  })

  it('абсолютный путь', () => {
    delete process.env.UPLOADS_DIR
    const root = uploadsRoot()
    expect(root.startsWith('/')).toBe(true)
    expect(root.endsWith('/uploads')).toBe(true)
  })

  it('UPLOADS_DIR переопределяет корень', () => {
    process.env.UPLOADS_DIR = '/mnt/media-elsewhere'
    expect(uploadsRoot()).toBe('/mnt/media-elsewhere')
  })

  it('относительный override резолвится в абсолютный', () => {
    process.env.UPLOADS_DIR = 'tmp/rel-uploads'
    expect(uploadsRoot().startsWith('/')).toBe(true)
  })
})
