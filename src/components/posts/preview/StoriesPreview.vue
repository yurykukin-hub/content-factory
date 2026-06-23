<script setup lang="ts">
// Превью STORIES «как в соцсети». Раскладка повторяет реальные сторис:
//  IG  — фото 9:16, под ним полоса: поле «Отправить сообщение» + иконки.
//  VK  — фото 9:16 с нативной кнопкой «Забронировать» ПОВЕРХ фото справа внизу,
//        под фото полоса: просмотры + иконки.
// Верх (прогресс+аватар) — поверх фото. baked=true → текст-оверлей не дублируем (вшит в картинку).
import { X, Heart, Send, Eye, Share2 } from 'lucide-vue-next'
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
    <div class="rounded-2xl overflow-hidden bg-gray-900 shadow-md select-none">
      <!-- Фото 9:16 с верхним интерфейсом поверх -->
      <div class="relative aspect-[9/16]">
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
          <div v-if="text" class="absolute inset-x-3 bottom-3 z-10">
            <p class="text-white text-[12px] font-semibold leading-snug whitespace-pre-wrap break-words" style="text-shadow:0 1px 4px rgba(0,0,0,0.8)">{{ text }}</p>
          </div>
        </template>

        <!-- VK: нативная кнопка «Забронировать» — ПОВЕРХ фото справа внизу (как в реальной VK-сторис) -->
        <div v-if="!isIg()" class="absolute right-2 bottom-2 z-20">
          <div class="rounded-lg bg-white px-3 py-1.5 shadow-md"><span class="text-gray-900 text-[11px] font-semibold">Забронировать</span></div>
        </div>
      </div>

      <!-- Нижняя полоса ПОД фото -->
      <div class="flex items-center gap-2 px-2.5 py-2.5">
        <template v-if="isIg()">
          <!-- IG: поле «Отправить сообщение» + иконки -->
          <div class="flex-1 rounded-full border border-white/40 px-3 py-1.5">
            <span class="text-white/55 text-[10px]">Отправить сообщение</span>
          </div>
          <Heart :size="18" class="text-white shrink-0" />
          <Send :size="18" class="text-white shrink-0" />
        </template>
        <template v-else>
          <!-- VK: просмотры слева, иконки справа -->
          <div class="flex items-center gap-1 text-white/70 text-[11px]"><Eye :size="15" /> 1</div>
          <Send :size="17" class="text-white shrink-0 ml-auto" />
          <Share2 :size="17" class="text-white shrink-0" />
        </template>
      </div>
    </div>
    <p class="text-center text-[11px] text-gray-400 mt-1">{{ baked ? 'Готовая сторис' : 'Stories' }} · {{ isIg() ? 'Instagram' : 'ВКонтакте' }}</p>
  </div>
</template>
