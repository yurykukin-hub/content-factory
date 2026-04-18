/**
 * Configurable USD/RUB rate from backend settings.
 * Fetched once, cached for the session. Fallback: 95.
 */

import { ref } from 'vue'
import { http } from '../api/client'

const USD_RUB = ref(95)
const voiceInputEnabled = ref(false)
const loaded = ref(false)

export function useRates() {
  if (!loaded.value) {
    loaded.value = true
    http.get<{ usdRubRate: number; markupPercent: number; voiceInputEnabled?: boolean }>('/settings/public')
      .then((data) => {
        if (data.usdRubRate > 0) USD_RUB.value = data.usdRubRate
        if (data.voiceInputEnabled != null) voiceInputEnabled.value = data.voiceInputEnabled
      })
      .catch(() => { /* keep default */ })
  }

  /** Convert USD to RUB (rounded) */
  function usdToRub(usd: number): number {
    return Math.round(usd * USD_RUB.value)
  }

  return { USD_RUB, usdToRub, voiceInputEnabled }
}
