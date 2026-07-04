<script setup lang="ts">
/**
 * SharedEnhanceMenu — split-button меню улучшения промпта (Photo + Sound, Волна 2, C3).
 * Поглощает PsEnhanceMenu + SsEnhanceMenu. Режимы (доменные) приходят пропом `modes`
 * с секциями basic/pro (визуальный «Pro»-разделитель, все режимы кликабельны).
 * Главная кнопка вызывает mainMode (или modes[0]); chevron раскрывает полный список.
 * accent — API на будущее; v1 всегда fuchsia (классы зашиты строками целиком —
 * Tailwind не интерполирует text-${x}).
 */
import { ref, computed } from 'vue'
import { Wand2, Loader2, ChevronDown } from 'lucide-vue-next'

export interface EnhanceModeItem {
  id: string
  label: string
  group: 'basic' | 'pro'
}

const props = withDefaults(defineProps<{
  modes: EnhanceModeItem[]
  enhancing: boolean
  disabled?: boolean
  accent?: string
  mainMode?: string
}>(), {
  disabled: false,
  accent: 'fuchsia',
})

const emit = defineEmits<{
  enhance: [mode: string]
}>()

const open = ref(false)
const basicModes = computed(() => props.modes.filter(m => m.group === 'basic'))
const proModes = computed(() => props.modes.filter(m => m.group === 'pro'))
const effectiveMain = computed(() => props.mainMode || props.modes[0]?.id || '')
const mainLabel = computed(() =>
  props.modes.find(m => m.id === effectiveMain.value)?.label || props.modes[0]?.label || 'Улучшить'
)

function selectMode(mode: string) {
  open.value = false
  emit('enhance', mode)
}

function onMainClick() {
  if (effectiveMain.value) emit('enhance', effectiveMain.value)
}
</script>

<template>
  <div class="relative">
    <div class="flex items-center">
      <button @click="onMainClick" :disabled="enhancing || disabled"
        :title="mainLabel"
        class="flex items-center gap-1.5 px-3 py-1.5 rounded-l-lg text-xs font-medium border border-fuchsia-300 text-fuchsia-600 hover:bg-fuchsia-50 dark:hover:bg-fuchsia-900/20 disabled:opacity-50 transition-colors">
        <Loader2 v-if="enhancing" :size="12" class="animate-spin" />
        <Wand2 v-else :size="12" />
        {{ enhancing ? 'Обработка...' : mainLabel }}
      </button>
      <button @click="open = !open" :disabled="enhancing || disabled"
        aria-label="Другие режимы улучшения" title="Другие режимы"
        class="flex items-center px-1.5 py-1.5 rounded-r-lg text-xs font-medium border border-l-0 border-fuchsia-300 text-fuchsia-600 hover:bg-fuchsia-50 dark:hover:bg-fuchsia-900/20 disabled:opacity-50 transition-colors">
        <ChevronDown :size="12" :class="{ 'rotate-180': open }" class="transition-transform" />
      </button>
    </div>

    <div v-if="open" class="fixed inset-0 z-10" @click="open = false" />

    <div v-if="open"
      class="absolute bottom-full left-0 mb-1 w-56 bg-white dark:bg-gray-900 border border-fuchsia-200 dark:border-fuchsia-800 rounded-xl shadow-xl z-20 py-1">
      <button v-for="m in basicModes" :key="m.id"
        @click="selectMode(m.id)"
        class="w-full flex items-center px-3 py-2 text-left text-xs font-medium text-gray-800 dark:text-gray-200 hover:bg-fuchsia-50 dark:hover:bg-fuchsia-900/20 transition-colors">
        {{ m.label }}
      </button>

      <div v-if="proModes.length" class="my-1 mx-3 border-t border-fuchsia-100 dark:border-fuchsia-800 flex items-center gap-2">
        <span class="text-[8px] font-bold text-fuchsia-400 uppercase tracking-wider py-1">Pro</span>
      </div>
      <button v-for="m in proModes" :key="m.id"
        @click="selectMode(m.id)"
        class="w-full flex items-center px-3 py-2 text-left text-xs font-medium text-gray-800 dark:text-gray-200 hover:bg-fuchsia-50 dark:hover:bg-fuchsia-900/20 transition-colors">
        {{ m.label }}
      </button>
    </div>
  </div>
</template>
