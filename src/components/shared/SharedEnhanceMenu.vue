<script setup lang="ts">
/**
 * SharedEnhanceMenu — split-button меню улучшения промпта (Photo + Sound + Video, C3).
 * Поглощает PsEnhanceMenu + SsEnhanceMenu + VsEnhanceMenu. Режимы (доменные) приходят
 * пропом `modes` с секциями basic/pro (визуальный «Pro»-разделитель).
 * Главная кнопка вызывает mainMode (или modes[0]); chevron раскрывает полный список.
 *
 * accent — 'fuchsia' (Photo/Sound, дефолт) | 'emerald' (Video). Tailwind не
 * интерполирует классы, поэтому варианты зашиты целиком строками (как colorScheme
 * в SharedCharacterCarousel) и выбираются тернаром по `accent`.
 *
 * gateProModes — если true, pro-секция видна ТОЛЬКО админу в pro-режиме
 * (isAdmin && isProMode). Video включает гейт; Photo/Sound не передают → pro-режимы
 * видны всегда (поведение как раньше).
 */
import { ref, computed } from 'vue'
import { Wand2, Loader2, ChevronDown } from 'lucide-vue-next'

export interface EnhanceModeItem {
  id: string
  label: string
  group: 'basic' | 'pro'
  icon?: any
  desc?: string
}

const props = withDefaults(defineProps<{
  modes: EnhanceModeItem[]
  enhancing: boolean
  disabled?: boolean
  accent?: string
  mainMode?: string
  gateProModes?: boolean
  isAdmin?: boolean
  isProMode?: boolean
}>(), {
  disabled: false,
  accent: 'fuchsia',
  gateProModes: false,
  isAdmin: false,
  isProMode: false,
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

// Pro-секция скрыта за гейтом только когда gateProModes включён (Video)
const showPro = computed(() =>
  proModes.value.length > 0 && (!props.gateProModes || (props.isAdmin && props.isProMode))
)

// Accent-классы целиком (Tailwind не интерполирует) — дефолт fuchsia = прежний вид
const c = computed(() => props.accent === 'emerald'
  ? {
      btn: 'border-emerald-300 text-emerald-600 hover:bg-emerald-50 dark:hover:bg-emerald-900/20',
      dropdown: 'border-emerald-200 dark:border-emerald-800',
      item: 'hover:bg-emerald-50 dark:hover:bg-emerald-900/20',
      sep: 'border-emerald-100 dark:border-emerald-800',
      sepText: 'text-emerald-400',
      icon: 'text-emerald-500',
    }
  : {
      btn: 'border-fuchsia-300 text-fuchsia-600 hover:bg-fuchsia-50 dark:hover:bg-fuchsia-900/20',
      dropdown: 'border-fuchsia-200 dark:border-fuchsia-800',
      item: 'hover:bg-fuchsia-50 dark:hover:bg-fuchsia-900/20',
      sep: 'border-fuchsia-100 dark:border-fuchsia-800',
      sepText: 'text-fuchsia-400',
      icon: 'text-fuchsia-500',
    })

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
        class="flex items-center gap-1.5 px-3 py-1.5 rounded-l-lg text-xs font-medium border disabled:opacity-50 transition-colors"
        :class="c.btn">
        <Loader2 v-if="enhancing" :size="12" class="animate-spin" />
        <Wand2 v-else :size="12" />
        {{ enhancing ? 'Обработка...' : mainLabel }}
      </button>
      <button @click="open = !open" :disabled="enhancing || disabled"
        aria-label="Другие режимы улучшения" title="Другие режимы"
        class="flex items-center px-1.5 py-1.5 rounded-r-lg text-xs font-medium border border-l-0 disabled:opacity-50 transition-colors"
        :class="c.btn">
        <ChevronDown :size="12" :class="{ 'rotate-180': open }" class="transition-transform" />
      </button>
    </div>

    <div v-if="open" class="fixed inset-0 z-10" @click="open = false" />

    <div v-if="open"
      class="absolute bottom-full left-0 mb-1 w-56 bg-white dark:bg-gray-900 border rounded-xl shadow-xl z-20 py-1"
      :class="c.dropdown">
      <button v-for="m in basicModes" :key="m.id"
        @click="selectMode(m.id)"
        class="w-full flex items-center gap-2.5 px-3 py-2 text-left transition-colors"
        :class="c.item">
        <component :is="m.icon" v-if="m.icon" :size="14" class="shrink-0" :class="c.icon" />
        <div class="min-w-0">
          <div class="text-xs font-medium text-gray-800 dark:text-gray-200">{{ m.label }}</div>
          <span v-if="m.desc" class="text-[10px] text-gray-500 dark:text-gray-400">{{ m.desc }}</span>
        </div>
      </button>

      <template v-if="showPro">
        <div class="my-1 mx-3 border-t flex items-center gap-2" :class="c.sep">
          <span class="text-[8px] font-bold uppercase tracking-wider py-1" :class="c.sepText">Pro</span>
        </div>
        <button v-for="m in proModes" :key="m.id"
          @click="selectMode(m.id)"
          class="w-full flex items-center gap-2.5 px-3 py-2 text-left transition-colors"
          :class="c.item">
          <component :is="m.icon" v-if="m.icon" :size="14" class="shrink-0" :class="c.icon" />
          <div class="min-w-0">
            <div class="text-xs font-medium text-gray-800 dark:text-gray-200">{{ m.label }}</div>
            <span v-if="m.desc" class="text-[10px] text-gray-500 dark:text-gray-400">{{ m.desc }}</span>
          </div>
        </button>
      </template>
    </div>
  </div>
</template>
