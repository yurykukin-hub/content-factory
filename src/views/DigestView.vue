<script setup lang="ts">
import { ref, onMounted, computed } from 'vue'
import { http } from '@/api/client'
import { useRouter } from 'vue-router'
import { useToast } from '@/composables/useToast'
import { useBusinessesStore } from '@/stores/businesses'
import { useAuthStore } from '@/stores/auth'
import { platformColor, platformBgColor } from '@/composables/usePlatform'
import { formatDate } from '@/composables/useFormatters'
import { Sunrise, Sparkles, Loader2, Check, X, Lightbulb, CalendarClock, FileEdit, Flame, RotateCcw, ChevronDown, ImagePlus, RefreshCw, Maximize2 } from 'lucide-vue-next'
import MediaPickerModal from '@/components/MediaPickerModal.vue'
import PostPreview from '@/components/posts/preview/PostPreview.vue'

interface DigestTask {
  id: string
  businessId: string
  status: string
  postType: string | null
  title: string | null
  proposedText: string
  proposedTags: string[]
  visualIdea: string | null
  aiReasoning: string | null
  platforms: string[]
  postId: string | null
  createdAt: string
  mediaFileId: string | null
  media: { id: string; url: string; thumbUrl: string | null; altText: string | null } | null
  adaptations?: { platform: string; text: string; hashtags: string[] }[] | null
  previews?: { platform: string; accountName: string; text: string; hashtags: string[] }[]
}

interface InspirationPost {
  id: string
  accountName: string
  text: string
  engagementRate: number | null
  likes: number
  reposts: number
  views: number
  externalUrl: string
}

const router = useRouter()
const toast = useToast()
const businesses = useBusinessesStore()
const auth = useAuthStore()
const isAdmin = computed(() => auth.user?.role === 'ADMIN')

const tasks = ref<DigestTask[]>([])
const inspiration = ref<InspirationPost[]>([])
const loading = ref(true)
const generating = ref(false)
const showArchive = ref(false)
const actingId = ref<string | null>(null)

function bizName(id: string): string {
  return businesses.businesses.find(b => b.id === id)?.name || ''
}

const POST_TYPE_LABELS: Record<string, string> = {
  STORIES: 'Stories', TEXT: 'Пост', PHOTO: 'Фото-пост', VIDEO: 'Видео', REELS: 'Reels',
}

async function load() {
  loading.value = true
  try {
    // proposed + approved + rejected: одобренные (черновик) и отклонённые (архив) остаются
    tasks.value = await http.get<DigestTask[]>('/auto-posts?source=digest&status=proposed,approved,rejected&limit=50')
  } catch (e: any) {
    toast.error('Ошибка загрузки: ' + (e.message || e))
  } finally {
    loading.value = false
  }
  // Вдохновение у конкурентов — отдельно, ошибка не должна ронять дайджест
  const bizId = businesses.currentBusiness?.id
  inspiration.value = bizId
    ? await http.get<InspirationPost[]>(`/auto-posts/competitor-inspiration?businessId=${bizId}`).catch(() => [])
    : []
}

// Активные: предложения сверху, созданные черновики ниже. Отклонённые — отдельно в архиве.
const activeTasks = computed(() => [
  ...tasks.value.filter(t => t.status === 'proposed'),
  ...tasks.value.filter(t => t.status === 'approved'),
])
const archivedTasks = computed(() => tasks.value.filter(t => t.status === 'rejected'))

async function generate() {
  generating.value = true
  try {
    const res = await http.post<{ created: number }>('/auto-posts/generate-digest', {})
    toast.success(res.created ? `Готово: ${res.created} предложений` : 'Новых предложений нет (возможно, уже сгенерированы сегодня)')
    await load()
  } catch (e: any) {
    toast.error('Ошибка: ' + (e.message || e))
  } finally {
    generating.value = false
  }
}

async function approve(task: DigestTask) {
  actingId.value = task.id
  try {
    const res = await http.post<{ postId: string; postType: string }>(`/auto-posts/${task.id}/approve`, {})
    // Оставляем карточку видимой как «черновик создан» — не выкидываем из дайджеста
    task.status = 'approved'
    task.postId = res.postId
    toast.success('Черновик создан')
  } catch (e: any) {
    toast.error('Ошибка: ' + (e.message || e))
  } finally {
    actingId.value = null
  }
}

function openDraft(task: DigestTask) {
  if (!task.postId) return
  router.push(task.postType === 'STORIES' ? `/stories/${task.postId}` : `/posts/${task.postId}`)
}

async function reject(task: DigestTask) {
  actingId.value = task.id
  try {
    await http.post(`/auto-posts/${task.id}/reject`, {})
    task.status = 'rejected' // уходит в архив ниже, не теряется
    toast.info('Отклонено — в архиве ниже')
  } catch (e: any) {
    toast.error('Ошибка: ' + (e.message || e))
  } finally {
    actingId.value = null
  }
}

async function restore(task: DigestTask) {
  actingId.value = task.id
  try {
    await http.post(`/auto-posts/${task.id}/restore`, {})
    task.status = 'proposed'
    toast.success('Возвращено в предложения')
  } catch (e: any) {
    toast.error('Ошибка: ' + (e.message || e))
  } finally {
    actingId.value = null
  }
}

// Замена/добавление подобранного фото (Ф1.2)
const pickerTask = ref<DigestTask | null>(null)

function openPicker(task: DigestTask) {
  pickerTask.value = task
}

async function onPhotoSelected(file: { id: string; url: string; thumbUrl?: string | null; altText?: string | null }) {
  const task = pickerTask.value
  pickerTask.value = null
  if (!task) return
  actingId.value = task.id
  try {
    await http.patch(`/auto-posts/${task.id}`, { mediaFileId: file.id })
    task.mediaFileId = file.id
    task.media = { id: file.id, url: file.url, thumbUrl: file.thumbUrl ?? null, altText: file.altText ?? null }
    toast.success('Фото обновлено')
  } catch (e: any) {
    toast.error('Ошибка: ' + (e.message || e))
  } finally {
    actingId.value = null
  }
}

// Превью «как в соцсети» — активная платформа per task (Ф1.5b)
const activePlatform = ref<Record<string, string>>({})
function previewPlatform(task: DigestTask): string {
  return activePlatform.value[task.id] || task.previews?.[0]?.platform || task.platforms?.[0] || 'VK'
}
function setPreviewPlatform(taskId: string, platform: string) {
  activePlatform.value = { ...activePlatform.value, [taskId]: platform }
}
function previewMedia(task: DigestTask) {
  return task.media ? [{ url: task.media.url, thumbUrl: task.media.thumbUrl, mimeType: 'image/jpeg' }] : []
}

// Лайтбокс фото (Ф1.5c)
const lightboxUrl = ref<string | null>(null)
function openLightbox(url: string) { lightboxUrl.value = url }
function closeLightbox() { lightboxUrl.value = null }

onMounted(load)
</script>

<template>
  <div class="max-w-3xl mx-auto">
    <!-- Header -->
    <div class="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-2">
      <h1 class="text-xl md:text-2xl font-bold flex items-center gap-2">
        <Sunrise :size="24" class="text-brand-500" /> Утренний дайджест
      </h1>
      <button v-if="isAdmin" @click="generate" :disabled="generating"
        class="flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg bg-brand-600 hover:bg-brand-700 text-white text-sm font-medium transition-colors disabled:opacity-50 shrink-0">
        <Loader2 v-if="generating" :size="16" class="animate-spin" /><Sparkles v-else :size="16" />
        {{ generating ? 'Генерирую...' : 'Сгенерировать сейчас' }}
      </button>
    </div>
    <p class="text-sm text-gray-500 mb-5">
      AI-агент анализирует погоду, бронирования и контент-план и предлагает, что постить сегодня. Одобрите — создастся черновик, который можно доработать и опубликовать.
    </p>

    <!-- Вдохновлено у конкурентов -->
    <div v-if="inspiration.length" class="mb-5 bg-fuchsia-50/60 dark:bg-fuchsia-950/20 border border-fuchsia-200 dark:border-fuchsia-900/40 rounded-xl p-4">
      <div class="flex items-center gap-2 mb-2 flex-wrap">
        <Flame :size="16" class="text-fuchsia-500" />
        <span class="text-sm font-semibold text-fuchsia-700 dark:text-fuchsia-300">Вдохновлено у конкурентов</span>
        <span class="text-[11px] text-gray-400">залетело за 7 дней · агент учёл это в предложениях</span>
      </div>
      <div class="space-y-1.5">
        <a v-for="p in inspiration" :key="p.id" :href="p.externalUrl" target="_blank" rel="noopener"
          class="block text-xs text-gray-600 dark:text-gray-400 hover:text-fuchsia-600 dark:hover:text-fuchsia-400 transition-colors">
          <span class="font-medium">{{ p.accountName }}:</span>
          «{{ p.text.slice(0, 110) || '(без текста)' }}{{ p.text.length > 110 ? '…' : '' }}»
          <span class="text-fuchsia-500 whitespace-nowrap">ER {{ p.engagementRate ?? '?' }}% · {{ p.views }}👁</span>
        </a>
      </div>
    </div>

    <!-- Loading -->
    <div v-if="loading" class="space-y-3">
      <div v-for="i in 3" :key="i" class="bg-white dark:bg-gray-900 rounded-xl p-5 border border-gray-200 dark:border-gray-800 animate-pulse h-40"></div>
    </div>

    <!-- Empty -->
    <div v-else-if="activeTasks.length === 0" class="bg-white dark:bg-gray-900 rounded-xl p-8 border border-gray-200 dark:border-gray-800 text-center">
      <Sunrise :size="48" class="mx-auto text-gray-300 dark:text-gray-600 mb-3" />
      <p class="text-gray-500 mb-1">Нет активных предложений</p>
      <p class="text-xs text-gray-400">Агент готовит дайджест каждое утро. Или нажмите «Сгенерировать сейчас».</p>
    </div>

    <!-- Suggestions -->
    <div v-else class="space-y-4">
      <div v-for="task in activeTasks" :key="task.id"
        :class="['rounded-xl p-5 border transition-colors', task.status === 'approved' ? 'bg-green-50/40 dark:bg-green-950/20 border-green-200 dark:border-green-900/50' : 'bg-white dark:bg-gray-900 border-gray-200 dark:border-gray-800']">
        <!-- Top row: type + platforms + biz + date -->
        <div class="flex items-center gap-2 flex-wrap mb-2">
          <span class="px-2 py-0.5 rounded-full text-xs font-semibold bg-brand-100 dark:bg-brand-950 text-brand-700 dark:text-brand-300">
            {{ POST_TYPE_LABELS[task.postType || 'TEXT'] || task.postType }}
          </span>
          <span v-for="p in task.platforms" :key="p" :class="['px-1.5 py-0.5 rounded text-[11px] font-medium', platformColor(p)]">{{ p }}</span>
          <span v-if="bizName(task.businessId)" class="text-xs text-gray-400">· {{ bizName(task.businessId) }}</span>
          <span class="text-xs text-gray-400 ml-auto flex items-center gap-1"><CalendarClock :size="12" /> {{ formatDate(task.createdAt) }}</span>
        </div>

        <!-- Title -->
        <h3 v-if="task.title" class="font-semibold text-base mb-1">{{ task.title }}</h3>

        <!-- Превью «как в соцсети» (Ф1.5b): табы платформ + PostPreview с адаптированным текстом -->
        <div v-if="task.previews?.length" class="mb-3">
          <div v-if="task.previews.length > 1" class="flex gap-1.5 mb-2">
            <button v-for="pv in task.previews" :key="pv.platform" @click="setPreviewPlatform(task.id, pv.platform)"
              :class="['px-2.5 py-1 rounded-md text-xs font-medium transition-colors', previewPlatform(task) === pv.platform ? platformBgColor(pv.platform) : 'text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800']">
              {{ pv.platform }}
            </button>
          </div>
          <template v-for="pv in task.previews" :key="pv.platform">
            <PostPreview v-if="previewPlatform(task) === pv.platform"
              :platform="pv.platform" :account-name="pv.accountName"
              :text="pv.text" :hashtags="pv.hashtags"
              :media-files="previewMedia(task)" :post-type="task.postType || 'TEXT'" />
          </template>
        </div>
        <!-- Fallback (старые предложения без адаптаций) -->
        <template v-else>
          <p class="text-sm text-gray-700 dark:text-gray-300 whitespace-pre-line mb-2">{{ task.proposedText }}</p>
          <div v-if="task.proposedTags?.length" class="flex flex-wrap gap-1 mb-2">
            <span v-for="t in task.proposedTags" :key="t" class="text-xs text-blue-500">#{{ t }}</span>
          </div>
        </template>

        <!-- Управление фото (Ф1.2 + лайтбокс Ф1.5c) -->
        <div v-if="task.media || task.postType === 'PHOTO' || task.postType === 'STORIES'" class="flex items-center gap-2 flex-wrap mb-3">
          <template v-if="task.media">
            <button @click="openLightbox(task.media!.url)"
              class="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-gray-300 dark:border-gray-700 text-xs font-medium text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800">
              <Maximize2 :size="13" /> Открыть фото
            </button>
            <button v-if="task.status === 'proposed'" @click="openPicker(task)" :disabled="actingId === task.id"
              class="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-gray-300 dark:border-gray-700 text-xs font-medium text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800 disabled:opacity-50">
              <RefreshCw :size="13" /> Заменить фото
            </button>
          </template>
          <button v-else-if="task.status === 'proposed'" @click="openPicker(task)"
            class="flex items-center gap-1.5 px-3 py-2 rounded-lg border border-dashed border-gray-300 dark:border-gray-700 text-sm text-gray-500 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors">
            <ImagePlus :size="15" /> Подобрать фото из галереи
          </button>
        </div>

        <!-- Visual idea -->
        <div v-if="task.visualIdea" class="flex items-start gap-1.5 text-xs text-gray-500 mb-2 bg-gray-50 dark:bg-gray-800 rounded-lg p-2">
          <Lightbulb :size="14" class="shrink-0 mt-0.5 text-amber-500" /><span>Визуал: {{ task.visualIdea }}</span>
        </div>

        <!-- Reasoning -->
        <p v-if="task.aiReasoning" class="text-xs text-gray-400 italic mb-3 flex items-start gap-1.5">
          <CalendarClock :size="14" class="shrink-0 mt-0.5" /><span>{{ task.aiReasoning }}</span>
        </p>

        <!-- Actions: предложение -->
        <div v-if="task.status === 'proposed'" class="flex gap-2 pt-1">
          <button @click="approve(task)" :disabled="actingId === task.id"
            class="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-green-600 hover:bg-green-700 text-white text-sm font-medium disabled:opacity-50">
            <Loader2 v-if="actingId === task.id" :size="15" class="animate-spin" /><Check v-else :size="15" />
            Одобрить → черновик
          </button>
          <button @click="reject(task)" :disabled="actingId === task.id"
            class="flex items-center gap-1.5 px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-700 text-sm font-medium text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-800 disabled:opacity-50">
            <X :size="15" /> Отклонить
          </button>
        </div>
        <!-- Actions: черновик уже создан -->
        <div v-else class="flex items-center gap-2 pt-1 flex-wrap">
          <span class="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-green-100 dark:bg-green-900/40 text-green-700 dark:text-green-300 text-sm font-medium">
            <Check :size="15" /> Черновик создан
          </span>
          <button @click="openDraft(task)"
            class="flex items-center gap-1.5 px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-700 text-sm font-medium text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800">
            <FileEdit :size="15" /> Открыть черновик
          </button>
        </div>
      </div>
    </div>

    <!-- Архив отклонённых -->
    <div v-if="!loading && archivedTasks.length" class="mt-5">
      <button @click="showArchive = !showArchive"
        class="flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-700 dark:hover:text-gray-300">
        <ChevronDown :size="16" :class="showArchive ? '' : '-rotate-90'" class="transition-transform" />
        Отклонённые ({{ archivedTasks.length }})
      </button>
      <div v-if="showArchive" class="space-y-2 mt-3">
        <div v-for="task in archivedTasks" :key="task.id"
          class="flex items-start gap-3 bg-gray-50 dark:bg-gray-800/50 rounded-lg p-3 border border-gray-200 dark:border-gray-800">
          <div class="flex-1 min-w-0">
            <div class="text-xs font-medium text-gray-600 dark:text-gray-300">
              {{ POST_TYPE_LABELS[task.postType || 'TEXT'] || task.postType }}<span v-if="task.title"> · {{ task.title }}</span>
            </div>
            <p class="text-xs text-gray-400 mt-0.5">{{ task.proposedText.slice(0, 100) }}{{ task.proposedText.length > 100 ? '…' : '' }}</p>
          </div>
          <button @click="restore(task)" :disabled="actingId === task.id"
            class="shrink-0 flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-medium text-gray-500 hover:bg-gray-200 dark:hover:bg-gray-700 disabled:opacity-50">
            <Loader2 v-if="actingId === task.id" :size="13" class="animate-spin" /><RotateCcw v-else :size="13" /> Вернуть
          </button>
        </div>
      </div>
    </div>

    <!-- Выбор фото из галереи для предложения (Ф1.2) -->
    <MediaPickerModal
      v-if="pickerTask"
      :visible="true"
      :business-id="pickerTask.businessId"
      @selected="onPhotoSelected"
      @close="pickerTask = null"
    />

    <!-- Лайтбокс фото (Ф1.5c) -->
    <Teleport to="body">
      <div v-if="lightboxUrl" class="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80" @click="closeLightbox">
        <img :src="lightboxUrl" class="max-w-full max-h-[88vh] object-contain rounded-lg shadow-2xl" @click.stop />
        <button @click="closeLightbox" class="absolute top-4 right-4 w-9 h-9 rounded-full bg-white/90 shadow-lg flex items-center justify-center text-gray-700 hover:bg-white">
          <X :size="18" />
        </button>
      </div>
    </Teleport>
  </div>
</template>
