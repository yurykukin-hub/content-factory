<script setup lang="ts">
import { computed, ref } from 'vue'
import { Play } from 'lucide-vue-next'

interface Media { url: string; thumbUrl: string | null; mimeType: string }
const props = defineProps<{
  accountName: string
  text: string
  hashtags?: string[]
  mediaFiles?: Media[]
}>()

const media = computed(() => props.mediaFiles || [])
const gridClass = computed(() => (media.value.length === 2 ? 'grid-cols-2' : 'grid-cols-3'))
function isVideo(m: Media) { return m.mimeType?.startsWith('video/') }

// Одиночное фото: Telegram показывает в РОДНОМ соотношении (как VK, формат не форсит).
// Реальное соотношение из натуральных размеров + оригинал (квадратный thumb давал квадрат + мыло).
// Альбом (>1) — сетка (media group коллажем).
const single = computed(() => (media.value.length === 1 ? media.value[0] : null))
const singleSrc = computed(() => single.value && isVideo(single.value) ? (single.value.thumbUrl || single.value.url) : single.value?.url)
const soloRatio = ref(1)
function onImgLoad(e: Event) {
  const img = e.target as HTMLImageElement
  if (img.naturalWidth && img.naturalHeight) {
    soloRatio.value = Math.min(2.5, Math.max(0.5, img.naturalWidth / img.naturalHeight))
  }
}
</script>

<template>
  <div class="flex">
    <div class="max-w-[88%] rounded-2xl rounded-tl-md bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 overflow-hidden text-sm shadow-sm">
      <!-- Одиночное фото: реальное соотношение + оригинал -->
      <div v-if="single" class="relative bg-gray-100 dark:bg-gray-900" :style="{ aspectRatio: String(soloRatio) }">
        <img :src="singleSrc" @load="onImgLoad" class="w-full h-full object-cover" />
        <div v-if="isVideo(single)" class="absolute inset-0 flex items-center justify-center bg-black/20">
          <div class="w-10 h-10 rounded-full bg-black/50 flex items-center justify-center"><Play :size="18" class="text-white ml-0.5" /></div>
        </div>
      </div>
      <!-- Несколько фото: сетка-коллаж (media group) -->
      <div v-else-if="media.length" :class="['grid gap-0.5', gridClass]">
        <div v-for="(m, i) in media.slice(0, 6)" :key="i" class="relative aspect-square bg-gray-100 dark:bg-gray-900 overflow-hidden">
          <img :src="m.thumbUrl || m.url" class="w-full h-full object-cover" />
          <div v-if="isVideo(m)" class="absolute inset-0 flex items-center justify-center bg-black/20">
            <div class="w-8 h-8 rounded-full bg-black/50 flex items-center justify-center"><Play :size="16" class="text-white ml-0.5" /></div>
          </div>
        </div>
      </div>
      <div class="p-3">
        <div class="font-semibold text-sky-600 dark:text-sky-400 mb-1 truncate">{{ accountName || 'Канал' }}</div>
        <div v-if="text" class="whitespace-pre-wrap break-words leading-relaxed">{{ text }}</div>
        <div v-if="hashtags?.length" class="flex flex-wrap gap-x-1.5 text-sky-500 mt-1">
          <span v-for="h in hashtags" :key="h">#{{ h }}</span>
        </div>
        <div class="text-[10px] text-gray-400 text-right mt-1.5">сейчас</div>
      </div>
    </div>
  </div>
</template>
