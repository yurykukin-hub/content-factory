<script setup lang="ts">
/**
 * Music generation settings panel.
 * Model selector, weight sliders, instrumental toggle, cost display, generate button.
 */
import { ref, watch, computed } from 'vue'
import { Music, Loader2, Mic, MicOff } from 'lucide-vue-next'

const props = defineProps<{
  sunoModel: string
  instrumental: boolean
  vocalGender: 'f' | 'm' | null
  styleWeight: number
  weirdnessConstraint: number
  costRub: number
  generating: boolean
  generatingStartedAt: string | null
  canGenerate: boolean
}>()

const emit = defineEmits<{
  'update:sunoModel': [value: string]
  'update:instrumental': [value: boolean]
  'update:vocalGender': [value: 'f' | 'm' | null]
  'update:styleWeight': [value: number]
  'update:weirdnessConstraint': [value: number]
  generate: []
}>()

const MODELS = [
  { id: 'suno/v4', label: 'V4', sub: 'до 4 мин' },
  { id: 'suno/v4.5', label: 'V4.5', sub: 'до 8 мин' },
  { id: 'suno/v5.5', label: 'V5.5', sub: 'voice clone' },
]

const GENDERS = [
  { id: null as 'f' | 'm' | null, label: 'Авто' },
  { id: 'f' as const, label: 'Жен' },
  { id: 'm' as const, label: 'Муж' },
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

const modelLabel = computed(() => MODELS.find(m => m.id === props.sunoModel)?.label || 'V4.5')
</script>

<template>
  <div class="sticky bottom-0 bg-white dark:bg-gray-900 border-t border-gray-200 dark:border-gray-800 px-3 py-2 z-10">
    <div class="flex items-center gap-2 flex-wrap">
      <!-- Model selector -->
      <div class="flex bg-gray-100 dark:bg-gray-800 rounded p-0.5 shrink-0">
        <button v-for="m in MODELS" :key="m.id"
          @click="emit('update:sunoModel', m.id)"
          :class="[
            'px-2 py-0.5 rounded text-[10px] font-medium transition-all',
            sunoModel === m.id
              ? 'bg-white dark:bg-gray-900 text-fuchsia-600 shadow-sm'
              : 'text-gray-500 hover:text-gray-700'
          ]"
          :title="m.sub">
          {{ m.label }}
        </button>
      </div>

      <!-- Vocal/Instrumental toggle -->
      <button @click="emit('update:instrumental', !instrumental)"
        :class="[
          'flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[9px] font-medium transition-colors shrink-0',
          instrumental
            ? 'bg-gray-100 dark:bg-gray-800 text-gray-400'
            : 'bg-fuchsia-100 dark:bg-fuchsia-900/50 text-fuchsia-600'
        ]"
        :title="instrumental ? 'Инструментал (без вокала)' : 'С вокалом'">
        <component :is="instrumental ? MicOff : Mic" :size="10" />
        <span>{{ instrumental ? 'Инструм.' : 'Вокал' }}</span>
      </button>

      <!-- Vocal gender (only when not instrumental) -->
      <div v-if="!instrumental" class="flex bg-gray-100 dark:bg-gray-800 rounded p-0.5 shrink-0">
        <button v-for="g in GENDERS" :key="String(g.id)"
          @click="emit('update:vocalGender', g.id)"
          :class="[
            'px-1.5 py-0.5 rounded text-[9px] font-medium transition-all',
            vocalGender === g.id
              ? 'bg-white dark:bg-gray-900 text-fuchsia-600 shadow-sm'
              : 'text-gray-500 hover:text-gray-700'
          ]">
          {{ g.label }}
        </button>
      </div>

      <!-- Style weight mini-slider -->
      <div class="flex items-center gap-1 shrink-0" title="Вес стиля (0-1)">
        <span class="text-[8px] text-gray-400">Стиль</span>
        <input type="range" min="0" max="1" step="0.1"
          :value="styleWeight"
          @input="emit('update:styleWeight', Number(($event.target as HTMLInputElement).value))"
          class="w-12 h-1 accent-fuchsia-500" />
        <span class="text-[9px] text-gray-500 w-5">{{ styleWeight }}</span>
      </div>

      <!-- Weirdness mini-slider -->
      <div class="flex items-center gap-1 shrink-0" title="Креативность (0-1)">
        <span class="text-[8px] text-gray-400">Weird</span>
        <input type="range" min="0" max="1" step="0.1"
          :value="weirdnessConstraint"
          @input="emit('update:weirdnessConstraint', Number(($event.target as HTMLInputElement).value))"
          class="w-12 h-1 accent-fuchsia-500" />
        <span class="text-[9px] text-gray-500 w-5">{{ weirdnessConstraint }}</span>
      </div>

      <!-- Spacer -->
      <div class="flex-1" />

      <!-- Cost -->
      <span class="text-sm font-bold text-fuchsia-600 dark:text-fuchsia-400 shrink-0">{{ costRub }} &#8381;</span>

      <!-- Generate button -->
      <button @click="emit('generate')" :disabled="generating || !canGenerate"
        :class="[
          'flex items-center gap-1.5 px-4 py-2 rounded-xl font-medium text-sm transition-colors shrink-0',
          generating
            ? 'bg-amber-600 text-white'
            : 'bg-fuchsia-600 hover:bg-fuchsia-700 text-white disabled:opacity-50'
        ]">
        <Loader2 v-if="generating" :size="14" class="animate-spin" />
        <Music v-else :size="14" />
        {{ generating ? formatTime(elapsedSec) : 'Сгенерировать' }}
      </button>
    </div>
  </div>
</template>
