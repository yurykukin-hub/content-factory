<script setup lang="ts">
import { ref, computed } from 'vue'
import { Play, Download, Video, Sparkles } from 'lucide-vue-next'
import { formatDate } from '@/composables/useFormatters'

interface GeneratedVideo {
  id: string; url: string; filename: string; durationSec: number | null
  aiModel: string | null; aiCostUsd: number | null; altText: string | null; createdAt: string
}

interface PromptEntry {
  id: string; prompt: string; resultUrl: string | null; rating: number | null
  tags: string[]; metadata: any; createdAt: string
}

const props = defineProps<{
  videos: GeneratedVideo[]
  savedPrompts: PromptEntry[]
}>()

const emit = defineEmits<{
  usePrompt: [entry: PromptEntry]
  ratePrompt: [id: string, rating: number]
}>()

type Filter = 'all' | 'videos' | 'prompts' | 'favorites'
const activeFilter = ref<Filter>('all')
const activeVideoUrl = ref<string | null>(null)

const filters = computed(() => [
  { id: 'all' as const, label: 'Все' },
  { id: 'videos' as const, label: 'Видео', count: props.videos.length },
  { id: 'prompts' as const, label: 'Промпты', count: props.savedPrompts.length },
  { id: 'favorites' as const, label: 'Избранное', count: props.savedPrompts.filter(p => (p.rating || 0) >= 4).length },
])

const filteredVideos = computed(() => {
  if (activeFilter.value === 'prompts') return []
  return props.videos
})

const filteredPrompts = computed(() => {
  if (activeFilter.value === 'videos') return []
  if (activeFilter.value === 'favorites') return props.savedPrompts.filter(p => (p.rating || 0) >= 4)
  if (activeFilter.value === 'prompts') return props.savedPrompts
  return []
})

const showPrompts = computed(() => activeFilter.value === 'prompts' || activeFilter.value === 'favorites')
const showVideos = computed(() => activeFilter.value !== 'prompts' && activeFilter.value !== 'favorites')
</script>

<template>
  <div class="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 overflow-hidden flex flex-col max-h-[calc(100vh-160px)]">

    <!-- Filter tabs -->
    <div class="px-4 pt-4 pb-2 shrink-0">
      <div class="flex gap-1 bg-gray-100 dark:bg-gray-800 rounded-xl p-1">
        <button v-for="f in filters" :key="f.id"
          @click="activeFilter = f.id"
          :class="[
            'flex-1 px-3 py-1.5 rounded-lg text-xs font-medium transition-all whitespace-nowrap text-center',
            activeFilter === f.id
              ? 'bg-white dark:bg-gray-900 text-emerald-600 dark:text-emerald-400 shadow-sm'
              : 'text-gray-500 hover:text-gray-700 dark:hover:text-gray-300'
          ]">
          {{ f.label }}
          <span v-if="f.count" class="ml-1 text-[9px] opacity-60">{{ f.count }}</span>
        </button>
      </div>
    </div>

    <!-- Active video player -->
    <div v-if="activeVideoUrl && showVideos" class="px-4 pb-2 shrink-0">
      <div class="rounded-xl overflow-hidden bg-black">
        <video :src="activeVideoUrl" controls loop autoplay playsinline
          class="w-full" style="aspect-ratio: 9/16; max-height: 360px; object-fit: contain;" />
      </div>
    </div>

    <!-- Card feed -->
    <div class="flex-1 overflow-y-auto px-4 pb-4 space-y-3">

      <!-- Empty state -->
      <div v-if="!filteredVideos.length && !filteredPrompts.length"
        class="flex flex-col items-center justify-center py-12">
        <Video :size="40" class="text-gray-300 dark:text-gray-700 mb-3" />
        <p class="text-sm text-gray-400">
          {{ activeFilter === 'prompts' ? 'Промпты сохраняются при генерации' :
             activeFilter === 'favorites' ? 'Нет избранных промптов' :
             'Сгенерируйте видео' }}
        </p>
      </div>

      <!-- Video cards -->
      <template v-if="showVideos">
        <div v-for="v in filteredVideos" :key="v.id"
          @click="activeVideoUrl = v.url"
          :class="[
            'rounded-xl border overflow-hidden cursor-pointer transition-all',
            activeVideoUrl === v.url
              ? 'border-emerald-400 dark:border-emerald-600 ring-1 ring-emerald-400/30'
              : 'border-gray-200 dark:border-gray-800 hover:border-gray-300 dark:hover:border-gray-700'
          ]">
          <!-- Thumbnail area -->
          <div class="relative bg-black/5 dark:bg-black/20" style="aspect-ratio: 16/9;">
            <video :src="v.url" class="w-full h-full object-cover" preload="metadata" muted />
            <div class="absolute inset-0 flex items-center justify-center bg-black/20 hover:bg-black/10 transition-colors">
              <div class="w-10 h-10 rounded-full bg-white/20 backdrop-blur-sm flex items-center justify-center">
                <Play :size="18" class="text-white ml-0.5" />
              </div>
            </div>
            <!-- Model badge -->
            <span class="absolute top-2 left-2 px-1.5 py-0.5 bg-black/60 text-white text-[9px] rounded font-medium backdrop-blur-sm">
              {{ v.aiModel || 'seedance-2' }}
            </span>
            <!-- Duration badge -->
            <span v-if="v.durationSec" class="absolute top-2 right-2 px-1.5 py-0.5 bg-black/60 text-white text-[9px] rounded font-medium backdrop-blur-sm">
              {{ v.durationSec }}с
            </span>
          </div>

          <!-- Info -->
          <div class="p-3">
            <p class="text-[11px] text-gray-600 dark:text-gray-400 line-clamp-2 mb-2 leading-relaxed">
              {{ v.altText || v.filename }}
            </p>
            <div class="flex items-center justify-between">
              <div class="flex items-center gap-2 text-[10px] text-gray-400">
                <span v-if="v.aiCostUsd">{{ Math.round(v.aiCostUsd * 95) }} &#8381;</span>
                <span>{{ formatDate(v.createdAt) }}</span>
              </div>
              <div class="flex items-center gap-0.5">
                <a :href="v.url" :download="v.filename" @click.stop title="Скачать"
                  class="p-1.5 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors">
                  <Download :size="14" class="text-gray-400" />
                </a>
              </div>
            </div>
          </div>
        </div>
      </template>

      <!-- Prompt cards -->
      <template v-if="showPrompts">
        <div v-for="entry in filteredPrompts" :key="entry.id"
          @click="emit('usePrompt', entry)"
          class="p-3 rounded-xl border border-gray-200 dark:border-gray-800 hover:border-emerald-300 dark:hover:border-emerald-700 cursor-pointer transition-colors">
          <div class="flex items-start gap-2 mb-2">
            <Sparkles :size="12" class="text-purple-500 mt-0.5 shrink-0" />
            <p class="text-[11px] text-gray-600 dark:text-gray-400 line-clamp-3 leading-relaxed">{{ entry.prompt }}</p>
          </div>
          <div class="flex items-center justify-between">
            <div class="flex items-center gap-0.5">
              <button v-for="star in 5" :key="star" @click.stop="emit('ratePrompt', entry.id, star)"
                :class="['text-[11px] transition-colors', (entry.rating || 0) >= star ? 'text-amber-400' : 'text-gray-300 dark:text-gray-600 hover:text-amber-300']">
                &#9733;
              </button>
            </div>
            <div class="flex items-center gap-1.5 text-[9px] text-gray-400">
              <span v-if="entry.metadata?.duration">{{ entry.metadata.duration }}с</span>
              <span v-if="entry.metadata?.cost">{{ Math.round(entry.metadata.cost * 95) }} &#8381;</span>
            </div>
          </div>
        </div>
      </template>

    </div>
  </div>
</template>
