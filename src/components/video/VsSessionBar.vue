<script setup lang="ts">
import { Plus, FileText, CheckCircle, AlertCircle, Clock, Image } from 'lucide-vue-next'
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
  createNew: []
}>()

const STATUS_ICON: Record<string, any> = {
  draft: FileText,
  generating: Clock,
  completed: CheckCircle,
  failed: AlertCircle,
}

const STATUS_COLOR: Record<string, string> = {
  draft: 'border-gray-300 dark:border-gray-700',
  generating: 'border-amber-400 dark:border-amber-600',
  completed: 'border-emerald-400 dark:border-emerald-600',
  failed: 'border-red-400 dark:border-red-600',
}

const STATUS_DOT: Record<string, string> = {
  draft: 'bg-gray-400',
  generating: 'bg-amber-500',
  completed: 'bg-emerald-500',
  failed: 'bg-red-500',
}
</script>

<template>
  <div class="px-4 py-2 border-b border-gray-100 dark:border-gray-800">
    <div class="flex gap-2 overflow-x-auto pb-1 scrollbar-hide">
      <!-- New session button -->
      <button @click="emit('createNew')"
        class="flex flex-col items-center gap-1 shrink-0 group">
        <div class="w-20 h-14 rounded-lg border-2 border-dashed border-gray-300 dark:border-gray-700 flex items-center justify-center group-hover:border-emerald-400 transition-all">
          <Plus :size="18" class="text-gray-400 group-hover:text-emerald-500 transition-colors" />
        </div>
        <span class="text-[8px] text-gray-400">Новая</span>
      </button>

      <!-- Session cards -->
      <button v-for="s in sessions" :key="s.id"
        @click="emit('loadSession', s)"
        :class="[
          'flex flex-col shrink-0 w-36 rounded-lg border-2 overflow-hidden transition-all text-left',
          currentSessionId === s.id
            ? 'border-emerald-500 ring-1 ring-emerald-500/30'
            : STATUS_COLOR[s.status] || STATUS_COLOR.draft,
          'hover:border-emerald-400'
        ]">
        <!-- Thumbnail row -->
        <div class="flex h-9 bg-gray-50 dark:bg-gray-800/50">
          <template v-if="s.mediaFile">
            <img :src="s.mediaFile.thumbUrl || s.mediaFile.url" class="h-full w-full object-cover" />
          </template>
          <template v-else-if="s.referenceImages?.length">
            <img v-for="(r, i) in (s.referenceImages as any[]).slice(0, 3)" :key="i"
              :src="r.thumbUrl || r.url" class="h-full flex-1 object-cover" />
          </template>
          <div v-else class="flex-1 flex items-center justify-center">
            <component :is="STATUS_ICON[s.status] || FileText" :size="14" class="text-gray-300 dark:text-gray-600" />
          </div>
        </div>
        <!-- Info -->
        <div class="px-1.5 py-1">
          <div class="flex items-center gap-1">
            <span :class="['w-1.5 h-1.5 rounded-full shrink-0', STATUS_DOT[s.status] || STATUS_DOT.draft]" />
            <span class="text-[9px] text-gray-600 dark:text-gray-400 truncate">
              {{ s.title || s.prompt?.slice(0, 20) || 'Без названия' }}
            </span>
          </div>
          <div class="flex items-center gap-1 text-[8px] text-gray-400 mt-0.5">
            <span>{{ s.resolution }} · {{ s.duration }}с</span>
            <span v-if="s.referenceImages?.length" class="flex items-center gap-0.5">
              <Image :size="7" /> {{ (s.referenceImages as any[]).length }}
            </span>
          </div>
        </div>
      </button>
    </div>
  </div>
</template>
