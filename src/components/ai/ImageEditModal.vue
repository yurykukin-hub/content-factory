<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { http } from '@/api/client'
import { useToast } from '@/composables/useToast'
import { Sparkles, Loader2, Wand2, X, ChevronLeft, ChevronRight } from 'lucide-vue-next'

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
  submitted: [data: { prompt: string; model: string; mediaId: string }]
}>()

const toast = useToast()
const prompt = ref('')
const enhancing = ref(false)
const selectedModel = ref<'flux-kontext-pro' | 'nano-banana-2'>('flux-kontext-pro')

// Prompt history
const promptHistory = ref<string[]>([])
const historyIndex = ref(-1)

const MODELS = [
  { id: 'flux-kontext-pro' as const, label: 'FLUX Kontext', desc: 'Точное редактирование' },
  { id: 'nano-banana-2' as const, label: 'Nano Banana 2', desc: 'Креативная стилизация' },
]

// Templates — простая подстановка текста (как раньше)
const EDIT_TEMPLATES = [
  { label: 'Сменить фон', prompt: 'Change the background to a beautiful sunset over water' },
  { label: 'Стилизовать', prompt: 'Transform this image into a vibrant illustration style' },
  { label: 'Добавить элемент', prompt: 'Add soft bokeh lights in the background' },
  { label: 'Улучшить', prompt: 'Enhance image quality, improve lighting and colors' },
]

const historyLabel = computed(() => {
  if (promptHistory.value.length === 0) return ''
  return `${historyIndex.value + 1}/${promptHistory.value.length}`
})
const canGoBack = computed(() => historyIndex.value > 0)
const canGoForward = computed(() => historyIndex.value < promptHistory.value.length - 1)

function goBack() {
  if (!canGoBack.value) return
  historyIndex.value--
  prompt.value = promptHistory.value[historyIndex.value]
}
function goForward() {
  if (!canGoForward.value) return
  historyIndex.value++
  prompt.value = promptHistory.value[historyIndex.value]
}

// Load history from DB
onMounted(async () => {
  if (!props.postId) return
  try {
    const res = await http.get<{ history: any[] }>(`/ai/prompt-history/${props.postId}`)
    const imagePrompts = (res.history || []).filter((h: any) => h.type === 'image').map((h: any) => h.prompt)
    if (imagePrompts.length > 0) {
      promptHistory.value = imagePrompts
      historyIndex.value = imagePrompts.length - 1
      prompt.value = imagePrompts[imagePrompts.length - 1]
    }
  } catch {}
})

// AI Enhance — берёт простой текст и делает детальный промпт
async function enhancePrompt() {
  if (!prompt.value.trim() || enhancing.value) return
  enhancing.value = true
  try {
    const res = await http.post<{ enhancedPrompt: string }>('/ai/enhance-image-prompt', {
      prompt: prompt.value,
      aspectRatio: '9:16',
      businessId: props.businessId,
      mode: 'edit',
    })
    prompt.value = res.enhancedPrompt
    // Save to history
    promptHistory.value.push(res.enhancedPrompt)
    historyIndex.value = promptHistory.value.length - 1
    // Persist in DB
    if (props.postId) {
      http.post('/ai/generate-edit-prompt', {
        businessId: props.businessId,
        postId: props.postId,
        template: res.enhancedPrompt,
      }).catch(() => {}) // fire and forget
    }
  } catch (e: any) { toast.error('Ошибка: ' + (e.message || e)) }
  finally { enhancing.value = false }
}

// Submit for background processing
function submit() {
  if (!prompt.value.trim()) return
  emit('submitted', {
    prompt: prompt.value,
    model: selectedModel.value,
    mediaId: props.mediaId,
  })
  emit('close')
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

        <!-- Template pills — простая подстановка текста -->
        <div>
          <label class="block text-sm font-medium mb-1.5">Шаблоны</label>
          <div class="flex flex-wrap gap-1.5">
            <button v-for="t in EDIT_TEMPLATES" :key="t.label" @click="prompt = t.prompt"
              class="px-2.5 py-1 rounded-full text-xs font-medium bg-purple-100 dark:bg-purple-900/50 text-purple-700 dark:text-purple-300 hover:bg-purple-200 dark:hover:bg-purple-800 transition-colors">
              {{ t.label }}
            </button>
          </div>
        </div>

        <!-- Prompt + history + enhance -->
        <div>
          <div class="flex items-center justify-between mb-1">
            <label class="block text-sm font-medium">Что изменить?</label>
            <div v-if="promptHistory.length > 0" class="flex items-center gap-1">
              <button @click="goBack" :disabled="!canGoBack"
                class="p-0.5 rounded hover:bg-gray-100 dark:hover:bg-gray-800 disabled:opacity-30">
                <ChevronLeft :size="16" class="text-gray-500" />
              </button>
              <span class="text-xs text-gray-400 min-w-[28px] text-center">{{ historyLabel }}</span>
              <button @click="goForward" :disabled="!canGoForward"
                class="p-0.5 rounded hover:bg-gray-100 dark:hover:bg-gray-800 disabled:opacity-30">
                <ChevronRight :size="16" class="text-gray-500" />
              </button>
            </div>
          </div>
          <textarea v-model="prompt" rows="3" placeholder="Замени фон на закат над морем..."
            class="w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 focus:ring-2 focus:ring-purple-500 text-sm" />
          <!-- Enhance button — под textarea -->
          <button @click="enhancePrompt" :disabled="enhancing || !prompt.trim()"
            class="mt-1.5 flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium border border-purple-300 dark:border-purple-700 text-purple-600 dark:text-purple-400 hover:bg-purple-50 dark:hover:bg-purple-950 disabled:opacity-50 transition-colors">
            <Loader2 v-if="enhancing" :size="14" class="animate-spin" /><Sparkles v-else :size="14" />
            {{ enhancing ? 'Улучшаю...' : 'Улучшить промпт' }}
          </button>
        </div>
      </div>

      <div class="flex justify-end gap-2 mt-5">
        <button @click="emit('close')" class="px-4 py-2 rounded-lg text-sm text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800">
          Отмена
        </button>
        <button @click="submit" :disabled="!prompt.trim() || enhancing"
          class="flex items-center gap-2 px-4 py-2 rounded-lg bg-purple-600 hover:bg-purple-700 text-white text-sm font-medium disabled:opacity-50">
          <Sparkles :size="16" />
          Применить
        </button>
      </div>
    </div>
  </div>
</template>
