import { ref } from 'vue'

export interface Toast {
  id: number
  message: string
  type: 'success' | 'error' | 'info' | 'warning'
}

const toasts = ref<Toast[]>([])
let nextId = 0

export function useToast() {
  function show(message: string, type: Toast['type'] = 'info', duration = 3000) {
    const id = ++nextId
    toasts.value.push({ id, message, type })
    setTimeout(() => remove(id), duration)
  }

  function remove(id: number) {
    toasts.value = toasts.value.filter(t => t.id !== id)
  }

  return {
    toasts,
    success: (msg: string, duration?: number) => show(msg, 'success', duration ?? 3000),
    error: (msg: string, duration?: number) => show(msg, 'error', duration ?? 5000),
    warning: (msg: string, duration?: number) => show(msg, 'warning', duration ?? 4000),
    info: (msg: string, duration?: number) => show(msg, 'info', duration ?? 3000),
    remove,
  }
}
