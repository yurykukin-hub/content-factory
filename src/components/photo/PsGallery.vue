<script setup lang="ts">
/**
 * Gallery of generated images for Photo Studio.
 * Grid layout with lightbox preview, download, edit actions.
 */
import { ref, computed } from 'vue'
import { Camera, Download, Pencil, Eraser, Heart, Loader2, ChevronDown, X, ZoomIn } from 'lucide-vue-next'
import { useRates } from '../../composables/useRates'

interface ImageResult {
  resultUrl: string
  thumbUrl?: string | null
  mediaFileId?: string
  costUsd?: number
  createdAt: string
  prompt?: string
  photoModel?: string
  photoResolution?: string
  photoAspectRatio?: string
}

const { USD_RUB } = useRates()

function costToRub(usd: number): string {
  const rub = usd * USD_RUB.value
  return rub < 1 ? '<1' : String(Math.round(rub))
}

const props = defineProps<{
  results: ImageResult[]
  generating: boolean
  batchSize: number
}>()

const emit = defineEmits<{
  edit: [imageUrl: string]
  removeBg: [imageUrl: string]
  download: [resultUrl: string]
}>()

const activeFilter = ref<'all' | 'favorites'>('all')
const favorites = ref<Set<string>>(new Set())
const expandedIdx = ref<number | null>(null)
const lightboxUrl = ref<string | null>(null)

function toggleExpanded(idx: number) {
  expandedIdx.value = expandedIdx.value === idx ? null : idx
}

function toggleFavorite(url: string) {
  if (favorites.value.has(url)) favorites.value.delete(url)
  else favorites.value.add(url)
}

function openLightbox(url: string) {
  lightboxUrl.value = url
}

function closeLightbox() {
  lightboxUrl.value = null
}

const MODEL_LABELS: Record<string, string> = {
  'nano-banana-2': 'Nano Banana 2',
  'nano-banana-pro': 'Nano Banana Pro',
}

const filtered = computed(() => {
  if (activeFilter.value === 'favorites') {
    return props.results.filter(r => favorites.value.has(r.resultUrl))
  }
  return props.results
})

function downloadImage(url: string) {
  emit('download', url)
  const a = document.createElement('a')
  a.href = url
  a.download = ''
  a.click()
}
</script>

<template>
  <div class="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 overflow-hidden flex flex-col lg:min-h-0">
    <!-- Header -->
    <div class="px-4 py-3 border-b border-gray-100 dark:border-gray-800">
      <div class="flex items-center justify-between">
        <h3 class="text-sm font-semibold text-gray-700 dark:text-gray-300">
          Галерея <span v-if="results.length" class="text-gray-400">({{ results.length }})</span>
        </h3>
        <div class="flex gap-1">
          <button @click="activeFilter = 'all'"
            :class="['px-2 py-0.5 rounded text-[10px] font-medium transition-colors',
              activeFilter === 'all' ? 'bg-fuchsia-100 dark:bg-fuchsia-900/30 text-fuchsia-600' : 'text-gray-400 hover:text-gray-600']">
            Все
          </button>
          <button @click="activeFilter = 'favorites'"
            :class="['px-2 py-0.5 rounded text-[10px] font-medium transition-colors',
              activeFilter === 'favorites' ? 'bg-fuchsia-100 dark:bg-fuchsia-900/30 text-fuchsia-600' : 'text-gray-400 hover:text-gray-600']">
            Избранное
          </button>
        </div>
      </div>
    </div>

    <!-- Image grid -->
    <div class="flex-1 overflow-y-auto p-4">
      <!-- Generating placeholders -->
      <div v-if="generating" class="grid grid-cols-1 lg:grid-cols-2 gap-3 mb-4">
        <div v-for="i in batchSize" :key="'skel-' + i"
          class="aspect-square rounded-xl bg-gray-100 dark:bg-gray-800 overflow-hidden relative">
          <div class="absolute inset-0 flex flex-col items-center justify-center gap-2">
            <Loader2 :size="24" class="text-fuchsia-400 animate-spin" />
            <p class="text-[10px] text-gray-400">Генерация...</p>
          </div>
          <!-- Shimmer effect -->
          <div class="absolute inset-0 bg-gradient-to-r from-transparent via-white/10 to-transparent animate-pulse" />
        </div>
      </div>

      <!-- Image cards -->
      <div class="grid grid-cols-1 lg:grid-cols-2 gap-3">
        <div v-for="(img, idx) in filtered" :key="idx"
          class="rounded-xl border border-gray-100 dark:border-gray-800 overflow-hidden group">
          <!-- Image preview with hover overlay -->
          <div class="relative aspect-square bg-gray-100 dark:bg-gray-800 cursor-pointer"
               @click="openLightbox(img.resultUrl)">
            <img :src="img.thumbUrl || img.resultUrl" :alt="img.prompt || ''"
              class="w-full h-full object-cover" loading="lazy" />

            <!-- Hover overlay with actions -->
            <div class="absolute inset-0 bg-black/0 group-hover:bg-black/40 transition-colors flex items-center justify-center gap-2 opacity-0 group-hover:opacity-100">
              <button @click.stop="openLightbox(img.resultUrl)"
                class="p-2 rounded-full bg-white/90 dark:bg-gray-800/90 text-gray-700 dark:text-gray-300 hover:bg-white transition-colors"
                title="Увеличить">
                <ZoomIn :size="16" />
              </button>
              <button @click.stop="downloadImage(img.resultUrl)"
                class="p-2 rounded-full bg-white/90 dark:bg-gray-800/90 text-gray-700 dark:text-gray-300 hover:bg-white transition-colors"
                title="Скачать">
                <Download :size="16" />
              </button>
              <button @click.stop="emit('edit', img.resultUrl)"
                class="p-2 rounded-full bg-white/90 dark:bg-gray-800/90 text-gray-700 dark:text-gray-300 hover:bg-white transition-colors"
                title="Редактировать">
                <Pencil :size="16" />
              </button>
              <button @click.stop="emit('removeBg', img.resultUrl)"
                class="p-2 rounded-full bg-white/90 dark:bg-gray-800/90 text-gray-700 dark:text-gray-300 hover:bg-white transition-colors"
                title="Удалить фон">
                <Eraser :size="16" />
              </button>
            </div>

            <!-- Favorite badge -->
            <button @click.stop="toggleFavorite(img.resultUrl)"
              :class="[
                'absolute top-2 right-2 p-1.5 rounded-full transition-all',
                favorites.has(img.resultUrl)
                  ? 'bg-red-500/80 text-white'
                  : 'bg-black/20 text-white/70 opacity-0 group-hover:opacity-100 hover:bg-black/40'
              ]">
              <Heart :size="12" :fill="favorites.has(img.resultUrl) ? 'currentColor' : 'none'" />
            </button>
          </div>

          <!-- Info bar -->
          <div class="px-2.5 py-1.5 flex items-center justify-between">
            <div class="flex items-center gap-1.5 text-[9px] text-gray-400 min-w-0">
              <span v-if="img.photoModel" class="shrink-0">{{ MODEL_LABELS[img.photoModel] || img.photoModel }}</span>
              <span v-if="img.photoResolution" class="shrink-0">· {{ img.photoResolution }}</span>
              <span v-if="img.costUsd" class="shrink-0">· {{ costToRub(img.costUsd) }} &#8381;</span>
            </div>
            <button @click="toggleExpanded(idx)"
              :class="expandedIdx === idx ? 'text-fuchsia-500' : 'text-gray-300 hover:text-gray-500'"
              class="p-0.5 rounded transition-colors shrink-0">
              <ChevronDown :size="12" :class="expandedIdx === idx ? 'rotate-180 transition-transform' : 'transition-transform'" />
            </button>
          </div>

          <!-- Expanded details -->
          <div v-if="expandedIdx === idx" class="px-2.5 pb-2 space-y-1 text-[10px] text-gray-500 border-t border-gray-50 dark:border-gray-800 pt-1.5">
            <div class="flex flex-wrap gap-x-3 gap-y-1">
              <span v-if="img.photoModel">
                <span class="text-gray-400">Модель:</span> {{ MODEL_LABELS[img.photoModel] || img.photoModel }}
              </span>
              <span v-if="img.photoResolution">
                <span class="text-gray-400">Разрешение:</span> {{ img.photoResolution }}
              </span>
              <span v-if="img.photoAspectRatio">
                <span class="text-gray-400">Формат:</span> {{ img.photoAspectRatio }}
              </span>
              <span>
                <span class="text-gray-400">Дата:</span> {{ new Date(img.createdAt).toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) }}
              </span>
            </div>
            <div v-if="img.prompt">
              <span class="text-gray-400">Промпт:</span>
              <p class="mt-0.5 text-gray-600 dark:text-gray-400 line-clamp-3">{{ img.prompt }}</p>
            </div>
          </div>
        </div>
      </div>

      <!-- Empty state -->
      <div v-if="!filtered.length && !generating" class="text-center py-12">
        <Camera :size="32" class="mx-auto text-gray-200 dark:text-gray-700 mb-2" />
        <p class="text-sm text-gray-400">
          {{ activeFilter === 'favorites' ? 'Нет избранных фото' : 'Сгенерируйте первое изображение' }}
        </p>
      </div>
    </div>

    <!-- Lightbox modal -->
    <Teleport to="body">
      <div v-if="lightboxUrl" class="fixed inset-0 z-50 flex items-center justify-center p-4" @click="closeLightbox">
        <div class="absolute inset-0 bg-black/80" />
        <div class="relative max-w-[90vw] max-h-[90vh]" @click.stop>
          <img :src="lightboxUrl" class="max-w-full max-h-[85vh] object-contain rounded-lg shadow-2xl" />
          <button @click="closeLightbox"
            class="absolute -top-3 -right-3 w-8 h-8 rounded-full bg-white dark:bg-gray-800 shadow-lg flex items-center justify-center text-gray-600 hover:text-gray-900 dark:text-gray-400 dark:hover:text-gray-200 transition-colors">
            <X :size="16" />
          </button>
          <div class="absolute bottom-3 left-1/2 -translate-x-1/2 flex gap-2">
            <button @click="downloadImage(lightboxUrl!)"
              class="px-3 py-1.5 rounded-lg bg-white/90 dark:bg-gray-800/90 text-sm font-medium text-gray-700 dark:text-gray-300 hover:bg-white transition-colors flex items-center gap-1.5">
              <Download :size="14" /> Скачать
            </button>
            <button @click="emit('edit', lightboxUrl!); closeLightbox()"
              class="px-3 py-1.5 rounded-lg bg-white/90 dark:bg-gray-800/90 text-sm font-medium text-gray-700 dark:text-gray-300 hover:bg-white transition-colors flex items-center gap-1.5">
              <Pencil :size="14" /> Редактировать
            </button>
            <button @click="emit('removeBg', lightboxUrl!); closeLightbox()"
              class="px-3 py-1.5 rounded-lg bg-white/90 dark:bg-gray-800/90 text-sm font-medium text-gray-700 dark:text-gray-300 hover:bg-white transition-colors flex items-center gap-1.5">
              <Eraser :size="14" /> Удалить фон
            </button>
          </div>
        </div>
      </div>
    </Teleport>
  </div>
</template>
