<script setup lang="ts">
import { Sparkles, PenTool } from 'lucide-vue-next'

type MusicMode = 'simple' | 'custom'

defineProps<{ modelValue: MusicMode }>()
defineEmits<{ 'update:modelValue': [value: MusicMode] }>()

const tabs = [
  { id: 'simple' as const, label: 'Простой', sub: 'только промпт', icon: Sparkles },
  { id: 'custom' as const, label: 'Полный', sub: 'текст + стиль', icon: PenTool },
]
</script>

<template>
  <div class="px-4 pt-4 pb-2">
    <div class="flex gap-1 bg-gray-100 dark:bg-gray-800 rounded-xl p-1">
      <button v-for="tab in tabs" :key="tab.id"
        @click="$emit('update:modelValue', tab.id)"
        :class="[
          'flex-1 flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg text-xs font-medium transition-all',
          modelValue === tab.id
            ? 'bg-white dark:bg-gray-900 text-fuchsia-600 dark:text-fuchsia-400 shadow-sm'
            : 'text-gray-500 hover:text-gray-700'
        ]">
        <component :is="tab.icon" :size="14" />
        <span>{{ tab.label }}</span>
        <span class="text-[9px] opacity-60 hidden sm:inline">{{ tab.sub }}</span>
      </button>
    </div>
  </div>
</template>
