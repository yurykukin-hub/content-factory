<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { http } from '@/api/client'
import { useToast } from '@/composables/useToast'
import { useBusinessesStore } from '@/stores/businesses'
import { formatDate } from '@/composables/useFormatters'
import BusinessFilter from '@/components/BusinessFilter.vue'
import PromptConstructor from '@/components/video/PromptConstructor.vue'
import {
  Video, Sparkles, Loader2, Wand2, ChevronLeft, ChevronRight, ChevronDown, ChevronUp,
  Image, Trash2, Plus, Play, Download, UserCircle, Volume2, VolumeX,
  PenTool, Type,
} from 'lucide-vue-next'

const toast = useToast()
const businesses = useBusinessesStore()
const selectedBizId = ref<string | null>(businesses.currentBusinessId)

// Prompt
const promptMode = ref<'constructor' | 'freetext'>('constructor')
const prompt = ref('')
const enhancing = ref(false)
const mergingRefs = ref(false)
const generating = ref(false)
const promptHistory = ref<string[]>([])
const historyIndex = ref(-1)

// Settings
const duration = ref(5)
const audio = ref(true)
const inputMode = ref<'text' | 'frames' | 'references'>('text')

// Frames
const firstFrame = ref<{ url: string; thumbUrl?: string | null; filename: string } | null>(null)
const lastFrame = ref<{ url: string; thumbUrl?: string | null; filename: string } | null>(null)

// References (с ролями для конструктора промптов)
const refImages = ref<{ url: string; thumbUrl?: string | null; filename: string; role: string }[]>([])

// Characters
interface CharacterRef { id: string; name: string; type: string; referenceMedia?: { url: string; thumbUrl: string | null } | null }
const characters = ref<CharacterRef[]>([])
const selectedCharacterId = ref<string | null>(null)

// Prompt library
interface PromptEntry { id: string; prompt: string; resultUrl: string | null; rating: number | null; tags: string[]; metadata: any; createdAt: string }
const savedPrompts = ref<PromptEntry[]>([])
const showLibrary = ref(false)

async function loadSavedPrompts() {
  if (!selectedBizId.value) return
  try { savedPrompts.value = await http.get<PromptEntry[]>(`/prompt-library?businessId=${selectedBizId.value}&type=video`) } catch { savedPrompts.value = [] }
}

async function ratePrompt(id: string, rating: number) {
  try {
    await http.put(`/prompt-library/${id}`, { rating })
    const idx = savedPrompts.value.findIndex(p => p.id === id)
    if (idx !== -1) savedPrompts.value[idx].rating = rating
  } catch {}
}

function usePrompt(entry: PromptEntry) {
  prompt.value = entry.prompt
  showLibrary.value = false
  toast.success('Промпт загружен')
}

// Generated videos
interface GeneratedVideo {
  id: string; url: string; filename: string; durationSec: number | null
  aiModel: string | null; aiCostUsd: number | null; altText: string | null; createdAt: string
}
const generatedVideos = ref<GeneratedVideo[]>([])
const activeVideoUrl = ref<string | null>(null)

// Pricing
const CREDITS_PER_SEC = 41
const CREDITS_PER_SEC_IMG = 25
const CREDIT_PRICE = 0.005
const AUDIO_MULT = 2.0
const USD_RUB = 95

const costUsd = computed(() => {
  const hasImg = inputMode.value !== 'text' && (firstFrame.value || refImages.value.length > 0)
  const cps = hasImg ? CREDITS_PER_SEC_IMG : CREDITS_PER_SEC
  const base = cps * duration.value * CREDIT_PRICE
  return audio.value ? base * AUDIO_MULT : base
})
const costRub = computed(() => Math.round(costUsd.value * USD_RUB))

const TEMPLATES = [
  { label: 'SUP рассвет', prompt: 'SUP-борд на спокойной воде на рассвете, плавное отражение солнца, лёгкий туман' },
  { label: 'Динамика', prompt: 'Быстрое движение камеры вдоль набережной, энергичная атмосфера, солнечный день' },
  { label: 'Природа', prompt: 'Спокойный лесной пейзаж с озером, птицы, плавное панорамирование' },
  { label: 'Продукт 360°', prompt: 'Крупный план продукта, медленное вращение на 360°, студийный свет' },
  { label: 'Ивент', prompt: 'Концертная площадка с цветным освещением, энергичная толпа, динамичные переходы' },
  { label: 'Кинематограф', prompt: 'Кинематографичный закат над городом, тёплые тона, медленный дрон-пролёт' },
  { label: 'Портрет', prompt: 'Портрет человека крупным планом, мягкое боке, естественный свет, лёгкая улыбка' },
  { label: 'Еда', prompt: 'Аппетитное блюдо крупным планом, пар поднимается, тёплое освещение, shallow depth of field' },
]

async function loadCharacters() {
  if (!selectedBizId.value) return
  try { characters.value = await http.get<CharacterRef[]>(`/businesses/${selectedBizId.value}/characters`) } catch { characters.value = [] }
}

async function loadVideos() {
  if (!selectedBizId.value) return
  try {
    const all = await http.get<any[]>(`/media/library/${selectedBizId.value}`)
    generatedVideos.value = all
      .filter((f: any) => f.mimeType?.startsWith('video/') && f.aiModel)
      .map((f: any) => ({ id: f.id, url: f.url, filename: f.filename, durationSec: f.durationSec, aiModel: f.aiModel, aiCostUsd: f.aiCostUsd, altText: f.altText, createdAt: f.createdAt }))
  } catch { generatedVideos.value = [] }
}

async function enhance() {
  if (!prompt.value.trim() || !selectedBizId.value) return
  enhancing.value = true
  try {
    const res = await http.post<{ enhancedPrompt: string }>('/ai/enhance-video-prompt', {
      prompt: prompt.value, duration: duration.value, businessId: selectedBizId.value,
    })
    prompt.value = res.enhancedPrompt
    promptHistory.value.push(res.enhancedPrompt)
    historyIndex.value = promptHistory.value.length - 1
    toast.success('Промпт улучшен')
  } catch (e: any) { toast.error(e.message || 'Ошибка') }
  finally { enhancing.value = false }
}

async function generate() {
  if (!prompt.value.trim() || !selectedBizId.value) return
  generating.value = true
  try {
    const payload: any = {
      businessId: selectedBizId.value, prompt: prompt.value,
      duration: duration.value, aspectRatio: '9:16', generateAudio: audio.value,
    }
    if (inputMode.value === 'frames' && firstFrame.value) {
      payload.firstFrameUrl = firstFrame.value.url
      if (lastFrame.value) payload.lastFrameUrl = lastFrame.value.url
    } else if (inputMode.value === 'references' && refImages.value.length) {
      payload.referenceImageUrls = refImages.value.map(r => r.url)
    }

    const result = await http.post<{ mediaFile: GeneratedVideo }>('/ai/generate-video', payload)
    promptHistory.value.push(prompt.value)
    historyIndex.value = promptHistory.value.length - 1
    generatedVideos.value.unshift(result.mediaFile)
    activeVideoUrl.value = result.mediaFile.url
    // Auto-save в библиотеку промптов
    http.post('/prompt-library', {
      businessId: selectedBizId.value, type: 'video', prompt: prompt.value,
      resultUrl: result.mediaFile.url,
      metadata: { duration: duration.value, model: 'bytedance/seedance-2', cost: costUsd.value, audio: audio.value, inputMode: inputMode.value },
    }).catch(() => {})
    toast.success(`Видео готово (${duration.value} сек)`)
  } catch (e: any) { toast.error(e.message || 'Ошибка генерации') }
  finally { generating.value = false }
}

async function mergeReferences() {
  if (!selectedBizId.value || !refImages.value.length) return
  mergingRefs.value = true
  try {
    const res = await http.post<{ mergedPrompt: string }>('/ai/merge-references', {
      businessId: selectedBizId.value,
      prompt: prompt.value || '',
      imageUrls: refImages.value.map(r => r.url),
    })
    prompt.value = res.mergedPrompt
    promptHistory.value.push(res.mergedPrompt)
    historyIndex.value = promptHistory.value.length - 1
    toast.success('AI распознал фото и вставил теги')
  } catch (e: any) { toast.error(e.message || 'Ошибка') }
  finally { mergingRefs.value = false }
}

function historyBack() { if (historyIndex.value > 0) { historyIndex.value--; prompt.value = promptHistory.value[historyIndex.value] } }
function historyForward() { if (historyIndex.value < promptHistory.value.length - 1) { historyIndex.value++; prompt.value = promptHistory.value[historyIndex.value] } }

async function uploadFrame(event: Event, which: 'first' | 'last') {
  const input = event.target as HTMLInputElement
  if (!input.files?.length || !selectedBizId.value) return
  const fd = new FormData()
  fd.append('file', input.files[0])
  fd.append('businessId', selectedBizId.value)
  fd.append('tags', JSON.stringify(['video-frame']))
  try {
    const res = await fetch('/api/media/upload', { method: 'POST', credentials: 'include', body: fd })
    if (!res.ok) throw new Error()
    const m = await res.json()
    const frame = { url: m.url, thumbUrl: m.thumbUrl, filename: m.filename }
    if (which === 'first') firstFrame.value = frame; else lastFrame.value = frame
  } catch { toast.error('Ошибка загрузки') }
  input.value = ''
}

async function addRef(event: Event) {
  const input = event.target as HTMLInputElement
  if (!input.files?.length || !selectedBizId.value || refImages.value.length >= 9) return
  const fd = new FormData()
  fd.append('file', input.files[0])
  fd.append('businessId', selectedBizId.value)
  fd.append('tags', JSON.stringify(['video-reference']))
  try {
    const res = await fetch('/api/media/upload', { method: 'POST', credentials: 'include', body: fd })
    if (!res.ok) throw new Error()
    const m = await res.json()
    refImages.value.push({ url: m.url, thumbUrl: m.thumbUrl, filename: m.filename, role: '' })
  } catch { toast.error('Ошибка загрузки') }
  input.value = ''
}

onMounted(() => { loadCharacters(); loadVideos(); loadSavedPrompts() })
</script>

<template>
  <div>
    <!-- Header -->
    <div class="flex items-center justify-between mb-4">
      <h1 class="text-xl md:text-2xl font-bold flex items-center gap-2">
        <Video :size="24" class="text-emerald-500" />
        Видео-студия
      </h1>
    </div>
    <BusinessFilter v-model="selectedBizId" @update:model-value="() => { loadCharacters(); loadVideos() }" />

    <div class="grid grid-cols-1 lg:grid-cols-3 gap-6">

      <!-- LEFT: Генератор (2/3) -->
      <div class="lg:col-span-2 space-y-4">

        <!-- Шаблоны -->
        <div class="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 p-4">
          <label class="block text-xs font-medium text-gray-500 mb-2">Шаблоны промптов</label>
          <div class="flex flex-wrap gap-1.5">
            <button v-for="t in TEMPLATES" :key="t.label" @click="prompt = t.prompt"
              class="px-2.5 py-1.5 rounded-full text-xs font-medium bg-emerald-100 dark:bg-emerald-900/50 text-emerald-700 dark:text-emerald-300 hover:bg-emerald-200 dark:hover:bg-emerald-800 transition-colors">
              {{ t.label }}
            </button>
          </div>
        </div>

        <!-- Промпт -->
        <div class="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 p-4">
          <!-- Mode toggle + history -->
          <div class="flex items-center justify-between mb-3 flex-wrap gap-2">
            <label class="text-sm font-semibold">Промпт</label>
            <div class="flex items-center gap-3">
              <div class="flex border border-emerald-300 dark:border-emerald-700 rounded-lg overflow-hidden">
                <button @click="promptMode = 'constructor'"
                  :class="['flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium transition-colors',
                    promptMode === 'constructor' ? 'bg-emerald-600 text-white' : 'text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-800']">
                  <PenTool :size="12" /> Конструктор
                </button>
                <button @click="promptMode = 'freetext'"
                  :class="['flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium transition-colors',
                    promptMode === 'freetext' ? 'bg-emerald-600 text-white' : 'text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-800']">
                  <Type :size="12" /> Свободный
                </button>
              </div>
              <div v-if="promptHistory.length" class="flex items-center gap-0.5">
                <button @click="historyBack" :disabled="historyIndex <= 0" class="p-0.5 rounded hover:bg-gray-100 dark:hover:bg-gray-800 disabled:opacity-30"><ChevronLeft :size="14" /></button>
                <span class="text-[10px] text-gray-400 min-w-[24px] text-center">{{ historyIndex + 1 }}/{{ promptHistory.length }}</span>
                <button @click="historyForward" :disabled="historyIndex >= promptHistory.length - 1" class="p-0.5 rounded hover:bg-gray-100 dark:hover:bg-gray-800 disabled:opacity-30"><ChevronRight :size="14" /></button>
              </div>
            </div>
          </div>

          <!-- Constructor mode -->
          <div v-if="promptMode === 'constructor'" class="mb-3">
            <PromptConstructor v-model="prompt" :reference-images="inputMode === 'references' ? refImages : []" />
          </div>

          <!-- Assembled/free prompt -->
          <textarea v-model="prompt" :rows="promptMode === 'constructor' ? 3 : 6"
            :placeholder="promptMode === 'constructor' ? 'Промпт собирается автоматически. Можете дополнить вручную.' : 'Опишите видео подробно: объект, действие, камера, освещение, настроение...'"
            class="w-full px-4 py-3 rounded-xl border border-gray-300 dark:border-gray-700 bg-gray-50 dark:bg-gray-800 focus:ring-2 focus:ring-emerald-500 text-sm resize-none" />
          <div class="flex items-center gap-2 mt-2">
            <button @click="enhance" :disabled="enhancing || !prompt.trim()"
              class="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium border border-emerald-300 dark:border-emerald-700 text-emerald-600 dark:text-emerald-400 hover:bg-emerald-50 dark:hover:bg-emerald-950 disabled:opacity-50 transition-colors">
              <Loader2 v-if="enhancing" :size="14" class="animate-spin" /><Wand2 v-else :size="14" />
              {{ enhancing ? 'Улучшаю...' : 'Улучшить промпт (AI)' }}
            </button>
          </div>
        </div>

        <!-- Входные изображения -->
        <div class="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 p-4">
          <label class="block text-sm font-semibold mb-2">Входные изображения</label>
          <!-- Mode -->
          <div class="flex gap-1.5 mb-3">
            <button v-for="m in [{ id: 'text', l: 'Без фото', d: '41 кр/с' }, { id: 'frames', l: 'Кадры (1-2)', d: '25 кр/с' }, { id: 'references', l: 'Референсы (до 9)', d: '25 кр/с' }]" :key="m.id"
              @click="inputMode = m.id as any"
              :class="['px-3 py-2 rounded-lg text-xs font-medium border transition-colors',
                inputMode === m.id
                  ? 'bg-emerald-100 dark:bg-emerald-900 text-emerald-700 dark:text-emerald-300 border-emerald-300 dark:border-emerald-700'
                  : 'bg-gray-50 dark:bg-gray-800 text-gray-500 border-gray-200 dark:border-gray-700 hover:border-emerald-300']">
              <div>{{ m.l }}</div>
              <div class="text-[9px] opacity-60 mt-0.5">{{ m.d }}</div>
            </button>
          </div>

          <!-- Frames -->
          <div v-if="inputMode === 'frames'" class="grid grid-cols-2 gap-3">
            <div>
              <div v-if="firstFrame" class="flex items-center gap-2 p-2.5 rounded-lg bg-emerald-50 dark:bg-emerald-900/30 border border-emerald-200 dark:border-emerald-800">
                <img :src="firstFrame.thumbUrl || firstFrame.url" class="w-12 h-12 rounded-lg object-cover" />
                <div class="flex-1 min-w-0"><div class="text-xs font-medium">Первый кадр</div><div class="text-[10px] text-gray-400 truncate">{{ firstFrame.filename }}</div></div>
                <button @click="firstFrame = null" class="p-1 text-gray-400 hover:text-red-500"><Trash2 :size="14" /></button>
              </div>
              <label v-else class="flex flex-col items-center gap-1.5 p-4 rounded-lg border-2 border-dashed border-gray-300 dark:border-gray-700 cursor-pointer hover:border-emerald-400">
                <Image :size="20" class="text-gray-400" /><span class="text-xs text-gray-500">Первый кадр</span>
                <input type="file" accept="image/*" class="hidden" @change="(e: Event) => uploadFrame(e, 'first')" />
              </label>
            </div>
            <div>
              <div v-if="lastFrame" class="flex items-center gap-2 p-2.5 rounded-lg bg-emerald-50 dark:bg-emerald-900/30 border border-emerald-200 dark:border-emerald-800">
                <img :src="lastFrame.thumbUrl || lastFrame.url" class="w-12 h-12 rounded-lg object-cover" />
                <div class="flex-1 min-w-0"><div class="text-xs font-medium">Последний кадр</div><div class="text-[10px] text-gray-400 truncate">{{ lastFrame.filename }}</div></div>
                <button @click="lastFrame = null" class="p-1 text-gray-400 hover:text-red-500"><Trash2 :size="14" /></button>
              </div>
              <label v-else class="flex flex-col items-center gap-1.5 p-4 rounded-lg border-2 border-dashed border-gray-300 dark:border-gray-700 cursor-pointer hover:border-emerald-400">
                <Image :size="20" class="text-gray-400" /><span class="text-xs text-gray-500">Последний кадр</span>
                <input type="file" accept="image/*" class="hidden" @change="(e: Event) => uploadFrame(e, 'last')" />
              </label>
            </div>
          </div>

          <!-- References с ролями -->
          <div v-if="inputMode === 'references'">
            <div class="flex flex-wrap gap-3 mb-2">
              <div v-for="(r, idx) in refImages" :key="idx" class="flex flex-col items-center gap-1">
                <div class="relative group w-20 h-20 rounded-xl overflow-hidden border-2 border-emerald-200 dark:border-emerald-800">
                  <img :src="r.thumbUrl || r.url" class="w-full h-full object-cover" />
                  <div class="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 flex items-center justify-center transition-opacity">
                    <button @click="refImages.splice(idx, 1)" class="p-1.5 bg-red-500/80 rounded-full"><Trash2 :size="12" class="text-white" /></button>
                  </div>
                  <span class="absolute bottom-0.5 left-0.5 px-1 py-0.5 bg-black/70 text-white text-[8px] rounded font-mono">@Image{{ idx + 1 }}</span>
                </div>
                <!-- Role selector -->
                <select v-model="r.role"
                  class="w-20 px-1 py-0.5 rounded text-[9px] bg-gray-100 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 text-center">
                  <option value="">Роль...</option>
                  <option value="face">Лицо</option>
                  <option value="background">Фон</option>
                  <option value="object">Объект</option>
                  <option value="style">Стиль</option>
                  <option value="outfit">Одежда</option>
                  <option value="pose">Поза</option>
                </select>
              </div>
              <label v-if="refImages.length < 9"
                class="w-20 h-20 rounded-xl border-2 border-dashed border-gray-300 dark:border-gray-700 flex flex-col items-center justify-center cursor-pointer hover:border-emerald-400 transition-colors">
                <Plus :size="18" class="text-gray-400" />
                <span class="text-[9px] text-gray-400 mt-1">{{ refImages.length }}/9</span>
                <input type="file" accept="image/*" class="hidden" @change="addRef" />
              </label>
            </div>
            <div v-if="refImages.length" class="flex items-center gap-2 mt-1">
              <button @click="mergeReferences" :disabled="mergingRefs"
                class="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-purple-600 hover:bg-purple-700 text-white disabled:opacity-50 transition-colors">
                <Loader2 v-if="mergingRefs" :size="12" class="animate-spin" /><Sparkles v-else :size="12" />
                {{ mergingRefs ? 'Распознаю фото...' : 'Вставить референсы (AI)' }}
              </button>
              <span class="text-[9px] text-gray-400">AI посмотрит на фото и вставит @Image теги в промпт</span>
            </div>
            <p v-else class="text-[10px] text-gray-400">Загрузи фото — AI распознает содержимое и вставит теги в промпт</p>
          </div>

          <div v-if="inputMode === 'text'" class="text-center py-4 text-xs text-gray-400">
            Видео генерируется только из текстового промпта
          </div>
        </div>

        <!-- Настройки + Генерация -->
        <div class="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 p-4">
          <div class="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-4">
            <!-- Duration -->
            <div>
              <label class="block text-xs font-medium text-gray-500 mb-1.5">Длительность: {{ duration }} сек</label>
              <input type="range" v-model.number="duration" min="4" max="15" step="1"
                class="w-full h-2 bg-gray-200 dark:bg-gray-700 rounded-lg appearance-none cursor-pointer accent-emerald-500" />
              <div class="flex justify-between text-[9px] text-gray-400 mt-0.5"><span>4с</span><span>15с</span></div>
            </div>
            <!-- Audio -->
            <div>
              <label class="block text-xs font-medium text-gray-500 mb-1.5">Звук</label>
              <label class="flex items-center gap-2 cursor-pointer">
                <div class="relative">
                  <input type="checkbox" v-model="audio" class="sr-only peer" />
                  <div class="w-10 h-5 bg-gray-200 dark:bg-gray-700 rounded-full peer peer-checked:bg-emerald-500 transition-colors"></div>
                  <div class="absolute left-0.5 top-0.5 w-4 h-4 bg-white rounded-full transition-transform peer-checked:translate-x-5 shadow-sm"></div>
                </div>
                <component :is="audio ? Volume2 : VolumeX" :size="14" class="text-gray-400" />
              </label>
            </div>
            <!-- Character -->
            <div v-if="characters.length">
              <label class="block text-xs font-medium text-gray-500 mb-1.5">Персонаж</label>
              <select v-model="selectedCharacterId" class="w-full px-2 py-1.5 rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 text-xs">
                <option :value="null">Без персонажа</option>
                <option v-for="c in characters" :key="c.id" :value="c.id">{{ c.name }}</option>
              </select>
            </div>
          </div>

          <!-- Price + Generate -->
          <div class="flex items-center justify-between p-3 rounded-xl bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700">
            <div class="flex items-center gap-3">
              <span class="px-2 py-0.5 bg-emerald-100 dark:bg-emerald-900/50 text-emerald-600 dark:text-emerald-400 rounded-lg text-[10px] font-medium">seedance-2</span>
              <span class="text-[10px] text-gray-400">720p · {{ inputMode === 'text' ? 'text→video' : 'img→video' }} · ~1-3 мин</span>
            </div>
            <div class="flex items-center gap-4">
              <div class="text-right">
                <div class="text-lg font-bold text-emerald-600 dark:text-emerald-400">{{ costRub }} ₽</div>
                <div class="text-[9px] text-gray-400">${{ costUsd.toFixed(2) }}</div>
              </div>
              <button @click="generate" :disabled="generating || !prompt.trim() || !selectedBizId"
                class="flex items-center gap-2 px-5 py-3 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-medium disabled:opacity-50 transition-colors">
                <Loader2 v-if="generating" :size="18" class="animate-spin" /><Video v-else :size="18" />
                {{ generating ? 'Генерация...' : 'Сгенерировать' }}
              </button>
            </div>
          </div>
        </div>
      </div>

      <!-- RIGHT: Результаты (1/3) -->
      <div class="space-y-4">
        <!-- Active video player -->
        <div v-if="activeVideoUrl" class="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 overflow-hidden">
          <video :src="activeVideoUrl" controls loop autoplay playsinline
            class="w-full" style="aspect-ratio: 9/16; object-fit: cover; background: #000;" />
        </div>
        <div v-else class="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 p-8 text-center" style="aspect-ratio: 9/16;">
          <div class="flex flex-col items-center justify-center h-full">
            <Video :size="48" class="text-gray-300 dark:text-gray-700 mb-3" />
            <p class="text-sm text-gray-400">Сгенерируйте видео</p>
            <p class="text-[10px] text-gray-400 mt-1">Результат появится здесь</p>
          </div>
        </div>

        <!-- History of generated videos -->
        <div v-if="generatedVideos.length" class="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 p-4">
          <h3 class="text-sm font-semibold mb-3">Сгенерированные видео</h3>
          <div class="space-y-2 max-h-96 overflow-y-auto">
            <div v-for="v in generatedVideos" :key="v.id"
              @click="activeVideoUrl = v.url"
              :class="['flex items-center gap-2.5 p-2 rounded-lg cursor-pointer transition-colors',
                activeVideoUrl === v.url ? 'bg-emerald-50 dark:bg-emerald-900/30 border border-emerald-200 dark:border-emerald-800' : 'hover:bg-gray-50 dark:hover:bg-gray-800']">
              <div class="w-10 h-10 rounded-lg bg-gray-200 dark:bg-gray-700 flex items-center justify-center shrink-0">
                <Play :size="14" class="text-gray-500" />
              </div>
              <div class="flex-1 min-w-0">
                <div class="text-[10px] text-gray-500 truncate" :title="v.altText || ''">{{ v.altText?.slice(0, 60) || v.filename }}</div>
                <div class="flex items-center gap-2 text-[9px] text-gray-400 mt-0.5">
                  <span v-if="v.durationSec">{{ v.durationSec }}с</span>
                  <span v-if="v.aiCostUsd">${{ v.aiCostUsd.toFixed(2) }}</span>
                  <span>{{ formatDate(v.createdAt) }}</span>
                </div>
              </div>
            </div>
          </div>
        </div>

        <!-- Prompt Library -->
        <div class="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 overflow-hidden">
          <button @click="showLibrary = !showLibrary" class="w-full flex items-center justify-between p-4 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors">
            <h3 class="text-sm font-semibold flex items-center gap-1.5">
              <Sparkles :size="14" class="text-purple-500" /> Библиотека промптов
              <span v-if="savedPrompts.length" class="text-[10px] text-gray-400 font-normal">({{ savedPrompts.length }})</span>
            </h3>
            <component :is="showLibrary ? ChevronUp : ChevronDown" :size="14" class="text-gray-400" />
          </button>
          <div v-if="showLibrary && savedPrompts.length" class="border-t border-gray-100 dark:border-gray-800 max-h-80 overflow-y-auto">
            <div v-for="entry in savedPrompts" :key="entry.id"
              class="p-3 border-b border-gray-100 dark:border-gray-800 last:border-0 hover:bg-gray-50 dark:hover:bg-gray-800/50 cursor-pointer transition-colors"
              @click="usePrompt(entry)">
              <p class="text-[11px] text-gray-600 dark:text-gray-400 line-clamp-2 mb-1.5">{{ entry.prompt }}</p>
              <div class="flex items-center justify-between">
                <div class="flex items-center gap-1">
                  <button v-for="star in 5" :key="star" @click.stop="ratePrompt(entry.id, star)"
                    :class="['text-[10px]', (entry.rating || 0) >= star ? 'text-amber-400' : 'text-gray-300 dark:text-gray-600']">★</button>
                </div>
                <div class="flex items-center gap-1.5 text-[9px] text-gray-400">
                  <span v-if="entry.metadata?.duration">{{ entry.metadata.duration }}с</span>
                  <span v-if="entry.metadata?.cost">${{ entry.metadata.cost.toFixed(2) }}</span>
                </div>
              </div>
            </div>
          </div>
          <div v-if="showLibrary && !savedPrompts.length" class="p-4 text-center text-xs text-gray-400 border-t border-gray-100 dark:border-gray-800">
            Промпты сохраняются автоматически при генерации
          </div>
        </div>
      </div>
    </div>
  </div>
</template>
