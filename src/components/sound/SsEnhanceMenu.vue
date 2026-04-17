<script setup lang="ts">
/**
 * Split-button enhance menu with 8 music modes.
 * Pattern from VsEnhanceMenu.vue adapted for music.
 */
import { ref } from 'vue'
import {
  Wand2, Loader2, ChevronDown, FileText, Sparkles,
  Music, LayoutTemplate, Repeat, Globe, Eraser,
} from 'lucide-vue-next'

export type MusicEnhanceMode = 'enhance' | 'lyrics' | 'improve' | 'style' | 'structure' | 'rhyme' | 'translate' | 'simplify'

interface ModeItem {
  id: MusicEnhanceMode
  label: string
  description: string
  icon: any
  category: 'basic' | 'pro'
}

const MODES: ModeItem[] = [
  { id: 'enhance', label: 'Улучшить промпт', description: 'Обогатить описание', icon: Wand2, category: 'basic' },
  { id: 'lyrics', label: 'Написать текст', description: 'AI-генерация из темы', icon: FileText, category: 'basic' },
  { id: 'style', label: 'Подобрать стиль', description: 'Жанр + mood + BPM', icon: Music, category: 'basic' },
  { id: 'improve', label: 'Улучшить текст', description: 'Рифмы, ритм, образы', icon: Sparkles, category: 'pro' },
  { id: 'structure', label: 'Структурировать', description: '[Verse]/[Chorus] секции', icon: LayoutTemplate, category: 'pro' },
  { id: 'rhyme', label: 'Рифмы', description: 'Найти и улучшить', icon: Repeat, category: 'pro' },
  { id: 'translate', label: 'Перевести', description: 'RU ↔ EN для Suno', icon: Globe, category: 'pro' },
  { id: 'simplify', label: 'Упростить', description: 'Сжать описание', icon: Eraser, category: 'pro' },
]

const props = defineProps<{
  enhancing: boolean
  disabled: boolean
  hasLyrics: boolean
}>()

const emit = defineEmits<{
  enhance: [mode: MusicEnhanceMode]
}>()

const open = ref(false)
const basicModes = MODES.filter(m => m.category === 'basic')
const proModes = MODES.filter(m => m.category === 'pro')

function selectMode(mode: MusicEnhanceMode) {
  open.value = false
  emit('enhance', mode)
}

function onMainClick() {
  // Default: enhance if no lyrics, lyrics-generate if no lyrics text
  emit('enhance', props.hasLyrics ? 'improve' : 'enhance')
}
</script>

<template>
  <div class="relative">
    <div class="flex items-center">
      <button @click="onMainClick" :disabled="enhancing || disabled"
        class="flex items-center gap-1.5 px-3 py-1.5 rounded-l-lg text-xs font-medium border border-fuchsia-300 text-fuchsia-600 hover:bg-fuchsia-50 disabled:opacity-50 transition-colors">
        <Loader2 v-if="enhancing" :size="12" class="animate-spin" />
        <Wand2 v-else :size="12" />
        {{ enhancing ? 'Обработка...' : (hasLyrics ? 'Улучшить текст' : 'Улучшить') }}
      </button>
      <button @click="open = !open" :disabled="enhancing || disabled"
        class="flex items-center px-1.5 py-1.5 rounded-r-lg text-xs font-medium border border-l-0 border-fuchsia-300 text-fuchsia-600 hover:bg-fuchsia-50 disabled:opacity-50 transition-colors">
        <ChevronDown :size="12" :class="{ 'rotate-180': open }" class="transition-transform" />
      </button>
    </div>

    <div v-if="open" class="fixed inset-0 z-10" @click="open = false" />

    <div v-if="open"
      class="absolute bottom-full left-0 mb-1 w-56 bg-white dark:bg-gray-900 border border-fuchsia-200 rounded-xl shadow-xl z-20 py-1">
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
