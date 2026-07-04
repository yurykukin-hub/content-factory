<script setup lang="ts">
/**
 * Video Studio — AI video generation view.
 * Сессии / автосейв / SSE / lifecycle вынесены в useStudioSession (общий движок студий,
 * как Photo/Sound). Здесь остаётся доменное: video-стейт, маппинг полей, генерация,
 * агент, референсы/кадры, promptHistory (undo/redo промптов) + @ImageN-бейджи.
 * Brand color: emerald (в отличие от fuchsia Photo/Sound).
 */
import { ref, computed, watch, nextTick, onMounted } from 'vue'
import { http, TAB_ID } from '@/api/client'
import { useToast } from '@/composables/useToast'
import { useRates } from '@/composables/useRates'
import { useBusinessesStore } from '@/stores/businesses'
import { useAuthStore } from '@/stores/auth'
import { useThemeStore } from '@/stores/theme'
import { useStudioSession } from '@/composables/useStudioSession'

import VsModeTabs from '@/components/video/VsModeTabs.vue'
import VsRichPrompt from '@/components/video/VsRichPrompt.vue'
import VsSettingsPanel from '@/components/video/VsSettingsPanel.vue'
import VsGallery from '@/components/video/VsGallery.vue'
import VsSessionBar from '@/components/video/VsSessionBar.vue'
import VsPreGenModal from '@/components/video/VsPreGenModal.vue'
import SharedCharacterCarousel from '@/components/shared/SharedCharacterCarousel.vue'
import SharedRefModal from '@/components/shared/SharedRefModal.vue'
import type { CharacterData } from '@/components/shared/SharedRefModal.vue'
import StudioChat from '@/components/shared/StudioChat.vue'
import type { AgentMessage } from '@/components/shared/StudioChat.vue'
import SharedEnhanceMenu from '@/components/shared/SharedEnhanceMenu.vue'
import type { EnhanceModeItem } from '@/components/shared/SharedEnhanceMenu.vue'
import MediaPickerModal from '@/components/MediaPickerModal.vue'
import {
  Video, Plus, Upload, FolderOpen, X, Image as ImageIcon, Trash2,
  Sparkles, Loader2, ChevronLeft, ChevronRight, ChevronDown, ChevronUp,
  Wand2, Eraser, Clapperboard, LayoutTemplate, Target, Volume2, Camera, Globe,
} from 'lucide-vue-next'

defineOptions({ name: 'VideoStudioView' })

const businesses = useBusinessesStore()
const toast = useToast()
const auth = useAuthStore()
const theme = useThemeStore()
const { USD_RUB } = useRates()

const isAdmin = computed(() => auth.user?.role === 'ADMIN')
const isProMode = computed(() => theme.devMode)

// --- Types ---
interface RefImage { url: string; thumbUrl?: string | null; filename: string; altText?: string | null }
interface FrameRef { url: string; thumbUrl?: string | null; filename: string }
interface CharacterRef { id: string; name: string; type: string; description?: string | null; style?: string | null; referenceMedia?: { url: string; thumbUrl: string | null } | null }
interface Session {
  id: string; businessId: string; title: string; prompt: string; duration: number; aspectRatio: string
  resolution: string; generateAudio: boolean; inputMode: string
  referenceImages: any; firstFrameUrl: string | null; lastFrameUrl: string | null
  status: string; resultUrl: string | null; costUsd: number | null
  kieTaskCreatedAt: string | null
  mediaFile?: { url: string; thumbUrl: string | null; filename: string; durationSec: number | null } | null
  createdAt: string; updatedAt: string
}
interface GeneratedVideo {
  id: string; url: string; filename: string; durationSec: number | null
  aiModel: string | null; aiCostUsd: number | null; altText: string | null; createdAt: string
}
interface AiTemplate { emoji: string; name: string; prompt: string }
interface PromptEntry { id: string; prompt: string; resultUrl: string | null; rating: number | null; tags: string[]; metadata: any; createdAt: string }

// --- Video generation state ---
const prompt = ref('')
const enhancing = ref(false)
const currentSessionTitle = ref('')

// Settings
const duration = ref(4)
const audio = ref(false)
const resolution = ref<'480p' | '720p'>('480p')
const aspectRatio = ref<'9:16' | '1:1' | '16:9'>('9:16')
const inputMode = ref<'text' | 'frames' | 'references'>('references')

// Frames + references
const firstFrame = ref<FrameRef | null>(null)
const lastFrame = ref<FrameRef | null>(null)
const refImages = ref<RefImage[]>([])

// Prompt history (undo/redo) — in-memory строки; сериализуется в {version,prompt,createdAt,generated}[]
const promptHistory = ref<string[]>([])
const historyIndex = ref(-1)
const generatedPromptIndices = ref<Set<number>>(new Set())

// --- UI state ---
const chatMessages = ref<AgentMessage[]>([])
const agentLoading = ref(false)
const showPreGenModal = ref(false)
const showTemplates = ref(false)
const showMediaPicker = ref(false)
const showRefModal = ref(false)
const editingCharacter = ref<CharacterData | null>(null)
const mobileGalleryOpen = ref(false)

// Reference add-menu + preview popup
const showAddMenu = ref(false)
const addBtnRef = ref<HTMLElement | null>(null)
const addMenuStyle = computed(() => {
  if (!addBtnRef.value) return {}
  const rect = addBtnRef.value.getBoundingClientRect()
  return { top: `${rect.bottom + 4}px`, left: `${rect.left}px` }
})
const fileInputRef = ref<HTMLInputElement | null>(null)
const previewRef = ref<RefImage | null>(null)
const describingPreview = ref(false)

// Rich prompt ref (for @ImageN badge insertion / restore)
const richPromptRef = ref<InstanceType<typeof VsRichPrompt> | null>(null)

// Characters
const characters = ref<CharacterRef[]>([])
const selectedCharacterId = ref<string | null>(null)

// Prompt library + generated videos
const savedPrompts = ref<PromptEntry[]>([])
const generatedVideos = ref<GeneratedVideo[]>([])

// AI templates
const aiTemplates = ref<AiTemplate[]>([])
const loadingTemplates = ref(false)
const templatesLoaded = ref(false)

// --- Enhance-режимы видео (доменные → SharedEnhanceMenu; basic = enhance/simplify, pro за гейтом) ---
const VIDEO_ENHANCE_MODES: EnhanceModeItem[] = [
  { id: 'enhance', label: 'Улучшить', group: 'basic', icon: Wand2, desc: 'Адаптивное улучшение' },
  { id: 'simplify', label: 'Упростить', group: 'basic', icon: Eraser, desc: 'Базовая структура' },
  { id: 'director', label: 'Режиссёрский', group: 'pro', icon: Clapperboard, desc: 'Timeline, мультисцены' },
  { id: 'structure', label: 'Структурировать', group: 'pro', icon: LayoutTemplate, desc: '6-компонентный шаблон' },
  { id: 'focus', label: 'Фокус', group: 'pro', icon: Target, desc: 'Убрать мусор, усилить' },
  { id: 'audio', label: 'Добавить звук', group: 'pro', icon: Volume2, desc: 'Inline-аудио описания' },
  { id: 'camera', label: 'Камера', group: 'pro', icon: Camera, desc: 'Кадр + движение + угол' },
  { id: 'translate', label: 'Перевести', group: 'pro', icon: Globe, desc: 'RU → EN для Seedance' },
]
const MODE_LABELS: Record<string, string> = {
  enhance: 'Промпт улучшен',
  director: 'Режиссёрский промпт готов',
  structure: 'Промпт структурирован',
  focus: 'Промпт сфокусирован',
  audio: 'Звук добавлен',
  camera: 'Камера улучшена',
  translate: 'Промпт переведён',
  simplify: 'Промпт упрощён',
}

// --- Pricing (480p/720p) — сохранено без наценки, как в исходной Video-студии ---
const PRICING = {
  '480p': { withImage: 11.5, textOnly: 19 },
  '720p': { withImage: 25, textOnly: 41 },
} as const
const CREDIT_PRICE = 0.005
const AUDIO_MULT = 2.0

const costRub = computed(() => {
  const hasImg = inputMode.value !== 'text' && (firstFrame.value || refImages.value.length > 0)
  const tier = PRICING[resolution.value]
  const cps = hasImg ? tier.withImage : tier.textOnly
  const base = cps * duration.value * CREDIT_PRICE
  const usd = audio.value ? base * AUDIO_MULT : base
  return Math.round(usd * USD_RUB.value)
})

// Сводка контекста для welcome-бабла агента
const contextSummary = computed(() => {
  const parts: string[] = []
  parts.push(inputMode.value === 'text' ? 'Текст' : inputMode.value === 'frames' ? 'Кадры' : 'Референсы')
  parts.push(resolution.value)
  parts.push(aspectRatio.value)
  parts.push(`${duration.value}с`)
  if (audio.value) parts.push('звук')
  if (refImages.value.length) parts.push(`${refImages.value.length} фото`)
  return parts.join(' / ')
})
const welcomeText = computed(() =>
  `Опиши, какое видео хочешь создать\nНастройки: ${contextSummary.value}`
)

// --- Session <-> domain mapping (для useStudioSession) ---
function buildSavePayload() {
  const autoTitle = prompt.value.trim().slice(0, 40) || 'Новая сессия'
  return {
    title: currentSessionTitle.value || autoTitle,
    prompt: prompt.value,
    promptHistory: (() => {
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
    chatHistory: chatMessages.value.length ? chatMessages.value : null,
  }
}

function applySession(session: any) {
  currentSessionTitle.value = session.title || ''
  prompt.value = session.prompt || ''
  duration.value = session.duration || 4
  audio.value = session.generateAudio ?? false
  resolution.value = (session.resolution || '480p') as any
  aspectRatio.value = (session.aspectRatio || '9:16') as any
  inputMode.value = (session.inputMode || 'references') as any
  refImages.value = (session.referenceImages as any[]) || []
  firstFrame.value = session.firstFrameUrl ? { url: session.firstFrameUrl, thumbUrl: null, filename: 'frame' } : null
  lastFrame.value = session.lastFrameUrl ? { url: session.lastFrameUrl, thumbUrl: null, filename: 'frame' } : null
  chatMessages.value = Array.isArray(session.chatHistory) ? session.chatHistory as AgentMessage[] : []

  // Восстановление promptHistory + generatedPromptIndices (по ОРИГИНАЛЬНОМУ индексу — фикс бага)
  if (session.promptHistory?.length) {
    const entries = session.promptHistory as any[]
    promptHistory.value = entries.map((h: any) => h.prompt)
    historyIndex.value = promptHistory.value.length - 1
    const s = new Set<number>()
    entries.forEach((h: any, i: number) => { if (h.generated) s.add(i) })
    generatedPromptIndices.value = s
  } else {
    promptHistory.value = prompt.value.trim() ? [prompt.value] : []
    historyIndex.value = promptHistory.value.length - 1
    generatedPromptIndices.value = new Set()
  }

  // Восстановить @ImageN-бейджи в промпте (после того как VsRichPrompt отрисовал текст)
  if (prompt.value && refImages.value.length) {
    setTimeout(() => setPromptWithBadges(prompt.value), 150)
  }
}

function resetState() {
  currentSessionTitle.value = ''
  prompt.value = ''
  promptHistory.value = []
  historyIndex.value = -1
  generatedPromptIndices.value = new Set()
  refImages.value = []
  firstFrame.value = null
  lastFrame.value = null
  chatMessages.value = []
}

// --- Движок сессий (sessions / автосейв / SSE / lifecycle) ---
const {
  sessions,
  currentSessionId,
  generating,
  generatingStartedAt,
  loadSessions,
  createNew,
  onLoadSession,
  onDeleteSession,
  onRenameSession,
  scheduleAutoSave,
  flush,
} = useStudioSession<Session>({
  type: 'video',
  businessId: computed(() => businesses.currentBusinessId),
  buildSavePayload,
  applySession,
  resetState,
  watchSources: () => [prompt, duration, audio, resolution, aspectRatio, inputMode, refImages, firstFrame, lastFrame, chatMessages],
  // Video тянет результат из /media/library, НЕ из session.results
  onCompleted: () => { loadVideos(); toast.success('Видео готово!', 5000) },
  onFailed: () => toast.error('Генерация не удалась'),
  onRenamed: (id, title) => { if (currentSessionId.value === id) currentSessionTitle.value = title },
  onBusinessChanged: () => {
    loadCharacters()
    loadVideos()
    loadSavedPrompts()
    templatesLoaded.value = false
    aiTemplates.value = []
  },
})

// --- @ImageN badges helper (восстановление после restore / enhance / agent-use) ---
function setPromptWithBadges(text: string) {
  const badges = refImages.value
    .map((img, idx) => ({
      badgeType: 'image' as const,
      id: `img_${idx + 1}`,
      name: `Image${idx + 1}`,
      thumbUrl: img.thumbUrl || null,
    }))
    .filter(b => text.includes(`@${b.name}`))

  if (badges.length) {
    nextTick(() => { richPromptRef.value?.setContentWithBadges(text, badges) })
  } else {
    prompt.value = text
  }
}

// Показывать «Вставить референсы» когда есть картинки, но их @ImageN нет в тексте
const missingRefs = computed(() => {
  if (inputMode.value !== 'references' || !refImages.value.length) return []
  return refImages.value
    .map((img, i) => ({ img, tag: `@Image${i + 1}`, index: i }))
    .filter(r => !prompt.value.includes(r.tag))
})
function insertAllMissingRefs() {
  for (const r of missingRefs.value) {
    richPromptRef.value?.insertBadge({
      badgeType: 'image', id: `ref-${r.index}`, name: `Image${r.index + 1}`,
      thumbUrl: r.img.thumbUrl || r.img.url,
    })
  }
}

// --- Data loaders ---
async function loadCharacters() {
  if (!businesses.currentBusinessId) return
  try { characters.value = await http.get<CharacterRef[]>(`/businesses/${businesses.currentBusinessId}/characters`) } catch { characters.value = [] }
}

async function loadVideos() {
  if (!businesses.currentBusinessId) return
  try {
    const res = await http.get<{ files: any[] }>(`/media/library/${businesses.currentBusinessId}`)
    generatedVideos.value = res.files
      .filter((f: any) => f.mimeType?.startsWith('video/') && f.aiModel)
      .map((f: any) => ({ id: f.id, url: f.url, filename: f.filename, durationSec: f.durationSec, aiModel: f.aiModel, aiCostUsd: f.aiCostUsd, altText: f.altText, createdAt: f.createdAt }))
  } catch { generatedVideos.value = [] }
}

async function loadSavedPrompts() {
  if (!businesses.currentBusinessId) return
  try { savedPrompts.value = await http.get<PromptEntry[]>(`/prompt-library?businessId=${businesses.currentBusinessId}&type=video`) } catch { savedPrompts.value = [] }
}

async function loadAiTemplates() {
  if (templatesLoaded.value || !businesses.currentBusinessId) return
  loadingTemplates.value = true
  try {
    const res = await http.post<{ suggestions: AiTemplate[] }>('/ai/suggest-video-templates', { businessId: businesses.currentBusinessId })
    aiTemplates.value = res.suggestions
    templatesLoaded.value = true
  } catch { /* silent */ }
  finally { loadingTemplates.value = false }
}

// Загружать шаблоны при первом раскрытии
watch(showTemplates, (val) => {
  if (val && !aiTemplates.value.length && !loadingTemplates.value) loadAiTemplates()
})

function applyTemplate(p: string) {
  prompt.value = p
  scheduleAutoSave()
}

// --- Prompt history nav ---
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

// --- Enhance ---
async function onEnhance(mode: string) {
  if (!prompt.value.trim() || !businesses.currentBusinessId) return
  enhancing.value = true
  try {
    const elements = refImages.value.map((img, idx) => ({
      tag: `@Image${idx + 1}`,
      description: img.altText || img.filename || `Image ${idx + 1}`,
    }))
    const res = await http.post<{ enhancedPrompt: string }>('/ai/enhance-video-prompt', {
      prompt: prompt.value, duration: duration.value, businessId: businesses.currentBusinessId,
      mode,
      elements: elements.length ? elements : undefined,
    })
    if (!promptHistory.value.length || promptHistory.value[promptHistory.value.length - 1] !== prompt.value) {
      promptHistory.value.push(prompt.value)
    }
    setPromptWithBadges(res.enhancedPrompt)
    promptHistory.value.push(res.enhancedPrompt)
    historyIndex.value = promptHistory.value.length - 1
    toast.success(MODE_LABELS[mode] || 'Промпт улучшен')
  } catch (e: any) { toast.error(e.message || 'Ошибка') }
  finally { enhancing.value = false }
}

// --- Generation ---
function onGenerateClick() {
  if (!prompt.value.trim() || !businesses.currentBusinessId) return
  showPreGenModal.value = true
}
function onPreGenConfirm() {
  showPreGenModal.value = false
  generate()
}

function generate() {
  if (!prompt.value.trim() || !businesses.currentBusinessId) return
  const sessionId = currentSessionId.value
  if (!sessionId || generating.value) return

  // Capture all state at click time (user may switch sessions)
  const sessionTitle = currentSessionTitle.value || prompt.value.slice(0, 30) || 'Сессия'
  const capturedState = {
    businessId: businesses.currentBusinessId,
    prompt: prompt.value,
    duration: duration.value,
    aspectRatio: aspectRatio.value,
    resolution: resolution.value,
    generateAudio: audio.value,
    inputMode: inputMode.value,
    firstFrameUrl: inputMode.value === 'frames' && firstFrame.value ? firstFrame.value.url : null,
    lastFrameUrl: inputMode.value === 'frames' && lastFrame.value ? lastFrame.value.url : null,
    referenceImageUrls: inputMode.value === 'references' ? refImages.value.map(r => r.url) : [],
  }

  // Save prompt to history + mark generated
  if (!promptHistory.value.length || promptHistory.value[promptHistory.value.length - 1] !== capturedState.prompt) {
    promptHistory.value.push(capturedState.prompt)
  }
  generatedPromptIndices.value.add(promptHistory.value.length - 1)
  historyIndex.value = promptHistory.value.length - 1

  // Персистим состояние (вкл. promptHistory с ✓-маркером) ПОКА статус ещё 'draft', затем оптимистично флипаем
  flush()
  const s = sessions.value.find(s => s.id === sessionId)
  if (s) s.status = 'generating'

  // Fire and forget — не блокируем UI
  runGeneration(sessionId, capturedState, sessionTitle)
}

/** Submit video generation — returns in 2-5 sec, poller handles the rest via SSE */
async function runGeneration(sessionId: string, state: {
  businessId: string; prompt: string; duration: number; aspectRatio: string
  resolution: string; generateAudio: boolean; inputMode: string
  firstFrameUrl: string | null; lastFrameUrl: string | null; referenceImageUrls: string[]
}, sessionTitle: string) {
  try {
    const payload: any = {
      businessId: state.businessId, prompt: state.prompt,
      duration: state.duration, aspectRatio: state.aspectRatio,
      resolution: state.resolution, generateAudio: state.generateAudio,
    }
    if (state.firstFrameUrl) {
      payload.firstFrameUrl = state.firstFrameUrl
      if (state.lastFrameUrl) payload.lastFrameUrl = state.lastFrameUrl
    } else if (state.referenceImageUrls.length) {
      payload.referenceImageUrls = state.referenceImageUrls
    }
    // Возвращается за 2-5 сек (создаёт задачу в KIE); результат придёт через SSE от video-poller
    await http.post('/ai/generate-video', { ...payload, sessionId })
    loadSessions()
    toast.success(`Генерация запущена: ${sessionTitle}`, 3000)
  } catch (e: any) {
    toast.error(`Ошибка: ${e.message || 'Ошибка запуска генерации'}`, 8000)
    const s = sessions.value.find(s => s.id === sessionId)
    if (s) s.status = 'draft'
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
  if (!businesses.currentBusinessId || agentLoading.value) return
  chatMessages.value.push({ role: 'user', content: userText, createdAt: new Date().toISOString() })
  agentLoading.value = true
  try {
    const context = {
      inputMode: inputMode.value,
      refImages: refImages.value.map(r => ({ filename: r.filename, altText: r.altText || null })),
      duration: duration.value,
      aspectRatio: aspectRatio.value,
      resolution: resolution.value,
      generateAudio: audio.value,
      currentPrompt: prompt.value,
    }
    const recentMessages = chatMessages.value.slice(-20).map(m => ({ role: m.role, content: m.content }))
    const res = await http.post<{ content: string }>('/ai/agent-chat', {
      messages: recentMessages,
      context,
      mode: 'advanced',
      businessId: businesses.currentBusinessId,
    })
    const parsed = parseAgentResponse(res.content)
    chatMessages.value.push({
      role: 'assistant',
      content: parsed.text,
      prompts: parsed.prompts,
      suggestions: parsed.suggestions,
      createdAt: new Date().toISOString(),
    })
  } catch (e: any) {
    toast.error(e.message || 'Ошибка агента')
  } finally {
    agentLoading.value = false
    scheduleAutoSave()
  }
}

function onAgentUsePrompt(promptText: string) {
  // Save current prompt to history if different
  if (prompt.value.trim() && (!promptHistory.value.length || promptHistory.value[promptHistory.value.length - 1] !== prompt.value)) {
    promptHistory.value.push(prompt.value)
  }
  setPromptWithBadges(promptText)
  promptHistory.value.push(promptText)
  historyIndex.value = promptHistory.value.length - 1
  toast.success('Промпт загружен из агента')
}

// --- Reference images / frames ---
async function uploadFrame(event: Event, which: 'first' | 'last') {
  const input = event.target as HTMLInputElement
  if (!input.files?.length || !businesses.currentBusinessId) return
  const fd = new FormData()
  fd.append('file', input.files[0])
  fd.append('businessId', businesses.currentBusinessId)
  fd.append('tags', JSON.stringify(['video-frame']))
  try {
    const res = await fetch('/api/media/upload', { method: 'POST', credentials: 'include', headers: { 'X-Tab-ID': TAB_ID }, body: fd })
    if (!res.ok) throw new Error()
    const m = await res.json()
    const frame = { url: m.url, thumbUrl: m.thumbUrl, filename: m.filename }
    if (which === 'first') firstFrame.value = frame; else lastFrame.value = frame
  } catch { toast.error('Ошибка загрузки') }
  input.value = ''
}

async function addRef(event: Event) {
  const input = event.target as HTMLInputElement
  if (!input.files?.length || !businesses.currentBusinessId || refImages.value.length >= 9) return
  const fd = new FormData()
  fd.append('file', input.files[0])
  fd.append('businessId', businesses.currentBusinessId)
  fd.append('tags', JSON.stringify(['video-reference']))
  try {
    const res = await fetch('/api/media/upload', { method: 'POST', credentials: 'include', headers: { 'X-Tab-ID': TAB_ID }, body: fd })
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

function addRefImage(img: RefImage) {
  refImages.value.push(img)
  const idx = refImages.value.length
  richPromptRef.value?.insertBadge({
    badgeType: 'image', id: `img_${idx}`, name: `Image${idx}`, thumbUrl: img.thumbUrl || null,
  })
}

function onUploadClick() {
  showAddMenu.value = false
  fileInputRef.value?.click()
}
function onLibraryClick() {
  showAddMenu.value = false
  showMediaPicker.value = true
}

async function describeRefImage(img: RefImage) {
  describingPreview.value = true
  try {
    const res = await http.post<{ description: string }>('/ai/describe-image', {
      imageUrl: img.url,
      businessId: businesses.currentBusinessId,
      type: 'auto',
    })
    img.altText = res.description
    const found = refImages.value.find(r => r.url === img.url)
    if (found) found.altText = res.description
    toast.success('Описание сгенерировано')
  } catch (e: any) { toast.error(e.message || 'Ошибка AI') }
  finally { describingPreview.value = false }
}

// --- Characters ---
function onCharacterSelect(id: string | null) {
  if (!id) return
  const char = characters.value.find(c => c.id === id)
  if (!char) return
  // Already in working set → open ref modal for viewing
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

async function onRefSaved() {
  await loadCharacters()
  // Sync altText in working set from updated characters data
  for (const img of refImages.value) {
    const char = characters.value.find(c => c.referenceMedia?.url === img.url)
    if (char) img.altText = char.description || null
  }
  showRefModal.value = false
  editingCharacter.value = null
}

// --- Prompt library (right gallery) ---
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

// Characters for @mention autocomplete in VsRichPrompt
const promptCharacters = computed(() =>
  characters.value.map(c => ({ id: c.id, name: c.name, thumbUrl: c.referenceMedia?.thumbUrl || null }))
)

const canGenerate = computed(() => !!prompt.value.trim() && !!businesses.currentBusinessId)

// --- Lifecycle (доменное: персонажи/видео/промпты; сессии/SSE/автосейв — в useStudioSession) ---
onMounted(() => {
  loadCharacters()
  loadVideos()
  loadSavedPrompts()
})
</script>

<template>
  <div class="max-w-[1600px] mx-auto flex flex-col h-[calc(100vh-5rem)] lg:h-[calc(100vh-7.5rem)] overflow-hidden">
    <!-- Header: title -->
    <div class="flex items-center justify-between mb-2 lg:mb-4 shrink-0">
      <h1 class="text-lg font-bold text-gray-800 dark:text-gray-200 flex items-center gap-2">
        <Video :size="20" class="text-emerald-500" />
        Видео-студия
      </h1>
    </div>

    <!-- Main 50/50 layout -->
    <div class="grid grid-cols-1 lg:grid-cols-2 gap-3 lg:gap-6 flex-1 min-h-0">
      <!-- LEFT: Generator -->
      <div class="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 overflow-hidden flex flex-col min-h-0">
        <!-- Session bar (limited height, scrollable) -->
        <VsSessionBar class="shrink-0 lg:max-h-[30vh] lg:overflow-y-auto"
          :sessions="sessions"
          :current-session-id="currentSessionId"
          @load-session="onLoadSession"
          @delete-session="onDeleteSession"
          @create-new="createNew"
          @rename-session="onRenameSession"
        />

        <!-- Character Carousel -->
        <SharedCharacterCarousel
          :characters="characters"
          :model-value="selectedCharacterId"
          color-scheme="emerald"
          @update:model-value="onCharacterSelect"
          @create-new="onCreateRef"
        />

        <!-- Controls (fill remaining space): chat (flex-1) + composer (flex-1) + settings -->
        <div class="flex-1 min-h-0 flex flex-col border-t border-gray-200 dark:border-gray-800">

          <!-- Слитый чат агента (история + ввод + карточки-промпты) -->
          <StudioChat class="flex-1 min-h-0"
            :messages="chatMessages"
            :loading="agentLoading"
            agent-title="AI-агент видеостудии"
            placeholder="Спроси агента…"
            :welcome-text="welcomeText"
            @send="onSendAgentMessage"
            @use-prompt="onAgentUsePrompt"
          />

          <!-- Композер (ВСЕГДА виден, не вкладка): режим + референсы/кадры + промпт + enhance.
               flex-1 + внутренний скролл — делит место с чатом, не съедает настройки. -->
          <div class="flex-1 min-h-0 overflow-y-auto flex flex-col border-t border-gray-200 dark:border-gray-800">
            <!-- Режим ввода -->
            <VsModeTabs v-model="inputMode" />

            <div class="px-4 pb-3 flex flex-col gap-3">
              <!-- INPUT IMAGES: frames or references -->
              <!-- Frames mode -->
              <div v-if="inputMode === 'frames'" class="flex gap-2">
                <div v-for="which in (['first', 'last'] as const)" :key="which">
                  <div v-if="(which === 'first' ? firstFrame : lastFrame)"
                    class="relative group w-16 h-16 rounded-xl overflow-hidden border-2 border-emerald-200 dark:border-emerald-800">
                    <img :src="(which === 'first' ? firstFrame : lastFrame)!.thumbUrl || (which === 'first' ? firstFrame : lastFrame)!.url"
                      class="w-full h-full object-cover" />
                    <div class="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 flex items-center justify-center transition-opacity">
                      <button @click="which === 'first' ? firstFrame = null : lastFrame = null"
                        :aria-label="which === 'first' ? 'Удалить первый кадр' : 'Удалить последний кадр'"
                        title="Удалить кадр" class="p-1.5 bg-red-500/80 rounded-full">
                        <Trash2 :size="12" class="text-white" />
                      </button>
                    </div>
                    <span class="absolute bottom-0.5 left-0.5 px-1 py-0.5 bg-black/70 text-white text-[7px] rounded font-mono">
                      {{ which === 'first' ? '1-й' : 'Посл.' }}
                    </span>
                  </div>
                  <label v-else
                    class="w-16 h-16 rounded-xl border-2 border-dashed border-gray-300 dark:border-gray-700 flex flex-col items-center justify-center cursor-pointer hover:border-emerald-400 transition-colors">
                    <ImageIcon :size="16" class="text-gray-400" />
                    <span class="text-[7px] text-gray-400 mt-0.5">{{ which === 'first' ? '1-й' : 'Посл.' }}</span>
                    <input type="file" accept="image/*" class="hidden"
                      @change="(e: Event) => uploadFrame(e, which)" />
                  </label>
                </div>
              </div>

              <!-- References mode (compact row of 56×56 thumbs) -->
              <div v-if="inputMode === 'references'" class="flex items-center gap-2 overflow-x-auto pb-1">
                <!-- Add button with dropdown (Teleport — parent scrolls) -->
                <div v-if="refImages.length < 9" class="shrink-0">
                  <button ref="addBtnRef" @click="showAddMenu = !showAddMenu" :disabled="generating"
                    aria-label="Добавить референс" title="Добавить референс"
                    class="w-14 h-14 rounded-xl border-2 border-dashed border-gray-300 dark:border-gray-700 flex flex-col items-center justify-center hover:border-emerald-400 transition-colors disabled:opacity-50">
                    <Plus :size="16" class="text-gray-400" />
                    <span class="text-[7px] text-gray-400 mt-0.5">Фото</span>
                  </button>
                  <input ref="fileInputRef" type="file" accept="image/*" class="hidden" @change="addRef" />
                  <Teleport to="body">
                    <div v-if="showAddMenu" class="fixed inset-0 z-40" @click="showAddMenu = false" />
                    <div v-if="showAddMenu" :style="addMenuStyle"
                      class="fixed w-48 bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-xl shadow-xl z-50 py-1 overflow-hidden">
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
                  </Teleport>
                </div>

                <!-- Ref image thumbnails (clickable → preview popup) -->
                <div v-for="(r, idx) in refImages" :key="idx" class="relative group shrink-0">
                  <button @click="previewRef = r"
                    :aria-label="`Референс ${idx + 1}`" :title="r.filename"
                    class="w-14 h-14 rounded-xl overflow-hidden border-2 border-emerald-200 dark:border-emerald-800 cursor-pointer">
                    <img :src="r.thumbUrl || r.url" class="w-full h-full object-cover" />
                    <span class="absolute bottom-0.5 left-0.5 px-1 py-0.5 bg-black/70 text-white text-[7px] rounded font-mono">
                      @{{ idx + 1 }}
                    </span>
                  </button>
                  <button @click="refImages.splice(idx, 1)"
                    aria-label="Удалить референс" title="Удалить референс"
                    class="absolute -top-1 -right-1 w-4 h-4 bg-red-500 rounded-full flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity z-10">
                    <X :size="8" class="text-white" />
                  </button>
                </div>
              </div>

              <!-- Rich prompt (contenteditable + @ImageN badges) -->
              <VsRichPrompt
                ref="richPromptRef"
                :model-value="prompt"
                :characters="promptCharacters"
                placeholder="Опишите видео: объект, действие, камера, освещение, настроение..."
                @update:model-value="prompt = $event; scheduleAutoSave()"
              />

              <!-- Missing refs hint -->
              <button v-if="missingRefs.length" @click="insertAllMissingRefs"
                class="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-950/50 border border-amber-200 dark:border-amber-800 hover:bg-amber-100 dark:hover:bg-amber-900/50 transition-colors w-fit">
                <ImageIcon :size="12" />
                Вставить референсы ({{ missingRefs.length }})
              </button>

              <!-- Action row: enhance + templates toggle + history nav -->
              <div class="flex items-center gap-2 flex-wrap">
                <SharedEnhanceMenu
                  :modes="VIDEO_ENHANCE_MODES"
                  main-mode="enhance"
                  accent="emerald"
                  gate-pro-modes
                  :is-admin="isAdmin"
                  :is-pro-mode="isProMode"
                  :enhancing="enhancing"
                  :disabled="generating || !prompt.trim()"
                  @enhance="onEnhance"
                />

                <button @click="showTemplates = !showTemplates"
                  class="flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-medium text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors">
                  <Sparkles :size="12" class="text-purple-400" />
                  <component :is="showTemplates ? ChevronUp : ChevronDown" :size="12" />
                  Шаблоны
                </button>

                <div class="flex-1" />

                <!-- History nav -->
                <div v-if="promptHistory.length" class="flex items-center gap-1">
                  <span v-if="generatedPromptIndices.has(historyIndex)"
                    class="px-1.5 py-0.5 rounded text-[8px] font-medium bg-emerald-100 dark:bg-emerald-900/50 text-emerald-600 dark:text-emerald-400">
                    ✓ сгенерировано
                  </span>
                  <span v-else class="px-1.5 py-0.5 rounded text-[8px] font-medium bg-gray-100 dark:bg-gray-800 text-gray-400">
                    черновик
                  </span>
                  <button @click="historyBack" :disabled="historyIndex <= 0"
                    aria-label="Предыдущий промпт" title="Предыдущий промпт"
                    class="p-1 rounded hover:bg-gray-100 dark:hover:bg-gray-800 disabled:opacity-30 transition-colors">
                    <ChevronLeft :size="14" />
                  </button>
                  <span class="text-[10px] text-gray-400 min-w-[24px] text-center">{{ historyIndex + 1 }}/{{ promptHistory.length }}</span>
                  <button @click="historyForward" :disabled="historyIndex >= promptHistory.length - 1"
                    aria-label="Следующий промпт" title="Следующий промпт"
                    class="p-1 rounded hover:bg-gray-100 dark:hover:bg-gray-800 disabled:opacity-30 transition-colors">
                    <ChevronRight :size="14" />
                  </button>
                </div>
              </div>

              <!-- Templates (collapsible, AI-generated) -->
              <div v-if="showTemplates">
                <div v-if="loadingTemplates" class="flex flex-wrap gap-1.5">
                  <div v-for="i in 5" :key="i"
                    class="h-7 rounded-full bg-gray-200 dark:bg-gray-700 animate-pulse"
                    :style="{ width: (60 + Math.random() * 40) + 'px' }" />
                </div>
                <div v-else-if="aiTemplates.length" class="flex flex-wrap gap-1.5">
                  <button v-for="t in aiTemplates" :key="t.name"
                    @click="applyTemplate(t.prompt)"
                    class="px-2.5 py-1.5 rounded-full text-xs font-medium bg-emerald-100 dark:bg-emerald-900/50 text-emerald-700 dark:text-emerald-300 hover:bg-emerald-200 dark:hover:bg-emerald-800 transition-colors">
                    {{ t.emoji }} {{ t.name }}
                  </button>
                </div>
                <p v-else class="text-[10px] text-gray-400">Выберите проект для генерации шаблонов</p>
              </div>
            </div>
          </div>

          <!-- Mobile: collapsible gallery section -->
          <div class="lg:hidden shrink-0 border-t border-gray-200 dark:border-gray-800" v-if="generatedVideos.length || generating">
            <button @click="mobileGalleryOpen = !mobileGalleryOpen"
              class="w-full flex items-center justify-between px-3 py-1.5 text-[11px] font-medium text-gray-500 hover:bg-gray-50 dark:hover:bg-gray-800/50">
              <div class="flex items-center gap-1.5">
                <Video :size="12" class="text-emerald-500" />
                <span>Видео</span>
                <span v-if="generatedVideos.length" class="text-[9px] text-gray-400 bg-gray-100 dark:bg-gray-800 px-1.5 py-0.5 rounded-full">{{ generatedVideos.length }}</span>
              </div>
              <ChevronUp :size="12" :class="['transition-transform text-gray-400', mobileGalleryOpen ? '' : 'rotate-180']" />
            </button>
            <div v-if="mobileGalleryOpen" class="max-h-[35vh] overflow-y-auto">
              <VsGallery :videos="generatedVideos" :saved-prompts="savedPrompts" @use-prompt="usePrompt" @rate-prompt="ratePrompt" />
            </div>
          </div>

          <!-- Settings panel (pinned to bottom) -->
          <VsSettingsPanel class="shrink-0"
            :duration="duration"
            :audio="audio"
            :resolution="resolution"
            :aspect-ratio="aspectRatio"
            :cost-rub="costRub"
            :generating="generating"
            :generating-started-at="generatingStartedAt"
            :can-generate="canGenerate"
            @update:duration="duration = $event"
            @update:audio="audio = $event"
            @update:resolution="resolution = $event"
            @update:aspect-ratio="aspectRatio = $event"
            @generate="onGenerateClick"
          />
        </div>
      </div>

      <!-- RIGHT: Gallery (desktop only) -->
      <VsGallery class="hidden lg:flex"
        :videos="generatedVideos"
        :saved-prompts="savedPrompts"
        @use-prompt="usePrompt"
        @rate-prompt="ratePrompt"
      />
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

    <!-- Media Picker Modal (single-select reference) -->
    <MediaPickerModal
      :visible="showMediaPicker"
      :business-id="businesses.currentBusinessId || ''"
      @close="showMediaPicker = false"
      @selected="(f: any) => addRefFromLibrary(f)"
    />

    <!-- Reference Modal (create / view+edit) -->
    <SharedRefModal
      :visible="showRefModal"
      :business-id="businesses.currentBusinessId || ''"
      :character="editingCharacter"
      color-scheme="emerald"
      @close="showRefModal = false; editingCharacter = null"
      @saved="onRefSaved()"
    />

    <!-- Pre-generation Confirmation Modal -->
    <VsPreGenModal
      :visible="showPreGenModal"
      :prompt="prompt"
      :duration="duration"
      :resolution="resolution"
      :aspect-ratio="aspectRatio"
      :generate-audio="audio"
      :cost-rub="costRub"
      @confirm="onPreGenConfirm"
      @cancel="showPreGenModal = false"
    />
  </div>
</template>
