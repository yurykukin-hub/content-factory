<script setup lang="ts">
import {
  Wand2, Loader2, PenTool, ChevronLeft, ChevronRight, ChevronDown, ChevronUp,
  Image, Trash2, Plus, Sparkles, Upload, FolderOpen, Users, X,
} from 'lucide-vue-next'
import { ref, watch } from 'vue'
import VsRichPrompt from './VsRichPrompt.vue'
import type { BadgeData } from './VsRichPrompt.vue'

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

const props = defineProps<{
  modelValue: string
  inputMode: 'text' | 'frames' | 'references'
  refImages: RefImage[]
  firstFrame: FrameRef | null
  lastFrame: FrameRef | null
  enhancing: boolean
  promptHistory: string[]
  historyIndex: number
  templates: AiTemplate[]
  loadingTemplates: boolean
}>()

const emit = defineEmits<{
  'update:modelValue': [value: string]
  enhance: []
  historyBack: []
  historyForward: []
  uploadFrame: [event: Event, which: 'first' | 'last']
  addRef: [event: Event]
  addRefFromLibrary: []
  addRefFromCharacters: []
  removeRef: [index: number]
  removeFrame: [which: 'first' | 'last']
  openConstructor: []
  applyTemplate: [prompt: string]
  loadTemplates: []
}>()

const showTemplates = ref(false)
const richPromptRef = ref<InstanceType<typeof VsRichPrompt> | null>(null)
const showAddMenu = ref(false)
const previewRef = ref<RefImage | null>(null)
const fileInputRef = ref<HTMLInputElement | null>(null)

watch(showTemplates, (val) => {
  if (val && !props.templates.length && !props.loadingTemplates) {
    emit('loadTemplates')
  }
})

function insertBadge(badge: BadgeData) {
  richPromptRef.value?.insertBadge(badge)
}

function onUploadClick() {
  showAddMenu.value = false
  fileInputRef.value?.click()
}

function onLibraryClick() {
  showAddMenu.value = false
  emit('addRefFromLibrary')
}

function onCharactersClick() {
  showAddMenu.value = false
  emit('addRefFromCharacters')
}

defineExpose({ insertBadge })
</script>

<template>
  <div class="px-4 py-3 space-y-3">

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
            {{ which === 'first' ? '1st' : 'last' }}
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
          <span class="text-[7px] text-gray-400 mt-0.5">Image</span>
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
          <button @click="onCharactersClick"
            class="w-full flex items-center gap-2 px-3 py-2 text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors">
            <Users :size="14" class="text-gray-400" />
            Из референсов
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
            <p v-if="previewRef.altText" class="text-xs text-gray-500 dark:text-gray-400 leading-relaxed">
              {{ previewRef.altText }}
            </p>
            <p v-else class="text-xs text-gray-400 italic">Нет описания</p>
          </div>
          <div class="px-4 pb-4">
            <button @click="previewRef = null"
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

    <!-- 3. ACTION ROW -->
    <div class="flex items-center gap-2 flex-wrap">
      <!-- Open constructor -->
      <button @click="emit('openConstructor')"
        class="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium border border-emerald-300 dark:border-emerald-700 text-emerald-600 dark:text-emerald-400 hover:bg-emerald-50 dark:hover:bg-emerald-950 transition-colors">
        <PenTool :size="12" />
        Конструктор
      </button>

      <!-- Enhance -->
      <button @click="emit('enhance')" :disabled="enhancing || !modelValue.trim()"
        class="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium border border-purple-300 dark:border-purple-700 text-purple-600 dark:text-purple-400 hover:bg-purple-50 dark:hover:bg-purple-950 disabled:opacity-50 transition-colors">
        <Loader2 v-if="enhancing" :size="12" class="animate-spin" />
        <Wand2 v-else :size="12" />
        {{ enhancing ? 'Улучшаю...' : 'Улучшить (AI)' }}
      </button>

      <!-- Templates toggle -->
      <button @click="showTemplates = !showTemplates"
        class="flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-medium text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors">
        <Sparkles :size="12" class="text-purple-400" />
        <component :is="showTemplates ? ChevronUp : ChevronDown" :size="12" />
        Шаблоны
      </button>

      <div class="flex-1" />

      <!-- History nav -->
      <div v-if="promptHistory.length" class="flex items-center gap-0.5">
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

  </div>
</template>
