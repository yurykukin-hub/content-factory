/**
 * Generic контент-стратегия (strategy-as-data, Эпик B Phase 3).
 *
 * Рубрики / поводы / текст стратегии / сезонные ориентиры читаются ИЗ БД per-business
 * (модели Rubric, Occasion + BrandProfile.contentStrategy/seasonHints), а не зашиты в код.
 * Добавить бизнес = внести данные (сидер/UI), не писать ветки `if erpType==='nawode'`.
 *
 * Источник сид-данных для НаWоде — `nawode-strategy.ts` (используется только сидером).
 */

import { db } from '../../db'

export interface SeasonHint {
  months: number[] // индексы месяцев 0-11; пустой массив = дефолтный ориентир
  hint: string
}

/** Названия активных рубрик бизнеса (по sortOrder). Пусто, если рубрик нет. */
export async function getRubricNames(businessId: string): Promise<string[]> {
  const rows = await db.rubric.findMany({
    where: { businessId, isActive: true },
    orderBy: { sortOrder: 'asc' },
    select: { name: true },
  })
  return rows.map((r) => r.name)
}

/**
 * Поводы бизнеса, попадающие в диапазон дат (год-независимый MM-DD → конкретные даты).
 * Аналог прежнего getEventsInRange, но данные из БД (Occasion), а не из кода.
 */
export async function getOccasionsInRange(
  businessId: string,
  start: Date,
  end: Date,
): Promise<{ date: string; topic: string; rubric: string; postType?: string }[]> {
  const occ = await db.occasion.findMany({ where: { businessId, isActive: true } })
  const res: { date: string; topic: string; rubric: string; postType?: string }[] = []
  for (let y = start.getUTCFullYear(); y <= end.getUTCFullYear(); y++) {
    for (const ev of occ) {
      const [mm, dd] = ev.monthDay.split('-').map(Number)
      if (!mm || !dd) continue
      const d = new Date(Date.UTC(y, mm - 1, dd))
      if (d >= start && d <= end) {
        res.push({
          date: d.toISOString().slice(0, 10),
          topic: ev.topic,
          rubric: ev.rubric,
          postType: ev.postType ?? undefined,
        })
      }
    }
  }
  return res.sort((a, b) => a.date.localeCompare(b.date))
}

/** Текст стратегии + сезонные ориентиры бизнеса (BrandProfile). Для system-промпта дайджеста. */
export async function getStrategyBlock(
  businessId: string,
): Promise<{ strategyText: string; seasonHints: SeasonHint[] }> {
  const bp = await db.brandProfile.findUnique({
    where: { businessId },
    select: { contentStrategy: true, seasonHints: true },
  })
  return {
    strategyText: bp?.contentStrategy ?? '',
    seasonHints: Array.isArray(bp?.seasonHints) ? (bp!.seasonHints as unknown as SeasonHint[]) : [],
  }
}

/** Сезонный ориентир по месяцу (0-11) из seasonHints. months:[] = дефолт. Pure. */
export function getSeasonHint(seasonHints: unknown, month: number): string {
  const arr = Array.isArray(seasonHints) ? (seasonHints as SeasonHint[]) : []
  const exact = arr.find((h) => Array.isArray(h.months) && h.months.includes(month))
  if (exact) return exact.hint
  const def = arr.find((h) => Array.isArray(h.months) && h.months.length === 0)
  return def?.hint ?? ''
}
