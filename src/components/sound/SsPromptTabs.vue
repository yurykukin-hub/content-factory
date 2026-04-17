<script setup lang="ts">
import { Bot, PenTool } from 'lucide-vue-next'

const tabs = [
  { id: 'agent' as const, label: 'Агент', icon: Bot },
  { id: 'editor' as const, label: 'Редактор', icon: PenTool },
]

defineProps<{ modelValue: 'agent' | 'editor' }>()
defineEmits<{ 'update:modelValue': [value: 'agent' | 'editor'] }>()
</script>

<template>
  <div class="flex gap-1 p-1 bg-gray-100 dark:bg-gray-800 rounded-lg w-fit">
    <button v-for="tab in tabs" :key="tab.id"
      @click="$emit('update:modelValue', tab.id)"
      :class="[
        'flex items-center gap-1 px-2 py-1 lg:gap-1.5 lg:px-3 lg:py-1.5 rounded-md text-xs font-medium transition-all',
        modelValue === tab.id
          ? 'bg-white dark:bg-gray-900 text-fuchsia-600 dark:text-fuchsia-400 shadow-sm'
          : 'text-gray-500 hover:text-gray-700',
      ]">
      <component :is="tab.icon" :size="13" />
      <span>{{ tab.label }}</span>
    </button>
  </div>
</template>
