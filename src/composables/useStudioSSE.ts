import { onScopeDispose } from 'vue'
import { TAB_ID } from '@/api/client'

/**
 * Одно SSE-соединение студии (Photo/Sound/Video) с авто-reconnect.
 *
 * Раньше блок `connectSSE` + refs `sseSource`/`sseReconnectTimer` был скопирован
 * байт-в-байт в каждую студию. Домен-специфична только реакция на событие —
 * её передаём колбэком `onEvent`.
 *
 * Контракт:
 * - `connect()` вызывает потребитель (в onMounted, ДО загрузки сессий) — соединение
 *   одно на view и НЕ пересоздаётся при KeepAlive-активации.
 * - служебные кадры `ping`/`connected` игнорируются;
 * - тело кадра парсится как JSON и уходит в `onEvent` (ошибки парсинга/обработчика
 *   глотаются — как в оригинале, где весь handler был в try/catch);
 * - при разрыве — авто-reconnect через 5 с;
 * - соединение закрывается при размонтировании (onScopeDispose); при KeepAlive-
 *   деактивации НЕ закрывается (scope живёт) — поведение как в исходных студиях.
 *
 * @param onEvent  обработчик распарсенного SSE-события
 * @returns connect — открыть соединение; close — закрыть (идемпотентно)
 */
export function useStudioSSE(onEvent: (event: any) => void) {
  let source: EventSource | null = null
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null

  function connect() {
    source = new EventSource(`/api/sse?tabId=${TAB_ID}`)
    source.onmessage = (e) => {
      if (e.data === 'ping' || e.data === 'connected') return
      try {
        onEvent(JSON.parse(e.data))
      } catch {}
    }
    source.onerror = () => {
      source?.close()
      reconnectTimer = setTimeout(connect, 5000)
    }
  }

  function close() {
    source?.close()
    source = null
    if (reconnectTimer) {
      clearTimeout(reconnectTimer)
      reconnectTimer = null
    }
  }

  // Страховочная чистка на реальном размонтировании компонента.
  onScopeDispose(close)

  return { connect, close }
}
