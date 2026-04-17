<script setup lang="ts">
/**
 * Audio waveform player using wavesurfer.js.
 * Fuchsia brand color for played portion.
 */
import { ref, watch, onMounted } from 'vue'
import { Play, Pause, Square } from 'lucide-vue-next'
import { useSurfer } from '@/composables/useSurfer'

const props = defineProps<{
  url: string
  compact?: boolean
}>()

const containerRef = ref<HTMLElement | null>(null)
const { isPlaying, isReady, currentTime, duration, load, playPause, stop } = useSurfer(containerRef, {
  height: props.compact ? 40 : 64,
})

function formatTime(sec: number): string {
  const m = Math.floor(sec / 60)
  const s = Math.floor(sec % 60)
  return `${m}:${s.toString().padStart(2, '0')}`
}

onMounted(() => {
  if (props.url) load(props.url)
})

watch(() => props.url, (newUrl) => {
  if (newUrl) load(newUrl)
})
</script>

<template>
  <div class="flex flex-col gap-2">
    <!-- Waveform container -->
    <div ref="containerRef"
      class="rounded-lg overflow-hidden cursor-pointer bg-gray-50 dark:bg-gray-800/50"
      :class="compact ? 'min-h-[40px]' : 'min-h-[64px]'" />

    <!-- Controls -->
    <div class="flex items-center gap-2">
      <button @click="playPause()" :disabled="!isReady"
        class="w-8 h-8 rounded-full bg-fuchsia-500 hover:bg-fuchsia-600 disabled:bg-gray-300 text-white flex items-center justify-center transition-colors shrink-0">
        <Pause v-if="isPlaying" :size="14" />
        <Play v-else :size="14" class="ml-0.5" />
      </button>

      <button @click="stop()" :disabled="!isReady"
        class="w-6 h-6 rounded text-gray-400 hover:text-gray-600 disabled:opacity-30 flex items-center justify-center shrink-0">
        <Square :size="12" />
      </button>

      <!-- Time display -->
      <div class="flex-1 flex items-center justify-between text-[10px] text-gray-500 font-mono">
        <span>{{ formatTime(currentTime) }}</span>
        <span>{{ formatTime(duration) }}</span>
      </div>
    </div>
  </div>
</template>
