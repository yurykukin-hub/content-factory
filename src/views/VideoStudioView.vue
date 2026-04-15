<script setup lang="ts">
defineOptions({ name: 'VideoStudioView' })
import { ref, computed, onMounted, nextTick, watch } from 'vue'
import { http } from '@/api/client'
import { useToast } from '@/composables/useToast'
import { formatDate } from '@/composables/useFormatters'
import { useBusinessesStore } from '@/stores/businesses'
import VsModeTabs from '@/components/video/VsModeTabs.vue'
import VsCharacterCarousel from '@/components/video/VsCharacterCarousel.vue'
import VsPromptArea from '@/components/video/VsPromptArea.vue'
import VsSettingsPanel from '@/components/video/VsSettingsPanel.vue'
import VsGallery from '@/components/video/VsGallery.vue'
import VsSessionBar from '@/components/video/VsSessionBar.vue'
import VsConstructorDrawer from '@/components/video/VsConstructorDrawer.vue'
import MediaPickerModal from '@/components/MediaPickerModal.vue'
import VsRefModal from '@/components/video/VsRefModal.vue'
import type { CharacterData } from '@/components/video/VsRefModal.vue'
import { Video, ChevronDown } from 'lucide-vue-next'
import { useAuthStore } from '@/stores/auth'
import { useThemeStore } from '@/stores/theme'
import type { EnhanceMode } from '@/components/video/VsEnhanceMenu.vue'
import type { EnhanceDebugInfo } from '@/components/video/VsPromptArea.vue'

const toast = useToast()
const auth = useAuthStore()
const theme = useThemeStore()

const isAdmin = computed(() => auth.user?.role === 'ADMIN')
const isProMode = computed(() => theme.devMode)
const lastEnhanceDebug = ref<EnhanceDebugInfo | null>(null)
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

// --- Session persistence (DB-backed) ---
const currentSessionId = ref<string | null>(null)
const currentSessionTitle = ref('')
const showSessionDropdown = ref(false)
let autoSaveTimer: ReturnType<typeof setTimeout> | null = null
let autoSavePaused = false

function scheduleAutoSave() {
  if (autoSavePaused) return
  if (autoSaveTimer) clearTimeout(autoSaveTimer)
  autoSaveTimer = setTimeout(saveSession, 2000)
}

async function saveSession() {
  if (!selectedBizId.value || autoSavePaused) return
  // Don't create new sessions automatically — only save existing ones
  if (!currentSessionId.value) return
  // Auto-generate title from first 40 chars of prompt
  const autoTitle = prompt.value.trim().slice(0, 40) || 'Новая сессия'
  const payload: any = {
    businessId: selectedBizId.value,
    title: currentSessionTitle.value || autoTitle,
    prompt: prompt.value,
    promptHistory: (() => {
      // Ensure current prompt is in history before saving
      const history = [...promptHistory.value]
      if (prompt.value.trim() && (!history.length || history[history.length - 1] !== prompt.value)) {
        history.push(prompt.value)
      }
      return history.length ? history.map((p, i) => ({
        version: i + 1, prompt: p, createdAt: new Date().toISOString(),
        generated: generatedPromptIndices.value.has(i),
      })) : null
    })(),
    duration: duration.value,
    aspectRatio: aspectRatio.value,
    resolution: resolution.value,
    generateAudio: audio.value,
    inputMode: inputMode.value,
    referenceImages: refImages.value.length ? refImages.value : null,
    firstFrameUrl: firstFrame.value?.url || null,
    lastFrameUrl: lastFrame.value?.url || null,
  }
  try {
    await http.put(`/sessions/${currentSessionId.value}`, payload)
  } catch (e) { console.error('[VS] saveSession failed:', e) }
}

// Check for stuck "generating" sessions and fix them
async function fixStuckSessions() {
  const stuck = sessions.value.filter(s => s.status === 'generating' || (s.status === 'failed' && s.resultUrl))
  for (const s of stuck) {
    if (s.resultUrl) {
      // Video was generated but status wasn't updated (F5 during generation)
      await http.put(`/sessions/${s.id}`, { status: 'completed' }).catch(() => {})
    }
  }
  if (stuck.length) loadSessions()
}

async function loadDraftSession() {
  if (!selectedBizId.value) return
  autoSavePaused = true
  try {
    const draft = await http.get<any>(`/sessions/draft?businessId=${selectedBizId.value}`)
    if (draft) {
      currentSessionId.value = draft.id
      currentSessionTitle.value = draft.title || ''
      prompt.value = draft.prompt || ''
      // Restore prompt history + generated markers
      if (draft.promptHistory?.length) {
        const entries = draft.promptHistory as any[]
        promptHistory.value = entries.map((h: any) => h.prompt)
        historyIndex.value = promptHistory.value.length - 1
        generatedPromptIndices.value = new Set(
          entries.filter((h: any) => h.generated).map((_: any, i: number) => i)
        )
      }
      duration.value = draft.duration || 4
      audio.value = draft.generateAudio ?? false
      resolution.value = draft.resolution || '480p'
      aspectRatio.value = draft.aspectRatio || '9:16'
      inputMode.value = draft.inputMode || 'references'
      refImages.value = (draft.referenceImages as any[]) || []
      firstFrame.value = draft.firstFrameUrl ? { url: draft.firstFrameUrl, thumbUrl: null, filename: 'frame' } : null
      lastFrame.value = draft.lastFrameUrl ? { url: draft.lastFrameUrl, thumbUrl: null, filename: 'frame' } : null
      // Restore badges from prompt text (setTimeout ensures DOM is ready)
      if (prompt.value && refImages.value.length) {
        setTimeout(() => {
          const badges = refImages.value
            .map((img, idx) => ({ badgeType: 'image' as const, id: `img_${idx + 1}`, name: `Image${idx + 1}`, thumbUrl: img.thumbUrl || null }))
            .filter(b => prompt.value.includes(`@${b.name}`))
          if (badges.length) {
            vsPromptAreaRef.value?.setContentWithBadges(prompt.value, badges)
          }
        }, 300)
      }
    } else {
      // No draft exists — create one automatically
      try {
        const session = await http.post<any>('/sessions', { businessId: selectedBizId.value })
        currentSessionId.value = session.id
      } catch {}
    }
  } catch {}
  finally { setTimeout(() => { autoSavePaused = false }, 500) }
}

function startNewSession() {
  currentSessionId.value = null
  currentSessionTitle.value = ''
  prompt.value = ''
  promptHistory.value = []
  historyIndex.value = -1
  generatedPromptIndices.value = new Set()
  refImages.value = []
  firstFrame.value = null
  lastFrame.value = null
}

async function deleteSession(id: string) {
  try {
    await http.delete(`/sessions/${id}`)
    sessions.value = sessions.value.filter(s => s.id !== id)
    // If deleted current session — create new
    if (currentSessionId.value === id) {
      await createNewSession()
    }
    toast.success('Сессия удалена')
  } catch (e: any) { toast.error(e.message || 'Ошибка удаления') }
}

async function createNewSession() {
  startNewSession()
  if (!selectedBizId.value) return
  try {
    const session = await http.post<any>('/sessions', { businessId: selectedBizId.value })
    currentSessionId.value = session.id
    loadSessions()
    toast.success('Новая сессия создана')
  } catch (e) { console.error('[VS] createNewSession failed:', e) }
}

// --- State ---
const prompt = ref('')
const enhancing = ref(false)
const generating = ref(false)
const promptHistory = ref<string[]>([])
const historyIndex = ref(-1)
const generatedPromptIndices = ref<Set<number>>(new Set())
const showConstructor = ref(false)

// Settings
const duration = ref(4)
const audio = ref(false)
const resolution = ref<'480p' | '720p'>('480p')
const aspectRatio = ref<'9:16' | '1:1' | '16:9'>('9:16')
const inputMode = ref<'text' | 'frames' | 'references'>('references')

// Frames
const firstFrame = ref<{ url: string; thumbUrl?: string | null; filename: string } | null>(null)
const lastFrame = ref<{ url: string; thumbUrl?: string | null; filename: string } | null>(null)

// References
const refImages = ref<{ url: string; thumbUrl?: string | null; filename: string; altText?: string | null }[]>([])

// Auto-save on changes (debounced 2sec)
watch([prompt, duration, audio, resolution, aspectRatio, inputMode, refImages, firstFrame, lastFrame], scheduleAutoSave, { deep: true })
const showMediaPicker = ref(false)
const showRefModal = ref(false)
const editingCharacter = ref<CharacterData | null>(null)

// Characters
interface CharacterRef { id: string; name: string; type: string; description?: string | null; style?: string | null; referenceMedia?: { url: string; thumbUrl: string | null } | null }
const characters = ref<CharacterRef[]>([])
const selectedCharacterId = ref<string | null>(null)

// Prompt library
interface PromptEntry { id: string; prompt: string; resultUrl: string | null; rating: number | null; tags: string[]; metadata: any; createdAt: string }
const savedPrompts = ref<PromptEntry[]>([])

// Sessions
interface Session {
  id: string; businessId: string; prompt: string; duration: number; aspectRatio: string
  resolution: string; generateAudio: boolean; inputMode: string
  referenceImages: any; firstFrameUrl: string | null; lastFrameUrl: string | null
  status: string; resultUrl: string | null; costUsd: number | null
  mediaFile?: { url: string; thumbUrl: string | null; filename: string; durationSec: number | null } | null
  createdAt: string; updatedAt: string
}
const sessions = ref<Session[]>([])

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

async function loadSessions() {
  if (!selectedBizId.value) return
  try { sessions.value = await http.get<Session[]>(`/sessions?businessId=${selectedBizId.value}`) } catch { sessions.value = [] }
}

function loadSession(session: Session) {
  autoSavePaused = true
  // Switch to this session's state
  currentSessionId.value = session.status === 'draft' ? session.id : null
  prompt.value = session.prompt || ''
  duration.value = session.duration || 4
  audio.value = session.generateAudio ?? false
  resolution.value = (session.resolution || '480p') as any
  aspectRatio.value = (session.aspectRatio || '9:16') as any
  inputMode.value = (session.inputMode || 'references') as any
  refImages.value = (session.referenceImages as any[]) || []
  firstFrame.value = session.firstFrameUrl ? { url: session.firstFrameUrl, thumbUrl: null, filename: 'frame' } : null
  lastFrame.value = session.lastFrameUrl ? { url: session.lastFrameUrl, thumbUrl: null, filename: 'frame' } : null

  // If completed session (read-only), create new draft from it
  if (session.status !== 'draft') {
    currentSessionId.value = null
  }

  // Restore badges
  if (prompt.value && refImages.value.length) {
    setTimeout(() => {
      const badges = refImages.value
        .map((img, idx) => ({ badgeType: 'image' as const, id: `img_${idx + 1}`, name: `Image${idx + 1}`, thumbUrl: img.thumbUrl || null }))
        .filter(b => prompt.value.includes(`@${b.name}`))
      if (badges.length) {
        vsPromptAreaRef.value?.setContentWithBadges(prompt.value, badges)
      }
    }, 100)
  }
  setTimeout(() => { autoSavePaused = false }, 500)
  toast.success('Сессия загружена')
}

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

function setPromptWithBadges(text: string) {
  // Build badge data for all @ImageN found in text
  const badges = refImages.value
    .map((img, idx) => ({
      badgeType: 'image' as const,
      id: `img_${idx + 1}`,
      name: `Image${idx + 1}`,
      thumbUrl: img.thumbUrl || null,
    }))
    .filter(b => text.includes(`@${b.name}`))

  if (badges.length) {
    // Use setContentWithBadges to replace @ImageN text with inline badge chips
    nextTick(() => {
      vsPromptAreaRef.value?.setContentWithBadges(text, badges)
    })
  } else {
    prompt.value = text
  }
}

const MODE_LABELS: Record<EnhanceMode, string> = {
  enhance: 'Промпт улучшен',
  director: 'Режиссёрский промпт готов',
  structure: 'Промпт структурирован',
  focus: 'Промпт сфокусирован',
  audio: 'Звук добавлен',
  camera: 'Камера улучшена',
  translate: 'Промпт переведён',
  simplify: 'Промпт упрощён',
}

async function enhance(mode: EnhanceMode = 'enhance') {
  if (!prompt.value.trim() || !selectedBizId.value) return
  enhancing.value = true
  lastEnhanceDebug.value = null
  try {
    // Collect element descriptions for AI context
    const elements = refImages.value.map((img, idx) => ({
      tag: `@Image${idx + 1}`,
      description: img.altText || img.filename || `Image ${idx + 1}`,
    }))

    const res = await http.post<{
      enhancedPrompt: string
      analysis?: Record<string, unknown>
      debug?: EnhanceDebugInfo
    }>('/ai/enhance-video-prompt', {
      prompt: prompt.value, duration: duration.value, businessId: selectedBizId.value,
      mode,
      debug: isProMode.value,
      elements: elements.length ? elements : undefined,
    })
    // Save original before replacing (if not already in history)
    if (!promptHistory.value.length || promptHistory.value[promptHistory.value.length - 1] !== prompt.value) {
      promptHistory.value.push(prompt.value)
    }
    // Set enhanced prompt with badges restored
    setPromptWithBadges(res.enhancedPrompt)
    promptHistory.value.push(res.enhancedPrompt)
    historyIndex.value = promptHistory.value.length - 1

    // Store debug info for display
    if (res.debug) lastEnhanceDebug.value = res.debug

    toast.success(MODE_LABELS[mode] || 'Промпт улучшен')
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

    // Mark session as generating
    if (currentSessionId.value) {
      http.put(`/sessions/${currentSessionId.value}`, { status: 'generating' }).catch(() => {})
    }

    const result = await http.post<{ mediaFile: GeneratedVideo }>('/ai/generate-video', payload)
    // Save prompt to history and mark as generated
    if (!promptHistory.value.length || promptHistory.value[promptHistory.value.length - 1] !== prompt.value) {
      promptHistory.value.push(prompt.value)
    }
    generatedPromptIndices.value.add(promptHistory.value.length - 1)
    historyIndex.value = promptHistory.value.length - 1
    generatedVideos.value.unshift(result.mediaFile)

    // Mark session as completed with result
    const costUsd = (() => {
      const hasImg = inputMode.value !== 'text' && (firstFrame.value || refImages.value.length > 0)
      const tier = PRICING[resolution.value]
      const cps = hasImg ? tier.withImage : tier.textOnly
      const base = cps * duration.value * CREDIT_PRICE
      return audio.value ? base * AUDIO_MULT : base
    })()

    if (currentSessionId.value) {
      // Add result to session's results array (keep within same session)
      const newResult = {
        resultUrl: result.mediaFile.url,
        prompt: prompt.value,
        costUsd,
        createdAt: new Date().toISOString(),
        mediaFileId: result.mediaFile.id,
      }
      // Load current session to get existing results
      try {
        const curr = await http.get<any>(`/sessions/${currentSessionId.value}`)
        const existingResults = (curr?.results as any[]) || []
        existingResults.push(newResult)
        await http.put(`/sessions/${currentSessionId.value}`, {
          status: 'completed',
          mediaFileId: result.mediaFile.id,
          resultUrl: result.mediaFile.url,
          results: existingResults,
          costUsd: existingResults.reduce((sum: number, r: any) => sum + (r.costUsd || 0), 0),
        })
      } catch {
        http.put(`/sessions/${currentSessionId.value}`, {
          status: 'completed', mediaFileId: result.mediaFile.id, resultUrl: result.mediaFile.url, costUsd,
        }).catch(() => {})
      }
    }

    // Auto-save to prompt library (keep for backwards compat)
    http.post('/prompt-library', {
      businessId: selectedBizId.value, type: 'video', prompt: prompt.value,
      resultUrl: result.mediaFile.url,
      metadata: { duration: duration.value, model: 'bytedance/seedance-2', resolution: resolution.value, cost: costUsd, audio: audio.value, inputMode: inputMode.value },
    }).catch(() => {})

    // Refresh data
    loadSessions()
    loadVideos()

    toast.success(`Видео готово (${duration.value} сек)`)
  } catch (e: any) {
    const msg = e.message || 'Ошибка генерации'
    // Don't mark as failed if connection was aborted (F5, navigation)
    const isAbort = msg.includes('abort') || msg.includes('network') || msg.includes('fetch')
    if (currentSessionId.value && !isAbort) {
      http.put(`/sessions/${currentSessionId.value}`, {
        status: 'failed', errorMessage: msg,
      }).catch(() => {})
    }
    toast.error(msg)
  }
  finally { generating.value = false }
}

function historyBack() {
  if (historyIndex.value > 0) {
    historyIndex.value--
    setPromptWithBadges(promptHistory.value[historyIndex.value])
  }
}
function historyForward() {
  if (historyIndex.value < promptHistory.value.length - 1) {
    historyIndex.value++
    setPromptWithBadges(promptHistory.value[historyIndex.value])
  }
}

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
  if (!id) return
  const char = characters.value.find(c => c.id === id)
  if (!char) return

  // Check if already in working set → open ref modal for viewing
  const alreadyAdded = char.referenceMedia && refImages.value.find(r => r.url === char.referenceMedia!.url)
  if (alreadyAdded) {
    editingCharacter.value = char as CharacterData
    showRefModal.value = true
    return
  }

  // First click → add to working set
  if (!char.referenceMedia || refImages.value.length >= 9) return
  addRefImage({
    url: char.referenceMedia.url,
    thumbUrl: char.referenceMedia.thumbUrl,
    filename: char.name,
    altText: char.description || null,
  })
  selectedCharacterId.value = id
}

function onCreateRef() {
  editingCharacter.value = null
  showRefModal.value = true
}

async function describeRefImage(img: { url: string; thumbUrl?: string | null; filename: string; altText?: string | null }) {
  try {
    const res = await http.post<{ description: string }>('/ai/describe-image', {
      imageUrl: img.url,
      type: 'auto',
    })
    img.altText = res.description
    toast.success('Описание сгенерировано')
  } catch (e: any) { toast.error(e.message || 'Ошибка AI') }
}

async function onRefSaved() {
  await loadCharacters()
  // Sync altText in working set from updated characters data
  for (const img of refImages.value) {
    const char = characters.value.find(c => c.referenceMedia?.url === img.url)
    if (char) {
      img.altText = char.description || null
    }
  }
}

function onBusinessChange() {
  loadCharacters()
  loadVideos()
  loadSavedPrompts()
  loadSessions()
  loadDraftSession()
  templatesLoaded.value = false
  aiTemplates.value = []
}

onMounted(async () => {
  loadCharacters(); loadVideos(); loadSavedPrompts(); loadDraftSession()
  await loadSessions()
  fixStuckSessions()
})
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
        <!-- Sessions list (takes available space) -->
        <VsSessionBar
          class="flex-1 min-h-0"
          :sessions="sessions"
          :current-session-id="currentSessionId"
          @load-session="loadSession"
          @create-new="createNewSession"
          @delete-session="deleteSession" />
        <!-- Prompt block (pinned to bottom) -->
        <div class="shrink-0 border-t border-gray-200 dark:border-gray-800">
        <VsModeTabs v-model="inputMode" />
        <VsCharacterCarousel
          :characters="characters"
          :model-value="selectedCharacterId"
          @update:model-value="onCharacterSelect"
          @create-new="onCreateRef" />
        <div>
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
            :generated-indices="generatedPromptIndices"
            :templates="aiTemplates"
            :loading-templates="loadingTemplates"
            :is-admin="isAdmin"
            :is-pro-mode="isProMode"
            :debug-info="lastEnhanceDebug"
            @enhance="enhance"
            @history-back="historyBack"
            @history-forward="historyForward"
            @upload-frame="uploadFrame"
            @add-ref="addRef"
            @add-ref-from-library="showMediaPicker = true"
            @describe-ref="describeRefImage"
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

    <!-- Reference Modal (create / view+edit) -->
    <VsRefModal
      :visible="showRefModal"
      :business-id="selectedBizId || ''"
      :character="editingCharacter"
      @close="showRefModal = false; editingCharacter = null"
      @saved="onRefSaved()" />

    <!-- Media Picker Modal -->
    <MediaPickerModal
      :visible="showMediaPicker"
      :business-id="selectedBizId || ''"
      @close="showMediaPicker = false"
      @selected="(f: any) => addRefFromLibrary(f)" />

  </div>
</template>
