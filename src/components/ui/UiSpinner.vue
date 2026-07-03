<script setup lang="ts">
interface Props {
  size?: 'sm' | 'md' | 'lg'
  /** Visually-hidden text for screen readers (aria-live via role="status") */
  label?: string
}

withDefaults(defineProps<Props>(), {
  size: 'md',
  label: 'Загрузка…',
})

const sizeClasses: Record<string, string> = {
  sm: 'h-4 w-4',
  md: 'h-6 w-6',
  lg: 'h-8 w-8',
}
</script>

<template>
  <span class="inline-flex items-center justify-center" role="status">
    <svg class="animate-spin" :class="sizeClasses[size]" fill="none" viewBox="0 0 24 24">
      <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4" />
      <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
    </svg>
    <span v-if="label" class="sr-only">{{ label }}</span>
  </span>
</template>
