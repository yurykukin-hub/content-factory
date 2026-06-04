/**
 * End-to-end смоук коллектора против ЖИВОГО Postmypost + запись в dev-БД.
 * Сидлит минимум (бизнес + IG-аккаунт + опубликованную версию) и гоняет коллектор.
 * Запуск: bun src/scripts/smoke-collect.ts   (dev-БД из .env)
 */
import { db } from '../db'
import { collectBusinessMetrics } from '../services/analytics/collector'

const SLUG = 'smoke-nawode'

// 1. seed business
const biz = await db.business.upsert({
  where: { slug: SLUG },
  update: { isActive: true },
  create: { slug: SLUG, name: 'Smoke НаWоде', isActive: true, erpType: 'nawode' },
})

// 2. seed IG platform account (Postmypost) — реальные id nawode
const ig = await db.platformAccount.upsert({
  where: { businessId_platform_accountId: { businessId: biz.id, platform: 'INSTAGRAM', accountId: '2163599' } },
  update: { isActive: true, config: { provider: 'postmypost', postmypostProjectId: 347349 } },
  create: {
    businessId: biz.id, platform: 'INSTAGRAM', accountType: 'BUSINESS',
    accountName: 'smoke nawode.ru', accountId: '2163599', accessToken: '',
    config: { provider: 'postmypost', postmypostProjectId: 347349 },
  },
})

// 3. seed Post + published PostVersion (реальный publication id 30366286)
const post = await db.post.findFirst({ where: { businessId: biz.id, title: 'smoke-ig' } })
  ?? await db.post.create({ data: { businessId: biz.id, title: 'smoke-ig', body: 'Смоук IG пост', postType: 'PHOTO', status: 'PUBLISHED' } })

await db.postVersion.upsert({
  where: { postId_platformAccountId: { postId: post.id, platformAccountId: ig.id } },
  update: { status: 'PUBLISHED', externalPostId: '30366286', publishedAt: new Date() },
  create: {
    postId: post.id, platformAccountId: ig.id, body: 'Смоук IG пост', status: 'PUBLISHED',
    externalPostId: '30366286', publishedAt: new Date(),
  },
})

console.log('=== running collectBusinessMetrics (force) ===')
const result = await collectBusinessMetrics(biz.id, { force: true })
console.log(JSON.stringify(result, null, 2))

const snaps = await db.socialPostMetricSnapshot.findMany({
  where: { businessId: biz.id }, orderBy: { capturedAt: 'desc' }, take: 5,
})
console.log(`\n=== snapshots in DB: ${snaps.length} (showing up to 5) ===`)
for (const s of snaps) {
  console.log(`  ${s.source}/${s.publicationType} ext=${s.externalId} views=${s.views} reach=${s.reach} likes=${s.likes} ER=${s.engagementRate} postId=${s.postId ?? '—'}`)
}

// cleanup seed (keep DB clean)
await db.socialPostMetricSnapshot.deleteMany({ where: { businessId: biz.id } })
await db.postVersion.deleteMany({ where: { post: { businessId: biz.id } } })
await db.post.deleteMany({ where: { businessId: biz.id } })
await db.platformAccount.deleteMany({ where: { businessId: biz.id } })
await db.business.delete({ where: { id: biz.id } })
console.log('\n(seed cleaned up)')
process.exit(0)
