<script setup lang="ts">
import { ref } from 'vue'
import { http } from '@/api/client'
import { useToast } from '@/composables/useToast'
import { Sparkles, Loader2, Wand2, X } from 'lucide-vue-next'

interface MediaFile {
  id: string; url: string; thumbUrl: string | null
  filename: string; mimeType: string; sizeBytes: number
}

const props = defineProps<{
  visible: boolean
  imageUrl: string
  mediaId: string
  businessId: string
  postId?: string
}>()

const emit = defineEmits<{
  close: []
  edited: [file: MediaFile]
}>()

const toast = useToast()
const prompt = ref('')
const loading = ref(false)
const selectedModel = ref<'flux-kontext-pro' | 'nano-banana-2'>('flux-kontext-pro')

const MODELS = [
  { id: 'flux-kontext-pro' as const, label: 'FLUX Kontext', desc: 'Точное редактирование' },
  { id: 'nano-banana-2' as const, label: 'Nano Banana 2', desc: 'Креативная стилизация' },
]

const EDIT_TEMPLATES = [
  { label: 'Сменить фон', prompt: 'Change the background to a beautiful sunset over water' },
  { label: 'Стилизовать', prompt: 'Transform this image into a vibrant, colorful illustration style' },
  { label: 'Добавить элемент', prompt: 'Add soft bokeh lights in the background' },
  { label: 'Улучшить', prompt: 'Enhance image quality, improve lighting, colors and sharpness' },
]

async function submit() {
  if (!prompt.value.trim() || loading.value) return
  loading.value = true
  try {
    const result = await http.post<{ mediaFile: MediaFile }>('/ai/edit-image', {
      businessId: props.businessId,
      mediaId: props.mediaId,
      prompt: prompt.value,
      postId: props.postId,
      model: selectedModel.value,
    })
    emit('edited', result.mediaFile)
    emit('close')
    prompt.value = ''
    toast.success('Изображение отредактировано')
  } catch (e: any) {
    toast.error('Ошибка: ' + (e.message || e))
  } finally {
    loading.value = false
  }
}
</script>

<template>
  <div v-if="visible" class="fixed inset-0 z-50 flex items-center justify-center bg-black/50" @click.self="emit('close')">
    <div class="bg-white dark:bg-gray-900 rounded-2xl p-6 w-full max-w-lg shadow-xl">
      <div class="flex items-center justify-between mb-4">
        <h2 class="text-lg font-bold flex items-center gap-2">
          <Wand2 :size="20" class="text-purple-500" /> Редактировать AI
        </h2>
        <button @click="emit('close')" class="p-1 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800">
          <X :size="18" class="text-gray-400" />
        </button>
      </div>

      <!-- Preview -->
      <div class="mb-4 rounded-lg overflow-hidden bg-gray-100 dark:bg-gray-800 flex items-center justify-center" style="max-height: 200px">
        <img :src="imageUrl" class="max-h-[200px] object-contain" alt="Original" />
      </div>

      <div class="space-y-3">
        <!-- Model selector -->
        <div>
          <label class="block text-sm font-medium mb-1.5">Модель</label>
          <div class="flex gap-2">
            <button v-for="m in MODELS" :key="m.id" @click="selectedModel = m.id"
              :class="['flex-1 px-3 py-2 rounded-lg text-xs font-medium border-2 transition-colors text-left',
                selectedModel === m.id
                  ? 'border-purple-500 bg-purple-50 dark:bg-purple-950 text-purple-700 dark:text-purple-300'
                  : 'border-gray-200 dark:border-gray-700 text-gray-500 hover:border-gray-300']">
              <div class="font-semibold">{{ m.label }}</div>
              <div class="text-[10px] opacity-70 mt-0.5">{{ m.desc }}</div>
            </button>
          </div>
        </div>

        <!-- Template pills -->
        <div>
          <label class="block text-sm font-medium mb-1.5">Шаблоны</label>
          <div class="flex flex-wrap gap-1.5">
            <button v-for="t in EDIT_TEMPLATES" :key="t.label" @click="prompt = t.prompt"
              class="px-2.5 py-1 rounded-full text-xs font-medium bg-purple-100 dark:bg-purple-900/50 text-purple-700 dark:text-purple-300 hover:bg-purple-200 dark:hover:bg-purple-800 transition-colors">
              {{ t.label }}
            </button>
          </div>
        </div>

        <!-- Prompt -->
        <div>
          <label class="block text-sm font-medium mb-1">Что изменить?</label>
          <textarea v-model="prompt" rows="3" placeholder="Замени фон на закат над морем..."
            class="w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 focus:ring-2 focus:ring-purple-500 text-sm" />
        </div>
      </div>

      <div class="flex justify-end gap-2 mt-5">
        <button @click="emit('close')" class="px-4 py-2 rounded-lg text-sm text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800">
          Отмена
        </button>
        <button @click="submit" :disabled="loading || !prompt.trim()"
          class="flex items-center gap-2 px-4 py-2 rounded-lg bg-purple-600 hover:bg-purple-700 text-white text-sm font-medium disabled:opacity-50">
          <Loader2 v-if="loading" :size="16" class="animate-spin" /><Sparkles v-else :size="16" />
          {{ loading ? 'Обработка...' : 'Применить' }}
        </button>
      </div>
    </div>
  </div>
</template>
