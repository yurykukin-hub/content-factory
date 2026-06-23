/**
 * Красные линии скидок НаWоде (защита маржи) — переиспользуемый актив для Content
 * Factory (промо-автопостинг, дайджест) и Sales Bot (переговоры о цене).
 *
 * Источник цифр: docs/nawode-promo-playbook.md (раздел 1 / A.8) + ADR
 * knowledge/decisions/2026-06-nawode-promo-mechanics.md — расчёт biz-strategist по ERP
 * compensation_rules. Принцип: скидка ДОБИВАЕТ идущий слот (переменные затраты на +1 чел
 * ≈ 0), не плодит новые слоты. Пик (выходные/закаты/июль-авг) скидками не трогаем.
 *
 * MVP — захардкоженные линии (как nawode-strategy). Чтение compensation_rules из ERP
 * на лету (ступени + зависимость от заполненности слота) — позже. Цифры держим ЗДЕСЬ,
 * единым справочником, чтобы Sales Bot (Python) мог их концептуально воспроизвести.
 */

export type RedLineCategory = 'RENTAL' | 'WALK' | 'SUNSET' | 'BREAKFAST' | 'TOUR' | 'LESSON'

/** Режим скидки: mass — массовая акция (на всех); fill — добивка одного идущего слота. */
export type PromoMode = 'mass' | 'fill'

/** Максимальная скидка массовой акции (на всех) по всему меню. Плейбук: потолок −40% (маржа ≥400₽/чел). */
export const MASS_MAX_PERCENT = 40

/** Предельные скидки добивки (1 лишний в идущий слот), % — раздел 1 плейбука. */
const FILL_MAX_PERCENT: Record<RedLineCategory, number> = {
  RENTAL: 75,    // прокат Выборг 1000₽ (маржа +800₽), мин ~250₽
  WALK: 80,      // прогулка «Выборг с воды» (маржа +1250/1500 ≈ 83%, берём консервативно)
  SUNSET: 88,    // закат: инструктор фикс 2000₽ → каждый сверх 1-го почти чистыми
  BREAKFAST: 70, // арома-завтрак — единственная услуга с товарной частью (еда ~350₽/чел); NEVER глубже 70
  TOUR: 87,      // тур внутри ступени; на ПЕРЕХОДЕ (4-й/8-й чел) — TOUR_TRANSITION_MAX
  LESSON: 50,    // плейбук про уроки молчит → консервативно (дорогое время инструктора)
}

/** Тур на переходе ступени (3→4, 7→8): инструктору +500₽ на группу → линия мягче. */
const TOUR_TRANSITION_MAX = 75

export interface RedLine {
  category: RedLineCategory
  mode: PromoMode
  maxPercentOff: number
  note: string
}

/**
 * Категория красной линии по данным скидки. productId — точнее всего, затем label (рус),
 * затем serviceType (грубо: WALK включает и прогулку, и закат, и завтрак — поэтому label важен).
 */
export function redLineCategoryOf(
  serviceType?: string | null,
  productId?: string | null,
  label?: string | null,
): RedLineCategory {
  const pid = (productId || '').toLowerCase()
  if (pid === 'tour-sunset') return 'SUNSET'
  if (pid === 'tour-aroma') return 'BREAKFAST'
  if (pid === 'tour-vyborg-walk') return 'WALK'
  if (pid === 'tour-fountain-lesson') return 'LESSON'
  if (pid.startsWith('tour-')) return 'TOUR' // monrepo / belichi / sila

  const l = (label || '').toLowerCase()
  if (/закат|белые ноч/.test(l)) return 'SUNSET'
  if (/завтрак|арома/.test(l)) return 'BREAKFAST'
  if (/прогулк/.test(l)) return 'WALK'
  if (/урок|фонтан/.test(l)) return 'LESSON'
  if (/\bтур\b|монрепо|беличь|место силы/.test(l)) return 'TOUR'
  if (/прокат/.test(l)) return 'RENTAL'

  const st = (serviceType || '').toUpperCase()
  if (st === 'TOUR') return 'TOUR'
  if (st === 'LESSON') return 'LESSON'
  if (st === 'WALK') return 'WALK'
  return 'RENTAL' // RENTAL + неизвестные → дефолт прокат
}

export interface RedLineInput {
  serviceType?: string | null
  productId?: string | null
  label?: string | null
  mode?: PromoMode       // по умолчанию 'mass' (самый строгий общий потолок −40%)
  currentBooked?: number // уже записано (для tour-переходов и подтверждения «слот идёт»)
}

/**
 * Предельно допустимая скидка для услуги/режима. mass → общий потолок −40%; fill → глубокие
 * линии добивки по категории (тур учитывает переход ступени по currentBooked). Никогда не
 * предлагать скидку больше maxPercentOff.
 */
export function getRedLine(input: RedLineInput): RedLine {
  const category = redLineCategoryOf(input.serviceType, input.productId, input.label)
  const mode: PromoMode = input.mode || 'mass'

  if (mode === 'mass') {
    return {
      category,
      mode,
      maxPercentOff: MASS_MAX_PERCENT,
      note: `Массовая акция: потолок −${MASS_MAX_PERCENT}% по всему меню (маржа ≥400₽/чел).`,
    }
  }

  // fill — добивка идущего слота (переменные затраты на +1 чел ≈ 0)
  let max = FILL_MAX_PERCENT[category]
  let note = `Добивка идущего слота (${category}): до −${max}%.`
  if (category === 'TOUR') {
    const next = (input.currentBooked ?? 0) + 1
    if (next === 4 || next === 8) {
      max = TOUR_TRANSITION_MAX
      note = `Тур на ПЕРЕХОДЕ ступени (${next}-й гость): до −${max}% (инструктору +500₽ на группу).`
    }
  }
  return { category, mode, maxPercentOff: max, note }
}

/** Безопасна ли предлагаемая скидка (percentOff ≤ красной линии). */
export function isDiscountWithinRedLine(percentOff: number, input: RedLineInput): boolean {
  return percentOff <= getRedLine(input).maxPercentOff
}

/** Обрезает предлагаемую скидку до красной линии (для авто-подачи в дайджесте/Sales Bot). */
export function clampDiscountToRedLine(percentOff: number, input: RedLineInput): number {
  return Math.max(0, Math.min(percentOff, getRedLine(input).maxPercentOff))
}
