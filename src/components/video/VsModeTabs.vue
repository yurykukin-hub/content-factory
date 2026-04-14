<script setup lang="ts">
import { Image, Film, Type } from 'lucide-vue-next'

type InputMode = 'text' | 'frames' | 'references'

defineProps<{
  modelValue: InputMode
}>()

const emit = defineEmits<{
  'update:modelValue': [value: InputMode]
}>()

const tabs = [
  { id: 'references' as const, label: 'Референсы', sub: 'до 9 фото', icon: Image },
  { id: 'frames' as const, label: 'Кадры', sub: '1-2 фото', icon: Film },
  { id: 'text' as const, label: 'Текст', sub: 'без фото', icon: Type },
]
</script>

<template>
  <div class="px-4 pt-4 pb-2">
    <div class="flex gap-1 bg-gray-100 dark:bg-gray-800 rounded-xl p-1">
      <button v-for="tab in tabs" :key="tab.id"
        @click="emit('update:modelValue', tab.id)"
        :class="[
          'flex-1 flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg text-xs font-medium transition-all whitespace-nowrap',
          modelValue === tab.id
            ? 'bg-white dark:bg-gray-900 text-emerald-600 dark:text-emerald-400 shadow-sm'
            : 'text-gray-500 hover:text-gray-700 dark:hover:text-gray-300'
        ]">
        <component :is="tab.icon" :size="14" />
        <span>{{ tab.label }}</span>
        <span class="text-[9px] opacity-60 hidden sm:inline">{{ tab.sub }}</span>
      </button>
    </div>
  </div>
</template>
