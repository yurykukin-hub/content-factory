<script setup lang="ts">
interface Props {
  variant?: 'success' | 'warning' | 'danger' | 'info' | 'default' | 'brand'
}

withDefaults(defineProps<Props>(), {
  variant: 'default',
})

const colors: Record<string, string> = {
  success: 'bg-success-50 text-success-700 ring-1 ring-success-600/20 dark:bg-success-500/10 dark:text-success-400 dark:ring-success-500/20',
  warning: 'bg-warning-50 text-warning-700 ring-1 ring-warning-600/20 dark:bg-warning-500/10 dark:text-warning-400 dark:ring-warning-500/20',
  danger: 'bg-danger-50 text-danger-700 ring-1 ring-danger-600/20 dark:bg-danger-500/10 dark:text-danger-400 dark:ring-danger-500/20',
  info: 'bg-info-50 text-info-700 ring-1 ring-info-600/20 dark:bg-info-500/10 dark:text-info-400 dark:ring-info-500/20',
  brand: 'bg-brand-50 text-brand-700 ring-1 ring-brand-600/20 dark:bg-brand-500/10 dark:text-brand-400 dark:ring-brand-500/20',
  default: 'bg-gray-50 text-gray-600 ring-1 ring-gray-500/10 dark:bg-gray-400/10 dark:text-gray-400 dark:ring-gray-400/20',
}
</script>

<template>
  <span
    class="inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-xs font-medium whitespace-nowrap"
    :class="colors[variant]"
  >
    <slot />
  </span>
</template>
