<script setup lang="ts">
import { computed, ref } from 'vue'
import { Heart, MessageCircle, Send, Bookmark, Play } from 'lucide-vue-next'

interface Media { url: string; thumbUrl: string | null; mimeType: string }
const props = defineProps<{
  accountName: string
  text: string
  hashtags?: string[]
  mediaFiles?: Media[]
}>()

const media = computed(() => props.mediaFiles || [])
const cover = computed(() => media.value[0])
const username = computed(() => (props.accountName || 'instagram').replace(/^@/, ''))
const initial = computed(() => username.value.charAt(0).toUpperCase())
function isVideo(m: Media) { return m.mimeType?.startsWith('video/') }

// IG-лента допускает соотношение 4:5 (0.8) … 1.91:1; бэкенд кропает фото к этим границам
// (publishers/postmypost.ts) → превью показываем В ТОМ ЖЕ формате, что реально опубликуется,
// а не квадратом. Соотношение берём из натуральных размеров (thumb квадратный — не годится).
const IG_MIN = 0.8, IG_MAX = 1.91
const coverRatio = ref(0.8) // дефолт 4:5 (контент чаще вертикальный); уточняем после загрузки
// Фото грузим оригиналом (точное соотношение); видео — thumb (кроп видео не трогает).
const coverSrc = computed(() => cover.value && isVideo(cover.value) ? (cover.value.thumbUrl || cover.value.url) : cover.value?.url)
function onCoverLoad(e: Event) {
  const img = e.target as HTMLImageElement
  if (img.naturalWidth && img.naturalHeight) {
    coverRatio.value = Math.min(IG_MAX, Math.max(IG_MIN, img.naturalWidth / img.naturalHeight))
  }
}
</script>

<template>
  <div class="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 overflow-hidden text-sm shadow-sm max-w-sm">
    <div class="flex items-center gap-2 p-2.5">
      <div class="w-8 h-8 rounded-full bg-gradient-to-tr from-yellow-400 via-pink-500 to-purple-600 p-0.5 shrink-0">
        <div class="w-full h-full rounded-full bg-white dark:bg-gray-900 flex items-center justify-center text-xs font-bold">{{ initial }}</div>
      </div>
      <div class="font-semibold truncate">{{ username }}</div>
    </div>

    <div v-if="cover" class="relative bg-gray-100 dark:bg-gray-800" :style="{ aspectRatio: String(coverRatio) }">
      <img :src="coverSrc" @load="onCoverLoad" class="w-full h-full object-cover" />
      <div v-if="isVideo(cover)" class="absolute inset-0 flex items-center justify-center bg-black/15">
        <div class="w-10 h-10 rounded-full bg-black/50 flex items-center justify-center"><Play :size="20" class="text-white ml-0.5" /></div>
      </div>
    </div>
    <div v-else class="aspect-[4/5] bg-gray-100 dark:bg-gray-800 flex items-center justify-center text-xs text-gray-400 text-center px-6">
      Instagram требует фото или видео
    </div>

    <div class="flex items-center gap-4 px-2.5 pt-2.5 text-gray-700 dark:text-gray-300">
      <Heart :size="20" /><MessageCircle :size="20" /><Send :size="20" /><Bookmark :size="20" class="ml-auto" />
    </div>

    <div class="px-2.5 py-2">
      <span v-if="text" class="break-words"><span class="font-semibold mr-1">{{ username }}</span><span class="whitespace-pre-wrap">{{ text }}</span></span>
      <div v-if="hashtags?.length" class="text-blue-600 dark:text-blue-400 mt-1 flex flex-wrap gap-x-1.5">
        <span v-for="h in hashtags" :key="h">#{{ h }}</span>
      </div>
    </div>
  </div>
</template>
