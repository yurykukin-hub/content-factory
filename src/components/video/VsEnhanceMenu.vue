<script setup lang="ts">
import {
  Wand2, Loader2, ChevronDown, Clapperboard, LayoutTemplate, Target,
  Volume2, Camera, Globe, Eraser,
} from 'lucide-vue-next'
import { ref } from 'vue'

export type EnhanceMode = 'enhance' | 'director' | 'structure' | 'focus' | 'audio' | 'camera' | 'translate' | 'simplify'

interface ModeItem {
  id: EnhanceMode
  label: string
  description: string
  icon: any
  category: 'basic' | 'pro'
}

const MODES: ModeItem[] = [
  { id: 'enhance', label: 'Улучшить', description: 'Адаптивное улучшение', icon: Wand2, category: 'basic' },
  { id: 'simplify', label: 'Упростить', description: 'Базовая структура', icon: Eraser, category: 'basic' },
  { id: 'director', label: 'Режиссёрский', description: 'Timeline, мультисцены', icon: Clapperboard, category: 'pro' },
  { id: 'structure', label: 'Структурировать', description: '6-компонентный шаблон', icon: LayoutTemplate, category: 'pro' },
  { id: 'focus', label: 'Фокус', description: 'Убрать мусор, усилить', icon: Target, category: 'pro' },
  { id: 'audio', label: 'Добавить звук', description: 'Inline-аудио описания', icon: Volume2, category: 'pro' },
  { id: 'camera', label: 'Камера', description: 'Кадр + движение + угол', icon: Camera, category: 'pro' },
  { id: 'translate', label: 'Перевести', description: 'RU → EN для Seedance', icon: Globe, category: 'pro' },
]

const props = defineProps<{
  enhancing: boolean
  disabled: boolean
  isAdmin: boolean
  isProMode: boolean
}>()

const emit = defineEmits<{
  enhance: [mode: EnhanceMode]
}>()

const open = ref(false)

const basicModes = MODES.filter(m => m.category === 'basic')
const proModes = MODES.filter(m => m.category === 'pro')

function selectMode(mode: EnhanceMode) {
  open.value = false
  emit('enhance', mode)
}

function onMainClick() {
  emit('enhance', 'enhance')
}
</script>

<template>
  <div class="relative">
    <!-- Split button: main action + dropdown chevron -->
    <div class="flex items-center">
      <!-- Main button — default enhance -->
      <button @click="onMainClick" :disabled="enhancing || disabled"
        class="flex items-center gap-1.5 px-3 py-1.5 rounded-l-lg text-xs font-medium border border-purple-300 dark:border-purple-700 text-purple-600 dark:text-purple-400 hover:bg-purple-50 dark:hover:bg-purple-950 disabled:opacity-50 transition-colors">
        <Loader2 v-if="enhancing" :size="12" class="animate-spin" />
        <Wand2 v-else :size="12" />
        {{ enhancing ? 'Улучшаю...' : 'Улучшить' }}
      </button>
      <!-- Chevron dropdown trigger -->
      <button @click="open = !open" :disabled="enhancing || disabled"
        class="flex items-center px-1.5 py-1.5 rounded-r-lg text-xs font-medium border border-l-0 border-purple-300 dark:border-purple-700 text-purple-600 dark:text-purple-400 hover:bg-purple-50 dark:hover:bg-purple-950 disabled:opacity-50 transition-colors">
        <ChevronDown :size="12" :class="{ 'rotate-180': open }" class="transition-transform" />
      </button>
    </div>

    <!-- Backdrop (click-outside) -->
    <div v-if="open" class="fixed inset-0 z-10" @click="open = false" />

    <!-- Dropdown menu (opens UPWARD) -->
    <div v-if="open"
      class="absolute bottom-full left-0 mb-1 w-56 bg-white dark:bg-gray-900 border border-purple-200 dark:border-purple-800 rounded-xl shadow-xl z-20 py-1 overflow-hidden">

      <!-- Basic modes -->
      <button v-for="m in basicModes" :key="m.id"
        @click="selectMode(m.id)"
        class="w-full flex items-center gap-2.5 px-3 py-2 text-left hover:bg-purple-50 dark:hover:bg-purple-950/50 transition-colors">
        <component :is="m.icon" :size="14" class="text-purple-500 dark:text-purple-400 shrink-0" />
        <div class="min-w-0">
          <div class="text-xs font-medium text-gray-800 dark:text-gray-200">{{ m.label }}</div>
          <div class="text-[9px] text-gray-400 dark:text-gray-500 truncate">{{ m.description }}</div>
        </div>
      </button>

      <!-- Pro separator + modes (admin + devMode only) -->
      <template v-if="isAdmin && isProMode">
        <div class="my-1 mx-3 border-t border-purple-100 dark:border-purple-900 flex items-center gap-2">
          <span class="text-[8px] font-bold text-purple-400 dark:text-purple-500 uppercase tracking-wider py-1">Pro</span>
        </div>
        <button v-for="m in proModes" :key="m.id"
          @click="selectMode(m.id)"
          class="w-full flex items-center gap-2.5 px-3 py-2 text-left hover:bg-purple-50 dark:hover:bg-purple-950/50 transition-colors">
          <component :is="m.icon" :size="14" class="text-purple-500 dark:text-purple-400 shrink-0" />
          <div class="min-w-0">
            <div class="text-xs font-medium text-gray-800 dark:text-gray-200">{{ m.label }}</div>
            <div class="text-[9px] text-gray-400 dark:text-gray-500 truncate">{{ m.description }}</div>
          </div>
        </button>
      </template>
    </div>
  </div>
</template>
