<script setup lang="ts">
/**
 * Pre-generation confirmation modal for Photo Studio.
 * Shows structured summary before confirming image generation.
 */
import { computed } from 'vue'
import { Camera, X } from 'lucide-vue-next'

const props = defineProps<{
  show: boolean
  prompt: string
  photoModel: string
  photoResolution: string
  photoAspectRatio: string
  batchSize: number
  costRub: number
  costUsd: number
  characterName?: string | null
}>()

const emit = defineEmits<{
  confirm: []
  cancel: []
}>()

const modelLabel = computed(() => {
  const map: Record<string, string> = {
    'nano-banana-2': 'Nano Banana 2 (быстрый)',
    'nano-banana-pro': 'Nano Banana Pro (качество)',
  }
  return map[props.photoModel] || props.photoModel
})

const batchLabel = computed(() => {
  if (props.batchSize === 1) return '1 изображение'
  if (props.batchSize <= 4) return `${props.batchSize} изображения`
  return `${props.batchSize} изображений`
})
</script>

<template>
  <Teleport to="body">
    <div v-if="show" class="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div class="absolute inset-0 bg-black/50" @click="emit('cancel')" />

      <div class="relative bg-white dark:bg-gray-900 rounded-2xl shadow-2xl max-w-md w-full max-h-[80vh] overflow-y-auto">
        <!-- Header -->
        <div class="flex items-center justify-between px-5 py-4 border-b border-gray-100 dark:border-gray-800">
          <div class="flex items-center gap-2">
            <Camera :size="18" class="text-fuchsia-500" />
            <h3 class="text-base font-semibold text-gray-800 dark:text-gray-200">Генерация фото</h3>
          </div>
          <button @click="emit('cancel')" class="p-1.5 rounded-lg text-gray-400 hover:text-gray-600 hover:bg-gray-100 dark:hover:bg-gray-800">
            <X :size="16" />
          </button>
        </div>

        <!-- Content -->
        <div class="px-5 py-4 space-y-3">
          <!-- Model -->
          <div class="flex items-center justify-between text-sm">
            <span class="text-gray-500">Модель</span>
            <span class="font-medium text-gray-800 dark:text-gray-200">{{ modelLabel }}</span>
          </div>

          <!-- Resolution -->
          <div class="flex items-center justify-between text-sm">
            <span class="text-gray-500">Разрешение</span>
            <span class="font-medium text-gray-800 dark:text-gray-200">{{ photoResolution }}</span>
          </div>

          <!-- Aspect ratio -->
          <div class="flex items-center justify-between text-sm">
            <span class="text-gray-500">Формат</span>
            <span class="font-medium text-gray-800 dark:text-gray-200">{{ photoAspectRatio }}</span>
          </div>

          <!-- Batch size -->
          <div class="flex items-center justify-between text-sm">
            <span class="text-gray-500">Количество</span>
            <span class="font-medium text-gray-800 dark:text-gray-200">{{ batchLabel }}</span>
          </div>

          <!-- Character -->
          <div v-if="characterName" class="flex items-center justify-between text-sm">
            <span class="text-gray-500">Персонаж</span>
            <span class="font-medium text-gray-800 dark:text-gray-200">{{ characterName }}</span>
          </div>

          <!-- Prompt -->
          <div>
            <span class="text-[10px] font-medium text-gray-400 uppercase">Промпт</span>
            <div class="mt-1 p-3 rounded-lg bg-gray-50 dark:bg-gray-800 text-sm text-gray-700 dark:text-gray-300 whitespace-pre-line max-h-[200px] overflow-y-auto">
              {{ prompt }}
            </div>
          </div>
        </div>

        <!-- Footer -->
        <div class="px-5 py-4 border-t border-gray-100 dark:border-gray-800 flex items-center justify-between">
          <div>
            <span class="text-lg font-bold text-fuchsia-600">{{ costRub }} &#8381;</span>
            <p class="text-[10px] text-gray-400 mt-0.5">${{ costUsd.toFixed(2) }} / {{ batchLabel }}</p>
          </div>
          <div class="flex gap-2">
            <button @click="emit('cancel')"
              class="px-4 py-2 rounded-xl text-sm font-medium text-gray-600 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors">
              Отмена
            </button>
            <button @click="emit('confirm')"
              class="px-6 py-2 rounded-xl text-sm font-medium bg-fuchsia-600 hover:bg-fuchsia-700 text-white transition-colors">
              Сгенерировать
            </button>
          </div>
        </div>
      </div>
    </div>
  </Teleport>
</template>
