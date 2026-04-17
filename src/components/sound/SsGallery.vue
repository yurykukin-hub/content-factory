<script setup lang="ts">
/**
 * Gallery of generated music tracks with waveform players.
 */
import { ref, computed } from 'vue'
import { Music, Download, Heart, Loader2 } from 'lucide-vue-next'
import SsTrackPlayer from './SsTrackPlayer.vue'

interface TrackResult {
  resultUrl: string
  audioUrl?: string
  coverImageUrl?: string
  prompt: string
  costUsd: number
  createdAt: string
  mediaFileId?: string
  title?: string
  musicStyle?: string
}

const props = defineProps<{
  results: TrackResult[]
  generating: boolean
}>()

const activeFilter = ref<'all' | 'favorites'>('all')
const favorites = ref<Set<string>>(new Set())

function toggleFavorite(url: string) {
  if (favorites.value.has(url)) {
    favorites.value.delete(url)
  } else {
    favorites.value.add(url)
  }
}

const filtered = computed(() => {
  if (activeFilter.value === 'favorites') {
    return props.results.filter(r => favorites.value.has(r.resultUrl || r.audioUrl || ''))
  }
  return props.results
})
</script>

<template>
  <div class="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 overflow-hidden flex flex-col max-h-[calc(100vh-140px)]">
    <!-- Header -->
    <div class="px-4 py-3 border-b border-gray-100 dark:border-gray-800">
      <div class="flex items-center justify-between">
        <h3 class="text-sm font-semibold text-gray-700 dark:text-gray-300">
          Треки <span v-if="results.length" class="text-gray-400">({{ results.length }})</span>
        </h3>
        <div class="flex gap-1">
          <button @click="activeFilter = 'all'"
            :class="['px-2 py-0.5 rounded text-[10px] font-medium transition-colors',
              activeFilter === 'all' ? 'bg-fuchsia-100 text-fuchsia-600' : 'text-gray-400 hover:text-gray-600']">
            Все
          </button>
          <button @click="activeFilter = 'favorites'"
            :class="['px-2 py-0.5 rounded text-[10px] font-medium transition-colors',
              activeFilter === 'favorites' ? 'bg-fuchsia-100 text-fuchsia-600' : 'text-gray-400 hover:text-gray-600']">
            Избранное
          </button>
        </div>
      </div>
    </div>

    <!-- Track list -->
    <div class="flex-1 overflow-y-auto p-4 space-y-4">
      <!-- Generating placeholder -->
      <div v-if="generating" class="flex items-center gap-3 p-3 rounded-xl bg-amber-50 dark:bg-amber-900/10 border border-amber-200">
        <Loader2 :size="20" class="text-amber-500 animate-spin shrink-0" />
        <div>
          <p class="text-sm font-medium text-amber-700 dark:text-amber-400">Генерация трека...</p>
          <p class="text-[10px] text-amber-500 mt-0.5">Обычно занимает 1-3 минуты</p>
        </div>
      </div>

      <!-- Track cards -->
      <div v-for="(track, idx) in filtered" :key="idx"
        class="rounded-xl border border-gray-100 dark:border-gray-800 overflow-hidden">
        <!-- Cover + info -->
        <div class="flex gap-3 p-3">
          <div class="w-16 h-16 rounded-lg overflow-hidden bg-gray-100 dark:bg-gray-800 shrink-0 flex items-center justify-center">
            <img v-if="track.coverImageUrl" :src="track.coverImageUrl" class="w-full h-full object-cover" />
            <Music v-else :size="20" class="text-gray-300" />
          </div>
          <div class="flex-1 min-w-0">
            <h4 class="text-sm font-medium text-gray-800 dark:text-gray-200 truncate">
              {{ track.title || track.prompt.slice(0, 50) }}
            </h4>
            <p v-if="track.musicStyle" class="text-[10px] text-gray-400 mt-0.5 truncate">{{ track.musicStyle }}</p>
            <div class="flex items-center gap-2 mt-1 text-[9px] text-gray-400">
              <span>${{ track.costUsd?.toFixed(2) }}</span>
              <span>{{ new Date(track.createdAt).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' }) }}</span>
            </div>
          </div>
          <!-- Actions -->
          <div class="flex items-center gap-1 shrink-0">
            <button @click="toggleFavorite(track.resultUrl || track.audioUrl || '')"
              :class="favorites.has(track.resultUrl || track.audioUrl || '') ? 'text-red-500' : 'text-gray-300 hover:text-red-400'"
              class="p-1.5 rounded-lg transition-colors">
              <Heart :size="14" :fill="favorites.has(track.resultUrl || track.audioUrl || '') ? 'currentColor' : 'none'" />
            </button>
            <a v-if="track.resultUrl || track.audioUrl"
              :href="track.resultUrl || track.audioUrl" download
              class="p-1.5 rounded-lg text-gray-400 hover:text-fuchsia-500 transition-colors">
              <Download :size="14" />
            </a>
          </div>
        </div>

        <!-- Waveform player -->
        <div v-if="track.resultUrl || track.audioUrl" class="px-3 pb-3">
          <SsTrackPlayer :url="(track.resultUrl || track.audioUrl)!" compact />
        </div>
      </div>

      <!-- Empty state -->
      <div v-if="!filtered.length && !generating" class="text-center py-12">
        <Music :size="32" class="mx-auto text-gray-200 dark:text-gray-700 mb-2" />
        <p class="text-sm text-gray-400">
          {{ activeFilter === 'favorites' ? 'Нет избранных треков' : 'Сгенерируйте первый трек' }}
        </p>
      </div>
    </div>
  </div>
</template>
