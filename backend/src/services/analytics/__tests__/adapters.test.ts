import { describe, it, expect, vi, afterEach } from 'vitest'
import { fetchVkPostMetrics } from '../vk-adapter'
import { fetchPostmypostPostMetrics } from '../postmypost-adapter'
import { chunk, ymd, round2 } from '../types'

/** Мок fetch с маршрутизацией по подстроке URL. */
function stubFetch(routes: Array<{ match: (u: string) => boolean; response: any; ok?: boolean; status?: number }>) {
  vi.stubGlobal('fetch', vi.fn(async (url: any) => {
    const u = String(url)
    const r = routes.find(x => x.match(u))
    if (!r) return { ok: false, status: 404, json: async () => ({}), text: async () => '' } as any
    return {
      ok: r.ok ?? true,
      status: r.status ?? 200,
      json: async () => r.response,
      text: async () => JSON.stringify(r.response),
    } as any
  }))
}

afterEach(() => vi.unstubAllGlobals())

describe('types helpers', () => {
  it('chunk splits arrays', () => {
    expect(chunk([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]])
    expect(chunk([], 3)).toEqual([])
  })
  it('ymd formats UTC date', () => {
    expect(ymd(new Date('2026-06-04T23:30:00Z'))).toBe('2026-06-04')
  })
  it('round2 rounds to 2 decimals', () => {
    expect(round2(2.29885)).toBe(2.3)
    expect(round2(5)).toBe(5)
  })
})

describe('VkAdapter.fetchVkPostMetrics', () => {
  it('parses wall.getById (array form), computes ER, links by externalPostId', async () => {
    stubFetch([{
      match: u => u.includes('wall.getById'),
      response: { response: [{ id: 456239208, likes: { count: 10 }, comments: { count: 2 }, reposts: { count: 3 }, views: { count: 100 } }] },
    }])
    const refs = [{ postId: 'p1', postVersionId: 'v1', externalPostId: '456239208', publicationType: 'POST' }]
    const res = await fetchVkPostMetrics('tok', '-150371202', refs)
    expect(res).toHaveLength(1)
    const m = res[0]
    expect(m.views).toBe(100)
    expect(m.likes).toBe(10)
    expect(m.comments).toBe(2)
    expect(m.shares).toBe(3)        // reposts → shares
    expect(m.engagementRate).toBe(15) // (10+2+3)/100*100
    expect(m.postId).toBe('p1')
    expect(m.platform).toBe('VK')
    expect(m.externalUrl).toContain('wall-150371202_456239208')
  })

  it('parses {response:{items}} form', async () => {
    stubFetch([{
      match: u => u.includes('wall.getById'),
      response: { response: { items: [{ id: 1, likes: { count: 0 }, views: { count: 0 } }] } },
    }])
    const res = await fetchVkPostMetrics('tok', '-1', [{ postId: 'p', postVersionId: 'v', externalPostId: '1', publicationType: 'POST' }])
    expect(res).toHaveLength(1)
    expect(res[0].engagementRate).toBeNull() // views=0 → null
  })

  it('returns [] on VK error', async () => {
    stubFetch([{ match: u => u.includes('wall.getById'), response: { error: { error_code: 5, error_msg: 'expired' } } }])
    const res = await fetchVkPostMetrics('tok', '-1', [{ postId: 'p', postVersionId: 'v', externalPostId: '1', publicationType: 'POST' }])
    expect(res).toEqual([])
  })
})

describe('PostmypostAdapter.fetchPostmypostPostMetrics', () => {
  it('resolves external_id, maps metrics+type, links matching row', async () => {
    stubFetch([
      { match: u => u.includes('/publications/30366286'), response: { posts: [{ external_id: '18095032088206144', url: 'https://instagram.com/p/X' }] } },
      {
        match: u => u.includes('/analytics/publications'),
        response: {
          data: [
            { id: 'hex1', external_id: '18095032088206144', external_url: 'u1', type: 1, analytics: { likes: 4, shares: 0, engagements: 4, views: 174, reach: 80, engagement_rate_reach: 5 } },
            { id: 'hex2', external_id: '999', external_url: 'u2', type: 4, analytics: { likes: 1, views: 10, reach: 8, engagements: 1 } },
          ],
          pages: { total_pages: 1 },
        },
      },
    ])
    const refs = [{ postId: 'pIG', postVersionId: 'vIG', externalPostId: '30366286', publicationType: 'POST' }]
    const res = await fetchPostmypostPostMetrics('tok', 347349, 2163599, refs, new Date('2026-01-01'), new Date('2026-06-01'))
    expect(res).toHaveLength(2)

    const linked = res.find(r => r.externalId === '18095032088206144')!
    expect(linked.postId).toBe('pIG')
    expect(linked.postVersionId).toBe('vIG')
    expect(linked.views).toBe(174)
    expect(linked.reach).toBe(80)
    expect(linked.likes).toBe(4)
    expect(linked.engagementRate).toBe(5)
    expect(linked.publicationType).toBe('POST')
    expect(linked.platform).toBe('INSTAGRAM')

    const reels = res.find(r => r.externalId === '999')!
    expect(reels.publicationType).toBe('REELS') // type 4
    expect(reels.postId).toBeNull()             // не связан с CF
    // ER fallback из engagements/reach когда нет engagement_rate_reach: 1/8*100=12.5
    expect(reels.engagementRate).toBe(12.5)
  })

  it('respects pagination total_pages', async () => {
    let analyticsCalls = 0
    vi.stubGlobal('fetch', vi.fn(async (url: any) => {
      const u = String(url)
      if (u.includes('/analytics/publications')) {
        analyticsCalls++
        return { ok: true, status: 200, json: async () => ({ data: [{ id: 'x', external_id: 'e', type: 1, analytics: {} }], pages: { total_pages: 2 } }), text: async () => '' } as any
      }
      return { ok: true, status: 200, json: async () => ({ posts: [] }), text: async () => '' } as any
    }))
    const res = await fetchPostmypostPostMetrics('tok', 1, 1, [], new Date('2026-01-01'), new Date('2026-06-01'))
    expect(analyticsCalls).toBe(2)  // 2 страницы
    expect(res).toHaveLength(2)
  })
})
