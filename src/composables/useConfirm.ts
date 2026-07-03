import { ref } from 'vue'

export interface ConfirmOptions {
  title?: string
  message: string
  confirmLabel?: string
  cancelLabel?: string
  variant?: 'danger' | 'default'
}

interface ConfirmState {
  show: boolean
  options: ConfirmOptions
  resolve: ((value: boolean) => void) | null
}

// Module-level singleton — matches CF's existing useToast pattern (no provide/inject,
// no wiring needed in App.vue). Render <UiConfirmDialog /> once anywhere in the tree
// and every useConfirm().confirm() call across the app will show in it.
const state = ref<ConfirmState>({
  show: false,
  options: { message: '' },
  resolve: null,
})

export function useConfirm() {
  function confirm(messageOrOptions: string | ConfirmOptions): Promise<boolean> {
    const options = typeof messageOrOptions === 'string' ? { message: messageOrOptions } : messageOrOptions
    return new Promise((resolve) => {
      state.value = { show: true, options, resolve }
    })
  }

  function handleConfirm() {
    state.value.resolve?.(true)
    state.value = { show: false, options: { message: '' }, resolve: null }
  }

  function handleCancel() {
    state.value.resolve?.(false)
    state.value = { show: false, options: { message: '' }, resolve: null }
  }

  return { state, confirm, handleConfirm, handleCancel }
}
