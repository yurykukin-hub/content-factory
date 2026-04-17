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
    <button
      v-for="tab in tabs"
      :key="tab.id"
      @click="$emit('update:modelValue', tab.id)"
      :class="[
        'flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-all duration-150',
        modelValue === tab.id
          ? 'bg-white dark:bg-gray-900 text-emerald-600 dark:text-emerald-400 shadow-sm'
          : 'text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300',
      ]">
      <component :is="tab.icon" :size="13" />
      <span class="hidden sm:inline">{{ tab.label }}</span>
    </button>
  </div>
</template>
