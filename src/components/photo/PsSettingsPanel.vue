<script setup lang="ts">
/**
 * Photo generation settings panel.
 * Model selector, resolution, batch size, aspect ratio, cost display, generate button.
 */
import { ref, watch, computed } from 'vue'
import { Camera, Loader2 } from 'lucide-vue-next'

const props = defineProps<{
  photoModel: string
  photoResolution: string
  batchSize: number
  photoAspectRatio: string
  generating: boolean
  generatingStartedAt: string | null
  costRub: number
  costUsd: number
  canGenerate: boolean
  selectedCharacterId?: string | null
}>()

const emit = defineEmits<{
  'update:photoModel': [value: string]
  'update:photoResolution': [value: string]
  'update:batchSize': [value: number]
  'update:photoAspectRatio': [value: string]
  generate: []
}>()

const MODELS = [
  { id: 'nano-banana-2', label: 'NB2', sub: 'Быстрый' },
  { id: 'nano-banana-pro', label: 'Pro', sub: 'Качество' },
]

const RESOLUTIONS = [
  { id: '1K', label: '1K' },
  { id: '2K', label: '2K' },
  { id: '4K', label: '4K' },
]

const BATCH_SIZES = [
  { id: 1, label: '1' },
  { id: 2, label: '2' },
  { id: 4, label: '4' },
]

const ASPECT_RATIOS = [
  '1:1', '2:3', '3:2', '3:4', '4:3', '4:5', '5:4', '9:16', '16:9', '21:9',
]

// Timer
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

const batchLabel = computed(() => {
  if (props.batchSize === 1) return '1 фото'
  if (props.batchSize <= 4) return `${props.batchSize} фото`
  return `${props.batchSize} фото`
})
</script>

<template>
  <div class="shrink-0 bg-white dark:bg-gray-900 border-t border-gray-200 dark:border-gray-800 px-2 py-1.5 lg:px-3 lg:py-2 z-10">
    <div class="flex flex-col gap-1 lg:flex-row lg:items-center lg:gap-2 lg:flex-wrap">
      <!-- Row 1: model + resolution + batch -->
      <div class="flex items-center gap-1.5 flex-wrap lg:contents">
        <!-- Model selector -->
        <div class="flex bg-gray-100 dark:bg-gray-800 rounded p-0.5 shrink-0">
          <button v-for="m in MODELS" :key="m.id"
            @click="emit('update:photoModel', m.id)"
            :class="[
              'px-2 py-0.5 rounded text-[10px] font-medium transition-all',
              photoModel === m.id
                ? 'bg-white dark:bg-gray-900 text-fuchsia-600 shadow-sm'
                : 'text-gray-500 hover:text-gray-700'
            ]"
            :title="m.sub">
            {{ m.label }}
          </button>
        </div>

        <!-- Resolution selector -->
        <div class="flex bg-gray-100 dark:bg-gray-800 rounded p-0.5 shrink-0">
          <button v-for="r in RESOLUTIONS" :key="r.id"
            @click="emit('update:photoResolution', r.id)"
            :class="[
              'px-2 py-0.5 rounded text-[10px] font-medium transition-all',
              photoResolution === r.id
                ? 'bg-white dark:bg-gray-900 text-fuchsia-600 shadow-sm'
                : 'text-gray-500 hover:text-gray-700'
            ]">
            {{ r.label }}
          </button>
        </div>

        <!-- Batch size -->
        <div class="flex bg-gray-100 dark:bg-gray-800 rounded p-0.5 shrink-0" title="Количество изображений">
          <button v-for="b in BATCH_SIZES" :key="b.id"
            @click="emit('update:batchSize', b.id)"
            :class="[
              'px-2 py-0.5 rounded text-[10px] font-medium transition-all',
              batchSize === b.id
                ? 'bg-white dark:bg-gray-900 text-fuchsia-600 shadow-sm'
                : 'text-gray-500 hover:text-gray-700'
            ]">
            {{ b.label }}
          </button>
        </div>
      </div>

      <!-- Row 2: aspect ratio + cost + generate -->
      <div class="flex items-center gap-1.5 lg:contents">
        <!-- Aspect ratio -->
        <select
          :value="photoAspectRatio"
          @change="emit('update:photoAspectRatio', ($event.target as HTMLSelectElement).value)"
          class="shrink-0 px-1.5 py-0.5 rounded bg-gray-100 dark:bg-gray-800 text-[10px] font-medium text-gray-600 dark:text-gray-400 border-0 focus:outline-none focus:ring-1 focus:ring-fuchsia-500/40">
          <option v-for="ar in ASPECT_RATIOS" :key="ar" :value="ar">{{ ar }}</option>
        </select>

        <!-- Spacer -->
        <div class="flex-1" />

        <!-- Cost -->
        <div class="text-right shrink-0">
          <span class="text-sm font-bold text-fuchsia-600 dark:text-fuchsia-400">{{ costRub }} &#8381;</span>
          <p class="text-[9px] text-gray-400 leading-tight">${{ costUsd.toFixed(2) }} / {{ batchLabel }}</p>
        </div>

        <!-- Generate button -->
        <button @click="emit('generate')" :disabled="generating || !canGenerate"
          :class="[
            'flex items-center gap-1.5 px-3 py-1.5 lg:px-4 lg:py-2 rounded-xl font-medium text-sm transition-colors shrink-0',
            generating
              ? 'bg-amber-600 text-white'
              : 'bg-fuchsia-600 hover:bg-fuchsia-700 text-white disabled:opacity-50'
          ]">
          <Loader2 v-if="generating" :size="14" class="animate-spin" />
          <Camera v-else :size="14" />
          {{ generating ? formatTime(elapsedSec) : 'Сгенерировать' }}
        </button>
      </div>
    </div>
  </div>
</template>
