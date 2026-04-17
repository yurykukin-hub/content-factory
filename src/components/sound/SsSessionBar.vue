<script setup lang="ts">
/**
 * Session list for Sound Studio.
 * Pattern from VsSessionBar.vue, adapted for music (shows cover image, status).
 */
import { ref, nextTick } from 'vue'
import { Plus, Pencil, Trash2, Check, X, Music, Loader2, ChevronDown } from 'lucide-vue-next'

export interface MusicSession {
  id: string
  title: string
  prompt: string
  musicTitle: string | null
  musicStyle: string | null
  sunoModel: string | null
  instrumental: boolean | null
  status: string
  audioUrl: string | null
  coverImageUrl: string | null
  costUsd: number | null
  errorMessage?: string | null
  updatedAt: string
}

defineProps<{
  sessions: MusicSession[]
  currentSessionId: string | null
}>()

const emit = defineEmits<{
  loadSession: [session: MusicSession]
  deleteSession: [id: string]
  createNew: []
  renameSession: [id: string, title: string]
}>()

const sessionListOpen = ref(false)
const confirmDeleteId = ref<string | null>(null)
const editingId = ref<string | null>(null)
const editingTitle = ref('')
const editInputRef = ref<HTMLInputElement | null>(null)

function startRename(s: MusicSession, e: Event) {
  e.stopPropagation()
  editingId.value = s.id
  editingTitle.value = s.title || s.musicTitle || s.prompt?.slice(0, 40) || ''
  nextTick(() => { editInputRef.value?.focus(); editInputRef.value?.select() })
}

function saveRename(id: string) {
  const title = editingTitle.value.trim()
  if (title) emit('renameSession', id, title)
  editingId.value = null
}

function confirmDelete(id: string, e: Event) {
  e.stopPropagation()
  confirmDeleteId.value = id
}

const STATUS_DOT: Record<string, string> = {
  draft: 'bg-gray-400',
  generating: 'bg-amber-500 animate-pulse',
  completed: 'bg-fuchsia-500',
  failed: 'bg-red-500',
}

const STATUS_LABEL: Record<string, string> = {
  draft: 'Черновик',
  generating: 'Генерация...',
  completed: 'Готово',
  failed: 'Ошибка',
}
</script>

<template>
  <div class="flex flex-col min-h-0">
    <!-- Header: collapsible on mobile -->
    <div class="flex items-center justify-between px-4 py-1.5 shrink-0 cursor-pointer lg:cursor-default"
         @click="sessionListOpen = !sessionListOpen">
      <div class="flex items-center gap-2 min-w-0">
        <span class="text-[10px] font-semibold text-gray-400 uppercase shrink-0">Сессии</span>
        <!-- Mobile: current session name + count -->
        <span v-if="sessions.length" class="lg:hidden text-[10px] text-gray-500 truncate max-w-[120px]">
          {{ sessions.find(s => s.id === currentSessionId)?.musicTitle
             || sessions.find(s => s.id === currentSessionId)?.title
             || '' }}
        </span>
        <span v-if="sessions.length" class="lg:hidden text-[9px] text-gray-400 bg-gray-100 dark:bg-gray-800 px-1.5 py-0.5 rounded-full shrink-0">
          {{ sessions.length }}
        </span>
        <ChevronDown :size="12"
          :class="['lg:hidden transition-transform text-gray-400 shrink-0', sessionListOpen ? 'rotate-180' : '']" />
      </div>
      <button @click.stop="emit('createNew')"
        class="flex items-center gap-1 px-2 py-0.5 rounded-lg text-[10px] font-medium text-fuchsia-600 hover:bg-fuchsia-50 dark:hover:bg-fuchsia-900/20 transition-colors shrink-0">
        <Plus :size="12" /> Новая
      </button>
    </div>

    <!-- Session list: collapsible on mobile, always visible on desktop -->
    <div :class="[
      'overflow-y-auto px-2 pb-1 space-y-0.5 transition-all duration-200',
      sessionListOpen ? 'max-h-[40vh]' : 'max-h-0 overflow-hidden',
      'lg:max-h-none lg:overflow-y-auto lg:flex-1'
    ]">
      <div v-for="s in sessions" :key="s.id"
        @click="emit('loadSession', s)"
        :class="[
          'flex items-center gap-2 px-2 py-1 rounded-lg cursor-pointer transition-colors group',
          s.status === 'generating'
            ? 'bg-amber-50 dark:bg-amber-900/10 border border-amber-300'
            : currentSessionId === s.id
              ? 'bg-fuchsia-50 dark:bg-fuchsia-900/20 border border-fuchsia-300'
              : 'hover:bg-gray-50 dark:hover:bg-gray-800/50 border border-transparent'
        ]">
        <!-- Thumbnail (cover or icon) -->
        <div class="w-9 h-9 rounded-lg overflow-hidden bg-gray-100 dark:bg-gray-800 shrink-0 flex relative items-center justify-center">
          <div v-if="s.status === 'generating'" class="absolute inset-0 bg-amber-500/20 flex items-center justify-center z-10">
            <Loader2 :size="14" class="text-amber-500 animate-spin" />
          </div>
          <img v-if="s.coverImageUrl" :src="s.coverImageUrl" class="w-full h-full object-cover" />
          <Music v-else :size="14" class="text-gray-300" />
        </div>

        <!-- Info -->
        <div class="flex-1 min-w-0">
          <div class="flex items-center gap-1.5">
            <span :class="['w-1.5 h-1.5 rounded-full shrink-0', STATUS_DOT[s.status]]" />
            <input v-if="editingId === s.id" ref="editInputRef" v-model="editingTitle"
              @click.stop @keyup.enter="saveRename(s.id)" @blur="saveRename(s.id)"
              class="flex-1 min-w-0 text-[11px] font-medium bg-transparent border-b border-fuchsia-400 outline-none px-0 py-0" />
            <span v-else @dblclick="startRename(s, $event)"
              class="text-[11px] font-medium text-gray-700 dark:text-gray-300 truncate">
              {{ s.title || s.musicTitle || s.prompt?.slice(0, 30) || 'Без названия' }}
            </span>
          </div>
          <div class="flex items-center gap-1.5 text-[9px] text-gray-400 mt-0.5">
            <span :class="s.status === 'failed' ? 'text-red-500' : s.status === 'generating' ? 'text-amber-500' : ''">
              {{ STATUS_LABEL[s.status] }}
            </span>
            <span v-if="s.sunoModel">· {{ s.sunoModel.replace('suno/', '').replace('_', '.') }}</span>
            <span v-if="s.instrumental">· Инструм.</span>
          </div>
          <div v-if="s.status === 'failed' && s.errorMessage" class="text-[8px] text-red-400 mt-0.5 truncate">
            {{ s.errorMessage.slice(0, 60) }}
          </div>
        </div>

        <!-- Actions -->
        <div v-if="confirmDeleteId === s.id" class="flex items-center gap-0.5 shrink-0" @click.stop>
          <button @click="emit('deleteSession', s.id)" class="p-1 rounded text-red-500 hover:bg-red-500/10"><Check :size="14" /></button>
          <button @click="confirmDeleteId = null" class="p-1 rounded text-gray-400 hover:text-gray-600"><X :size="14" /></button>
        </div>
        <div v-else-if="editingId !== s.id" class="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
          <button @click="startRename(s, $event)" class="p-1 rounded text-gray-400 hover:text-fuchsia-500"><Pencil :size="10" /></button>
          <button @click="confirmDelete(s.id, $event)" class="p-1 rounded text-gray-400 hover:text-red-500"><Trash2 :size="12" /></button>
        </div>
      </div>

      <div v-if="!sessions.length" class="text-center text-[10px] text-gray-400 py-3">Нет сессий</div>
    </div>
  </div>
</template>
