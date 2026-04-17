<script setup lang="ts">
/**
 * Pre-generation confirmation modal for Sound Studio.
 * Shows structured summary before generating music.
 */
import { computed } from 'vue'
import { Music, X, Mic, MicOff } from 'lucide-vue-next'

const props = defineProps<{
  show: boolean
  customMode: boolean
  prompt: string
  lyrics: string
  musicStyle: string
  musicTitle: string
  negativeTags: string
  instrumental: boolean
  vocalGender: 'f' | 'm' | null
  sunoModel: string
  costRub: number
}>()

const emit = defineEmits<{
  confirm: []
  cancel: []
}>()

const modelLabel = computed(() => {
  const map: Record<string, string> = {
    'V4': 'Suno V4 (до 4 мин)',
    'V4_5': 'Suno V4.5 (до 8 мин)',
    'V5_5': 'Suno V5.5 (voice clone, до 8 мин)',
    // Legacy names (for existing sessions)
    'suno/v4': 'Suno V4 (до 4 мин)',
    'suno/v4.5': 'Suno V4.5 (до 8 мин)',
    'suno/v5.5': 'Suno V5.5 (voice clone, до 8 мин)',
  }
  return map[props.sunoModel] || props.sunoModel
})

const genderLabel = computed(() => {
  if (props.instrumental) return 'Инструментал'
  if (props.vocalGender === 'f') return 'Женский вокал'
  if (props.vocalGender === 'm') return 'Мужской вокал'
  return 'Авто'
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
            <Music :size="18" class="text-fuchsia-500" />
            <h3 class="text-base font-semibold text-gray-800 dark:text-gray-200">Генерация музыки</h3>
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

          <!-- Mode -->
          <div class="flex items-center justify-between text-sm">
            <span class="text-gray-500">Режим</span>
            <span class="font-medium text-gray-800 dark:text-gray-200">{{ customMode ? 'Полный (Custom)' : 'Простой (Simple)' }}</span>
          </div>

          <!-- Vocal -->
          <div class="flex items-center justify-between text-sm">
            <span class="text-gray-500">Вокал</span>
            <div class="flex items-center gap-1.5">
              <component :is="instrumental ? MicOff : Mic" :size="13" :class="instrumental ? 'text-gray-400' : 'text-fuchsia-500'" />
              <span class="font-medium text-gray-800 dark:text-gray-200">{{ genderLabel }}</span>
            </div>
          </div>

          <!-- Title -->
          <div v-if="musicTitle" class="flex items-center justify-between text-sm">
            <span class="text-gray-500">Название</span>
            <span class="font-medium text-gray-800 dark:text-gray-200">{{ musicTitle }}</span>
          </div>

          <!-- Prompt / Lyrics -->
          <div>
            <span class="text-[10px] font-medium text-gray-400 uppercase">
              {{ customMode ? 'Текст (Lyrics)' : 'Промпт' }}
            </span>
            <div class="mt-1 p-3 rounded-lg bg-gray-50 dark:bg-gray-800 text-sm text-gray-700 dark:text-gray-300 font-mono whitespace-pre-line max-h-[200px] overflow-y-auto">
              {{ customMode ? (lyrics || prompt) : prompt }}
            </div>
          </div>

          <!-- Style -->
          <div v-if="musicStyle">
            <span class="text-[10px] font-medium text-gray-400 uppercase">Стиль</span>
            <div class="mt-1 p-2 rounded-lg bg-fuchsia-50 dark:bg-fuchsia-900/20 text-sm text-fuchsia-700 dark:text-fuchsia-300">
              {{ musicStyle }}
            </div>
          </div>

          <!-- Negative tags -->
          <div v-if="negativeTags">
            <span class="text-[10px] font-medium text-gray-400 uppercase">Исключить</span>
            <div class="mt-1 p-2 rounded-lg bg-red-50 dark:bg-red-900/20 text-sm text-red-600 dark:text-red-400">
              {{ negativeTags }}
            </div>
          </div>
        </div>

        <!-- Footer -->
        <div class="px-5 py-4 border-t border-gray-100 dark:border-gray-800 flex items-center justify-between">
          <span class="text-lg font-bold text-fuchsia-600">{{ costRub }} &#8381;</span>
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
