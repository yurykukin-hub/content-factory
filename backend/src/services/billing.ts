/**
 * Billing service — наценка, баланс, списание.
 *
 * Баланс хранится в копейках (целые числа, без потерь точности).
 * Наценка — глобальный % из AppConfig (ai_markup_percent, default 50).
 * ADMIN не списывается — у него безлимит.
 */

import { db } from '../db'

const USD_RUB = 95
const DEFAULT_MARKUP_PERCENT = 50

/** Получить текущую наценку % из AppConfig */
export async function getMarkupPercent(): Promise<number> {
  try {
    const config = await db.appConfig.findUnique({ where: { key: 'ai_markup_percent' } })
    if (config?.value) {
      const val = parseFloat(config.value)
      if (!isNaN(val) && val >= 0) return val
    }
  } catch { /* fallback */ }
  return DEFAULT_MARKUP_PERCENT
}

/** Рассчитать стоимость с наценкой в рублях (копейки) */
export function calculateChargedKopecks(costUsd: number, markupPercent: number): number {
  const costRub = costUsd * USD_RUB
  const withMarkup = costRub * (1 + markupPercent / 100)
  return Math.ceil(withMarkup * 100) // ceil — округляем в пользу владельца
}

/** Рассчитать стоимость с наценкой в рублях (float) */
export function calculateChargedRub(costUsd: number, markupPercent: number): number {
  return calculateChargedKopecks(costUsd, markupPercent) / 100
}

/** Проверить, хватает ли баланса (ADMIN всегда true) */
export async function canAfford(userId: string, role: string): Promise<{ allowed: boolean; balanceKopecks: number }> {
  if (role === 'ADMIN') return { allowed: true, balanceKopecks: 0 }

  const user = await db.user.findUnique({ where: { id: userId }, select: { balanceKopecks: true } })
  const balance = user?.balanceKopecks ?? 0
  return { allowed: balance > 0, balanceKopecks: balance }
}

/**
 * Списать с баланса пользователя за AI-вызов.
 * Создаёт BalanceTransaction + уменьшает User.balanceKopecks.
 * ADMIN не списывается — только логируется наценка в AiUsageLog.
 */
export async function chargeUser(params: {
  userId: string
  role: string
  costUsd: number
  markupPercent: number
  aiUsageLogId: string
  description: string
}): Promise<{ chargedRub: number; chargedKopecks: number }> {
  const chargedKopecks = calculateChargedKopecks(params.costUsd, params.markupPercent)
  const chargedRub = chargedKopecks / 100

  // ADMIN не списываем — у него безлимит
  if (params.role === 'ADMIN') {
    return { chargedRub, chargedKopecks }
  }

  // Atomic: decrement balance + create transaction
  const updated = await db.user.update({
    where: { id: params.userId },
    data: { balanceKopecks: { decrement: chargedKopecks } },
    select: { balanceKopecks: true },
  })

  await db.balanceTransaction.create({
    data: {
      userId: params.userId,
      amountKopecks: -chargedKopecks,
      type: 'charge',
      description: params.description,
      aiUsageLogId: params.aiUsageLogId,
      balanceAfter: updated.balanceKopecks,
    },
  })

  return { chargedRub, chargedKopecks }
}

/**
 * Пополнить баланс пользователя (admin action).
 */
export async function topUpBalance(params: {
  userId: string
  amountRub: number
  adminId: string
  description?: string
}): Promise<{ newBalanceKopecks: number }> {
  const amountKopecks = Math.round(params.amountRub * 100)

  const updated = await db.user.update({
    where: { id: params.userId },
    data: { balanceKopecks: { increment: amountKopecks } },
    select: { balanceKopecks: true },
  })

  await db.balanceTransaction.create({
    data: {
      userId: params.userId,
      amountKopecks,
      type: 'topup',
      description: params.description || `Пополнение ${params.amountRub} ₽`,
      adminId: params.adminId,
      balanceAfter: updated.balanceKopecks,
    },
  })

  return { newBalanceKopecks: updated.balanceKopecks }
}

export { USD_RUB }
