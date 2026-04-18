<script setup lang="ts">
/**
 * Photo Studio — AI image generation view.
 * Pattern follows SoundStudioView: 50/50 layout, sessions, SSE, auto-save.
 * Brand color: fuchsia (matching Content Factory).
 */
import { ref, computed, watch, onMounted, onBeforeUnmount } from 'vue'
import { ChevronDown, ChevronUp, Camera, Plus, Upload, FolderOpen, X, Sparkles, Loader2 } from 'lucide-vue-next'
import MediaPickerModal from '@/components/MediaPickerModal.vue'
import { http, TAB_ID } from '@/api/client'
import { useBusinessesStore } from '@/stores/businesses'
import { useAuthStore } from '@/stores/auth'
import { useToast } from '@/composables/useToast'
import { useRates } from '@/composables/useRates'

import PsSettingsPanel from '@/components/photo/PsSettingsPanel.vue'
import PsSessionBar from '@/components/photo/PsSessionBar.vue'
import PsGallery from '@/components/photo/PsGallery.vue'
import PsPromptTabs from '@/components/photo/PsPromptTabs.vue'
import PsAgentChat from '@/components/photo/PsAgentChat.vue'
import PsEnhanceMenu from '@/components/photo/PsEnhanceMenu.vue'
import PsPreGenModal from '@/components/photo/PsPreGenModal.vue'
import type { PhotoSession } from '@/components/photo/PsSessionBar.vue'
import type { AgentMessage } from '@/components/photo/PsAgentChat.vue'
import type { PhotoEnhanceMode } from '@/components/photo/PsEnhanceMenu.vue'

defineOptions({ name: 'PhotoStudioView' })

const businesses = useBusinessesStore()
const auth = useAuthStore()
const toast = useToast()
const { USD_RUB } = useRates()
const markupPercent = ref(50) // default, loaded from settings

// Load markup percent
http.get<{ usdRubRate: number; markupPercent: number }>('/settings/public')
  .then((data) => { if (data.markupPercent >= 0) markupPercent.value = data.markupPercent })
  .catch(() => {})

// --- Business selector ---
const selectedBizId = ref<string | null>(businesses.currentBusinessId)
const showBizDropdown = ref(false)
const currentBizName = computed(() =>
  businesses.businesses.find(b => b.id === selectedBizId.value)?.name || 'Выберите проект'
)
function selectBiz(id: string) {
  selectedBizId.value = id
  businesses.setCurrent(id)
  showBizDropdown.value = false
  onBusinessChange()
}

// --- Session state ---
const sessions = ref<PhotoSession[]>([])
const currentSessionId = ref<string | null>(null)

// --- Photo generation state ---
const prompt = ref('')
const photoModel = ref<'nano-banana-2' | 'nano-banana-pro'>('nano-banana-2')
const photoResolution = ref<'1K' | '2K' | '4K'>('1K')
const batchSize = ref<1 | 2 | 4>(1)
const photoAspectRatio = ref('1:1')
const selectedCharacterId = ref<string | null>(null)
const referenceImages = ref<{ url: string; thumbUrl?: string | null; filename: string; altText?: string | null }[]>([])
const showMediaPicker = ref(false)
const showAddMenu = ref(false)
const previewRef = ref<{ url: string; thumbUrl?: string | null; filename: string; altText?: string | null } | null>(null)
const describingPreview = ref(false)
const fileInputRef = ref<HTMLInputElement | null>(null)

// Max reference images per model
const maxRefs = computed(() => photoModel.value === 'nano-banana-pro' ? 8 : 14)

// --- Generation state ---
const generating = ref(false)
const generatingStartedAt = ref<string | null>(null)

// --- UI state ---
const activeTab = ref<'agent' | 'editor'>('editor')
const chatMessages = ref<AgentMessage[]>([])
const agentMode = ref<'simple' | 'advanced'>('simple')
const agentLoading = ref(false)
const enhancing = ref(false)
const showPreGenModal = ref(false)
const mobileGalleryOpen = ref(false)

// --- Results (from completed sessions) ---
const imageResults = ref<any[]>([])

// --- Pricing ---
const PHOTO_PRICING: Record<string, Record<string, number>> = {
  'nano-banana-2':   { '1K': 0.04, '2K': 0.06, '4K': 0.09 },
  'nano-banana-pro': { '1K': 0.07, '2K': 0.09, '4K': 0.12 },
}

const costUsd = computed(() => {
  const pricing = PHOTO_PRICING[photoModel.value]
  if (!pricing) return 0
  const base = pricing[photoResolution.value] || 0.04
  return base * batchSize.value
})

const costRub = computed(() => {
  const rub = costUsd.value * USD_RUB.value * (1 + markupPercent.value / 100)
  return Math.round(rub)
})

const canGenerate = computed(() => {
  if (!selectedBizId.value) return false
  return prompt.value.trim().length > 0
})

// --- Auto-save ---
let autoSaveTimer: ReturnType<typeof setTimeout> | null = null
let autoSavePaused = false

function scheduleAutoSave() {
  if (autoSavePaused) return
  if (autoSaveTimer) clearTimeout(autoSaveTimer)
  autoSaveTimer = setTimeout(saveSession, 2000)
}

function buildSavePayload() {
  return {
    title: prompt.value.slice(0, 40) || '',
    prompt: prompt.value,
    photoModel: photoModel.value,
    photoResolution: photoResolution.value,
    batchSize: batchSize.value,
    photoAspectRatio: photoAspectRatio.value,
    characterId: selectedCharacterId.value,
    referenceImages: referenceImages.value.length ? referenceImages.value : null,
    chatHistory: chatMessages.value.length ? chatMessages.value : null,
  }
}

async function saveSession() {
  if (!currentSessionId.value || autoSavePaused) return
  const current = sessions.value.find(s => s.id === currentSessionId.value)
  // Allow saving for draft (full save) and failed (chat only)
  if (current && current.status === 'generating' || current?.status === 'completed') return

  try {
    if (current?.status === 'failed') {
      // Only save chat for failed sessions
      await http.put(`/sessions/${currentSessionId.value}`, {
        chatHistory: chatMessages.value.length ? chatMessages.value : null,
      })
    } else {
      await http.put(`/sessions/${currentSessionId.value}`, buildSavePayload())
    }
  } catch {}
}

/** Flush pending save on page unload (F5, tab close) */
function flushBeforeUnload() {
  if (autoSaveTimer && currentSessionId.value) {
    clearTimeout(autoSaveTimer)
    autoSaveTimer = null
    const current = sessions.value.find(s => s.id === currentSessionId.value)
    if (current?.status === 'generating' || current?.status === 'completed') return
    const payload = current?.status === 'failed'
      ? { chatHistory: chatMessages.value.length ? chatMessages.value : null }
      : buildSavePayload()
    fetch(`/api/sessions/${currentSessionId.value}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', 'X-Tab-ID': TAB_ID },
      body: JSON.stringify(payload),
      credentials: 'include',
      keepalive: true,
    })
  }
}

watch([prompt, photoModel, photoResolution, batchSize, photoAspectRatio, referenceImages, chatMessages], scheduleAutoSave, { deep: true })

// --- Session CRUD ---
async function loadSessions() {
  if (!selectedBizId.value) return
  try {
    sessions.value = await http.get<PhotoSession[]>(`/sessions?businessId=${selectedBizId.value}&type=photo`)
  } catch {}
}

async function loadDraftSession() {
  if (!selectedBizId.value) return
  autoSavePaused = true
  // Try loading existing draft first
  const draft = await http.get<any>(`/sessions/draft?businessId=${selectedBizId.value}&type=photo`).catch(() => null)
  if (draft) {
    loadSessionIntoState(draft)
    autoSavePaused = false
    return
  }
  // No draft — load the most recent session instead of auto-creating empty one
  if (sessions.value.length > 0) {
    const latest = sessions.value[0] // already sorted by updatedAt desc
    const full = await http.get<any>(`/sessions/${latest.id}`).catch(() => null)
    if (full) {
      loadSessionIntoState(full)
      autoSavePaused = false
      return
    }
  }
  // Truly empty — create first session
  await createNewSession()
  autoSavePaused = false
}

async function createNewSession() {
  if (!selectedBizId.value) return
  resetState()
  try {
    const session = await http.post<any>('/sessions', {
      businessId: selectedBizId.value,
      type: 'photo',
    })
    currentSessionId.value = session.id
    await loadSessions()
  } catch {}
}

function loadSessionIntoState(session: any) {
  currentSessionId.value = session.id
  prompt.value = session.prompt || ''
  photoModel.value = session.photoModel || 'nano-banana-2'
  photoResolution.value = session.photoResolution || '1K'
  batchSize.value = session.batchSize || 1
  photoAspectRatio.value = session.photoAspectRatio || '1:1'
  selectedCharacterId.value = session.characterId || null
  referenceImages.value = (session.referenceImages as any[]) || []
  chatMessages.value = session.chatHistory || []
  generating.value = session.status === 'generating'
  generatingStartedAt.value = session.kieTaskCreatedAt || null

  // Load results from completed sessions
  loadImageResults()
}

function resetState() {
  prompt.value = ''
  photoModel.value = 'nano-banana-2'
  photoResolution.value = '1K'
  batchSize.value = 1
  photoAspectRatio.value = '1:1'
  selectedCharacterId.value = null
  referenceImages.value = []
  chatMessages.value = []
  generating.value = false
  generatingStartedAt.value = null
}

async function onLoadSession(session: PhotoSession) {
  // Flush pending auto-save for current session before switching
  if (autoSaveTimer) {
    clearTimeout(autoSaveTimer)
    autoSaveTimer = null
    await saveSession()
  }
  autoSavePaused = true
  // Fetch full session
  const full = await http.get<any>(`/sessions/${session.id}`).catch(() => null)
  if (full) loadSessionIntoState(full)
  autoSavePaused = false
}

async function onDeleteSession(id: string) {
  try {
    await http.delete(`/sessions/${id}`)
    if (currentSessionId.value === id) {
      currentSessionId.value = null
      await loadDraftSession()
    }
    await loadSessions()
  } catch (e: any) {
    toast.error(e.message || 'Ошибка удаления')
  }
}

async function onRenameSession(id: string, title: string) {
  try {
    await http.put(`/sessions/${id}`, { title })
    await loadSessions()
  } catch {}
}

async function loadImageResults() {
  const images: typeof imageResults.value = []
  const completed = sessions.value.filter(s => s.status === 'completed')

  for (const s of completed) {
    const results = s.results as any[] | null
    if (Array.isArray(results) && results.length > 0) {
      for (const r of results) {
        images.push({
          resultUrl: r.resultUrl,
          thumbUrl: r.thumbUrl || null,
          mediaFileId: r.mediaFileId || null,
          costUsd: r.costUsd ?? s.costUsd ?? 0,
          createdAt: r.createdAt || s.updatedAt,
          prompt: r.prompt || s.prompt || '',
          photoModel: r.photoModel || (s as any).photoModel || '',
          photoResolution: r.photoResolution || (s as any).photoResolution || '',
          photoAspectRatio: r.photoAspectRatio || (s as any).photoAspectRatio || '',
        })
      }
    }
  }
  // Sort newest first
  images.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
  imageResults.value = images
}

async function onBusinessChange() {
  // Flush pending auto-save before switching business
  if (autoSaveTimer) {
    clearTimeout(autoSaveTimer)
    autoSaveTimer = null
    await saveSession()
  }
  sessions.value = []
  imageResults.value = []
  currentSessionId.value = null
  resetState()
  loadSessions()
  loadDraftSession()
}

// --- Generation ---
function requestGenerate() {
  showPreGenModal.value = true
}

async function confirmGenerate() {
  showPreGenModal.value = false
  if (!selectedBizId.value || !currentSessionId.value) return

  autoSavePaused = true
  generating.value = true
  generatingStartedAt.value = new Date().toISOString()

  try {
    await http.post('/photos/generate', {
      businessId: selectedBizId.value,
      sessionId: currentSessionId.value,
      prompt: prompt.value,
      photoModel: photoModel.value,
      photoResolution: photoResolution.value,
      batchSize: batchSize.value,
      photoAspectRatio: photoAspectRatio.value,
      characterId: selectedCharacterId.value || undefined,
      referenceImageUrls: referenceImages.value.length ? referenceImages.value.map(r => r.url) : undefined,
    })
    toast.info('Генерация запущена...')
    await loadSessions()
  } catch (err: any) {
    generating.value = false
    generatingStartedAt.value = null
    toast.error(err.message || 'Ошибка генерации')
  } finally {
    autoSavePaused = false
  }
}

// --- Enhance ---
async function onEnhance(mode: PhotoEnhanceMode) {
  if (!selectedBizId.value) return
  enhancing.value = true
  try {
    const res = await http.post<any>('/photos/enhance-prompt', {
      prompt: prompt.value,
      businessId: selectedBizId.value,
      mode,
    })
    prompt.value = res.enhancedPrompt
    toast.success(`Режим "${mode}" применён`)
  } catch (err: any) {
    toast.error(err.message || 'Ошибка улучшения')
  } finally {
    enhancing.value = false
  }
}

// --- Agent Chat ---
function parseAgentResponse(raw: string): { text: string; prompts: string[]; suggestions: string[] } {
  const prompts: string[] = []
  const suggestions: string[] = []

  let text = raw.replace(/<prompt>([\s\S]*?)<\/prompt>/g, (_, p) => { prompts.push(p.trim()); return '' })
  text = text.replace(/<suggestions>([\s\S]*?)<\/suggestions>/g, (_, s) => {
    suggestions.push(...s.split('|').map((x: string) => x.trim()).filter(Boolean))
    return ''
  })

  return { text: text.trim(), prompts, suggestions }
}

async function onSendAgentMessage(userText: string) {
  chatMessages.value.push({ role: 'user', content: userText, createdAt: new Date().toISOString() })
  agentLoading.value = true

  try {
    const res = await http.post<{ content: string }>('/photos/agent-chat', {
      messages: chatMessages.value.slice(-20),
      context: {
        currentPrompt: prompt.value,
        photoModel: photoModel.value,
        photoResolution: photoResolution.value,
        batchSize: batchSize.value,
        photoAspectRatio: photoAspectRatio.value,
        referenceImages: referenceImages.value.map(r => ({ filename: r.filename, altText: r.altText })),
      },
      mode: agentMode.value,
      businessId: selectedBizId.value,
    })

    const parsed = parseAgentResponse(res.content)
    chatMessages.value.push({
      role: 'assistant',
      content: parsed.text,
      prompts: parsed.prompts,
      suggestions: parsed.suggestions,
      createdAt: new Date().toISOString(),
    })
  } catch (err: any) {
    toast.error(err.message || 'Ошибка агента')
  } finally {
    agentLoading.value = false
    scheduleAutoSave()
  }
}

function onUsePrompt(p: string) {
  prompt.value = p
  activeTab.value = 'editor'
  scheduleAutoSave()
}

// --- SSE ---
let sseSource: EventSource | null = null
let sseReconnectTimer: ReturnType<typeof setTimeout> | null = null

function connectSSE() {
  sseSource = new EventSource(`/api/sse?tabId=${TAB_ID}`)
  sseSource.onmessage = (e) => {
    if (e.data === 'ping' || e.data === 'connected') return
    try {
      const event = JSON.parse(e.data)
      if (event.type === 'session_updated') {
        loadSessions().then(loadImageResults)
        if (event.sessionId === currentSessionId.value) {
          if (event.status === 'completed') {
            generating.value = false
            generatingStartedAt.value = null
            toast.success('Фото готово!')
            // Reload full session to get results
            http.get<any>(`/sessions/${currentSessionId.value}`).then(loadSessionIntoState)
          } else if (event.status === 'failed') {
            generating.value = false
            generatingStartedAt.value = null
            toast.error('Генерация не удалась')
          }
        }
      }
    } catch {}
  }
  sseSource.onerror = () => {
    sseSource?.close()
    sseReconnectTimer = setTimeout(connectSSE, 5000)
  }
}

// --- Reference images ---
function onAddRefFromLibrary(file: { url: string; thumbUrl: string | null; filename: string; altText?: string | null }) {
  if (referenceImages.value.length >= maxRefs.value) {
    toast.error(`Максимум ${maxRefs.value} референсов для ${photoModel.value === 'nano-banana-pro' ? 'Pro' : 'NB2'}`)
    return
  }
  referenceImages.value.push({
    url: file.url,
    thumbUrl: file.thumbUrl,
    filename: file.filename,
    altText: file.altText || null,
  })
  showMediaPicker.value = false
}

function onAddRefsMulti(files: { url: string; thumbUrl: string | null; filename: string; altText?: string | null }[]) {
  const remaining = maxRefs.value - referenceImages.value.length
  for (const file of files.slice(0, remaining)) {
    referenceImages.value.push({
      url: file.url,
      thumbUrl: file.thumbUrl,
      filename: file.filename,
      altText: file.altText || null,
    })
  }
  showMediaPicker.value = false
  if (files.length > remaining) {
    toast.info(`Добавлено ${remaining} из ${files.length} (лимит ${maxRefs.value})`)
  }
}

function onUploadClick() {
  showAddMenu.value = false
  fileInputRef.value?.click()
}

function onLibraryClick() {
  showAddMenu.value = false
  showMediaPicker.value = true
}

async function onFileUpload(e: Event) {
  const input = e.target as HTMLInputElement
  const file = input.files?.[0]
  if (!file || !selectedBizId.value) return
  input.value = '' // reset
  if (referenceImages.value.length >= maxRefs.value) return

  const formData = new FormData()
  formData.append('file', file)
  formData.append('businessId', selectedBizId.value)

  try {
    const resp = await fetch('/api/media/upload', {
      method: 'POST',
      body: formData,
      credentials: 'include',
      headers: { 'X-Tab-ID': TAB_ID },
    })
    if (!resp.ok) throw new Error('Upload failed')
    const res = await resp.json()
    referenceImages.value.push({
      url: res.url,
      thumbUrl: res.thumbUrl,
      filename: res.filename,
      altText: null,
    })
  } catch (err: any) {
    toast.error(err.message || 'Ошибка загрузки')
  }
}

async function describeRefImage(img: { url: string; thumbUrl?: string | null; filename: string; altText?: string | null }) {
  describingPreview.value = true
  try {
    const res = await http.post<{ description: string }>('/ai/describe-image', {
      imageUrl: img.url,
      businessId: selectedBizId.value,
      type: 'auto',
    })
    img.altText = res.description
    // Update in referenceImages array
    const found = referenceImages.value.find(r => r.url === img.url)
    if (found) found.altText = res.description
  } catch (err: any) {
    toast.error(err.message || 'Ошибка описания')
  } finally {
    describingPreview.value = false
  }
}

// Agent context summary
const contextSummary = computed(() => {
  const parts: string[] = []
  const modelLabel = photoModel.value === 'nano-banana-pro' ? 'NB Pro' : 'NB2'
  parts.push(modelLabel)
  parts.push(photoResolution.value)
  parts.push(photoAspectRatio.value)
  if (batchSize.value > 1) parts.push(`x${batchSize.value}`)
  return parts.join(' / ')
})

// --- Lifecycle ---
onMounted(async () => {
  if (!selectedBizId.value && businesses.businesses.length) {
    selectedBizId.value = businesses.businesses[0].id
    businesses.setCurrent(selectedBizId.value)
  }
  window.addEventListener('beforeunload', flushBeforeUnload)
  connectSSE()
  await loadSessions()
  await loadDraftSession()
})

onBeforeUnmount(() => {
  window.removeEventListener('beforeunload', flushBeforeUnload)
  sseSource?.close()
  if (sseReconnectTimer) clearTimeout(sseReconnectTimer)
  // Flush pending auto-save before unmount
  if (autoSaveTimer) {
    clearTimeout(autoSaveTimer)
    autoSaveTimer = null
    saveSession()
  }
})
</script>

<template>
  <div class="max-w-[1600px] mx-auto flex flex-col h-[calc(100vh-5rem)] lg:h-[calc(100vh-7.5rem)] overflow-hidden">
    <!-- Header: title + business selector -->
    <div class="flex items-center justify-between mb-2 lg:mb-4 shrink-0">
      <h1 class="text-lg font-bold text-gray-800 dark:text-gray-200 flex items-center gap-2">
        <Camera :size="20" class="text-fuchsia-500" />
        Фото-студия
      </h1>

      <!-- Business dropdown -->
      <div class="relative">
        <button @click="showBizDropdown = !showBizDropdown"
          class="flex items-center gap-2 px-3 py-1.5 rounded-lg border border-gray-200 dark:border-gray-700 text-sm font-medium text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800">
          {{ currentBizName }}
          <ChevronDown :size="14" :class="['transition-transform', showBizDropdown ? 'rotate-180' : '']" />
        </button>
        <div v-if="showBizDropdown" class="fixed inset-0 z-10" @click="showBizDropdown = false" />
        <div v-if="showBizDropdown"
          class="absolute right-0 top-full mt-1 w-48 bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-xl shadow-xl z-20 py-1">
          <button v-for="b in businesses.businesses" :key="b.id"
            @click="selectBiz(b.id)"
            :class="['w-full text-left px-3 py-2 text-sm hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors',
              b.id === selectedBizId ? 'text-fuchsia-600 font-medium' : 'text-gray-600 dark:text-gray-400']">
            {{ b.name }}
          </button>
        </div>
      </div>
    </div>

    <!-- Main 50/50 layout -->
    <div class="grid grid-cols-1 lg:grid-cols-2 gap-3 lg:gap-6 flex-1 min-h-0">
      <!-- LEFT: Generator -->
      <div class="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 overflow-hidden flex flex-col min-h-0">
        <!-- Session bar (limited height, scrollable) -->
        <PsSessionBar class="shrink-0 lg:max-h-[30vh] lg:overflow-y-auto"
          :sessions="sessions"
          :current-session-id="currentSessionId"
          :generating="generating"
          @select="onLoadSession"
          @delete="onDeleteSession"
          @create="createNewSession"
          @rename="onRenameSession"
        />

        <!-- Controls (fills remaining space) -->
        <div class="flex-1 min-h-0 flex flex-col border-t border-gray-200 dark:border-gray-800">
          <!-- Prompt Tabs: Agent / Editor -->
          <div class="px-2 py-1 lg:px-4 lg:pb-2 shrink-0">
            <PsPromptTabs v-model="activeTab" />
          </div>

          <!-- Agent tab (stretches to fill) -->
          <PsAgentChat v-if="activeTab === 'agent'" class="flex-1 min-h-0"
            :messages="chatMessages"
            :loading="agentLoading"
            :mode="agentMode"
            :disabled="generating"
            :context-summary="contextSummary"
            @send="onSendAgentMessage"
            @use-prompt="onUsePrompt"
            @update:mode="agentMode = $event"
          />

          <!-- Editor tab (stretches to fill) -->
          <div v-else class="px-4 py-2 flex-1 min-h-0 flex flex-col gap-2 overflow-y-auto">
            <div class="flex-1 flex flex-col min-h-0">
              <label class="text-[10px] font-medium text-gray-500 uppercase tracking-wide shrink-0">
                Промпт
              </label>
              <textarea v-model="prompt" :disabled="generating"
                placeholder="Опиши изображение, которое хочешь создать. Чем детальнее описание, тем лучше результат."
                class="w-full mt-0.5 px-3 py-2 rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 text-sm placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-fuchsia-500/40 resize-y disabled:opacity-50 flex-1 min-h-[60px]"
              />
            </div>

            <!-- Reference images (VideoStudio pattern: 56x56 thumbnails, dropdown, preview) -->
            <div class="flex items-center gap-2 shrink-0 overflow-x-auto pb-1">
              <!-- Add button with dropdown -->
              <div v-if="referenceImages.length < maxRefs" class="relative shrink-0">
                <button @click="showAddMenu = !showAddMenu" :disabled="generating"
                  class="w-14 h-14 rounded-xl border-2 border-dashed border-gray-300 dark:border-gray-700 flex flex-col items-center justify-center hover:border-fuchsia-400 transition-colors disabled:opacity-50">
                  <Plus :size="16" class="text-gray-400" />
                  <span class="text-[7px] text-gray-400 mt-0.5">Фото</span>
                </button>
                <!-- Hidden file input -->
                <input ref="fileInputRef" type="file" accept="image/*" class="hidden" @change="onFileUpload" />
                <!-- Dropdown menu -->
                <div v-if="showAddMenu" class="fixed inset-0 z-10" @click="showAddMenu = false" />
                <div v-if="showAddMenu"
                  class="absolute top-full left-0 mt-1 w-48 bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-xl shadow-xl z-20 py-1 overflow-hidden">
                  <button @click="onUploadClick"
                    class="w-full flex items-center gap-2 px-3 py-2 text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors">
                    <Upload :size="14" class="text-gray-400" />
                    Загрузить
                  </button>
                  <button @click="onLibraryClick"
                    class="w-full flex items-center gap-2 px-3 py-2 text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors">
                    <FolderOpen :size="14" class="text-gray-400" />
                    Из медиатеки
                  </button>
                </div>
              </div>

              <!-- Ref image thumbnails (clickable -> preview popup) -->
              <div v-for="(r, idx) in referenceImages" :key="idx" class="relative group shrink-0">
                <button @click="previewRef = r"
                  class="w-14 h-14 rounded-xl overflow-hidden border-2 border-fuchsia-200 dark:border-fuchsia-800 cursor-pointer">
                  <img :src="r.thumbUrl || r.url" class="w-full h-full object-cover" />
                  <span class="absolute bottom-0.5 left-0.5 px-1 py-0.5 bg-black/70 text-white text-[7px] rounded font-mono">
                    @{{ idx + 1 }}
                  </span>
                </button>
                <button @click="referenceImages.splice(idx, 1)"
                  class="absolute -top-1 -right-1 w-4 h-4 bg-red-500 rounded-full flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity z-10">
                  <X :size="8" class="text-white" />
                </button>
              </div>
            </div>

            <!-- Reference preview popup -->
            <Teleport to="body">
              <div v-if="previewRef" class="fixed inset-0 z-50 flex items-center justify-center bg-black/60" @click.self="previewRef = null">
                <div class="bg-white dark:bg-gray-900 rounded-2xl shadow-2xl max-w-sm w-full mx-4 overflow-hidden">
                  <img :src="previewRef.url" :alt="previewRef.altText || previewRef.filename"
                    class="w-full max-h-[360px] object-contain bg-black" />
                  <div class="p-4">
                    <div class="text-sm font-medium mb-1 truncate">{{ previewRef.filename }}</div>
                    <p v-if="previewRef.altText" class="text-xs text-gray-500 dark:text-gray-400 leading-relaxed mb-1">
                      {{ previewRef.altText }}
                    </p>
                    <p v-else class="text-xs text-gray-400 italic mb-1">Нет описания</p>
                    <button @click="describeRefImage(previewRef!)"
                      :disabled="describingPreview"
                      class="flex items-center gap-1 px-2 py-1 rounded-lg text-[10px] font-medium bg-purple-100 dark:bg-purple-900/50 text-purple-600 dark:text-purple-400 hover:bg-purple-200 dark:hover:bg-purple-800 disabled:opacity-50 transition-colors">
                      <Loader2 v-if="describingPreview" :size="10" class="animate-spin" />
                      <Sparkles v-else :size="10" />
                      {{ previewRef.altText ? 'Перегенерировать описание' : 'AI-описание' }}
                    </button>
                  </div>
                  <div class="px-4 pb-4">
                    <button @click="previewRef = null; describingPreview = false"
                      class="w-full py-2 rounded-lg bg-gray-100 dark:bg-gray-800 text-sm font-medium text-gray-600 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-gray-700 transition-colors">
                      Закрыть
                    </button>
                  </div>
                </div>
              </div>
            </Teleport>

            <!-- Enhance menu -->
            <div class="flex items-center gap-2 pb-2 shrink-0">
              <PsEnhanceMenu
                :enhancing="enhancing"
                :disabled="generating || !prompt.trim()"
                @enhance="onEnhance"
              />
            </div>
          </div>

          <!-- Mobile: collapsible gallery section -->
          <div class="lg:hidden shrink-0 border-t border-gray-200 dark:border-gray-800" v-if="imageResults.length || generating">
            <button @click="mobileGalleryOpen = !mobileGalleryOpen"
              class="w-full flex items-center justify-between px-3 py-1.5 text-[11px] font-medium text-gray-500 hover:bg-gray-50 dark:hover:bg-gray-800/50">
              <div class="flex items-center gap-1.5">
                <Camera :size="12" class="text-fuchsia-500" />
                <span>Фото</span>
                <span v-if="imageResults.length" class="text-[9px] text-gray-400 bg-gray-100 dark:bg-gray-800 px-1.5 py-0.5 rounded-full">{{ imageResults.length }}</span>
              </div>
              <ChevronUp :size="12" :class="['transition-transform text-gray-400', mobileGalleryOpen ? '' : 'rotate-180']" />
            </button>
            <div v-if="mobileGalleryOpen" class="max-h-[35vh] overflow-y-auto">
              <PsGallery :results="imageResults" :generating="generating" :batch-size="batchSize" />
            </div>
          </div>

          <!-- Settings panel (pinned to bottom) -->
          <PsSettingsPanel class="shrink-0"
            :photo-model="photoModel"
            :photo-resolution="photoResolution"
            :batch-size="batchSize"
            :photo-aspect-ratio="photoAspectRatio"
            :generating="generating"
            :generating-started-at="generatingStartedAt"
            :cost-rub="costRub"
            :cost-usd="costUsd"
            :can-generate="canGenerate"
            :selected-character-id="selectedCharacterId"
            @update:photo-model="photoModel = $event as any"
            @update:photo-resolution="photoResolution = $event as any"
            @update:batch-size="batchSize = $event as any"
            @update:photo-aspect-ratio="photoAspectRatio = $event"
            @generate="requestGenerate"
          />
        </div>
      </div>

      <!-- RIGHT: Gallery (hidden on mobile — only visible on desktop) -->
      <PsGallery class="hidden lg:flex"
        :results="imageResults"
        :generating="generating"
        :batch-size="batchSize"
        @edit="(url: string) => toast.info('Редактирование: ' + url.split('/').pop())"
        @remove-bg="(url: string) => toast.info('Удаление фона: ' + url.split('/').pop())"
      />
    </div>

    <!-- Pre-generation confirmation modal -->
    <PsPreGenModal
      :show="showPreGenModal"
      :prompt="prompt"
      :photo-model="photoModel"
      :photo-resolution="photoResolution"
      :photo-aspect-ratio="photoAspectRatio"
      :batch-size="batchSize"
      :cost-rub="costRub"
      :cost-usd="costUsd"
      @confirm="confirmGenerate"
      @cancel="showPreGenModal = false"
    />

    <!-- Media picker for reference images -->
    <MediaPickerModal
      :visible="showMediaPicker"
      :business-id="selectedBizId || ''"
      multi-select
      :max-select="maxRefs - referenceImages.length"
      @close="showMediaPicker = false"
      @selected="onAddRefFromLibrary"
      @selected-multi="onAddRefsMulti"
    />
  </div>
</template>
