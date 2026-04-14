<script setup lang="ts">
import { Video, Loader2, Volume2, VolumeX, Smartphone, Monitor, Square } from 'lucide-vue-next'

type Resolution = '480p' | '720p'
type AspectRatio = '9:16' | '1:1' | '16:9'

defineProps<{
  duration: number
  audio: boolean
  resolution: Resolution
  aspectRatio: AspectRatio
  costRub: number
  generating: boolean
  canGenerate: boolean
}>()

const emit = defineEmits<{
  'update:duration': [value: number]
  'update:audio': [value: boolean]
  'update:resolution': [value: Resolution]
  'update:aspectRatio': [value: AspectRatio]
  generate: []
}>()

const durations = [4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15]

const ratios: { id: AspectRatio; label: string; icon: any }[] = [
  { id: '9:16', label: '9:16', icon: Smartphone },
  { id: '1:1', label: '1:1', icon: Square },
  { id: '16:9', label: '16:9', icon: Monitor },
]
</script>

<template>
  <div class="sticky bottom-0 bg-white dark:bg-gray-900 border-t border-gray-200 dark:border-gray-800 px-4 py-3 z-10 space-y-3">

    <!-- Row 1: Settings -->
    <div class="flex items-center gap-3 flex-wrap">
      <!-- Model badge -->
      <span class="px-2 py-0.5 bg-emerald-100 dark:bg-emerald-900/50 text-emerald-600 dark:text-emerald-400 rounded-lg text-[10px] font-medium shrink-0">
        seedance-2
      </span>

      <!-- Resolution toggle -->
      <div class="flex bg-gray-100 dark:bg-gray-800 rounded-lg p-0.5 shrink-0">
        <button v-for="r in (['480p', '720p'] as Resolution[])" :key="r"
          @click="emit('update:resolution', r)"
          :class="[
            'px-2.5 py-1 rounded-md text-[11px] font-medium transition-all',
            resolution === r
              ? 'bg-white dark:bg-gray-900 text-emerald-600 dark:text-emerald-400 shadow-sm'
              : 'text-gray-500 hover:text-gray-700 dark:hover:text-gray-300'
          ]">
          {{ r }}
        </button>
      </div>

      <!-- Duration buttons -->
      <div class="flex gap-0.5 overflow-x-auto scrollbar-hide shrink-0">
        <button v-for="d in durations" :key="d"
          @click="emit('update:duration', d)"
          :class="[
            'w-7 h-7 rounded-lg text-[10px] font-medium transition-all shrink-0',
            duration === d
              ? 'bg-emerald-600 text-white'
              : 'bg-gray-100 dark:bg-gray-800 text-gray-500 hover:bg-gray-200 dark:hover:bg-gray-700'
          ]">
          {{ d }}
        </button>
      </div>

      <!-- Aspect ratio -->
      <div class="flex bg-gray-100 dark:bg-gray-800 rounded-lg p-0.5 shrink-0">
        <button v-for="r in ratios" :key="r.id"
          @click="emit('update:aspectRatio', r.id)"
          :class="[
            'flex items-center gap-1 px-2 py-1 rounded-md text-[10px] font-medium transition-all',
            aspectRatio === r.id
              ? 'bg-white dark:bg-gray-900 text-emerald-600 dark:text-emerald-400 shadow-sm'
              : 'text-gray-500 hover:text-gray-700 dark:hover:text-gray-300'
          ]">
          <component :is="r.icon" :size="10" />
          {{ r.label }}
        </button>
      </div>

      <!-- Audio toggle -->
      <button @click="emit('update:audio', !audio)"
        :class="[
          'flex items-center gap-1 px-2 py-1 rounded-lg text-[10px] font-medium transition-colors shrink-0',
          audio
            ? 'bg-emerald-100 dark:bg-emerald-900/50 text-emerald-600 dark:text-emerald-400'
            : 'bg-gray-100 dark:bg-gray-800 text-gray-400'
        ]">
        <component :is="audio ? Volume2 : VolumeX" :size="12" />
        {{ audio ? 'Звук' : 'Без' }}
      </button>
    </div>

    <!-- Row 2: Cost + Generate -->
    <div class="flex items-center justify-end gap-3">
      <span class="text-sm font-bold text-emerald-600 dark:text-emerald-400">{{ costRub }} &#8381;</span>
      <button @click="emit('generate')" :disabled="generating || !canGenerate"
        class="flex items-center gap-2 px-5 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-medium text-sm disabled:opacity-50 transition-colors">
        <Loader2 v-if="generating" :size="16" class="animate-spin" />
        <Video v-else :size="16" />
        {{ generating ? 'Генерация...' : 'Сгенерировать' }}
      </button>
    </div>
  </div>
</template>
