<script setup lang="ts">
import { Video, Loader2, Volume2, VolumeX } from 'lucide-vue-next'

defineProps<{
  duration: number
  audio: boolean
  costRub: number
  costUsd: number
  generating: boolean
  canGenerate: boolean
  inputMode: 'text' | 'frames' | 'references'
}>()

const emit = defineEmits<{
  'update:duration': [value: number]
  'update:audio': [value: boolean]
  generate: []
}>()
</script>

<template>
  <div class="sticky bottom-0 bg-white dark:bg-gray-900 border-t border-gray-200 dark:border-gray-800 px-4 py-3 z-10">
    <div class="flex items-center justify-between gap-3 flex-wrap">
      <!-- Left: model + duration + audio -->
      <div class="flex items-center gap-3 flex-wrap">
        <!-- Model badge -->
        <span class="px-2 py-0.5 bg-emerald-100 dark:bg-emerald-900/50 text-emerald-600 dark:text-emerald-400 rounded-lg text-[10px] font-medium">
          seedance-2
        </span>

        <!-- Duration compact -->
        <div class="flex items-center gap-1.5">
          <span class="text-[10px] text-gray-400 font-medium min-w-[20px]">{{ duration }}с</span>
          <input type="range"
            :value="duration"
            @input="emit('update:duration', Number(($event.target as HTMLInputElement).value))"
            min="4" max="15" step="1"
            class="w-20 h-1.5 bg-gray-200 dark:bg-gray-700 rounded-lg appearance-none cursor-pointer accent-emerald-500" />
        </div>

        <!-- Audio toggle -->
        <button @click="emit('update:audio', !audio)"
          :class="[
            'flex items-center gap-1 px-2 py-1 rounded-lg text-[10px] font-medium transition-colors',
            audio
              ? 'bg-emerald-100 dark:bg-emerald-900/50 text-emerald-600 dark:text-emerald-400'
              : 'bg-gray-100 dark:bg-gray-800 text-gray-400'
          ]">
          <component :is="audio ? Volume2 : VolumeX" :size="12" />
          {{ audio ? 'Звук' : 'Без' }}
        </button>

        <!-- Mode hint -->
        <span class="text-[9px] text-gray-400 hidden sm:inline">
          720p &middot; {{ inputMode === 'text' ? 'text&rarr;video' : 'img&rarr;video' }}
        </span>
      </div>

      <!-- Right: cost + generate -->
      <div class="flex items-center gap-3">
        <div class="text-right">
          <div class="text-sm font-bold text-emerald-600 dark:text-emerald-400">{{ costRub }} &#8381;</div>
          <div class="text-[9px] text-gray-400">${{ costUsd.toFixed(2) }}</div>
        </div>
        <button @click="emit('generate')" :disabled="generating || !canGenerate"
          class="flex items-center gap-2 px-5 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-medium text-sm disabled:opacity-50 transition-colors">
          <Loader2 v-if="generating" :size="16" class="animate-spin" />
          <Video v-else :size="16" />
          {{ generating ? 'Генерация...' : 'Сгенерировать' }}
        </button>
      </div>
    </div>
  </div>
</template>
