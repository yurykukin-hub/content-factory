/**
 * Промо-блок для промптов дайджеста (Фаза 3, этап 1: анонсируем ТОЛЬКО реально заведённые
 * в ERP скидки — без flash-предложений несуществующих скидок). Pure + тестируемо.
 *
 * Промокоды по умолчанию НЕ анонсируем (среди них партнёрские/реферальные — помечены note).
 * Sanity через getRedLine: подозрительно глубокие скидки (глубже массового потолка) метятся ⚠,
 * чтобы агент/человек перепроверил перед публикацией (защита от случайной убыточной акции).
 */

import type { ActiveDiscount } from '../datasource/types'
import { isDiscountWithinRedLine } from './red-lines'

/** Копейки → «900₽» (null если нет). */
function rub(kopecks: number | null | undefined): string | null {
  return kopecks == null ? null : `${Math.round(kopecks / 100)}₽`
}

/** Одна строка скидки для промпта. */
export function formatDiscountLine(d: ActiveDiscount): string {
  let s = `- ${d.label}`
  if (d.percentOff != null) s += ` −${d.percentOff}%`
  const price = rub(d.discountPriceKopecks)
  const base = rub(d.basePriceKopecks)
  if (price) s += base ? ` (${price} вместо ${base})` : ` (спеццена ${price})`
  if (d.startTime) s += ` в ${d.startTime}`
  if (d.code) s += ` — промокод ${d.code}`
  // sanity: % известен И глубже массового потолка (−40%) → подозрительно, пометить
  if (
    d.percentOff != null &&
    !isDiscountWithinRedLine(d.percentOff, {
      serviceType: d.serviceType,
      productId: d.productId,
      label: d.label,
      mode: 'mass',
    })
  ) {
    s += ' ⚠(скидка глубже обычного — проверь перед анонсом)'
  }
  return s
}

/**
 * Человекочитаемый блок действующих скидок для system-промпта. '' если анонсировать нечего
 * (тогда промпт блок не показывает). includePromoCodes — включить промокоды (по умолчанию нет).
 */
export function buildPromoBlock(
  discounts: ActiveDiscount[],
  opts: { dateLabel?: string; includePromoCodes?: boolean } = {},
): string {
  const anchorable = (discounts || []).filter(
    d =>
      d.source === 'day_of_week' ||
      d.source === 'slot_override' ||
      (opts.includePromoCodes && d.source === 'promo_code'),
  )
  if (!anchorable.length) return ''
  const header = opts.dateLabel ? `ДЕЙСТВУЮЩИЕ СКИДКИ (${opts.dateLabel}):` : 'ДЕЙСТВУЮЩИЕ СКИДКИ:'
  return `${header}\n${anchorable.map(formatDiscountLine).join('\n')}`
}
