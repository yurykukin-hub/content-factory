<script setup lang="ts">
import { useConfirm } from '@/composables/useConfirm'
import UiModal from './UiModal.vue'
import UiButton from './UiButton.vue'
import { AlertTriangle } from 'lucide-vue-next'

const { state, handleConfirm, handleCancel } = useConfirm()
</script>

<template>
  <UiModal
    :model-value="state.show"
    @update:model-value="handleCancel"
    :title="state.options.title || 'Подтверждение'"
    size="sm"
  >
    <div class="flex gap-4">
      <div
        class="shrink-0 w-10 h-10 rounded-full flex items-center justify-center"
        :class="state.options.variant === 'danger'
          ? 'bg-danger-100 dark:bg-danger-500/10'
          : 'bg-brand-100 dark:bg-brand-500/10'"
      >
        <AlertTriangle
          class="w-5 h-5"
          :class="state.options.variant === 'danger'
            ? 'text-danger-600 dark:text-danger-400'
            : 'text-brand-600 dark:text-brand-400'"
        />
      </div>
      <p class="text-sm text-gray-600 dark:text-gray-300 leading-relaxed">
        {{ state.options.message }}
      </p>
    </div>

    <template #footer>
      <UiButton variant="secondary" size="md" @click="handleCancel">
        {{ state.options.cancelLabel || 'Отмена' }}
      </UiButton>
      <UiButton
        :variant="state.options.variant === 'danger' ? 'danger' : 'primary'"
        size="md"
        @click="handleConfirm"
      >
        {{ state.options.confirmLabel || 'Подтвердить' }}
      </UiButton>
    </template>
  </UiModal>
</template>
