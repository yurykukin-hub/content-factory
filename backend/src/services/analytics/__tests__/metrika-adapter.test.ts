/**
 * Per-business Метрика-конфиг (масштабируемая архитектура):
 * счётчик/цели — поля Business → fallback metrika_config JSON; токен — per-business → глобальный.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

const { mockDb } = vi.hoisted(() => ({ mockDb: { appConfig: { findUnique: vi.fn() } } }))
vi.mock('../../../db', () => ({ db: mockDb }))

import { getMetrikaToken, getMetrikaConfigForBusiness } from '../metrika-adapter'

/** Мок AppConfig: map ключ→значение. */
function appConfig(map: Record<string, string>) {
  mockDb.appConfig.findUnique.mockImplementation(({ where: { key } }: any) =>
    Promise.resolve(map[key] != null ? { value: map[key] } : null),
  )
}

beforeEach(() => {
  vi.clearAllMocks()
  appConfig({})
})

describe('getMetrikaConfigForBusiness — per-business поля → JSON-fallback', () => {
  it('поля Business имеют приоритет (новая архитектура)', async () => {
    const c = await getMetrikaConfigForBusiness({ id: 'b1', slug: 'nawode', metrikaCounterId: '999', metrikaGoalIds: ['1', '2'] })
    expect(c?.counterId).toBe('999')
    expect(c?.goalIds).toEqual(['1', '2'])
  })

  it('fallback на metrika_config JSON, если полей нет (backward-compat)', async () => {
    appConfig({ metrika_config: JSON.stringify({ nawode: { counterId: '92916147', goalIds: ['7'] } }) })
    const c = await getMetrikaConfigForBusiness({ id: 'b1', slug: 'nawode' })
    expect(c?.counterId).toBe('92916147')
    expect(c?.goalIds).toEqual(['7'])
  })

  it('null, если ничего не настроено (нет хардкод-дефолта)', async () => {
    expect(await getMetrikaConfigForBusiness({ id: 'b1', slug: 'unknown' })).toBeNull()
  })

  it('плохой JSON конфига не валит — graceful null', async () => {
    appConfig({ metrika_config: '{not json' })
    expect(await getMetrikaConfigForBusiness({ id: 'b1', slug: 'x' })).toBeNull()
  })
})

describe('getMetrikaToken — per-business → глобальный → env', () => {
  it('per-business токен имеет приоритет над глобальным', async () => {
    appConfig({ metrika_token_b1: 'PERBIZ', metrika_oauth_token: 'GLOBAL' })
    expect(await getMetrikaToken('b1')).toBe('PERBIZ')
  })

  it('fallback на глобальный, если per-business нет', async () => {
    appConfig({ metrika_oauth_token: 'GLOBAL' })
    expect(await getMetrikaToken('b1')).toBe('GLOBAL')
    expect(await getMetrikaToken()).toBe('GLOBAL')
  })

  it('null, если токенов нет', async () => {
    expect(await getMetrikaToken('b1')).toBeNull()
  })
})
