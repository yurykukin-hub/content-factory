<script setup lang="ts">
// Wraps CF's EXISTING useToast() composable — keeps success/error/info/warning API,
// adds richer styling (ring, semantic tokens, dismiss button) like the donor kit.
// NOT wired into App.vue yet — old ToastContainer.vue stays the active one until reviewed.
import { useToast } from '@/composables/useToast'
import { CheckCircle, XCircle, AlertTriangle, Info, X } from 'lucide-vue-next'

const { toasts, remove } = useToast()

const iconMap = { success: CheckCircle, error: XCircle, warning: AlertTriangle, info: Info }

const colorMap: Record<string, string> = {
  success: 'bg-success-50 text-success-800 ring-success-500/20 dark:bg-success-500/10 dark:text-success-300 dark:ring-success-500/30',
  error: 'bg-danger-50 text-danger-800 ring-danger-500/20 dark:bg-danger-500/10 dark:text-danger-300 dark:ring-danger-500/30',
  warning: 'bg-warning-50 text-warning-800 ring-warning-500/20 dark:bg-warning-500/10 dark:text-warning-300 dark:ring-warning-500/30',
  info: 'bg-info-50 text-info-800 ring-info-500/20 dark:bg-info-500/10 dark:text-info-300 dark:ring-info-500/30',
}

const iconColorMap: Record<string, string> = {
  success: 'text-success-500',
  error: 'text-danger-500',
  warning: 'text-warning-500',
  info: 'text-info-500',
}
</script>

<template>
  <Teleport to="body">
    <div class="fixed top-4 right-4 z-[100] flex flex-col gap-2 max-w-sm w-full pointer-events-none" aria-live="polite" aria-atomic="true">
      <TransitionGroup name="toast">
        <div
          v-for="toast in toasts"
          :key="toast.id"
          role="status"
          class="pointer-events-auto flex items-start gap-3 px-4 py-3 rounded-xl shadow-lg ring-1 backdrop-blur-sm"
          :class="colorMap[toast.type]"
        >
          <component :is="iconMap[toast.type]" class="w-5 h-5 shrink-0 mt-0.5" :class="iconColorMap[toast.type]" />
          <p class="text-sm font-medium flex-1">{{ toast.message }}</p>
          <button
            type="button"
            aria-label="Закрыть уведомление"
            @click="remove(toast.id)"
            class="shrink-0 p-0.5 rounded hover:bg-black/5 dark:hover:bg-white/5 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-2 dark:focus-visible:ring-offset-gray-900"
          >
            <X class="w-4 h-4 opacity-50" />
          </button>
        </div>
      </TransitionGroup>
    </div>
  </Teleport>
</template>

<style scoped>
.toast-enter-active { transition: all 0.3s ease-out; }
.toast-leave-active { transition: all 0.2s ease-in; }
.toast-enter-from { opacity: 0; transform: translateX(100px); }
.toast-leave-to { opacity: 0; transform: translateX(100px); }
</style>
