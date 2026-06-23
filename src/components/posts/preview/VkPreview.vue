<script setup lang="ts">
import { computed, ref } from 'vue'
import { Heart, MessageCircle, Repeat2, Share2, Play } from 'lucide-vue-next'
import EditableText from './EditableText.vue'

interface Media { url: string; thumbUrl: string | null; mimeType: string }
const props = defineProps<{
  accountName: string
  text: string
  hashtags?: string[]
  mediaFiles?: Media[]
  editable?: boolean
}>()
const emit = defineEmits<{ 'update:text': [string] }>()

const media = computed(() => props.mediaFiles || [])
const initial = computed(() => (props.accountName || 'В').trim().charAt(0).toUpperCase())
const gridClass = computed(() => (media.value.length === 2 ? 'grid-cols-2' : 'grid-cols-3'))
function isVideo(m: Media) { return m.mimeType?.startsWith('video/') }

// Одиночное фото: VK показывает в РОДНОМ соотношении (в отличие от IG не форсит формат и не добавляет полей).
// Берём соотношение из натуральных размеров + грузим ОРИГИНАЛ (квадратный thumb давал квадрат + мыло).
// Альбом (>1) остаётся сеткой-коллажем (так VK и раскладывает несколько фото) — там thumb ок (плитки мелкие).
const single = computed(() => (media.value.length === 1 ? media.value[0] : null))
const singleSrc = computed(() => single.value && isVideo(single.value) ? (single.value.thumbUrl || single.value.url) : single.value?.url)
const soloRatio = ref(1)
function onImgLoad(e: Event) {
  const img = e.target as HTMLImageElement
  if (img.naturalWidth && img.naturalHeight) {
    // мягкий предел, чтобы экстремальные размеры не ломали вёрстку; обычные фото — как есть
    soloRatio.value = Math.min(2.5, Math.max(0.5, img.naturalWidth / img.naturalHeight))
  }
}
</script>

<template>
  <div class="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 overflow-hidden text-sm shadow-sm">
    <div class="flex items-center gap-2 p-3">
      <div class="w-9 h-9 rounded-full bg-blue-500 text-white flex items-center justify-center font-bold shrink-0">{{ initial }}</div>
      <div class="min-w-0">
        <div class="font-semibold leading-tight truncate">{{ accountName || 'Сообщество' }}</div>
        <div class="text-xs text-gray-400">сейчас · ВКонтакте</div>
      </div>
    </div>
    <div v-if="text || editable" class="px-3 pb-2 leading-relaxed"><EditableText :text="text" :editable="editable" @update:text="emit('update:text', $event)" /></div>
    <div v-if="hashtags?.length" class="px-3 pb-2 flex flex-wrap gap-x-1.5 text-blue-500">
      <span v-for="h in hashtags" :key="h">#{{ h }}</span>
    </div>

    <!-- Одиночное фото: реальное соотношение + оригинал (VK не форсит формат) -->
    <div v-if="single" class="relative bg-gray-100 dark:bg-gray-800" :style="{ aspectRatio: String(soloRatio) }">
      <img :src="singleSrc" @load="onImgLoad" class="w-full h-full object-cover" />
      <div v-if="isVideo(single)" class="absolute inset-0 flex items-center justify-center bg-black/20">
        <div class="w-10 h-10 rounded-full bg-black/50 flex items-center justify-center"><Play :size="18" class="text-white ml-0.5" /></div>
      </div>
    </div>
    <!-- Несколько фото: сетка-коллаж (как VK раскладывает альбом) -->
    <div v-else-if="media.length" :class="['grid gap-0.5', gridClass]">
      <div v-for="(m, i) in media.slice(0, 6)" :key="i" class="relative aspect-square bg-gray-100 dark:bg-gray-800 overflow-hidden">
        <img :src="m.thumbUrl || m.url" class="w-full h-full object-cover" />
        <div v-if="isVideo(m)" class="absolute inset-0 flex items-center justify-center bg-black/20">
          <div class="w-8 h-8 rounded-full bg-black/50 flex items-center justify-center"><Play :size="16" class="text-white ml-0.5" /></div>
        </div>
      </div>
    </div>

    <div class="flex items-center gap-4 p-3 text-gray-400">
      <Heart :size="16" /><MessageCircle :size="16" /><Repeat2 :size="16" /><Share2 :size="16" />
    </div>
  </div>
</template>
