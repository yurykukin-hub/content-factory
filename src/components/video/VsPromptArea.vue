<script setup lang="ts">
import {
  Wand2, Loader2, PenTool, ChevronLeft, ChevronRight, ChevronDown, ChevronUp,
  Image, Trash2, Plus, Sparkles, Upload, FolderOpen, X,
} from 'lucide-vue-next'
import { ref, computed, watch } from 'vue'
import VsRichPrompt from './VsRichPrompt.vue'
import type { BadgeData } from './VsRichPrompt.vue'
import VsEnhanceMenu from './VsEnhanceMenu.vue'
import type { EnhanceMode } from './VsEnhanceMenu.vue'
import VsPromptTabs from './VsPromptTabs.vue'
import VsAgentChat from './VsAgentChat.vue'
import type { AgentMessage } from './VsAgentMessage.vue'

interface FrameRef {
  url: string
  thumbUrl?: string | null
  filename: string
}

interface RefImage {
  url: string
  thumbUrl?: string | null
  filename: string
  altText?: string | null
}

interface AiTemplate {
  emoji: string
  name: string
  prompt: string
}

export interface EnhanceDebugInfo {
  model: string
  tokensIn: number
  tokensOut: number
  costUsd: number
  responseMs: number
}

const props = defineProps<{
  modelValue: string
  inputMode: 'text' | 'frames' | 'references'
  refImages: RefImage[]
  firstFrame: FrameRef | null
  lastFrame: FrameRef | null
  enhancing: boolean
  promptHistory: string[]
  historyIndex: number
  generatedIndices?: Set<number>
  templates: AiTemplate[]
  loadingTemplates: boolean
  isAdmin?: boolean
  isProMode?: boolean
  debugInfo?: EnhanceDebugInfo | null
  // Agent props
  chatMessages?: AgentMessage[]
  agentLoading?: boolean
  agentMode?: 'simple' | 'advanced'
}>()

const emit = defineEmits<{
  'update:modelValue': [value: string]
  enhance: [mode: EnhanceMode]
  historyBack: []
  historyForward: []
  uploadFrame: [event: Event, which: 'first' | 'last']
  addRef: [event: Event]
  addRefFromLibrary: []
  describeRef: [refImage: RefImage]
  removeRef: [index: number]
  removeFrame: [which: 'first' | 'last']
  openConstructor: []
  applyTemplate: [prompt: string]
  loadTemplates: []
  // Agent emits
  agentSend: [message: string]
  agentUsePrompt: [prompt: string]
  'update:agentMode': [mode: 'simple' | 'advanced']
}>()

const activeTab = ref<'agent' | 'editor'>('editor')
const showTemplates = ref(false)
const richPromptRef = ref<InstanceType<typeof VsRichPrompt> | null>(null)
const showAddMenu = ref(false)
const previewRef = ref<RefImage | null>(null)
const fileInputRef = ref<HTMLInputElement | null>(null)
const describingPreview = ref(false)

watch(showTemplates, (val) => {
  if (val && !props.templates.length && !props.loadingTemplates) {
    emit('loadTemplates')
  }
})

// Показывать кнопку "Вставить референсы" когда есть картинки, но их @ImageN нет в тексте
const missingRefs = computed(() => {
  if (props.inputMode !== 'references' || !props.refImages.length) return []
  return props.refImages
    .map((img, i) => ({ img, tag: `@Image${i + 1}`, index: i }))
    .filter(r => !props.modelValue.includes(r.tag))
})

function insertAllMissingRefs() {
  for (const r of missingRefs.value) {
    richPromptRef.value?.insertBadge({
      badgeType: 'image',
      id: `ref-${r.index}`,
      name: `Image${r.index + 1}`,
      thumbUrl: r.img.thumbUrl || r.img.url,
    })
  }
}

function insertBadge(badge: BadgeData) {
  richPromptRef.value?.insertBadge(badge)
}

function setContentWithBadges(text: string, badges: BadgeData[]) {
  richPromptRef.value?.setContentWithBadges(text, badges)
}

function onUploadClick() {
  showAddMenu.value = false
  fileInputRef.value?.click()
}

function onLibraryClick() {
  showAddMenu.value = false
  emit('addRefFromLibrary')
}

function openPreview(img: RefImage) {
  describingPreview.value = false
  previewRef.value = img
}

// Agent context summary for welcome message
const contextSummary = computed(() => {
  const parts: string[] = []
  if (props.refImages.length) parts.push(`${props.refImages.length} фото`)
  if (props.firstFrame || props.lastFrame) parts.push('кадры загружены')
  return parts.length
    ? `Загружено: ${parts.join(', ')}. Режим: ${props.inputMode === 'text' ? 'текст' : props.inputMode === 'frames' ? 'кадры' : 'референсы'}.`
    : 'Пока ничего не загружено. Можно начать с текстового описания.'
})

function onAgentUsePrompt(promptText: string) {
  activeTab.value = 'editor'
  emit('agentUsePrompt', promptText)
}

defineExpose({ insertBadge, openPreview, setContentWithBadges })
</script>

<template>
  <div>
    <!-- Tab switcher: Agent / Editor -->
    <div class="px-4 pt-3 pb-2">
      <VsPromptTabs v-model="activeTab" />
    </div>

    <!-- Agent tab (v-show: keep alive, don't destroy on tab switch) -->
    <VsAgentChat
      v-show="activeTab === 'agent'"
      :messages="chatMessages || []"
      :loading="agentLoading || false"
      :mode="agentMode || 'simple'"
      :disabled="false"
      :context-summary="contextSummary"
      @send="emit('agentSend', $event)"
      @use-prompt="onAgentUsePrompt"
      @update:mode="emit('update:agentMode', $event)" />

    <!-- Editor tab (v-show: keep alive, don't destroy on tab switch) -->
    <div v-show="activeTab === 'editor'" class="px-4 py-3 space-y-3">

    <!-- 1. INPUT IMAGES (above prompt, Kling-style) -->

    <!-- Frames mode -->
    <div v-if="inputMode === 'frames'" class="flex gap-2">
      <div v-for="which in (['first', 'last'] as const)" :key="which">
        <div v-if="(which === 'first' ? firstFrame : lastFrame)"
          class="relative group w-16 h-16 rounded-xl overflow-hidden border-2 border-emerald-200 dark:border-emerald-800">
          <img :src="(which === 'first' ? firstFrame : lastFrame)!.thumbUrl || (which === 'first' ? firstFrame : lastFrame)!.url"
            class="w-full h-full object-cover" />
          <div class="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 flex items-center justify-center transition-opacity">
            <button @click="emit('removeFrame', which)" class="p-1.5 bg-red-500/80 rounded-full">
              <Trash2 :size="10" class="text-white" />
            </button>
          </div>
          <span class="absolute bottom-0.5 left-0.5 px-1 py-0.5 bg-black/70 text-white text-[7px] rounded font-mono">
            {{ which === 'first' ? '1-й' : 'Посл.' }}
          </span>
        </div>
        <label v-else
          class="w-16 h-16 rounded-xl border-2 border-dashed border-gray-300 dark:border-gray-700 flex flex-col items-center justify-center cursor-pointer hover:border-emerald-400 transition-colors">
          <Image :size="16" class="text-gray-400" />
          <span class="text-[7px] text-gray-400 mt-0.5">{{ which === 'first' ? '1-й' : 'Посл.' }}</span>
          <input type="file" accept="image/*" class="hidden"
            @change="(e: Event) => emit('uploadFrame', e, which)" />
        </label>
      </div>
    </div>

    <!-- References mode (compact row above prompt) -->
    <div v-if="inputMode === 'references'" class="flex items-center gap-2">
      <!-- Add button with dropdown -->
      <div v-if="refImages.length < 9" class="relative shrink-0">
        <button @click="showAddMenu = !showAddMenu"
          class="w-14 h-14 rounded-xl border-2 border-dashed border-gray-300 dark:border-gray-700 flex flex-col items-center justify-center hover:border-emerald-400 transition-colors">
          <Plus :size="16" class="text-gray-400" />
          <span class="text-[7px] text-gray-400 mt-0.5">Фото</span>
        </button>
        <!-- Hidden file input -->
        <input ref="fileInputRef" type="file" accept="image/*" class="hidden"
          @change="(e: Event) => emit('addRef', e)" />
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

      <!-- Ref image thumbnails (clickable → preview popup) -->
      <div v-for="(r, idx) in refImages" :key="idx" class="relative group shrink-0">
        <button @click="previewRef = r"
          class="w-14 h-14 rounded-xl overflow-hidden border-2 border-emerald-200 dark:border-emerald-800 cursor-pointer">
          <img :src="r.thumbUrl || r.url" class="w-full h-full object-cover" />
          <span class="absolute bottom-0.5 left-0.5 px-1 py-0.5 bg-black/70 text-white text-[7px] rounded font-mono">
            @{{ idx + 1 }}
          </span>
        </button>
        <button @click="emit('removeRef', idx)"
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
            <button @click="emit('describeRef', previewRef!); describingPreview = true"
              :disabled="describingPreview"
              class="flex items-center gap-1 px-2 py-1 rounded-lg text-[10px] font-medium bg-purple-100 dark:bg-purple-900/50 text-purple-600 dark:text-purple-400 hover:bg-purple-200 dark:hover:bg-purple-800 disabled:opacity-50 transition-colors">
              <Loader2 v-if="describingPreview" :size="10" class="animate-spin" />
              <Sparkles v-else :size="10" />
              {{ previewRef.altText ? 'Перегенерировать' : 'Сгенерировать описание' }}
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

    <!-- 2. RICH PROMPT (contenteditable with badges) -->
    <VsRichPrompt
      ref="richPromptRef"
      :model-value="modelValue"
      @update:model-value="emit('update:modelValue', $event)" />

    <!-- Missing refs hint -->
    <button v-if="missingRefs.length" @click="insertAllMissingRefs"
      class="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-950/50 border border-amber-200 dark:border-amber-800 hover:bg-amber-100 dark:hover:bg-amber-900/50 transition-colors w-fit">
      <Image :size="12" />
      Вставить референсы ({{ missingRefs.length }})
    </button>

    <!-- 3. ACTION ROW -->
    <div class="flex items-center gap-2 flex-wrap">
      <!-- Open constructor -->
      <button @click="emit('openConstructor')"
        class="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium border border-emerald-300 dark:border-emerald-700 text-emerald-600 dark:text-emerald-400 hover:bg-emerald-50 dark:hover:bg-emerald-950 transition-colors">
        <PenTool :size="12" />
        Конструктор
      </button>

      <!-- Enhance (split-button with mode menu) -->
      <VsEnhanceMenu
        :enhancing="enhancing"
        :disabled="!modelValue.trim()"
        :is-admin="isAdmin ?? false"
        :is-pro-mode="isProMode ?? false"
        @enhance="(mode: EnhanceMode) => emit('enhance', mode)" />

      <!-- Templates toggle -->
      <button @click="showTemplates = !showTemplates"
        class="flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-medium text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors">
        <Sparkles :size="12" class="text-purple-400" />
        <component :is="showTemplates ? ChevronUp : ChevronDown" :size="12" />
        Шаблоны
      </button>

      <div class="flex-1" />

      <!-- History nav -->
      <div v-if="promptHistory.length" class="flex items-center gap-1">
        <!-- Generated indicator -->
        <span v-if="generatedIndices?.has(historyIndex)"
          class="px-1.5 py-0.5 rounded text-[8px] font-medium bg-emerald-100 dark:bg-emerald-900/50 text-emerald-600 dark:text-emerald-400">
          ✓ сгенерировано
        </span>
        <span v-else class="px-1.5 py-0.5 rounded text-[8px] font-medium bg-gray-100 dark:bg-gray-800 text-gray-400">
          черновик
        </span>
        <button @click="emit('historyBack')" :disabled="historyIndex <= 0"
          class="p-1 rounded hover:bg-gray-100 dark:hover:bg-gray-800 disabled:opacity-30 transition-colors">
          <ChevronLeft :size="14" />
        </button>
        <span class="text-[10px] text-gray-400 min-w-[24px] text-center">{{ historyIndex + 1 }}/{{ promptHistory.length }}</span>
        <button @click="emit('historyForward')" :disabled="historyIndex >= promptHistory.length - 1"
          class="p-1 rounded hover:bg-gray-100 dark:hover:bg-gray-800 disabled:opacity-30 transition-colors">
          <ChevronRight :size="14" />
        </button>
      </div>
    </div>

    <!-- 3b. DEBUG INFO (visible in Pro mode after enhance) -->
    <div v-if="isProMode && debugInfo"
      class="flex items-center gap-2 px-2 py-1 rounded-lg bg-purple-50 dark:bg-purple-950/30 text-[9px] text-purple-500 dark:text-purple-400 font-mono">
      <span>{{ debugInfo.model.split('/').pop() }}</span>
      <span class="text-purple-300 dark:text-purple-600">|</span>
      <span>{{ debugInfo.tokensIn }}→{{ debugInfo.tokensOut }} tok</span>
      <span class="text-purple-300 dark:text-purple-600">|</span>
      <span>${{ debugInfo.costUsd.toFixed(4) }}</span>
      <span class="text-purple-300 dark:text-purple-600">|</span>
      <span>{{ debugInfo.responseMs }}ms</span>
    </div>

    <!-- 4. TEMPLATES (collapsible, AI-generated) -->
    <div v-if="showTemplates">
      <div v-if="loadingTemplates" class="flex flex-wrap gap-1.5">
        <div v-for="i in 5" :key="i"
          class="h-7 rounded-full bg-gray-200 dark:bg-gray-700 animate-pulse"
          :style="{ width: (60 + Math.random() * 40) + 'px' }" />
      </div>
      <div v-else-if="templates.length" class="flex flex-wrap gap-1.5">
        <button v-for="t in templates" :key="t.name"
          @click="emit('applyTemplate', t.prompt)"
          class="px-2.5 py-1.5 rounded-full text-xs font-medium bg-emerald-100 dark:bg-emerald-900/50 text-emerald-700 dark:text-emerald-300 hover:bg-emerald-200 dark:hover:bg-emerald-800 transition-colors">
          {{ t.emoji }} {{ t.name }}
        </button>
      </div>
      <p v-else class="text-[10px] text-gray-400">Выберите проект для генерации шаблонов</p>
    </div>

    </div><!-- /Editor tab -->
  </div>
</template>
