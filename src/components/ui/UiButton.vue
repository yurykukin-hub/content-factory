<script setup lang="ts">
import { watchEffect } from 'vue'
import UiSpinner from './UiSpinner.vue'

interface Props {
  variant?: 'primary' | 'secondary' | 'danger' | 'ghost'
  size?: 'sm' | 'md' | 'lg'
  loading?: boolean
  disabled?: boolean
  type?: 'button' | 'submit' | 'reset'
  /** Renders as a square icon button. REQUIRES ariaLabel (dev-time warning if missing). */
  iconOnly?: boolean
  /** Accessible name — required when iconOnly=true, optional otherwise (adds aria-label). */
  ariaLabel?: string
}

const props = withDefaults(defineProps<Props>(), {
  variant: 'primary',
  size: 'md',
  loading: false,
  disabled: false,
  type: 'button',
  iconOnly: false,
})

if (import.meta.env.DEV) {
  watchEffect(() => {
    if (props.iconOnly && !props.ariaLabel) {
      console.warn('[UiButton] iconOnly=true requires an ariaLabel prop for accessibility.')
    }
  })
}

const variantClasses: Record<string, string> = {
  primary: 'bg-brand-600 text-white hover:bg-brand-700 focus-visible:ring-brand-500 shadow-sm',
  secondary: 'bg-white text-gray-700 ring-1 ring-gray-300 hover:bg-gray-50 focus-visible:ring-brand-500 dark:bg-gray-800 dark:text-gray-200 dark:ring-gray-600 dark:hover:bg-gray-700',
  danger: 'bg-danger-600 text-white hover:bg-danger-700 focus-visible:ring-danger-500 shadow-sm',
  ghost: 'text-gray-600 hover:bg-gray-100 hover:text-gray-900 focus-visible:ring-brand-500 dark:text-gray-400 dark:hover:bg-gray-700 dark:hover:text-gray-200',
}

const sizeClasses: Record<string, string> = {
  sm: 'px-2.5 py-1.5 text-xs gap-1.5 rounded-md',
  md: 'px-3 py-2 text-sm gap-2 rounded-lg',
  lg: 'px-4 py-2.5 text-sm gap-2 rounded-lg',
}

const iconOnlySizeClasses: Record<string, string> = {
  sm: 'p-1.5 rounded-md',
  md: 'p-2 rounded-lg',
  lg: 'p-2.5 rounded-lg',
}
</script>

<template>
  <button
    :type="type"
    :disabled="disabled || loading"
    :aria-label="ariaLabel"
    :aria-busy="loading || undefined"
    class="inline-flex items-center justify-center font-medium transition-all duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 dark:focus-visible:ring-offset-gray-900 disabled:opacity-50 disabled:cursor-not-allowed select-none"
    :class="[variantClasses[variant], iconOnly ? [iconOnlySizeClasses[size], 'min-w-touch min-h-touch'] : sizeClasses[size]]"
  >
    <UiSpinner v-if="loading" size="sm" :label="undefined" />
    <slot v-if="!loading" name="icon" />
    <slot v-if="!loading || !iconOnly" />
  </button>
</template>
