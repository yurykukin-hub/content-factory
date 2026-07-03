<script setup lang="ts">
interface Tab {
  key: string
  label: string
  count?: number
}

interface Props {
  modelValue: string
  tabs: Tab[]
  /** underline (default, classic tab strip) or segmented (pill group — absorbs UiSegmented) */
  variant?: 'underline' | 'segmented'
}

withDefaults(defineProps<Props>(), {
  variant: 'underline',
})

defineEmits<{
  'update:modelValue': [value: string]
}>()

const focusRing = 'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-2 dark:focus-visible:ring-offset-gray-900'
</script>

<template>
  <div v-if="variant === 'underline'" class="border-b border-gray-200 dark:border-gray-700">
    <nav class="-mb-px flex gap-1 overflow-x-auto" role="tablist">
      <button
        v-for="tab in tabs"
        :key="tab.key"
        role="tab"
        type="button"
        :aria-selected="modelValue === tab.key"
        :class="[
          'relative shrink-0 px-4 py-2.5 text-sm font-medium transition-colors duration-150 border-b-2 whitespace-nowrap rounded-t-md',
          focusRing,
          modelValue === tab.key
            ? 'border-brand-500 text-brand-600 dark:text-brand-400'
            : 'border-transparent text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300 hover:border-gray-300 dark:hover:border-gray-600',
        ]"
        @click="$emit('update:modelValue', tab.key)"
      >
        {{ tab.label }}
        <span
          v-if="tab.count !== undefined"
          class="ml-1.5 rounded-full px-1.5 py-0.5 text-xs tabular-nums"
          :class="modelValue === tab.key
            ? 'bg-brand-100 text-brand-700 dark:bg-brand-500/20 dark:text-brand-400'
            : 'bg-gray-100 text-gray-500 dark:bg-gray-700 dark:text-gray-400'"
        >
          {{ tab.count }}
        </span>
      </button>
    </nav>
  </div>

  <div v-else class="inline-flex items-center gap-1 rounded-lg bg-gray-100 dark:bg-gray-800 p-1" role="tablist">
    <button
      v-for="tab in tabs"
      :key="tab.key"
      role="tab"
      type="button"
      :aria-selected="modelValue === tab.key"
      :class="[
        'relative px-3 py-1.5 text-sm font-medium rounded-md transition-colors duration-150 whitespace-nowrap',
        focusRing,
        modelValue === tab.key
          ? 'bg-white dark:bg-gray-700 text-brand-600 dark:text-brand-400 shadow-sm'
          : 'text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200',
      ]"
      @click="$emit('update:modelValue', tab.key)"
    >
      {{ tab.label }}
      <span
        v-if="tab.count !== undefined"
        class="ml-1.5 rounded-full px-1.5 py-0.5 text-xs tabular-nums"
        :class="modelValue === tab.key
          ? 'bg-brand-100 text-brand-700 dark:bg-brand-500/20 dark:text-brand-400'
          : 'bg-gray-200 text-gray-500 dark:bg-gray-600 dark:text-gray-400'"
      >
        {{ tab.count }}
      </span>
    </button>
  </div>
</template>
