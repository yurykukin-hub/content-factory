/**
 * Смоук-тест адаптеров аналитики против ЖИВЫХ API (без БД).
 * Запуск: VK_SMOKE_TOKEN=... bun src/scripts/smoke-analytics.ts
 */
import { fetchVkPostMetrics } from '../services/analytics/vk-adapter'
import { fetchPostmypostPostMetrics } from '../services/analytics/postmypost-adapter'

const vkToken = process.env.VK_SMOKE_TOKEN || ''
const pmToken = process.env.POSTMYPOST_API_TOKEN || ''

const vkRefs = [
  { postId: 'p1', postVersionId: 'v1', externalPostId: '456239208', publicationType: 'POST' },
  { postId: 'p2', postVersionId: 'v2', externalPostId: '456239206', publicationType: 'POST' },
  { postId: 'p3', postVersionId: 'v3', externalPostId: '456239203', publicationType: 'POST' },
]

console.log('=== VK wall.getById (nawode group -150371202) ===')
if (vkToken) {
  const vk = await fetchVkPostMetrics(vkToken, '-150371202', vkRefs)
  console.log(`rows: ${vk.length}`)
  for (const m of vk) console.log(`  post ${m.externalId}: views=${m.views} likes=${m.likes} shares=${m.shares} comments=${m.comments} ER=${m.engagementRate}% link=${m.externalUrl}`)
} else {
  console.log('  (VK_SMOKE_TOKEN не задан — пропуск)')
}

console.log('\n=== Postmypost analytics (nawode IG acc 2163599) ===')
if (pmToken) {
  const df = new Date(Date.now() - 120 * 86400000)
  const dt = new Date()
  const ig = await fetchPostmypostPostMetrics(pmToken, 347349, 2163599, [
    { postId: 'pIG', postVersionId: 'vIG', externalPostId: '30366286', publicationType: 'POST' },
  ], df, dt)
  console.log(`rows: ${ig.length}, linked-to-CF: ${ig.filter(m => m.postId).length}`)
  for (const m of ig.slice(0, 5)) console.log(`  ${m.publicationType} ext=${m.externalId}: views=${m.views} reach=${m.reach} likes=${m.likes} shares=${m.shares} ER=${m.engagementRate}% postId=${m.postId ?? '—'}`)
} else {
  console.log('  (POSTMYPOST_API_TOKEN не задан — пропуск)')
}

process.exit(0)
