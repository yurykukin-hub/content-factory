<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { Heart, MessageCircle, Send, Bookmark, Play, ChevronLeft, ChevronRight } from 'lucide-vue-next'
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
const isCarousel = computed(() => media.value.length > 1)
const current = ref(0)
watch(() => media.value.length, (n) => { if (current.value >= n) current.value = 0 })

const active = computed(() => media.value[current.value])
const username = computed(() => (props.accountName || 'instagram').replace(/^@/, ''))
const initial = computed(() => username.value.charAt(0).toUpperCase())
function isVideo(m: Media) { return m.mimeType?.startsWith('video/') }
// Фото грузим оригиналом (точное соотношение); видео — thumb (кроп видео не трогает).
const activeSrc = computed(() => active.value && isVideo(active.value) ? (active.value.thumbUrl || active.value.url) : active.value?.url)

// IG-лента допускает соотношение 4:5 (0.8) … 1.91:1; бэкенд кропает фото к этим границам
// (publishers/postmypost.ts) → превью показываем В ТОМ ЖЕ формате, что реально опубликуется.
// Карусель (>1 фото): IG требует ОДИНАКОВОЕ соотношение → бэкенд форсит общий 4:5, превью тоже фикс 4:5.
// Одиночное фото: соотношение по натуральным размерам (квадратный thumb врёт → грузим оригинал).
const IG_MIN = 0.8, IG_MAX = 1.91
const soloRatio = ref(0.8)
const displayRatio = computed(() => (isCarousel.value ? 0.8 : soloRatio.value))
function onImgLoad(e: Event) {
  if (isCarousel.value) return
  const img = e.target as HTMLImageElement
  if (img.naturalWidth && img.naturalHeight) {
    soloRatio.value = Math.min(IG_MAX, Math.max(IG_MIN, img.naturalWidth / img.naturalHeight))
  }
}

function go(d: number) {
  const n = media.value.length
  if (n > 1) current.value = (current.value + d + n) % n
}
// Свайп на мобильном (как в Instagram)
let touchX = 0
function onTouchStart(e: TouchEvent) { touchX = e.changedTouches[0].clientX }
function onTouchEnd(e: TouchEvent) {
  const dx = e.changedTouches[0].clientX - touchX
  if (Math.abs(dx) > 40) go(dx < 0 ? 1 : -1)
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

    <div v-if="active" class="relative bg-gray-100 dark:bg-gray-800 overflow-hidden select-none"
      :style="{ aspectRatio: String(displayRatio) }"
      @touchstart.passive="onTouchStart" @touchend.passive="onTouchEnd">
      <img :key="active.url" :src="activeSrc" @load="onImgLoad" class="w-full h-full object-cover" />
      <div v-if="isVideo(active)" class="absolute inset-0 flex items-center justify-center bg-black/15">
        <div class="w-10 h-10 rounded-full bg-black/50 flex items-center justify-center"><Play :size="20" class="text-white ml-0.5" /></div>
      </div>

      <!-- Карусель: стрелки, счётчик, точки — листается как в Instagram (клик/свайп) -->
      <template v-if="isCarousel">
        <button v-if="current > 0" type="button" @click="go(-1)"
          class="absolute left-1.5 top-1/2 -translate-y-1/2 w-6 h-6 rounded-full bg-black/45 hover:bg-black/60 flex items-center justify-center text-white">
          <ChevronLeft :size="16" />
        </button>
        <button v-if="current < media.length - 1" type="button" @click="go(1)"
          class="absolute right-1.5 top-1/2 -translate-y-1/2 w-6 h-6 rounded-full bg-black/45 hover:bg-black/60 flex items-center justify-center text-white">
          <ChevronRight :size="16" />
        </button>
        <div class="absolute top-2 right-2 px-2 py-0.5 rounded-full bg-black/50 text-white text-[11px] font-medium tabular-nums">{{ current + 1 }}/{{ media.length }}</div>
        <div class="absolute bottom-2 inset-x-0 flex justify-center gap-1">
          <span v-for="(m, i) in media" :key="i" class="w-1.5 h-1.5 rounded-full transition-colors"
            :class="i === current ? 'bg-white' : 'bg-white/50'" />
        </div>
      </template>
    </div>
    <div v-else class="aspect-[4/5] bg-gray-100 dark:bg-gray-800 flex items-center justify-center text-xs text-gray-400 text-center px-6">
      Instagram требует фото или видео
    </div>

    <div class="flex items-center gap-4 px-2.5 pt-2.5 text-gray-700 dark:text-gray-300">
      <Heart :size="20" /><MessageCircle :size="20" /><Send :size="20" /><Bookmark :size="20" class="ml-auto" />
    </div>

    <div class="px-2.5 py-2">
      <div v-if="text || editable" class="break-words">
        <span class="font-semibold mr-1">{{ username }}</span>
        <EditableText :text="text" :editable="editable" @update:text="emit('update:text', $event)" />
      </div>
      <div v-if="hashtags?.length" class="text-blue-600 dark:text-blue-400 mt-1 flex flex-wrap gap-x-1.5">
        <span v-for="h in hashtags" :key="h">#{{ h }}</span>
      </div>
    </div>
  </div>
</template>
