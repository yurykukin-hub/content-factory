<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { http } from '@/api/client'
import { useToast } from '@/composables/useToast'
import { useBusinessesStore } from '@/stores/businesses'
import BusinessFilter from '@/components/BusinessFilter.vue'
import VsModeTabs from '@/components/video/VsModeTabs.vue'
import VsCharacterCarousel from '@/components/video/VsCharacterCarousel.vue'
import VsPromptArea from '@/components/video/VsPromptArea.vue'
import VsBottomBar from '@/components/video/VsBottomBar.vue'
import VsGallery from '@/components/video/VsGallery.vue'
import VsConstructorDrawer from '@/components/video/VsConstructorDrawer.vue'
import { Video } from 'lucide-vue-next'

const toast = useToast()
const businesses = useBusinessesStore()
const selectedBizId = ref<string | null>(businesses.currentBusinessId)

// --- State ---
const prompt = ref('')
const enhancing = ref(false)
const mergingRefs = ref(false)
const generating = ref(false)
const promptHistory = ref<string[]>([])
const historyIndex = ref(-1)
const showConstructor = ref(false)

// Settings
const duration = ref(5)
const audio = ref(true)
const inputMode = ref<'text' | 'frames' | 'references'>('text')

// Frames
const firstFrame = ref<{ url: string; thumbUrl?: string | null; filename: string } | null>(null)
const lastFrame = ref<{ url: string; thumbUrl?: string | null; filename: string } | null>(null)

// References
const refImages = ref<{ url: string; thumbUrl?: string | null; filename: string; role: string }[]>([])

// Characters
interface CharacterRef { id: string; name: string; type: string; referenceMedia?: { url: string; thumbUrl: string | null } | null }
const characters = ref<CharacterRef[]>([])
const selectedCharacterId = ref<string | null>(null)

// Prompt library
interface PromptEntry { id: string; prompt: string; resultUrl: string | null; rating: number | null; tags: string[]; metadata: any; createdAt: string }
const savedPrompts = ref<PromptEntry[]>([])

// Generated videos
interface GeneratedVideo {
  id: string; url: string; filename: string; durationSec: number | null
  aiModel: string | null; aiCostUsd: number | null; altText: string | null; createdAt: string
}
const generatedVideos = ref<GeneratedVideo[]>([])

// --- Pricing ---
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

// --- Templates ---
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

// --- API functions ---

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

async function loadSavedPrompts() {
  if (!selectedBizId.value) return
  try { savedPrompts.value = await http.get<PromptEntry[]>(`/prompt-library?businessId=${selectedBizId.value}&type=video`) } catch { savedPrompts.value = [] }
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
    // Auto-save to library
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

async function ratePrompt(id: string, rating: number) {
  try {
    await http.put(`/prompt-library/${id}`, { rating })
    const idx = savedPrompts.value.findIndex(p => p.id === id)
    if (idx !== -1) savedPrompts.value[idx].rating = rating
  } catch {}
}

function usePrompt(entry: PromptEntry) {
  prompt.value = entry.prompt
  toast.success('Промпт загружен')
}

function onBusinessChange() {
  loadCharacters()
  loadVideos()
  loadSavedPrompts()
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
    <BusinessFilter v-model="selectedBizId" @update:model-value="onBusinessChange" />

    <!-- Main 50/50 grid -->
    <div class="grid grid-cols-1 lg:grid-cols-2 gap-6">

      <!-- LEFT PANEL: Generator -->
      <div class="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 overflow-hidden flex flex-col lg:max-h-[calc(100vh-160px)]">
        <VsModeTabs v-model="inputMode" />
        <VsCharacterCarousel v-if="characters.length"
          :characters="characters" v-model="selectedCharacterId" />
        <div class="flex-1 overflow-y-auto">
          <VsPromptArea
            v-model="prompt"
            :input-mode="inputMode"
            :ref-images="refImages"
            :first-frame="firstFrame"
            :last-frame="lastFrame"
            :enhancing="enhancing"
            :merging-refs="mergingRefs"
            :prompt-history="promptHistory"
            :history-index="historyIndex"
            :templates="TEMPLATES"
            @enhance="enhance"
            @merge-references="mergeReferences"
            @history-back="historyBack"
            @history-forward="historyForward"
            @upload-frame="uploadFrame"
            @add-ref="addRef"
            @remove-ref="(idx) => refImages.splice(idx, 1)"
            @remove-frame="(w) => w === 'first' ? firstFrame = null : lastFrame = null"
            @open-constructor="showConstructor = true"
            @update-ref-role="(idx, role) => refImages[idx].role = role"
            @apply-template="(t) => prompt = t" />
        </div>
        <VsBottomBar
          :duration="duration"
          :audio="audio"
          :cost-rub="costRub"
          :cost-usd="costUsd"
          :generating="generating"
          :can-generate="!!prompt.trim() && !!selectedBizId"
          :input-mode="inputMode"
          @update:duration="duration = $event"
          @update:audio="audio = $event"
          @generate="generate" />
      </div>

      <!-- RIGHT PANEL: Gallery -->
      <VsGallery
        :videos="generatedVideos"
        :saved-prompts="savedPrompts"
        @use-prompt="usePrompt"
        @rate-prompt="ratePrompt" />
    </div>

    <!-- Constructor Drawer -->
    <VsConstructorDrawer
      v-model:visible="showConstructor"
      v-model="prompt"
      :reference-images="inputMode === 'references' ? refImages : []" />
  </div>
</template>
