<script setup lang="ts">
/**
 * Sound Studio — AI music generation view.
 * Сессии / автосейв / SSE / lifecycle вынесены в useStudioSession (общий движок студий).
 * Здесь остаётся доменное: music-стейт, маппинг полей, генерация, агент, персоны.
 * Brand color: fuchsia (matching Content Factory).
 */
import { ref, computed, watch } from 'vue'
import { ChevronUp, Music } from 'lucide-vue-next'
import { http } from '@/api/client'
import { useBusinessesStore } from '@/stores/businesses'
import { useToast } from '@/composables/useToast'
import { useRates } from '@/composables/useRates'
import { useStudioSession } from '@/composables/useStudioSession'

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
const toast = useToast()
const { USD_RUB } = useRates()
const markupPercent = ref(50) // default, loaded from settings

// Load markup percent
http.get<{ usdRubRate: number; markupPercent: number }>('/settings/public')
  .then((data) => { if (data.markupPercent >= 0) markupPercent.value = data.markupPercent })
  .catch(() => {})

// --- Music generation state ---
const musicMode = ref<'simple' | 'custom'>('custom') // forced to custom (Simple-режим скрыт)
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

// --- Cost ---
const MUSIC_COST_USD = 0.11
const costRub = computed(() => {
  const rub = MUSIC_COST_USD * USD_RUB.value * (1 + markupPercent.value / 100)
  return Math.round(rub)
})

const canGenerate = computed(() => {
  if (!businesses.currentBusinessId) return false
  if (musicMode.value === 'simple') return prompt.value.trim().length > 0
  return (lyrics.value.trim().length > 0 || prompt.value.trim().length > 0)
})

// Agent context summary
const contextSummary = computed(() => {
  const parts: string[] = []
  if (musicMode.value === 'custom') parts.push('Полный режим')
  else parts.push('Простой режим')
  if (instrumental.value) parts.push('инструментал')
  if (sunoModel.value) parts.push(sunoModel.value.replace('suno/', '').replace('_', '.'))
  return parts.join(' · ')
})

// --- Session <-> domain mapping (для useStudioSession) ---
function buildSavePayload() {
  return {
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
  }
}

function applySession(session: any) {
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
  musicMode.value = 'custom'
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
  pauseAutoSave,
  resumeAutoSave,
  flush,
} = useStudioSession<MusicSession>({
  type: 'music',
  businessId: computed(() => businesses.currentBusinessId),
  buildSavePayload,
  applySession,
  resetState,
  watchSources: () => [prompt, lyrics, musicStyle, musicTitle, negativeTags, instrumental, vocalGender, sunoModel, styleWeight, weirdnessConstraint, musicMode, selectedPersonaId, chatMessages],
  onCompleted: () => toast.success('Трек готов!'),
  onFailed: () => toast.error('Генерация не удалась'),
  // Переименование в списке — синхронизируем поле заголовка в редакторе
  onRenamed: (id, title) => { if (currentSessionId.value === id) musicTitle.value = title },
})

// --- Results (derived from completed sessions) ---
const trackResults = computed(() => {
  const tracks: any[] = []
  const completed = sessions.value.filter(s => s.status === 'completed' && s.audioUrl)

  for (const s of completed) {
    // Session-level fallback details
    const sessionFallback = {
      prompt: s.prompt || '',
      musicStyle: s.musicStyle || '',
      lyrics: (s as any).lyrics || '',
      sunoModel: s.sunoModel || '',
      instrumental: s.instrumental ?? false,
      vocalGender: (s as any).vocalGender || null,
    }

    // Check results JSON for multiple variants (new API returns 2 tracks)
    const results = (s as any).results as any[] | null
    if (Array.isArray(results) && results.length > 0) {
      for (const r of results) {
        tracks.push({
          sessionId: s.id,
          resultUrl: r.resultUrl,
          audioUrl: r.resultUrl,
          coverImageUrl: r.coverImageUrl,
          costUsd: r.costUsd ?? s.costUsd ?? MUSIC_COST_USD,
          createdAt: r.createdAt || s.updatedAt,
          title: r.title || s.musicTitle || s.title || '',
          duration: r.duration || null,
          favorite: r.favorite ?? false,
          // Prefer per-result snapshot, fallback to session
          prompt: r.prompt || sessionFallback.prompt,
          musicStyle: r.musicStyle || sessionFallback.musicStyle,
          lyrics: r.lyrics || sessionFallback.lyrics,
          sunoModel: r.sunoModel || sessionFallback.sunoModel,
          instrumental: r.instrumental ?? sessionFallback.instrumental,
          vocalGender: r.vocalGender ?? sessionFallback.vocalGender,
        })
      }
    } else {
      // Fallback: single track from session fields (old sessions)
      tracks.push({
        sessionId: s.id,
        resultUrl: s.audioUrl,
        audioUrl: s.audioUrl,
        coverImageUrl: s.coverImageUrl,
        costUsd: s.costUsd || MUSIC_COST_USD,
        createdAt: s.updatedAt,
        title: s.musicTitle || s.title || '',
        duration: null,
        favorite: false,
        ...sessionFallback,
      })
    }
  }
  // Sort newest first
  tracks.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
  return tracks
})

// Flush save immediately when switching tabs
watch(activeTab, flush)

async function onToggleFavorite(resultUrl: string) {
  for (const s of sessions.value) {
    const results = (s as any).results as any[] | null
    if (!Array.isArray(results)) continue
    const idx = results.findIndex(r => r.resultUrl === resultUrl)
    if (idx === -1) continue

    const updated = [...results]
    updated[idx] = { ...updated[idx], favorite: !updated[idx].favorite }

    try {
      await http.put(`/sessions/${s.id}`, { results: updated })
      ;(s as any).results = updated
    } catch {}
    return
  }
}

// --- Generation ---
function requestGenerate() {
  showPreGenModal.value = true
}

async function confirmGenerate() {
  showPreGenModal.value = false
  if (!businesses.currentBusinessId || !currentSessionId.value) return
  if (generating.value) return

  pauseAutoSave()

  try {
    await http.post('/music/generate', {
      businessId: businesses.currentBusinessId,
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
    toast.error(err.message || 'Ошибка генерации')
  } finally {
    resumeAutoSave()
  }
}

// --- Enhance ---
async function onEnhance(mode: MusicEnhanceMode) {
  if (!businesses.currentBusinessId) return
  enhancing.value = true
  try {
    const input = (mode === 'improve' || mode === 'structure' || mode === 'rhyme' || mode === 'translate')
      ? lyrics.value
      : prompt.value

    const res = await http.post<any>('/music/enhance-prompt', {
      prompt: input || prompt.value,
      lyrics: lyrics.value || undefined,
      businessId: businesses.currentBusinessId,
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
      businessId: businesses.currentBusinessId,
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
</script>

<template>
  <div class="max-w-[1600px] mx-auto flex flex-col h-[calc(100vh-5rem)] lg:h-[calc(100vh-7.5rem)] overflow-hidden">
    <!-- Header: title + business selector -->
    <div class="flex items-center justify-between mb-2 lg:mb-4 shrink-0">
      <h1 class="text-lg font-bold text-gray-800 dark:text-gray-200 flex items-center gap-2">
        <Music :size="20" class="text-fuchsia-500" />
        Звуковая студия
      </h1>

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
          @create-new="createNew"
          @rename-session="onRenameSession"
        />

        <!-- Controls (fills remaining space) -->
        <div class="flex-1 min-h-0 flex flex-col border-t border-gray-200 dark:border-gray-800">

          <!-- Prompt Tabs: Agent / Editor -->
          <div class="px-2 py-1 lg:px-4 lg:pb-2 shrink-0">
            <SsPromptTabs v-model="activeTab" />
          </div>

          <!-- Agent tab (v-show: keep alive, don't destroy on tab switch) -->
          <SsAgentChat v-show="activeTab === 'agent'" class="flex-1 min-h-0"
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

          <!-- Editor tab (v-show: keep alive, don't destroy on tab switch) -->
          <div v-show="activeTab === 'editor'" class="px-4 py-2 flex-1 min-h-0 flex flex-col gap-2 overflow-y-auto">
            <!-- Simple mode: just prompt -->
            <div :class="musicMode === 'simple' ? 'flex-1 flex flex-col min-h-0' : ''">
              <label class="text-[10px] font-medium text-gray-500 uppercase tracking-wide shrink-0">
                {{ musicMode === 'custom' ? 'Описание / тема' : 'Промпт' }}
              </label>
              <textarea v-model="prompt" :disabled="generating"
                :placeholder="musicMode === 'simple'
                  ? 'Мечтательный инди-рок про летние вечера: рев-гитары, мягкий женский вокал, 100 bpm'
                  : 'Тема или краткое описание для генерации текста'"
                :rows="musicMode === 'simple' ? undefined : 2"
                :class="[
                  'w-full mt-0.5 px-3 py-2 rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 text-sm placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-fuchsia-500/40 resize-y disabled:opacity-50',
                  musicMode === 'simple' ? 'flex-1 min-h-[60px]' : ''
                ]"
              />
            </div>

            <!-- Custom mode: lyrics + style -->
            <div v-if="musicMode === 'custom'" class="flex-1 min-h-0 flex flex-col gap-2">
              <SsLyricsEditor v-model="lyrics" :disabled="generating" class="flex-1 min-h-0" />
              <SsStylePanel class="shrink-0"
                :music-style="musicStyle"
                :music-title="musicTitle"
                :negative-tags="negativeTags"
                :disabled="generating"
                @update:music-style="musicStyle = $event"
                @update:music-title="musicTitle = $event"
                @update:negative-tags="negativeTags = $event"
              />
            </div>

            <!-- Persona selector + Enhance menu -->
            <div class="flex items-center gap-2 pb-2 shrink-0">
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
              <SsGallery :results="trackResults" :generating="generating" @toggle-favorite="onToggleFavorite" />
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
        @toggle-favorite="onToggleFavorite"
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
