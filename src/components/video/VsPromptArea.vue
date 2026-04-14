<script setup lang="ts">
import {
  Wand2, Loader2, PenTool, ChevronLeft, ChevronRight, ChevronDown, ChevronUp,
  Image, Trash2, Plus, Sparkles,
} from 'lucide-vue-next'
import { ref } from 'vue'

interface FrameRef {
  url: string
  thumbUrl?: string | null
  filename: string
}

interface RefImage {
  url: string
  thumbUrl?: string | null
  filename: string
  role: string
}

interface Template {
  label: string
  prompt: string
}

defineProps<{
  modelValue: string
  inputMode: 'text' | 'frames' | 'references'
  refImages: RefImage[]
  firstFrame: FrameRef | null
  lastFrame: FrameRef | null
  enhancing: boolean
  mergingRefs: boolean
  promptHistory: string[]
  historyIndex: number
  templates: Template[]
}>()

const emit = defineEmits<{
  'update:modelValue': [value: string]
  enhance: []
  mergeReferences: []
  historyBack: []
  historyForward: []
  uploadFrame: [event: Event, which: 'first' | 'last']
  addRef: [event: Event]
  removeRef: [index: number]
  removeFrame: [which: 'first' | 'last']
  openConstructor: []
  updateRefRole: [index: number, role: string]
  applyTemplate: [prompt: string]
}>()

const showTemplates = ref(false)
</script>

<template>
  <div class="px-4 py-3 space-y-3">

    <!-- 1. TEXTAREA -->
    <div>
      <textarea
        :value="modelValue"
        @input="emit('update:modelValue', ($event.target as HTMLTextAreaElement).value)"
        rows="5"
        placeholder="Опишите видео: объект, действие, камера, освещение, настроение..."
        class="w-full px-4 py-3 rounded-xl border border-gray-300 dark:border-gray-700 bg-gray-50 dark:bg-gray-800 focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 text-sm resize-none outline-none transition-colors" />
    </div>

    <!-- 2. ACTION ROW -->
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
        <component :is="showTemplates ? ChevronUp : ChevronDown" :size="12" />
        Шаблоны
      </button>

      <!-- Spacer -->
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

    <!-- 3. TEMPLATES (collapsible) -->
    <div v-if="showTemplates" class="flex flex-wrap gap-1.5">
      <button v-for="t in templates" :key="t.label"
        @click="emit('applyTemplate', t.prompt)"
        class="px-2.5 py-1.5 rounded-full text-xs font-medium bg-emerald-100 dark:bg-emerald-900/50 text-emerald-700 dark:text-emerald-300 hover:bg-emerald-200 dark:hover:bg-emerald-800 transition-colors">
        {{ t.label }}
      </button>
    </div>

    <!-- 4. INPUT IMAGES (conditional) -->

    <!-- Frames mode -->
    <div v-if="inputMode === 'frames'" class="grid grid-cols-2 gap-3">
      <div v-for="which in (['first', 'last'] as const)" :key="which">
        <div v-if="(which === 'first' ? firstFrame : lastFrame)"
          class="flex items-center gap-2 p-2.5 rounded-lg bg-emerald-50 dark:bg-emerald-900/30 border border-emerald-200 dark:border-emerald-800">
          <img :src="(which === 'first' ? firstFrame : lastFrame)!.thumbUrl || (which === 'first' ? firstFrame : lastFrame)!.url"
            class="w-12 h-12 rounded-lg object-cover" />
          <div class="flex-1 min-w-0">
            <div class="text-xs font-medium">{{ which === 'first' ? 'Первый' : 'Последний' }} кадр</div>
            <div class="text-[10px] text-gray-400 truncate">{{ (which === 'first' ? firstFrame : lastFrame)!.filename }}</div>
          </div>
          <button @click="emit('removeFrame', which)" class="p-1 text-gray-400 hover:text-red-500 transition-colors">
            <Trash2 :size="14" />
          </button>
        </div>
        <label v-else
          class="flex flex-col items-center gap-1.5 p-4 rounded-lg border-2 border-dashed border-gray-300 dark:border-gray-700 cursor-pointer hover:border-emerald-400 transition-colors">
          <Image :size="20" class="text-gray-400" />
          <span class="text-xs text-gray-500">{{ which === 'first' ? 'Первый' : 'Последний' }} кадр</span>
          <input type="file" accept="image/*" class="hidden"
            @change="(e: Event) => emit('uploadFrame', e, which)" />
        </label>
      </div>
    </div>

    <!-- References mode -->
    <div v-if="inputMode === 'references'">
      <div class="flex flex-wrap gap-3 mb-2">
        <div v-for="(r, idx) in refImages" :key="idx" class="flex flex-col items-center gap-1">
          <div class="relative group w-16 h-16 rounded-xl overflow-hidden border-2 border-emerald-200 dark:border-emerald-800">
            <img :src="r.thumbUrl || r.url" class="w-full h-full object-cover" />
            <div class="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 flex items-center justify-center transition-opacity">
              <button @click="emit('removeRef', idx)" class="p-1.5 bg-red-500/80 rounded-full">
                <Trash2 :size="10" class="text-white" />
              </button>
            </div>
            <span class="absolute bottom-0.5 left-0.5 px-1 py-0.5 bg-black/70 text-white text-[7px] rounded font-mono">
              @Image{{ idx + 1 }}
            </span>
          </div>
          <select :value="r.role"
            @change="emit('updateRefRole', idx, ($event.target as HTMLSelectElement).value)"
            class="w-16 px-0.5 py-0.5 rounded text-[8px] bg-gray-100 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 text-center">
            <option value="">Роль...</option>
            <option value="face">Лицо</option>
            <option value="background">Фон</option>
            <option value="object">Объект</option>
            <option value="style">Стиль</option>
            <option value="outfit">Одежда</option>
            <option value="pose">Поза</option>
          </select>
        </div>

        <!-- Add button -->
        <label v-if="refImages.length < 9"
          class="w-16 h-16 rounded-xl border-2 border-dashed border-gray-300 dark:border-gray-700 flex flex-col items-center justify-center cursor-pointer hover:border-emerald-400 transition-colors">
          <Plus :size="16" class="text-gray-400" />
          <span class="text-[8px] text-gray-400 mt-0.5">{{ refImages.length }}/9</span>
          <input type="file" accept="image/*" class="hidden" @change="(e: Event) => emit('addRef', e)" />
        </label>
      </div>

      <!-- Merge button -->
      <div v-if="refImages.length" class="flex items-center gap-2">
        <button @click="emit('mergeReferences')" :disabled="mergingRefs"
          class="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-purple-600 hover:bg-purple-700 text-white disabled:opacity-50 transition-colors">
          <Loader2 v-if="mergingRefs" :size="12" class="animate-spin" />
          <Sparkles v-else :size="12" />
          {{ mergingRefs ? 'Распознаю...' : 'Вставить референсы (AI)' }}
        </button>
        <span class="text-[9px] text-gray-400">AI вставит @Image теги в промпт</span>
      </div>
      <p v-else class="text-[10px] text-gray-400">Загрузи фото &mdash; AI распознает и вставит теги</p>
    </div>

  </div>
</template>
