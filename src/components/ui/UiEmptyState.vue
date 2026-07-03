<script setup lang="ts">
interface Props {
  title?: string
  description?: string
}

defineProps<Props>()
</script>

<template>
  <div class="flex flex-col items-center justify-center py-12 px-4 text-center">
    <div v-if="$slots.icon" class="mb-4 text-gray-300 dark:text-gray-600">
      <slot name="icon" />
    </div>
    <h3 v-if="title" class="text-sm font-medium text-gray-900 dark:text-gray-200 mb-1">{{ title }}</h3>
    <p v-if="description" class="text-sm text-gray-500 dark:text-gray-400 max-w-sm">{{ description }}</p>
    <div v-if="$slots.action" class="mt-4">
      <slot name="action" />
    </div>
  </div>
</template>
