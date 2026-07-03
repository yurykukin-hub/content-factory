<script setup lang="ts">
interface Props {
  padding?: boolean
  noBorder?: boolean
  hover?: boolean
}

withDefaults(defineProps<Props>(), {
  padding: true,
  noBorder: false,
  hover: false,
})
</script>

<template>
  <div
    class="bg-white dark:bg-gray-800 rounded-xl transition-shadow duration-200"
    :class="[
      noBorder ? '' : 'border border-gray-200 dark:border-gray-700/60',
      hover
        ? 'hover:shadow-md cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-2 dark:focus-visible:ring-offset-gray-900'
        : 'shadow-sm',
    ]"
  >
    <div v-if="$slots.header" class="px-5 py-4 border-b border-gray-100 dark:border-gray-700/60">
      <slot name="header" />
    </div>
    <div :class="padding ? 'p-5' : ''">
      <slot />
    </div>
    <div v-if="$slots.footer" class="px-5 py-3 border-t border-gray-100 dark:border-gray-700/60 bg-gray-50/50 dark:bg-gray-800/50 rounded-b-xl">
      <slot name="footer" />
    </div>
  </div>
</template>
