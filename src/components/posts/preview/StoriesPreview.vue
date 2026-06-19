<script setup lang="ts">
// Превью STORIES «как в соцсети» — вертикальный 9:16 с фото-фоном и текстом-оверлеем.
// baked=true → картинка уже содержит вшитый дизайн (satori), показываем как есть без vue-оверлея.
interface Media { url: string; thumbUrl: string | null; mimeType: string }
defineProps<{
  accountName: string
  text: string
  mediaFiles?: Media[]
  platform?: string
  baked?: boolean
}>()
</script>

<template>
  <div class="mx-auto w-full max-w-[260px]">
    <div class="relative aspect-[9/16] rounded-2xl overflow-hidden bg-gray-800 shadow-md">
      <!-- Фото-фон (полное качество) -->
      <img v-if="mediaFiles?.length" :src="mediaFiles[0].url" class="absolute inset-0 w-full h-full object-cover" />
      <div v-else class="absolute inset-0 flex items-center justify-center text-gray-400 text-xs">нет фото</div>

      <!-- Vue-оверлей (черновой превью) — скрываем, если дизайн уже вшит в картинку -->
      <template v-if="!baked">
        <div class="absolute inset-x-0 top-0 h-1/4 bg-gradient-to-b from-black/40 to-transparent"></div>
        <div class="absolute inset-x-0 bottom-0 h-2/3 bg-gradient-to-t from-black/80 via-black/30 to-transparent"></div>
        <div class="absolute top-3 left-3 right-3 flex items-center gap-2">
          <div class="w-7 h-7 rounded-full bg-white/90 text-gray-800 flex items-center justify-center text-xs font-bold shrink-0">{{ (accountName || 'Н').charAt(0).toUpperCase() }}</div>
          <span class="text-white text-xs font-medium truncate" style="text-shadow: 0 1px 3px rgba(0,0,0,0.6)">{{ accountName }}</span>
        </div>
        <div v-if="text" class="absolute inset-x-0 bottom-0 p-4">
          <p class="text-white text-sm font-semibold leading-snug whitespace-pre-wrap break-words" style="text-shadow: 0 1px 5px rgba(0,0,0,0.75)">{{ text }}</p>
        </div>
      </template>
    </div>
    <p class="text-center text-[11px] text-gray-400 mt-1">{{ baked ? 'Готовая сторис' : 'Stories' }} · {{ platform }}</p>
  </div>
</template>
