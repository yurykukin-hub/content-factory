<script setup lang="ts">
/**
 * Sound Studio — AI music generation view.
 * Pattern follows VideoStudioView: 50/50 layout, sessions, SSE, auto-save.
 * Brand color: fuchsia (matching Content Factory).
 */
import { ref, computed, watch, onMounted, onBeforeUnmount, nextTick } from 'vue'
import { ChevronDown, ChevronUp, Music } from 'lucide-vue-next'
import { http, TAB_ID } from '@/api/client'
import { useBusinessesStore } from '@/stores/businesses'
import { useAuthStore } from '@/stores/auth'
import { useToast } from '@/composables/useToast'
import { useRates } from '@/composables/useRates'

import SsModeTabs from '@/components/sound/SsModeTabs.vue'
import SsLyricsEditor from '@/components/sound/SsLyricsEditor.vue'
import SsStylePanel from '@/components/sound/SsStylePanel.vue'
import SsSettingsPanel from '@/components/sound/SsSettingsPanel.vue'
import SsSessionBar from '@/components/sound/SsSessionBar.vue'
import SsGallery from '@/components/sound/SsGallery.vue'
import SsPromptTabs from '@/components/sound/SsPromptTabs.vue'
import SsAgentChat from '@/components/sound/SsAgentChat.vue'
import SsEnhanceMenu from '@/components/sound/SsEnhanceMenu.vue'
import SsPreGenModal from '@/components/sound/SsPreGenModal.vue'
import SsPersonaSelector from '@/components/sound/SsPersonaSelector.vue'
import SsCreatePersonaModal from '@/components/sound/SsCreatePersonaModal.vue'
import type { MusicSession } from '@/components/sound/SsSessionBar.vue'
import type { AgentMessage } from '@/components/sound/SsAgentChat.vue'
import type { MusicEnhanceMode } from '@/components/sound/SsEnhanceMenu.vue'

defineOptions({ name: 'SoundStudioView' })

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
const sessions = ref<MusicSession[]>([])
const currentSessionId = ref<string | null>(null)

// --- Music generation state ---
const musicMode = ref<'simple' | 'custom'>('custom') // forced to custom, restore SsModeTabs to enable switching
const prompt = ref('')
const lyrics = ref('')
const musicStyle = ref('')
const musicTitle = ref('')
const negativeTags = ref('')
const instrumental = ref(false)
const vocalGender = ref<'f' | 'm' | null>(null)
const sunoModel = ref('V4_5')
const styleWeight = ref(0.7)
const weirdnessConstraint = ref(0.3)

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
const showCreatePersonaModal = ref(false)
const mobileTracksOpen = ref(false)
const selectedPersonaId = ref<string | null>(null)

// --- Results (from completed sessions) ---
const trackResults = ref<any[]>([])

// --- Cost ---
const MUSIC_COST_USD = 0.11
const costRub = computed(() => {
  const rub = MUSIC_COST_USD * USD_RUB.value * (1 + markupPercent.value / 100)
  return Math.ceil(rub * 100) / 100
})

const canGenerate = computed(() => {
  if (!selectedBizId.value) return false
  if (musicMode.value === 'simple') return prompt.value.trim().length > 0
  return (lyrics.value.trim().length > 0 || prompt.value.trim().length > 0)
})

// --- Auto-save ---
let autoSaveTimer: ReturnType<typeof setTimeout> | null = null
let autoSavePaused = false

function scheduleAutoSave() {
  if (autoSavePaused) return
  if (autoSaveTimer) clearTimeout(autoSaveTimer)
  autoSaveTimer = setTimeout(saveSession, 2000)
}

async function saveSession() {
  if (!currentSessionId.value || autoSavePaused) return
  const current = sessions.value.find(s => s.id === currentSessionId.value)
  if (current && current.status !== 'draft') return

  try {
    await http.put(`/sessions/${currentSessionId.value}`, {
      title: musicTitle.value || prompt.value.slice(0, 40) || '',
      prompt: prompt.value,
      customMode: musicMode.value === 'custom',
      instrumental: instrumental.value,
      lyrics: lyrics.value,
      musicStyle: musicStyle.value,
      musicTitle: musicTitle.value,
      negativeTags: negativeTags.value,
      vocalGender: vocalGender.value,
      styleWeight: styleWeight.value,
      weirdnessConstraint: weirdnessConstraint.value,
      sunoModel: sunoModel.value,
      personaId: selectedPersonaId.value,
      chatHistory: chatMessages.value.length ? chatMessages.value : null,
    })
  } catch {}
}

watch([prompt, lyrics, musicStyle, musicTitle, negativeTags, instrumental, vocalGender, sunoModel, styleWeight, weirdnessConstraint, musicMode, selectedPersonaId, chatMessages], scheduleAutoSave, { deep: true })

// --- Session CRUD ---
async function loadSessions() {
  if (!selectedBizId.value) return
  try {
    sessions.value = await http.get<MusicSession[]>(`/sessions?businessId=${selectedBizId.value}&type=music`)
  } catch {}
}

async function loadDraftSession() {
  if (!selectedBizId.value) return
  const draft = await http.get<any>(`/sessions/draft?businessId=${selectedBizId.value}&type=music`)
  if (draft) {
    loadSessionIntoState(draft)
  } else {
    await createNewSession()
  }
}

async function createNewSession() {
  if (!selectedBizId.value) return
  resetState()
  const session = await http.post<any>('/sessions', {
    businessId: selectedBizId.value,
    type: 'music',
  })
  currentSessionId.value = session.id
  await loadSessions()
}

function loadSessionIntoState(session: any) {
  currentSessionId.value = session.id
  prompt.value = session.prompt || ''
  musicMode.value = session.customMode ? 'custom' : 'simple'
  lyrics.value = session.lyrics || ''
  musicStyle.value = session.musicStyle || ''
  musicTitle.value = session.musicTitle || ''
  negativeTags.value = session.negativeTags || ''
  instrumental.value = session.instrumental ?? false
  vocalGender.value = session.vocalGender || null
  sunoModel.value = session.sunoModel || 'V4_5'
  styleWeight.value = session.styleWeight ?? 0.7
  weirdnessConstraint.value = session.weirdnessConstraint ?? 0.3
  selectedPersonaId.value = session.personaId || null
  chatMessages.value = session.chatHistory || []
  generating.value = session.status === 'generating'
  generatingStartedAt.value = session.kieTaskCreatedAt || null

  // Load results from this session and completed sessions
  loadTrackResults()
}

function resetState() {
  prompt.value = ''
  lyrics.value = ''
  musicStyle.value = ''
  musicTitle.value = ''
  negativeTags.value = ''
  instrumental.value = false
  vocalGender.value = null
  sunoModel.value = 'V4_5'
  styleWeight.value = 0.7
  weirdnessConstraint.value = 0.3
  selectedPersonaId.value = null
  chatMessages.value = []
  generating.value = false
  generatingStartedAt.value = null
  musicMode.value = 'custom'
}

async function onLoadSession(session: MusicSession) {
  // Fetch full session
  const full = await http.get<any>(`/sessions/${session.id}`)
  loadSessionIntoState(full)
}

async function onDeleteSession(id: string) {
  await http.delete(`/sessions/${id}`)
  if (currentSessionId.value === id) {
    currentSessionId.value = null
    await loadDraftSession()
  }
  await loadSessions()
}

async function onRenameSession(id: string, title: string) {
  await http.put(`/sessions/${id}`, { title })
  if (currentSessionId.value === id) musicTitle.value = title
  await loadSessions()
}

async function loadTrackResults() {
  // Collect results from completed sessions (including all variants from results JSON)
  const tracks: typeof trackResults.value = []
  const completed = sessions.value.filter(s => s.status === 'completed' && s.audioUrl)

  for (const s of completed) {
    // Check results JSON for multiple variants (new API returns 2 tracks)
    const results = s.results as any[] | null
    if (Array.isArray(results) && results.length > 0) {
      for (const r of results) {
        tracks.push({
          resultUrl: r.resultUrl,
          audioUrl: r.resultUrl,
          coverImageUrl: r.coverImageUrl,
          prompt: s.prompt || '',
          costUsd: r.costUsd ?? s.costUsd ?? MUSIC_COST_USD,
          createdAt: r.createdAt || s.updatedAt,
          title: r.title || s.musicTitle || s.title || '',
          musicStyle: s.musicStyle || '',
        })
      }
    } else {
      // Fallback: single track from session fields (old sessions)
      tracks.push({
        resultUrl: s.audioUrl,
        audioUrl: s.audioUrl,
        coverImageUrl: s.coverImageUrl,
        prompt: s.prompt || '',
        costUsd: s.costUsd || MUSIC_COST_USD,
        createdAt: s.updatedAt,
        title: s.musicTitle || s.title || '',
        musicStyle: s.musicStyle || '',
      })
    }
  }
  trackResults.value = tracks
}

function onBusinessChange() {
  sessions.value = []
  trackResults.value = []
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
    await http.post('/music/generate', {
      businessId: selectedBizId.value,
      sessionId: currentSessionId.value,
      prompt: musicMode.value === 'custom' ? (lyrics.value || prompt.value) : prompt.value,
      customMode: musicMode.value === 'custom',
      instrumental: instrumental.value,
      style: musicStyle.value || undefined,
      title: musicTitle.value || undefined,
      negativeTags: negativeTags.value || undefined,
      vocalGender: vocalGender.value || undefined,
      styleWeight: styleWeight.value,
      weirdnessConstraint: weirdnessConstraint.value,
      sunoModel: sunoModel.value,
    })
    toast.info('Генерация запущена (1-3 мин)...')
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
async function onEnhance(mode: MusicEnhanceMode) {
  if (!selectedBizId.value) return
  enhancing.value = true
  try {
    const input = (mode === 'improve' || mode === 'structure' || mode === 'rhyme' || mode === 'translate')
      ? lyrics.value
      : prompt.value

    const res = await http.post<any>('/music/enhance-prompt', {
      prompt: input || prompt.value,
      lyrics: lyrics.value || undefined,
      businessId: selectedBizId.value,
      mode,
    })

    // Apply result based on mode
    if (mode === 'lyrics' || mode === 'improve' || mode === 'structure' || mode === 'rhyme' || mode === 'translate') {
      lyrics.value = res.enhancedPrompt
      if (musicMode.value !== 'custom') musicMode.value = 'custom'
    } else if (mode === 'style') {
      musicStyle.value = res.enhancedPrompt
      if (musicMode.value !== 'custom') musicMode.value = 'custom'
    } else {
      prompt.value = res.enhancedPrompt
    }

    toast.success(`Режим "${mode}" применён`)
  } catch (err: any) {
    toast.error(err.message || 'Ошибка улучшения')
  } finally {
    enhancing.value = false
  }
}

// --- Agent Chat ---
function parseAgentResponse(raw: string): { text: string; prompts: string[]; lyrics: string[]; styles: string[]; suggestions: string[] } {
  const prompts: string[] = []
  const lyricsArr: string[] = []
  const styles: string[] = []
  const suggestions: string[] = []

  let text = raw.replace(/<prompt>([\s\S]*?)<\/prompt>/g, (_, p) => { prompts.push(p.trim()); return '' })
  text = text.replace(/<lyrics>([\s\S]*?)<\/lyrics>/g, (_, l) => { lyricsArr.push(l.trim()); return '' })
  text = text.replace(/<style>([\s\S]*?)<\/style>/g, (_, s) => { styles.push(s.trim()); return '' })
  text = text.replace(/<suggestions>([\s\S]*?)<\/suggestions>/g, (_, s) => {
    suggestions.push(...s.split('|').map((x: string) => x.trim()).filter(Boolean))
    return ''
  })

  return { text: text.trim(), prompts, lyrics: lyricsArr, styles, suggestions }
}

async function onSendAgentMessage(userText: string) {
  chatMessages.value.push({ role: 'user', content: userText, createdAt: new Date().toISOString() })
  agentLoading.value = true

  try {
    const res = await http.post<{ content: string }>('/music/agent-chat', {
      messages: chatMessages.value.slice(-20),
      context: {
        customMode: musicMode.value === 'custom',
        instrumental: instrumental.value,
        currentPrompt: prompt.value,
        lyrics: lyrics.value,
        musicStyle: musicStyle.value,
        musicTitle: musicTitle.value,
        sunoModel: sunoModel.value,
        vocalGender: vocalGender.value,
        styleWeight: styleWeight.value,
        weirdnessConstraint: weirdnessConstraint.value,
      },
      mode: agentMode.value,
      businessId: selectedBizId.value,
    })

    const parsed = parseAgentResponse(res.content)
    chatMessages.value.push({
      role: 'assistant',
      content: parsed.text,
      prompts: parsed.prompts,
      lyrics: parsed.lyrics,
      styles: parsed.styles,
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

function onUsePrompt(p: string) { prompt.value = p; activeTab.value = 'editor'; scheduleAutoSave() }
function onUseLyrics(l: string) { lyrics.value = l; musicMode.value = 'custom'; activeTab.value = 'editor'; scheduleAutoSave() }
function onUseStyle(s: string) { musicStyle.value = s; musicMode.value = 'custom'; activeTab.value = 'editor'; scheduleAutoSave() }

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
        loadSessions().then(loadTrackResults)
        if (event.sessionId === currentSessionId.value) {
          if (event.status === 'completed') {
            generating.value = false
            generatingStartedAt.value = null
            toast.success('Трек готов!')
            // Reload full session to get audioUrl
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

// Agent context summary
const contextSummary = computed(() => {
  const parts: string[] = []
  if (musicMode.value === 'custom') parts.push('Полный режим')
  else parts.push('Простой режим')
  if (instrumental.value) parts.push('инструментал')
  if (sunoModel.value) parts.push(sunoModel.value.replace('suno/', '').replace('_', '.'))
  return parts.join(' · ')
})

// --- Lifecycle ---
onMounted(async () => {
  if (!selectedBizId.value && businesses.businesses.length) {
    selectedBizId.value = businesses.businesses[0].id
    businesses.setCurrent(selectedBizId.value)
  }
  connectSSE()
  await loadSessions()
  await loadDraftSession()
})

onBeforeUnmount(() => {
  sseSource?.close()
  if (sseReconnectTimer) clearTimeout(sseReconnectTimer)
  if (autoSaveTimer) clearTimeout(autoSaveTimer)
})
</script>

<template>
  <div class="max-w-[1600px] mx-auto flex flex-col h-[calc(100vh-5rem)] lg:h-[calc(100vh-7.5rem)] overflow-hidden">
    <!-- Header: title + business selector -->
    <div class="flex items-center justify-between mb-2 lg:mb-4 shrink-0">
      <h1 class="text-lg font-bold text-gray-800 dark:text-gray-200 flex items-center gap-2">
        <Music :size="20" class="text-fuchsia-500" />
        Звуковая студия
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
        <SsSessionBar class="shrink-0 lg:max-h-[30vh] lg:overflow-y-auto"
          :sessions="sessions"
          :current-session-id="currentSessionId"
          @load-session="onLoadSession"
          @delete-session="onDeleteSession"
          @create-new="createNewSession"
          @rename-session="onRenameSession"
        />

        <!-- Controls (fills remaining space) -->
        <div class="flex-1 min-h-0 flex flex-col border-t border-gray-200 dark:border-gray-800">
          <!-- Mode tabs: hidden, forced to custom (uncomment SsModeTabs to restore) -->
          <!-- <SsModeTabs v-model="musicMode" class="shrink-0" /> -->

          <!-- Prompt Tabs: Agent / Editor -->
          <div class="px-2 py-1 lg:px-4 lg:pb-2 shrink-0">
            <SsPromptTabs v-model="activeTab" />
          </div>

          <!-- Agent tab (stretches to fill) -->
          <SsAgentChat v-if="activeTab === 'agent'" class="flex-1 min-h-0"
            :messages="chatMessages"
            :loading="agentLoading"
            :mode="agentMode"
            :disabled="generating"
            :context-summary="contextSummary"
            @send="onSendAgentMessage"
            @use-prompt="onUsePrompt"
            @use-lyrics="onUseLyrics"
            @use-style="onUseStyle"
            @update:mode="agentMode = $event"
          />

          <!-- Editor tab (stretches to fill) -->
          <div v-else class="px-4 space-y-3 flex-1 min-h-0 overflow-y-auto">
            <!-- Simple mode: just prompt -->
            <div :class="musicMode === 'simple' ? 'flex-1 flex flex-col min-h-0' : ''">
              <label class="text-[10px] font-medium text-gray-500 uppercase tracking-wide shrink-0">
                {{ musicMode === 'custom' ? 'Описание / тема' : 'Промпт' }}
              </label>
              <textarea v-model="prompt" :disabled="generating"
                :placeholder="musicMode === 'simple'
                  ? 'A dreamy indie rock song about summer nights with reverb guitars and soft female vocals, 100 bpm'
                  : 'Тема или краткое описание для генерации текста'"
                :rows="musicMode === 'simple' ? undefined : 2"
                :class="[
                  'w-full mt-0.5 px-3 py-2 rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 text-sm placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-fuchsia-500/40 resize-y disabled:opacity-50',
                  musicMode === 'simple' ? 'flex-1 min-h-[60px]' : ''
                ]"
              />
            </div>

            <!-- Custom mode: lyrics + style -->
            <template v-if="musicMode === 'custom'">
              <SsLyricsEditor v-model="lyrics" :disabled="generating" />
              <SsStylePanel
                :music-style="musicStyle"
                :music-title="musicTitle"
                :negative-tags="negativeTags"
                :disabled="generating"
                @update:music-style="musicStyle = $event"
                @update:music-title="musicTitle = $event"
                @update:negative-tags="negativeTags = $event"
              />
            </template>

            <!-- Persona selector + Enhance menu -->
            <div class="flex items-center gap-2 pb-2">
              <SsPersonaSelector
                v-if="!instrumental"
                v-model="selectedPersonaId"
                :disabled="generating"
                @create-from-track="showCreatePersonaModal = true"
              />
              <SsEnhanceMenu
                :enhancing="enhancing"
                :disabled="generating || (!prompt && !lyrics)"
                :has-lyrics="!!lyrics.trim()"
                @enhance="onEnhance"
              />
            </div>
          </div>

          <!-- Mobile: collapsible tracks section -->
          <div class="lg:hidden shrink-0 border-t border-gray-200 dark:border-gray-800" v-if="trackResults.length || generating">
            <button @click="mobileTracksOpen = !mobileTracksOpen"
              class="w-full flex items-center justify-between px-3 py-1.5 text-[11px] font-medium text-gray-500 hover:bg-gray-50 dark:hover:bg-gray-800/50">
              <div class="flex items-center gap-1.5">
                <Music :size="12" class="text-fuchsia-500" />
                <span>Треки</span>
                <span v-if="trackResults.length" class="text-[9px] text-gray-400 bg-gray-100 dark:bg-gray-800 px-1.5 py-0.5 rounded-full">{{ trackResults.length }}</span>
              </div>
              <ChevronUp :size="12" :class="['transition-transform text-gray-400', mobileTracksOpen ? '' : 'rotate-180']" />
            </button>
            <div v-if="mobileTracksOpen" class="max-h-[35vh] overflow-y-auto">
              <SsGallery :results="trackResults" :generating="generating" />
            </div>
          </div>

          <!-- Settings panel (pinned to bottom) -->
          <SsSettingsPanel class="shrink-0"
            :suno-model="sunoModel"
            :instrumental="instrumental"
            :vocal-gender="vocalGender"
            :style-weight="styleWeight"
            :weirdness-constraint="weirdnessConstraint"
            :cost-rub="costRub"
            :generating="generating"
            :generating-started-at="generatingStartedAt"
            :can-generate="canGenerate"
            @update:suno-model="sunoModel = $event"
            @update:instrumental="instrumental = $event"
            @update:vocal-gender="vocalGender = $event"
            @update:style-weight="styleWeight = $event"
            @update:weirdness-constraint="weirdnessConstraint = $event"
            @generate="requestGenerate"
          />
        </div>
      </div>

      <!-- RIGHT: Gallery (hidden on mobile — only visible on desktop) -->
      <SsGallery class="hidden lg:flex"
        :results="trackResults"
        :generating="generating"
      />
    </div>

    <!-- Pre-generation confirmation modal -->
    <SsPreGenModal
      :show="showPreGenModal"
      :custom-mode="musicMode === 'custom'"
      :prompt="prompt"
      :lyrics="lyrics"
      :music-style="musicStyle"
      :music-title="musicTitle"
      :negative-tags="negativeTags"
      :instrumental="instrumental"
      :vocal-gender="vocalGender"
      :suno-model="sunoModel"
      :cost-rub="costRub"
      @confirm="confirmGenerate"
      @cancel="showPreGenModal = false"
    />
    <!-- Create Persona Modal -->
    <SsCreatePersonaModal
      :show="showCreatePersonaModal"
      :sessions="sessions as any[]"
      @close="showCreatePersonaModal = false"
      @created="showCreatePersonaModal = false"
    />
  </div>
</template>
