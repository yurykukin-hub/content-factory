<script setup lang="ts">
defineOptions({ name: 'VideoStudioView' })
import { ref, computed, onMounted } from 'vue'
import { http } from '@/api/client'
import { useToast } from '@/composables/useToast'
import { useBusinessesStore } from '@/stores/businesses'
import VsModeTabs from '@/components/video/VsModeTabs.vue'
import VsCharacterCarousel from '@/components/video/VsCharacterCarousel.vue'
import VsPromptArea from '@/components/video/VsPromptArea.vue'
import VsSettingsPanel from '@/components/video/VsSettingsPanel.vue'
import VsGallery from '@/components/video/VsGallery.vue'
import VsConstructorDrawer from '@/components/video/VsConstructorDrawer.vue'
import MediaPickerModal from '@/components/MediaPickerModal.vue'
import { Video, ChevronDown } from 'lucide-vue-next'

const toast = useToast()
const businesses = useBusinessesStore()
const selectedBizId = ref<string | null>(businesses.currentBusinessId)

// --- Business dropdown ---
const showBizDropdown = ref(false)
const currentBizName = computed(() => businesses.businesses.find(b => b.id === selectedBizId.value)?.name || 'Выберите проект')
function selectBiz(id: string) {
  selectedBizId.value = id
  businesses.setCurrent(id)
  showBizDropdown.value = false
  onBusinessChange()
}

// --- State ---
const prompt = ref('')
const enhancing = ref(false)
const generating = ref(false)
const promptHistory = ref<string[]>([])
const historyIndex = ref(-1)
const showConstructor = ref(false)

// Settings
const duration = ref(5)
const audio = ref(true)
const resolution = ref<'480p' | '720p'>('720p')
const aspectRatio = ref<'9:16' | '1:1' | '16:9'>('9:16')
const inputMode = ref<'text' | 'frames' | 'references'>('text')

// Frames
const firstFrame = ref<{ url: string; thumbUrl?: string | null; filename: string } | null>(null)
const lastFrame = ref<{ url: string; thumbUrl?: string | null; filename: string } | null>(null)

// References (simplified — no roles, with altText for preview)
const refImages = ref<{ url: string; thumbUrl?: string | null; filename: string; altText?: string | null }[]>([])
const showMediaPicker = ref(false)
const showCharacterPicker = ref(false)

// Characters
interface CharacterRef { id: string; name: string; type: string; description?: string | null; style?: string | null; referenceMedia?: { url: string; thumbUrl: string | null } | null }
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

// AI templates
interface AiTemplate { emoji: string; name: string; prompt: string }
const aiTemplates = ref<AiTemplate[]>([])
const loadingTemplates = ref(false)
const templatesLoaded = ref(false)

// Prompt area ref (for badge insertion)
const vsPromptAreaRef = ref<InstanceType<typeof VsPromptArea> | null>(null)

// --- Pricing (480p/720p) ---
const PRICING = {
  '480p': { withImage: 11.5, textOnly: 19 },
  '720p': { withImage: 25, textOnly: 41 },
} as const
const CREDIT_PRICE = 0.005
const AUDIO_MULT = 2.0
const USD_RUB = 95

const costRub = computed(() => {
  const hasImg = inputMode.value !== 'text' && (firstFrame.value || refImages.value.length > 0)
  const tier = PRICING[resolution.value]
  const cps = hasImg ? tier.withImage : tier.textOnly
  const base = cps * duration.value * CREDIT_PRICE
  const usd = audio.value ? base * AUDIO_MULT : base
  return Math.round(usd * USD_RUB)
})

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

async function loadAiTemplates() {
  if (templatesLoaded.value || !selectedBizId.value) return
  loadingTemplates.value = true
  try {
    const res = await http.post<{ suggestions: AiTemplate[] }>('/ai/suggest-video-templates', {
      businessId: selectedBizId.value,
    })
    aiTemplates.value = res.suggestions
    templatesLoaded.value = true
  } catch { /* silent */ }
  finally { loadingTemplates.value = false }
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
      duration: duration.value, aspectRatio: aspectRatio.value,
      resolution: resolution.value, generateAudio: audio.value,
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
    const costUsd = (() => {
      const hasImg = inputMode.value !== 'text' && (firstFrame.value || refImages.value.length > 0)
      const tier = PRICING[resolution.value]
      const cps = hasImg ? tier.withImage : tier.textOnly
      const base = cps * duration.value * CREDIT_PRICE
      return audio.value ? base * AUDIO_MULT : base
    })()
    http.post('/prompt-library', {
      businessId: selectedBizId.value, type: 'video', prompt: prompt.value,
      resultUrl: result.mediaFile.url,
      metadata: { duration: duration.value, model: 'bytedance/seedance-2', resolution: resolution.value, cost: costUsd, audio: audio.value, inputMode: inputMode.value },
    }).catch(() => {})
    toast.success(`Видео готово (${duration.value} сек)`)
  } catch (e: any) { toast.error(e.message || 'Ошибка генерации') }
  finally { generating.value = false }
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
    addRefImage({ url: m.url, thumbUrl: m.thumbUrl, filename: m.filename, altText: m.altText || null })
  } catch { toast.error('Ошибка загрузки') }
  input.value = ''
}

function addRefFromLibrary(file: { url: string; thumbUrl: string | null; filename: string; altText?: string | null }) {
  if (refImages.value.length >= 9) return
  addRefImage({ url: file.url, thumbUrl: file.thumbUrl, filename: file.filename, altText: file.altText || null })
  showMediaPicker.value = false
}

function addRefFromCharacter(char: CharacterRef) {
  if (refImages.value.length >= 9 || !char.referenceMedia) return
  addRefImage({
    url: char.referenceMedia.url,
    thumbUrl: char.referenceMedia.thumbUrl,
    filename: char.name,
    altText: char.description || null,
  })
  showCharacterPicker.value = false
}

function addRefImage(img: { url: string; thumbUrl?: string | null; filename: string; altText?: string | null }) {
  refImages.value.push(img)
  const idx = refImages.value.length
  vsPromptAreaRef.value?.insertBadge({
    badgeType: 'image', id: `img_${idx}`, name: `Image${idx}`, thumbUrl: img.thumbUrl || null,
  })
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

function onCharacterSelect(id: string | null) {
  selectedCharacterId.value = id
  if (id) {
    const char = characters.value.find(c => c.id === id)
    if (char) {
      vsPromptAreaRef.value?.insertBadge({
        badgeType: 'character',
        id: char.id,
        name: char.name,
        thumbUrl: char.referenceMedia?.thumbUrl || char.referenceMedia?.url || null,
      })
    }
  }
}

function onBusinessChange() {
  loadCharacters()
  loadVideos()
  loadSavedPrompts()
  templatesLoaded.value = false
  aiTemplates.value = []
}

onMounted(() => { loadCharacters(); loadVideos(); loadSavedPrompts() })
</script>

<template>
  <div>
    <!-- Header with inline business dropdown -->
    <div class="flex items-center justify-between mb-4">
      <div class="flex items-center gap-3">
        <h1 class="text-xl md:text-2xl font-bold flex items-center gap-2">
          <Video :size="24" class="text-emerald-500" />
          Видео-студия
        </h1>

        <!-- Business dropdown -->
        <div v-if="businesses.businesses.length > 1" class="relative">
          <button @click="showBizDropdown = !showBizDropdown"
            class="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-gray-200 dark:border-gray-700 text-sm hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors">
            <span class="truncate max-w-[160px]">{{ currentBizName }}</span>
            <ChevronDown :size="14" :class="['transition-transform', showBizDropdown ? 'rotate-180' : '']" />
          </button>
          <!-- Backdrop -->
          <div v-if="showBizDropdown" class="fixed inset-0 z-10" @click="showBizDropdown = false" />
          <!-- Menu -->
          <div v-if="showBizDropdown"
            class="absolute top-full left-0 mt-1 min-w-[200px] bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-xl shadow-lg z-20 py-1 overflow-hidden">
            <button v-for="biz in businesses.businesses" :key="biz.id"
              @click="selectBiz(biz.id)"
              :class="[
                'w-full text-left px-3 py-2 text-sm hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors',
                selectedBizId === biz.id ? 'text-emerald-600 dark:text-emerald-400 font-medium bg-emerald-50 dark:bg-emerald-900/20' : 'text-gray-700 dark:text-gray-300'
              ]">
              {{ biz.name }}
            </button>
          </div>
        </div>
      </div>
    </div>

    <!-- Main 50/50 grid -->
    <div class="grid grid-cols-1 lg:grid-cols-2 gap-6">

      <!-- LEFT PANEL: Generator -->
      <div class="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 overflow-hidden flex flex-col lg:max-h-[calc(100vh-140px)]">
        <VsModeTabs v-model="inputMode" />
        <VsCharacterCarousel v-if="characters.length"
          :characters="characters"
          :model-value="selectedCharacterId"
          @update:model-value="onCharacterSelect" />
        <div class="flex-1 overflow-y-auto">
          <VsPromptArea
            ref="vsPromptAreaRef"
            v-model="prompt"
            :input-mode="inputMode"
            :ref-images="refImages"
            :first-frame="firstFrame"
            :last-frame="lastFrame"
            :enhancing="enhancing"
            :prompt-history="promptHistory"
            :history-index="historyIndex"
            :templates="aiTemplates"
            :loading-templates="loadingTemplates"
            @enhance="enhance"
            @history-back="historyBack"
            @history-forward="historyForward"
            @upload-frame="uploadFrame"
            @add-ref="addRef"
            @add-ref-from-library="showMediaPicker = true"
            @add-ref-from-characters="showCharacterPicker = true"
            @remove-ref="(idx) => refImages.splice(idx, 1)"
            @remove-frame="(w) => w === 'first' ? firstFrame = null : lastFrame = null"
            @open-constructor="showConstructor = true"
            @apply-template="(t) => prompt = t"
            @load-templates="loadAiTemplates" />
        </div>
        <VsSettingsPanel
          :duration="duration"
          :audio="audio"
          :resolution="resolution"
          :aspect-ratio="aspectRatio"
          :cost-rub="costRub"
          :generating="generating"
          :can-generate="!!prompt.trim() && !!selectedBizId"
          @update:duration="duration = $event"
          @update:audio="audio = $event"
          @update:resolution="resolution = $event"
          @update:aspect-ratio="aspectRatio = $event"
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

    <!-- Media Picker Modal -->
    <MediaPickerModal
      :visible="showMediaPicker"
      :business-id="selectedBizId || ''"
      @close="showMediaPicker = false"
      @selected="(f: any) => addRefFromLibrary(f)" />

    <!-- Character Picker Modal -->
    <Teleport to="body">
      <div v-if="showCharacterPicker" class="fixed inset-0 z-50 flex items-center justify-center bg-black/60" @click.self="showCharacterPicker = false">
        <div class="bg-white dark:bg-gray-900 rounded-2xl shadow-2xl max-w-md w-full mx-4 overflow-hidden">
          <div class="px-4 py-3 border-b border-gray-200 dark:border-gray-800 flex items-center justify-between">
            <h3 class="text-sm font-bold">Выбрать из референсов</h3>
            <button @click="showCharacterPicker = false" class="p-1 text-gray-400 hover:text-gray-600">&#10005;</button>
          </div>
          <div class="p-4 max-h-80 overflow-y-auto">
            <div v-if="!characters.length" class="text-center text-sm text-gray-400 py-8">Нет референсов</div>
            <div v-else class="grid grid-cols-3 gap-3">
              <button v-for="c in characters.filter(ch => ch.referenceMedia)" :key="c.id"
                @click="addRefFromCharacter(c)"
                class="flex flex-col items-center gap-1.5 p-2 rounded-xl border border-gray-200 dark:border-gray-700 hover:border-emerald-400 dark:hover:border-emerald-600 transition-colors">
                <img :src="c.referenceMedia!.thumbUrl || c.referenceMedia!.url"
                  class="w-16 h-16 rounded-lg object-cover" />
                <span class="text-[10px] font-medium truncate max-w-full">{{ c.name }}</span>
              </button>
            </div>
          </div>
        </div>
      </div>
    </Teleport>
  </div>
</template>
