/**
 * Погодный flash-сигнал (Фаза 3, этап 2): «распогодилось + сегодня ещё свободно» → повод
 * предложить разовую скидку на сегодня (заполнить пустые места, пока погода манит).
 *
 * Pure + тестируемо. Глубину скидки ограничивает getRedLine (красные линии плейбука).
 * Этап 2 — ПОЛУ-РУЧНОЙ: CF только ПРЕДЛАГАЕТ flash-сторис + даёт инструкцию, что завести
 * в ERP (CF читает ERP read-only, не пишет). Скидку в ERP ставит человек перед публикацией.
 */

import { clampDiscountToRedLine } from './red-lines'

export interface FlashConditions {
  minTemp: number     // °C, ниже — холодно для воды (дефолт 18)
  maxWind: number     // м/с, выше — некомфортно на сапе (дефолт 7 — умеренный)
  maxPrecip: number   // мм осадков, выше — мокро (дефолт 1)
  percent: number     // желаемая глубина flash (дефолт 25; getRedLine всё равно обрежет)
  maxBookings: number // если броней на сегодня больше — день и так идёт, flash не нужен (дефолт 5)
}

export const DEFAULT_FLASH_CONDITIONS: FlashConditions = {
  minTemp: 18,
  maxWind: 7,
  maxPrecip: 1,
  percent: 25,
  maxBookings: 5,
}

export interface FlashWeather {
  tempMax: number | null
  windMax: number | null
  precipMm: number | null
  label?: string | null
}

export interface FlashSignal {
  triggered: boolean
  reason: string            // объяснение (попадает в reasoning предложения)
  suggestedPercent: number  // глубина после обрезки красной линией
  serviceLabel: string      // на что предлагаем flash (прокат — самый ликвидный заполнитель)
}

/**
 * Оценивает, есть ли повод для погодного flash сегодня. triggered = хорошая погода
 * (тепло + не ветрено + сухо) И день ещё свободен (мало броней). Глубина скидки —
 * через clampDiscountToRedLine (mass-режим: на всех на сегодня → потолок −40%).
 */
export function evaluateWeatherFlash(input: {
  weatherToday?: FlashWeather | null
  bookingsToday: number
  conditions?: Partial<FlashConditions>
}): FlashSignal {
  // ?? (а не spread) — чтобы undefined из AppConfig не затирал дефолты
  const d = DEFAULT_FLASH_CONDITIONS
  const o = input.conditions || {}
  const c: FlashConditions = {
    minTemp: o.minTemp ?? d.minTemp,
    maxWind: o.maxWind ?? d.maxWind,
    maxPrecip: o.maxPrecip ?? d.maxPrecip,
    percent: o.percent ?? d.percent,
    maxBookings: o.maxBookings ?? d.maxBookings,
  }
  const serviceLabel = 'прокат' // массовый заполнитель; туры/закаты — пик, скидками не трогаем
  const suggestedPercent = clampDiscountToRedLine(c.percent, { serviceType: 'RENTAL', mode: 'mass' })
  const w = input.weatherToday

  if (!w || w.tempMax == null) {
    return { triggered: false, reason: 'нет данных о погоде на сегодня', suggestedPercent, serviceLabel }
  }

  const warm = w.tempMax >= c.minTemp
  const calm = w.windMax == null || w.windMax <= c.maxWind
  const dry = w.precipMm == null || w.precipMm <= c.maxPrecip
  const free = input.bookingsToday <= c.maxBookings
  const triggered = warm && calm && dry && free

  if (triggered) {
    return {
      triggered: true,
      reason: `Погода зовёт на воду (${w.tempMax}°${w.label ? ', ' + w.label : ''}), а на сегодня ещё свободно (${input.bookingsToday} броней) — повод для flash −${suggestedPercent}% на ${serviceLabel}.`,
      suggestedPercent,
      serviceLabel,
    }
  }

  const blockers: string[] = []
  if (!warm) blockers.push(`прохладно (${w.tempMax}° < ${c.minTemp}°)`)
  if (!calm) blockers.push('ветрено')
  if (!dry) blockers.push('осадки')
  if (!free) blockers.push(`день уже загружен (${input.bookingsToday} броней)`)
  return {
    triggered: false,
    reason: `Flash не нужен: ${blockers.join(', ') || 'условия не выполнены'}.`,
    suggestedPercent,
    serviceLabel,
  }
}
