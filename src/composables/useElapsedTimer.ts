import { ref, computed, watch, onScopeDispose, type Ref } from 'vue'

/**
 * Тикающий таймер генерации: считает от реального времени начала (ISO-строка),
 * а не с нуля — переживает переключение сессий/вкладок.
 *
 * Ранее этот блок был скопирован байт-в-байт в Vs/Ps/SsSettingsPanel.
 *
 * @param generating  реактивный флаг «идёт генерация»
 * @param startedAt   ISO-таймстамп начала генерации (или null)
 * @returns elapsedSec — секунды с начала; formatted — «m:ss»
 */
export function useElapsedTimer(generating: Ref<boolean>, startedAt: Ref<string | null>) {
  const elapsedSec = ref(0)
  let timerInterval: ReturnType<typeof setInterval> | null = null

  function updateElapsed() {
    if (startedAt.value) {
      elapsedSec.value = Math.max(0, Math.floor((Date.now() - new Date(startedAt.value).getTime()) / 1000))
    }
  }

  function stop() {
    if (timerInterval) clearInterval(timerInterval)
    timerInterval = null
  }

  watch(generating, (val) => {
    if (val) {
      updateElapsed()
      stop() // защита от задвоения интервала
      timerInterval = setInterval(updateElapsed, 1000)
    } else {
      stop()
    }
  }, { immediate: true })

  // Чистим интервал при размонтировании компонента (раньше был leak).
  onScopeDispose(stop)

  const formatted = computed(() => {
    const m = Math.floor(elapsedSec.value / 60)
    const s = elapsedSec.value % 60
    return `${m}:${s.toString().padStart(2, '0')}`
  })

  return { elapsedSec, formatted }
}
