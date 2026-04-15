import { ref } from 'vue'

export interface Toast {
  id: number
  message: string
  type: 'success' | 'error' | 'info'
}

const toasts = ref<Toast[]>([])
let nextId = 0

export function useToast() {
  function show(message: string, type: Toast['type'] = 'info', duration = 3000) {
    const id = ++nextId
    toasts.value.push({ id, message, type })
    setTimeout(() => {
      toasts.value = toasts.value.filter(t => t.id !== id)
    }, duration)
  }

  return {
    toasts,
    success: (msg: string, duration?: number) => show(msg, 'success', duration ?? 3000),
    error: (msg: string, duration?: number) => show(msg, 'error', duration ?? 5000),
    info: (msg: string, duration?: number) => show(msg, 'info', duration ?? 3000),
  }
}
