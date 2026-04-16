<script setup lang="ts">
import { Video, Loader2, Volume2, VolumeX, Smartphone, Monitor, Square } from 'lucide-vue-next'
import { ref, watch } from 'vue'

type Resolution = '480p' | '720p'
type AspectRatio = '9:16' | '1:1' | '16:9'

const props = defineProps<{
  duration: number
  audio: boolean
  resolution: Resolution
  aspectRatio: AspectRatio
  costRub: number
  generating: boolean
  generatingStartedAt: string | null  // ISO timestamp начала генерации
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

// Generation timer — считает от реального времени начала, не с нуля
const elapsedSec = ref(0)
let timerInterval: ReturnType<typeof setInterval> | null = null

function updateElapsed() {
  if (props.generatingStartedAt) {
    elapsedSec.value = Math.max(0, Math.floor((Date.now() - new Date(props.generatingStartedAt).getTime()) / 1000))
  }
}

watch(() => props.generating, (val) => {
  if (val) {
    updateElapsed()
    timerInterval = setInterval(updateElapsed, 1000)
  } else {
    if (timerInterval) clearInterval(timerInterval)
    timerInterval = null
  }
}, { immediate: true })

function formatTime(sec: number): string {
  const m = Math.floor(sec / 60)
  const s = sec % 60
  return `${m}:${s.toString().padStart(2, '0')}`
}
</script>

<template>
  <div class="sticky bottom-0 bg-white dark:bg-gray-900 border-t border-gray-200 dark:border-gray-800 px-3 py-2 z-10">
    <!-- Single compact row: settings + cost + button -->
    <div class="flex items-center gap-2 flex-wrap">
      <!-- Model badge -->
      <span class="px-1.5 py-0.5 bg-emerald-100 dark:bg-emerald-900/50 text-emerald-600 dark:text-emerald-400 rounded text-[9px] font-medium shrink-0">
        seedance-2
      </span>

      <!-- Resolution toggle -->
      <div class="flex bg-gray-100 dark:bg-gray-800 rounded p-0.5 shrink-0">
        <button v-for="r in (['480p', '720p'] as Resolution[])" :key="r"
          @click="emit('update:resolution', r)"
          :class="[
            'px-2 py-0.5 rounded text-[10px] font-medium transition-all',
            resolution === r
              ? 'bg-white dark:bg-gray-900 text-emerald-600 dark:text-emerald-400 shadow-sm'
              : 'text-gray-500 hover:text-gray-700'
          ]">
          {{ r }}
        </button>
      </div>

      <!-- Duration buttons -->
      <div class="flex gap-px overflow-x-auto scrollbar-hide shrink-0">
        <button v-for="d in durations" :key="d"
          @click="emit('update:duration', d)"
          :class="[
            'w-6 h-6 rounded text-[9px] font-medium transition-all shrink-0',
            duration === d
              ? 'bg-emerald-600 text-white'
              : 'bg-gray-100 dark:bg-gray-800 text-gray-500 hover:bg-gray-200'
          ]">
          {{ d }}
        </button>
      </div>

      <!-- Aspect ratio -->
      <div class="flex bg-gray-100 dark:bg-gray-800 rounded p-0.5 shrink-0">
        <button v-for="r in ratios" :key="r.id"
          @click="emit('update:aspectRatio', r.id)"
          :class="[
            'flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[9px] font-medium transition-all',
            aspectRatio === r.id
              ? 'bg-white dark:bg-gray-900 text-emerald-600 dark:text-emerald-400 shadow-sm'
              : 'text-gray-500 hover:text-gray-700'
          ]">
          <component :is="r.icon" :size="9" />
          {{ r.label }}
        </button>
      </div>

      <!-- Audio toggle -->
      <button @click="emit('update:audio', !audio)"
        :class="[
          'flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[9px] font-medium transition-colors shrink-0',
          audio
            ? 'bg-emerald-100 dark:bg-emerald-900/50 text-emerald-600'
            : 'bg-gray-100 dark:bg-gray-800 text-gray-400'
        ]">
        <component :is="audio ? Volume2 : VolumeX" :size="10" />
      </button>

      <!-- Spacer -->
      <div class="flex-1" />

      <!-- Cost -->
      <span class="text-sm font-bold text-emerald-600 dark:text-emerald-400 shrink-0">{{ costRub }} &#8381;</span>

      <!-- Generate button -->
      <button @click="emit('generate')" :disabled="generating || !canGenerate"
        :class="[
          'flex items-center gap-1.5 px-4 py-2 rounded-xl font-medium text-sm transition-colors shrink-0',
          generating
            ? 'bg-amber-600 text-white'
            : 'bg-emerald-600 hover:bg-emerald-700 text-white disabled:opacity-50'
        ]">
        <Loader2 v-if="generating" :size="14" class="animate-spin" />
        <Video v-else :size="14" />
        {{ generating ? `${formatTime(elapsedSec)}` : 'Сгенерировать' }}
      </button>
    </div>
  </div>
</template>
