/**
 * Ф0.3 — разовый массовый прогон: описать фото галереи без altText.
 * Запуск:
 *   bun --env-file=.env src/batch-describe.ts            # все активные бизнесы
 *   bun --env-file=.env src/batch-describe.ts nawode     # только НаWоде
 *   bun --env-file=.env src/batch-describe.ts nawode 5   # первые 5 (пробный)
 * Идемпотентно: берёт только image с altText IS NULL.
 */

import { db } from './db'
import { describeMediaFile } from './services/image-describer'

const CONCURRENCY = 5

async function main() {
  const slug = process.argv[2]
  const limit = process.argv[3] ? parseInt(process.argv[3], 10) : undefined

  const biz = slug ? await db.business.findFirst({ where: { slug } }) : null
  if (slug && !biz) { console.error(`Business '${slug}' not found`); process.exit(1) }

  const files = await db.mediaFile.findMany({
    where: {
      mimeType: { startsWith: 'image/' },
      altText: null,
      ...(biz ? { businessId: biz.id } : {}),
    },
    select: { id: true, url: true, businessId: true },
    orderBy: { createdAt: 'desc' },
    ...(limit ? { take: limit } : {}),
  })

  console.log(`К описанию: ${files.length} фото${biz ? ` (${biz.name})` : ' (все бизнесы)'}`)
  if (!files.length) { await db.$disconnect(); return }

  let ok = 0, fail = 0
  for (let i = 0; i < files.length; i += CONCURRENCY) {
    const chunk = files.slice(i, i + CONCURRENCY)
    const results = await Promise.allSettled(chunk.map(f => describeMediaFile(f)))
    for (let j = 0; j < results.length; j++) {
      const r = results[j]
      if (r.status === 'fulfilled' && r.value) {
        ok++
      } else {
        fail++
        await db.mediaFile.update({ where: { id: chunk[j].id }, data: { aiModel: 'describe_failed' } }).catch(() => {})
      }
    }
    console.log(`  ${Math.min(i + CONCURRENCY, files.length)}/${files.length}  (ok=${ok}, fail=${fail})`)
  }

  console.log(`\nГотово: описано ${ok}, ошибок ${fail}`)
  await db.$disconnect()
}

main().catch(e => { console.error(e); process.exit(1) })
