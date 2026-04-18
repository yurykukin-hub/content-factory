<script setup lang="ts">
/**
 * Split-button enhance menu with 8 photo modes.
 * Pattern from SsEnhanceMenu.vue adapted for photo generation.
 */
import { ref } from 'vue'
import {
  Wand2, Loader2, ChevronDown, Sparkles,
  Palette, Lightbulb, Grid3x3, Rainbow,
  Search, Globe, Scissors,
} from 'lucide-vue-next'

export type PhotoEnhanceMode = 'enhance' | 'style' | 'lighting' | 'composition' | 'mood' | 'detail' | 'translate' | 'simplify'

interface ModeItem {
  id: PhotoEnhanceMode
  label: string
  description: string
  icon: any
  category: 'basic' | 'pro'
}

const MODES: ModeItem[] = [
  { id: 'enhance', label: 'Улучшить', description: 'Обогатить описание', icon: Sparkles, category: 'basic' },
  { id: 'style', label: 'Стиль', description: 'Художественный стиль', icon: Palette, category: 'basic' },
  { id: 'lighting', label: 'Освещение', description: 'Свет и тени', icon: Lightbulb, category: 'basic' },
  { id: 'composition', label: 'Композиция', description: 'Расположение и кадр', icon: Grid3x3, category: 'pro' },
  { id: 'mood', label: 'Настроение', description: 'Атмосфера и цвет', icon: Rainbow, category: 'pro' },
  { id: 'detail', label: 'Детали', description: 'Текстуры и элементы', icon: Search, category: 'pro' },
  { id: 'translate', label: 'Перевести', description: 'RU / EN', icon: Globe, category: 'pro' },
  { id: 'simplify', label: 'Упростить', description: 'Сжать описание', icon: Scissors, category: 'pro' },
]

defineProps<{
  enhancing: boolean
  disabled?: boolean
}>()

const emit = defineEmits<{
  enhance: [mode: PhotoEnhanceMode]
}>()

const open = ref(false)
const basicModes = MODES.filter(m => m.category === 'basic')
const proModes = MODES.filter(m => m.category === 'pro')

function selectMode(mode: PhotoEnhanceMode) {
  open.value = false
  emit('enhance', mode)
}

function onMainClick() {
  emit('enhance', 'enhance')
}
</script>

<template>
  <div class="relative">
    <div class="flex items-center">
      <button @click="onMainClick" :disabled="enhancing || disabled"
        class="flex items-center gap-1.5 px-3 py-1.5 rounded-l-lg text-xs font-medium border border-fuchsia-300 text-fuchsia-600 hover:bg-fuchsia-50 dark:hover:bg-fuchsia-900/20 disabled:opacity-50 transition-colors">
        <Loader2 v-if="enhancing" :size="12" class="animate-spin" />
        <Wand2 v-else :size="12" />
        {{ enhancing ? 'Обработка...' : 'Улучшить' }}
      </button>
      <button @click="open = !open" :disabled="enhancing || disabled"
        class="flex items-center px-1.5 py-1.5 rounded-r-lg text-xs font-medium border border-l-0 border-fuchsia-300 text-fuchsia-600 hover:bg-fuchsia-50 dark:hover:bg-fuchsia-900/20 disabled:opacity-50 transition-colors">
        <ChevronDown :size="12" :class="{ 'rotate-180': open }" class="transition-transform" />
      </button>
    </div>

    <div v-if="open" class="fixed inset-0 z-10" @click="open = false" />

    <div v-if="open"
      class="absolute bottom-full left-0 mb-1 w-56 bg-white dark:bg-gray-900 border border-fuchsia-200 dark:border-fuchsia-800 rounded-xl shadow-xl z-20 py-1">
      <button v-for="m in basicModes" :key="m.id"
        @click="selectMode(m.id)"
        class="w-full flex items-center gap-2.5 px-3 py-2 text-left hover:bg-fuchsia-50 dark:hover:bg-fuchsia-900/20 transition-colors">
        <component :is="m.icon" :size="14" class="text-fuchsia-500 shrink-0" />
        <div class="min-w-0">
          <div class="text-xs font-medium text-gray-800 dark:text-gray-200">{{ m.label }}</div>
          <div class="text-[9px] text-gray-400 truncate">{{ m.description }}</div>
        </div>
      </button>

      <div class="my-1 mx-3 border-t border-fuchsia-100 dark:border-fuchsia-800 flex items-center gap-2">
        <span class="text-[8px] font-bold text-fuchsia-400 uppercase tracking-wider py-1">Pro</span>
      </div>
      <button v-for="m in proModes" :key="m.id"
        @click="selectMode(m.id)"
        class="w-full flex items-center gap-2.5 px-3 py-2 text-left hover:bg-fuchsia-50 dark:hover:bg-fuchsia-900/20 transition-colors">
        <component :is="m.icon" :size="14" class="text-fuchsia-500 shrink-0" />
        <div class="min-w-0">
          <div class="text-xs font-medium text-gray-800 dark:text-gray-200">{{ m.label }}</div>
          <div class="text-[9px] text-gray-400 truncate">{{ m.description }}</div>
        </div>
      </button>
    </div>
  </div>
</template>
