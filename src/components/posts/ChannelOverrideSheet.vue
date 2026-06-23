<script setup lang="ts">
// Bottom-sheet редактирования текста под канал (override). Mobile-first: на телефоне выезжает
// снизу, на десктопе — центрированная модалка. Вся механика (overrideDrafts/save/reset/adapt)
// живёт в родителе — компонент презентационный, общается через props/emits.
// Используется в редакторе поста (PostEditorView) и в дайджесте (DigestView).
import { computed } from 'vue'
import { X, Wand2, RefreshCw, Send, Loader2, ExternalLink, Clock, AlertCircle } from 'lucide-vue-next'
import PostPreview from '@/components/posts/preview/PostPreview.vue'
import { platformLabel, platformBgColor } from '@/composables/usePlatform'
import { platformLimit, charCountColor } from '@/composables/usePlatformLimits'
import { platformNote } from '@/composables/usePlatformRegistry'

interface OverrideDraft { body: string; saving: boolean; dirty: boolean }
interface Channel { id: string; platform: string; accountName: string }

const props = defineProps<{
  show: boolean
  channels: Channel[]
  activeChannelId: string
  masterText: string
  mediaFiles?: any[]
  postType?: string
  overrideDrafts: Record<string, OverrideDraft>
  effectiveText: (id: string) => string
  effectiveHashtags: (id: string) => string[]
  versionFor: (id: string) => any | undefined
  adaptingId: string | null
  publishingId?: string | null
  /** Дайджест может скрыть per-канальную публикацию (там публикация общая). */
  allowPublishOne?: boolean
  /** Скрыть кнопку AI-адаптации (в дайджесте per-task adapt пока не нужен). */
  allowAdapt?: boolean
}>()

const emit = defineEmits<{
  close: []
  changeChannel: [id: string]
  input: [id: string]
  adapt: [id: string]
  reset: [id: string]
  publishOne: [id: string]
  cancelSchedule: [versionId: string]
}>()

const active = computed(() => props.channels.find(c => c.id === props.activeChannelId))
const draft = computed(() => props.overrideDrafts[props.activeChannelId])
const version = computed(() => props.versionFor(props.activeChannelId))
const len = computed(() => props.effectiveText(props.activeChannelId).length)
const limit = computed(() => platformLimit(active.value?.platform || ''))
const locked = computed(() => ['PUBLISHED', 'SCHEDULED'].includes(version.value?.status || ''))
const hasOverride = computed(() => !!version.value)
function fmtDate(d: string) { try { return new Date(d).toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) } catch { return d } }
</script>

<template>
  <Teleport to="body">
    <div v-if="show" class="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/60" @click.self="emit('close')">
      <div class="w-full sm:max-w-lg bg-white dark:bg-gray-900 rounded-t-2xl sm:rounded-2xl shadow-2xl flex flex-col max-h-[90vh]">

        <!-- Drag-ручка (мобильный) -->
        <div class="flex justify-center pt-3 pb-1 sm:hidden shrink-0"><div class="w-10 h-1 rounded-full bg-gray-300 dark:bg-gray-700"></div></div>

        <!-- Шапка -->
        <div class="flex items-center justify-between px-4 py-2 shrink-0">
          <h3 class="text-sm font-semibold">Текст под канал</h3>
          <button @click="emit('close')" class="p-1 rounded-lg text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800"><X :size="18" /></button>
        </div>

        <!-- Табы каналов -->
        <div v-if="channels.length > 1" class="flex gap-1.5 px-4 pb-2 overflow-x-auto shrink-0">
          <button v-for="ch in channels" :key="ch.id" @click="emit('changeChannel', ch.id)"
            :class="['flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium whitespace-nowrap border transition-colors shrink-0',
              activeChannelId === ch.id ? 'border-brand-500 bg-brand-50 dark:bg-brand-950 text-brand-700 dark:text-brand-300' : 'border-gray-200 dark:border-gray-700 text-gray-500']">
            <span :class="['w-2 h-2 rounded-full shrink-0', platformBgColor(ch.platform)]"></span>
            {{ platformLabel(ch.platform) }}
            <span v-if="versionFor(ch.id)" class="w-1.5 h-1.5 rounded-full bg-purple-500 shrink-0" title="есть свой текст"></span>
          </button>
        </div>

        <!-- Прокручиваемая зона: превью + статусы -->
        <div class="flex-1 overflow-y-auto px-4 pb-2 min-h-0">
          <div class="text-[10px] uppercase tracking-wide text-gray-400 mb-1.5">Превью · {{ platformLabel(active?.platform || '') }}</div>
          <PostPreview class="mb-3" :platform="active?.platform || 'VK'" :account-name="active?.accountName || ''"
            :text="effectiveText(activeChannelId)" :hashtags="effectiveHashtags(activeChannelId)" :media-files="mediaFiles" :post-type="postType" />

          <!-- Статус публикации -->
          <div v-if="version?.publishLogs?.[0]?.status === 'FAILED'" class="p-2 rounded-lg bg-red-50 dark:bg-red-950 border border-red-200 dark:border-red-800 mb-2 text-xs text-red-600 dark:text-red-400 flex items-start gap-1.5">
            <AlertCircle :size="13" class="shrink-0 mt-0.5" /> {{ version.publishLogs[0].errorMessage }}
          </div>
          <a v-if="version?.externalUrl" :href="version.externalUrl" target="_blank" class="flex items-center gap-1 text-xs text-green-600 hover:underline mb-2"><ExternalLink :size="12" /> Открыть пост</a>
          <div v-if="version?.status === 'SCHEDULED'" class="flex items-center justify-between gap-2 mb-2 text-xs text-amber-600 dark:text-amber-400">
            <span class="flex items-center gap-1"><Clock :size="12" /> Запланировано{{ version.scheduledAt ? ': ' + fmtDate(version.scheduledAt) : '' }}</span>
            <button @click="emit('cancelSchedule', version.id)" class="px-2 py-0.5 rounded text-[11px] text-red-600 dark:text-red-400 border border-red-300 dark:border-red-700 hover:bg-red-50 dark:hover:bg-red-950">Отменить</button>
          </div>

          <!-- Редактор текста -->
          <div class="flex items-center gap-1.5 mb-1">
            <label class="text-[11px] text-gray-500">Текст для {{ platformLabel(active?.platform || '') }}</label>
            <span v-if="hasOverride" class="text-[10px] text-purple-500">свой текст</span>
            <span v-else class="text-[10px] text-gray-400">наследует мастер</span>
          </div>
          <textarea v-if="draft" v-model="draft.body" @input="emit('input', activeChannelId)" rows="5"
            :disabled="locked"
            :placeholder="locked ? 'Отмените план/публикацию, чтобы редактировать' : `Текст для ${platformLabel(active?.platform || '')}…`"
            class="w-full px-3 py-2.5 rounded-xl border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 text-sm leading-relaxed resize-none focus:border-brand-500 focus:ring-1 focus:ring-brand-500 focus:outline-none dark:text-gray-100 disabled:opacity-60" />
          <div class="flex items-center gap-2 mt-1">
            <span :class="['text-[11px] tabular-nums font-medium', charCountColor(len, limit)]">{{ len }} / {{ limit }}</span>
            <span v-if="len > limit" class="text-[11px] text-red-500">превышен на {{ len - limit }}</span>
            <span v-if="draft?.saving" class="text-[11px] text-gray-400 flex items-center gap-1"><Loader2 :size="11" class="animate-spin" /> сохр.</span>
          </div>
          <p v-if="platformNote(active?.platform || '')" class="text-[11px] text-gray-400 mt-2 leading-relaxed">{{ platformNote(active?.platform || '') }}</p>
        </div>

        <!-- Действия (sticky низ) -->
        <div class="flex items-center gap-2 px-4 py-3 border-t border-gray-100 dark:border-gray-800 shrink-0 flex-wrap">
          <button v-if="allowAdapt !== false" @click="emit('adapt', activeChannelId)" :disabled="adaptingId === activeChannelId || locked"
            class="flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-medium bg-purple-50 dark:bg-purple-950 text-purple-600 dark:text-purple-300 hover:bg-purple-100 dark:hover:bg-purple-900 disabled:opacity-50 transition-colors">
            <Loader2 v-if="adaptingId === activeChannelId" :size="13" class="animate-spin" /><Wand2 v-else :size="13" /> Адаптировать AI
          </button>
          <button v-if="hasOverride && !locked" @click="emit('reset', activeChannelId)"
            class="flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-medium border border-gray-200 dark:border-gray-700 text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors">
            <RefreshCw :size="13" /> Сбросить
          </button>
          <button v-if="allowPublishOne && !locked" @click="emit('publishOne', activeChannelId)" :disabled="publishingId === activeChannelId || len > limit"
            class="flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-medium bg-green-50 dark:bg-green-950 text-green-700 dark:text-green-300 hover:bg-green-100 dark:hover:bg-green-900 disabled:opacity-50 transition-colors">
            <Loader2 v-if="publishingId === activeChannelId" :size="13" class="animate-spin" /><Send v-else :size="13" /> {{ version?.status === 'FAILED' ? 'Повторить' : 'Только сюда' }}
          </button>
          <button @click="emit('close')" class="ml-auto px-4 py-2 rounded-xl text-xs font-medium bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400 hover:bg-gray-200 transition-colors">Готово</button>
        </div>
      </div>
    </div>
  </Teleport>
</template>
