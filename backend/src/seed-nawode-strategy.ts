/**
 * Сидер strategy-as-data для НаWоде (Эпик B Phase 3).
 * Переносит зашитые в код рубрики/поводы/стратегию (`nawode-strategy.ts`) в БД.
 *
 * Идемпотентный и НЕ деструктивный:
 *  - рубрики/поводы создаются только если их ещё нет (не затираем кастомизацию из UI);
 *  - contentStrategy/seasonHints проставляются только если пусты.
 *
 * Запуск: `bun src/seed-nawode-strategy.ts` (чистый .ts — безопасно для Bun).
 */

import { db } from './db'
import {
  NAWODE_RUBRICS,
  NAWODE_EVENTS,
  NAWODE_STRATEGY_TEXT,
  NAWODE_SEASON_HINTS,
} from './services/ai/nawode-strategy'

async function main() {
  const businesses = await db.business.findMany({ where: { erpType: 'nawode' } })
  if (!businesses.length) {
    console.log('[seed-strategy] нет бизнеса с erpType=nawode — нечего сидить')
    return
  }

  for (const biz of businesses) {
    // Рубрики
    const rubricCount = await db.rubric.count({ where: { businessId: biz.id } })
    if (rubricCount === 0) {
      await db.rubric.createMany({
        data: NAWODE_RUBRICS.map((name, i) => ({ businessId: biz.id, name, sortOrder: i })),
      })
      console.log(`[seed-strategy] ${biz.slug}: создано рубрик ${NAWODE_RUBRICS.length}`)
    } else {
      console.log(`[seed-strategy] ${biz.slug}: рубрики уже есть (${rubricCount}) — пропуск`)
    }

    // Поводы
    const occCount = await db.occasion.count({ where: { businessId: biz.id } })
    if (occCount === 0) {
      await db.occasion.createMany({
        data: NAWODE_EVENTS.map((e) => ({
          businessId: biz.id,
          monthDay: e.md,
          topic: e.topic,
          rubric: e.rubric,
          postType: e.postType ?? null,
        })),
      })
      console.log(`[seed-strategy] ${biz.slug}: создано поводов ${NAWODE_EVENTS.length}`)
    } else {
      console.log(`[seed-strategy] ${biz.slug}: поводы уже есть (${occCount}) — пропуск`)
    }

    // Стратегия + сезонные ориентиры (только если пусто)
    const bp = await db.brandProfile.findUnique({ where: { businessId: biz.id } })
    if (!bp) {
      console.log(`[seed-strategy] ${biz.slug}: НЕТ brand_profile — contentStrategy/seasonHints пропущены`)
      continue
    }
    const patch: Record<string, unknown> = {}
    if (!bp.contentStrategy) patch.contentStrategy = NAWODE_STRATEGY_TEXT
    if (!bp.seasonHints) patch.seasonHints = NAWODE_SEASON_HINTS
    if (Object.keys(patch).length) {
      await db.brandProfile.update({ where: { businessId: biz.id }, data: patch })
      console.log(`[seed-strategy] ${biz.slug}: brand_profile обновлён (${Object.keys(patch).join(', ')})`)
    } else {
      console.log(`[seed-strategy] ${biz.slug}: contentStrategy/seasonHints уже заданы — пропуск`)
    }
  }
  console.log('[seed-strategy] готово')
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error('[seed-strategy] ошибка:', e)
    process.exit(1)
  })
