<script setup lang="ts">
// Превью STORIES «как в соцсети» — вертикальный 9:16 с нативной рамкой Instagram / VK.
// baked=true → дизайн уже вшит в картинку (satori): рисуем рамку соцсети, но НЕ дублируем текст/градиенты.
import { X, Heart, Send } from 'lucide-vue-next'
interface Media { url: string; thumbUrl: string | null; mimeType: string }
const props = defineProps<{
  accountName: string
  text: string
  mediaFiles?: Media[]
  platform?: string
  baked?: boolean
}>()
const isIg = () => props.platform === 'INSTAGRAM'
</script>

<template>
  <div class="mx-auto w-full max-w-[260px]">
    <div class="relative aspect-[9/16] rounded-2xl overflow-hidden bg-gray-900 shadow-md select-none">
      <!-- Фото-фон (полное качество) -->
      <img v-if="mediaFiles?.length" :src="mediaFiles[0].url" class="absolute inset-0 w-full h-full object-cover" />
      <div v-else class="absolute inset-0 flex items-center justify-center text-gray-500 text-xs">нет фото</div>

      <!-- Прогресс-бар сегментов (сверху) -->
      <div class="absolute top-2 inset-x-2 flex gap-1 z-20">
        <div class="flex-1 h-[3px] rounded-full bg-white/90"></div>
        <div class="flex-1 h-[3px] rounded-full bg-white/35"></div>
        <div class="flex-1 h-[3px] rounded-full bg-white/35"></div>
      </div>

      <!-- Шапка: аватар + имя + «сейчас» + × -->
      <div class="absolute top-5 inset-x-2 flex items-center gap-2 z-20">
        <div v-if="isIg()" class="w-7 h-7 rounded-full bg-gradient-to-tr from-yellow-400 via-pink-500 to-purple-600 p-0.5 shrink-0">
          <div class="w-full h-full rounded-full bg-gray-900 flex items-center justify-center text-[9px] font-bold text-white">{{ (accountName || 'Н').charAt(0).toUpperCase() }}</div>
        </div>
        <div v-else class="w-7 h-7 rounded-full bg-blue-600 flex items-center justify-center text-[9px] font-bold text-white shrink-0">{{ (accountName || 'В').charAt(0).toUpperCase() }}</div>
        <span class="flex-1 min-w-0 text-white text-[11px] font-semibold truncate" style="text-shadow:0 1px 3px rgba(0,0,0,0.5)">{{ accountName || (isIg() ? 'instagram' : 'Сообщество') }}</span>
        <span class="text-white/70 text-[10px] shrink-0">сейчас</span>
        <X :size="14" class="text-white/80 shrink-0" />
      </div>

      <!-- Текст-оверлей + градиенты — только если дизайн НЕ вшит в картинку -->
      <template v-if="!baked">
        <div class="absolute inset-x-0 top-0 h-1/4 bg-gradient-to-b from-black/45 to-transparent pointer-events-none"></div>
        <div class="absolute inset-x-0 bottom-0 h-1/2 bg-gradient-to-t from-black/70 via-black/20 to-transparent pointer-events-none"></div>
        <div v-if="text" class="absolute inset-x-3 bottom-14 z-10">
          <p class="text-white text-[12px] font-semibold leading-snug whitespace-pre-wrap break-words" style="text-shadow:0 1px 4px rgba(0,0,0,0.8)">{{ text }}</p>
        </div>
      </template>

      <!-- Низ: IG — поле «Отправить сообщение» + иконки; VK — кнопка-таблетка + лайк -->
      <div class="absolute inset-x-2 bottom-2 z-20 flex items-center gap-2">
        <template v-if="isIg()">
          <div class="flex-1 rounded-full border border-white/50 bg-white/10 backdrop-blur-sm px-3 py-1.5">
            <span class="text-white/70 text-[10px]">Отправить сообщение</span>
          </div>
          <Heart :size="16" class="text-white shrink-0" />
          <Send :size="16" class="text-white shrink-0" />
        </template>
        <template v-else>
          <div class="flex-1 rounded-full bg-blue-600/85 backdrop-blur-sm px-3 py-1.5 text-center">
            <span class="text-white text-[10px] font-medium">Перейти →</span>
          </div>
          <Heart :size="16" class="text-white shrink-0" />
        </template>
      </div>
    </div>
    <p class="text-center text-[11px] text-gray-400 mt-1">{{ baked ? 'Готовая сторис' : 'Stories' }} · {{ isIg() ? 'Instagram' : 'ВКонтакте' }}</p>
  </div>
</template>
