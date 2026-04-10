<script setup lang="ts">
import { useToast } from '@/composables/useToast'
import { CheckCircle, XCircle, Info } from 'lucide-vue-next'

const { toasts } = useToast()
</script>

<template>
  <Teleport to="body">
    <div class="fixed top-4 right-4 z-[100] flex flex-col gap-2 pointer-events-none">
      <TransitionGroup name="toast">
        <div
          v-for="toast in toasts"
          :key="toast.id"
          :class="[
            'pointer-events-auto flex items-center gap-2 px-4 py-3 rounded-xl shadow-lg text-sm font-medium max-w-sm',
            toast.type === 'success' ? 'bg-green-600 text-white' : '',
            toast.type === 'error' ? 'bg-red-600 text-white' : '',
            toast.type === 'info' ? 'bg-gray-800 text-white' : '',
          ]"
        >
          <CheckCircle v-if="toast.type === 'success'" :size="18" class="shrink-0" />
          <XCircle v-if="toast.type === 'error'" :size="18" class="shrink-0" />
          <Info v-if="toast.type === 'info'" :size="18" class="shrink-0" />
          <span>{{ toast.message }}</span>
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
