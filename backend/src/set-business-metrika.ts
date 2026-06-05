/**
 * Онбординг Яндекс.Метрики для бизнеса (per-business архитектура).
 * Заполняет `Business.metrikaCounterId` + `metrikaGoalIds`; токен (опц., если другой
 * Яндекс-аккаунт) — в AppConfig `metrika_token_{businessId}` (секрет, не во фронт).
 *
 * Usage: bun src/set-business-metrika.ts <slug> <counterId> [goal1,goal2,...] [oauthToken]
 *   bun src/set-business-metrika.ts nawode 92916147 294764085,290266307
 *   bun src/set-business-metrika.ts kukin-brothers 11122233 555,666 y0_AgAAA...
 *
 * Чистый .ts (безопасно для Bun — без TS-синтаксиса в .js, урок инцидента).
 */
import { db } from './db'

const [, , slug, counterId, goalsCsv, token] = process.argv

async function main() {
  if (!slug || !counterId) {
    console.log('Usage: bun src/set-business-metrika.ts <slug> <counterId> [goal1,goal2,...] [oauthToken]')
    process.exit(1)
  }
  const goalIds = goalsCsv ? goalsCsv.split(',').map((s) => s.trim()).filter(Boolean) : []

  const biz = await db.business.findUnique({ where: { slug } })
  if (!biz) {
    console.log(`✗ Бизнес "${slug}" не найден`)
    process.exit(1)
  }

  await db.business.update({
    where: { id: biz.id },
    data: { metrikaCounterId: counterId, metrikaGoalIds: goalIds },
  })
  console.log(`✓ ${slug}: counter=${counterId}, goals=[${goalIds.join(', ') || '—'}]`)

  if (token) {
    const key = `metrika_token_${biz.id}`
    await db.appConfig.upsert({
      where: { key },
      create: { key, value: token },
      update: { value: token },
    })
    console.log(`✓ per-business токен задан (AppConfig ${key})`)
  } else {
    console.log('  (токен не задан → используется глобальный metrika_oauth_token)')
  }
  console.log('Готово. Следующий сбор метрик подхватит конфиг (или: POST /api/analytics/collect).')
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error('Ошибка:', e)
    process.exit(1)
  })
