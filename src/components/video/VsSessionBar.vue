<script setup lang="ts">
import { ref } from 'vue'
import { Plus, Trash2, Image } from 'lucide-vue-next'
import { formatDate } from '@/composables/useFormatters'

interface Session {
  id: string; title: string; prompt: string; duration: number; resolution: string
  referenceImages: any; status: string; resultUrl: string | null; costUsd: number | null
  mediaFile?: { url: string; thumbUrl: string | null } | null
  updatedAt: string
}

defineProps<{
  sessions: Session[]
  currentSessionId: string | null
}>()

const emit = defineEmits<{
  loadSession: [session: Session]
  deleteSession: [id: string]
  createNew: []
}>()

const confirmDeleteId = ref<string | null>(null)

const STATUS_DOT: Record<string, string> = {
  draft: 'bg-gray-400',
  generating: 'bg-amber-500 animate-pulse',
  completed: 'bg-emerald-500',
  failed: 'bg-red-500',
}

const STATUS_LABEL: Record<string, string> = {
  draft: 'Черновик',
  generating: 'Генерация...',
  completed: 'Готово',
  failed: 'Ошибка',
}

function getThumbUrl(url: string | null | undefined): string | null {
  if (!url) return null
  // Ensure /api prefix for local uploads
  if (url.startsWith('/uploads/')) return `/api${url}`
  return url
}

function confirmDelete(id: string, e: Event) {
  e.stopPropagation()
  confirmDeleteId.value = id
}

function doDelete(id: string) {
  emit('deleteSession', id)
  confirmDeleteId.value = null
}
</script>

<template>
  <div class="flex flex-col min-h-0">
    <!-- Header -->
    <div class="flex items-center justify-between px-4 py-1.5 shrink-0">
      <span class="text-[10px] font-semibold text-gray-400 uppercase tracking-wider">Сессии</span>
      <button @click="emit('createNew')"
        class="flex items-center gap-1 px-2 py-0.5 rounded-lg text-[10px] font-medium text-emerald-600 dark:text-emerald-400 hover:bg-emerald-50 dark:hover:bg-emerald-900/20 transition-colors">
        <Plus :size="12" /> Новая
      </button>
    </div>

    <!-- Session list (fills available space) -->
    <div class="flex-1 overflow-y-auto px-2 pb-1 space-y-0.5">
      <div v-for="s in sessions" :key="s.id"
        @click="emit('loadSession', s)"
        :class="[
          'flex items-center gap-2 px-2 py-1 rounded-lg cursor-pointer transition-all group',
          currentSessionId === s.id
            ? 'bg-emerald-50 dark:bg-emerald-900/20 border border-emerald-300 dark:border-emerald-700'
            : 'hover:bg-gray-50 dark:hover:bg-gray-800/50 border border-transparent'
        ]">
        <!-- Thumbnail -->
        <div class="w-9 h-9 rounded-lg overflow-hidden bg-gray-100 dark:bg-gray-800 shrink-0 flex">
          <img v-if="s.resultUrl"
            :src="getThumbUrl(s.resultUrl)!"
            class="w-full h-full object-cover"
            @error="($event.target as HTMLImageElement).style.display='none'" />
          <img v-else-if="s.mediaFile?.thumbUrl || s.mediaFile?.url"
            :src="getThumbUrl(s.mediaFile.thumbUrl || s.mediaFile.url)!"
            class="w-full h-full object-cover"
            @error="($event.target as HTMLImageElement).style.display='none'" />
          <template v-else-if="s.referenceImages?.length">
            <img v-for="(r, i) in (s.referenceImages as any[]).slice(0, 2)" :key="i"
              :src="getThumbUrl(r.thumbUrl || r.url)!"
              class="flex-1 h-full object-cover"
              @error="($event.target as HTMLImageElement).style.display='none'" />
          </template>
          <div v-else class="w-full h-full flex items-center justify-center">
            <Image :size="12" class="text-gray-300 dark:text-gray-600" />
          </div>
        </div>

        <!-- Info -->
        <div class="flex-1 min-w-0">
          <div class="flex items-center gap-1.5">
            <span :class="['w-1.5 h-1.5 rounded-full shrink-0', STATUS_DOT[s.status] || STATUS_DOT.draft]" />
            <span class="text-[11px] font-medium text-gray-700 dark:text-gray-300 truncate">
              {{ s.title || s.prompt?.slice(0, 30) || 'Без названия' }}
            </span>
          </div>
          <div class="flex items-center gap-1.5 text-[9px] text-gray-400 mt-0.5">
            <span>{{ STATUS_LABEL[s.status] || s.status }}</span>
            <span>·</span>
            <span>{{ s.resolution }} · {{ s.duration }}с</span>
            <span v-if="s.referenceImages?.length">· 📷{{ (s.referenceImages as any[]).length }}</span>
          </div>
        </div>

        <!-- Delete button -->
        <button v-if="confirmDeleteId !== s.id"
          @click="confirmDelete(s.id, $event)"
          class="p-1 rounded text-gray-300 dark:text-gray-600 opacity-0 group-hover:opacity-100 hover:text-red-500 transition-all shrink-0">
          <Trash2 :size="12" />
        </button>
        <!-- Confirm delete -->
        <div v-else class="flex items-center gap-1 shrink-0" @click.stop>
          <button @click="doDelete(s.id)"
            class="px-1.5 py-0.5 rounded text-[9px] font-medium bg-red-500 text-white hover:bg-red-600 transition-colors">
            Да
          </button>
          <button @click="confirmDeleteId = null"
            class="px-1.5 py-0.5 rounded text-[9px] font-medium text-gray-400 hover:text-gray-600 transition-colors">
            Нет
          </button>
        </div>
      </div>

      <div v-if="!sessions.length" class="text-center text-[10px] text-gray-400 py-3">
        Нет сессий
      </div>
    </div>
  </div>
</template>
