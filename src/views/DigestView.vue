<script setup lang="ts">
import { ref, onMounted, computed } from 'vue'
import { http } from '@/api/client'
import { useRouter } from 'vue-router'
import { useToast } from '@/composables/useToast'
import { useBusinessesStore } from '@/stores/businesses'
import { useAuthStore } from '@/stores/auth'
import { platformColor, platformBgColor, platformLabel } from '@/composables/usePlatform'
import { formatDate } from '@/composables/useFormatters'
import { Sunrise, Sparkles, Loader2, Check, X, Lightbulb, CalendarClock, FileEdit, Flame, RotateCcw, ChevronDown, ImagePlus, RefreshCw, Maximize2, Send, Clock, Calendar, Info } from 'lucide-vue-next'
import MediaPickerModal from '@/components/MediaPickerModal.vue'
import PostPreview from '@/components/posts/preview/PostPreview.vue'
import StoriesPreview from '@/components/posts/preview/StoriesPreview.vue'
import StoryDesignModal from '@/components/StoryDesignModal.vue'

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
  media: { id: string; url: string; thumbUrl: string | null; altText: string | null; tags?: string[] } | null
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
const showApproved = ref(false)
const showPublished = ref(false)
const actingId = ref<string | null>(null)

// Прямая публикация сторис из дайджеста (2 пути: «Опубликовать» / «В редактор»)
const scheduleOpenId = ref<string | null>(null)        // id задачи с раскрытым выбором времени
const scheduleAt = ref<Record<string, string>>({})     // datetime-local per task
const confirmTask = ref<DigestTask | null>(null)        // задача в модалке подтверждения
const confirmPlatforms = ref<string[]>([])              // выбранные каналы для публикации (галочки)
const pubResults = ref<{ platform: string; success: boolean; error: string | null }[]>([]) // результат по каналам
const publishingConfirm = ref(false)
function togglePubPlatform(p: string) {
  const i = confirmPlatforms.value.indexOf(p)
  if (i >= 0) confirmPlatforms.value.splice(i, 1)
  else confirmPlatforms.value.push(p)
}
function localNow(): string {
  return new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 16)
}
// Можно опубликовать сразу из дайджеста (без редактора): готовая сторис (дизайн вшит) ИЛИ фото-пост с фото
function canPublishNow(task: DigestTask): boolean {
  if (task.postType === 'STORIES') return isDesigned(task)
  return task.postType === 'PHOTO' && !!task.media
}
function isStoriesTask(task: DigestTask | null): boolean {
  return task?.postType === 'STORIES'
}

function bizName(id: string): string {
  return businesses.businesses.find(b => b.id === id)?.name || ''
}

const POST_TYPE_LABELS: Record<string, string> = {
  STORIES: 'Stories', TEXT: 'Пост', PHOTO: 'Фото-пост', VIDEO: 'Видео', REELS: 'Reels',
}

async function load() {
  loading.value = true
  try {
    // proposed + approved + rejected + published: всё остаётся видимым (черновики, опубликованные, архив)
    tasks.value = await http.get<DigestTask[]>('/auto-posts?source=digest&status=proposed,approved,rejected,published&limit=50')
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

// Развёрнуты только активные предложения (proposed). Одобренные и отклонённые — свёрнутые секции ниже.
const activeTasks = computed(() => tasks.value.filter(t => t.status === 'proposed'))
const approvedTasks = computed(() => tasks.value.filter(t => t.status === 'approved'))
const publishedTasks = computed(() => tasks.value.filter(t => t.status === 'published'))
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

// «В редактор»: одобрить (создать черновик) → перейти в редактор для доработки
async function approveAndOpen(task: DigestTask) {
  if (task.status !== 'approved') await approve(task)
  openDraft(task)
}

function toggleSchedule(taskId: string) {
  scheduleOpenId.value = scheduleOpenId.value === taskId ? null : taskId
  if (scheduleOpenId.value && !scheduleAt.value[taskId]) {
    scheduleAt.value = { ...scheduleAt.value, [taskId]: localNow() }
  }
}

function openPublishConfirm(task: DigestTask) {
  scheduleOpenId.value = null
  confirmTask.value = task
  confirmPlatforms.value = [...(task.platforms || [])] // по умолчанию все каналы выбраны
  pubResults.value = []
}

// Опубликовать сейчас: одобрить + публикация в ВЫБРАННЫЕ каналы (одна сторис, в каждый канал отдельно)
async function doPublishNow(task: DigestTask) {
  if (publishingConfirm.value || !confirmPlatforms.value.length) return
  publishingConfirm.value = true
  pubResults.value = []
  try {
    const res = await http.post<{ results: { platform: string; success: boolean; error: string | null }[] }>(
      `/auto-posts/${task.id}/approve-publish`, { when: 'now', platforms: confirmPlatforms.value }
    )
    pubResults.value = res.results
    const ok = res.results.filter(r => r.success)
    const fail = res.results.filter(r => !r.success)
    if (!fail.length) {
      task.status = 'published'
      toast.success(`Опубликовано: ${ok.map(r => platformLabel(r.platform)).join(', ')}`)
      setTimeout(() => { if (confirmTask.value === task) confirmTask.value = null }, 1400) // дать увидеть галочки
    } else if (ok.length) {
      task.status = 'published'
      toast.info(`Опубликовано: ${ok.map(r => platformLabel(r.platform)).join(', ')} · ошибки: ${fail.map(f => platformLabel(f.platform)).join(', ')}`)
    } else {
      toast.error('Не удалось опубликовать: ' + (fail[0]?.error || ''))
    }
  } catch (e: any) {
    toast.error('Ошибка: ' + (e.message || e))
  } finally {
    publishingConfirm.value = false
  }
}

// Запланировать: одобрить + запланировать публикацию на выбранное время
async function publishScheduled(task: DigestTask) {
  const at = scheduleAt.value[task.id]
  if (!at) return
  actingId.value = task.id
  try {
    await http.post(`/auto-posts/${task.id}/approve-publish`, { when: 'schedule', scheduledAt: new Date(at).toISOString() })
    task.status = 'approved' // пост запланирован; задача одобрена (показ в свёрнутой секции)
    scheduleOpenId.value = null
    toast.success('Запланировано на ' + new Date(at).toLocaleString('ru-RU', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }))
  } catch (e: any) {
    toast.error('Ошибка: ' + (e.message || e))
  } finally {
    actingId.value = null
  }
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
  // Отдаём полное url и в thumbUrl: превью-компоненты берут (thumbUrl||url) → покажут чёткое фото, не мутный thumb 200px
  return task.media ? [{ url: task.media.url, thumbUrl: task.media.url, mimeType: 'image/jpeg' }] : []
}

// Лайтбокс фото (Ф1.5c)
const lightboxUrl = ref<string | null>(null)
function openLightbox(url: string) { lightboxUrl.value = url }
function closeLightbox() { lightboxUrl.value = null }

// Дизайн-сторис (Ф2): фото → satori-картинка с текстом-оверлеем и виджетом
function isDesigned(task: DigestTask): boolean {
  return !!task.media?.tags?.includes('story-design')
}
async function generateDesign(task: DigestTask) {
  if (!task.media) return
  actingId.value = task.id
  try {
    const design = await http.post<{ id: string; url: string; thumbUrl: string | null; tags: string[] }>('/media/render-design', {
      mediaFileId: task.media.id,
      businessId: task.businessId,
      title: task.title || task.proposedText.split('\n')[0].slice(0, 60),
      cta: 'Записаться · nawode.ru',
    })
    await http.patch(`/auto-posts/${task.id}`, { mediaFileId: design.id })
    task.mediaFileId = design.id
    task.media = { id: design.id, url: design.url, thumbUrl: design.thumbUrl, altText: null, tags: design.tags }
    toast.success('Дизайн-сторис готова')
  } catch (e: any) {
    toast.error('Ошибка: ' + (e.message || e))
  } finally {
    actingId.value = null
  }
}

// Корректировка кадра дизайн-сторис (ползунок позиции + перезапекание)
const designTask = ref<DigestTask | null>(null)
function openDesignModal(task: DigestTask) { designTask.value = task }
async function onDesignDone(design: { id: string; url: string; thumbUrl: string | null; tags: string[] }) {
  const task = designTask.value
  if (!task) return
  try {
    await http.patch(`/auto-posts/${task.id}`, { mediaFileId: design.id })
    task.mediaFileId = design.id
    task.media = { id: design.id, url: design.url, thumbUrl: design.thumbUrl, altText: null, tags: design.tags }
  } catch (e: any) { toast.error('Ошибка: ' + (e.message || e)) }
}

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
            <template v-if="previewPlatform(task) === pv.platform">
              <!-- STORIES — вертикальный 9:16; PHOTO — лента соцсети -->
              <StoriesPreview v-if="task.postType === 'STORIES'"
                :platform="pv.platform" :account-name="pv.accountName"
                :text="pv.text" :media-files="previewMedia(task)" :baked="isDesigned(task)" />
              <p v-if="task.postType === 'STORIES' && pv.platform === 'VK'"
                class="mt-2 text-xs text-teal-600 dark:text-teal-400 flex items-start gap-1">
                <Info :size="13" class="shrink-0 mt-0.5" />
                <span>В VK при публикации добавится живая кнопка «Забронировать». Текст «· nawode.ru» на картинке — указатель для Instagram (там ссылка некликабельна).</span>
              </p>
              <PostPreview v-else
                :platform="pv.platform" :account-name="pv.accountName"
                :text="pv.text" :hashtags="pv.hashtags"
                :media-files="previewMedia(task)" :post-type="task.postType || 'PHOTO'" />
            </template>
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
            <!-- Ф2: собрать дизайн-сторис (фото → satori-картинка с текстом+виджетом) -->
            <button v-if="task.status === 'proposed' && task.postType === 'STORIES' && !isDesigned(task)" @click="generateDesign(task)" :disabled="actingId === task.id"
              class="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-brand-600 hover:bg-brand-700 text-white text-xs font-medium disabled:opacity-50">
              <Loader2 v-if="actingId === task.id" :size="13" class="animate-spin" /><Sparkles v-else :size="13" /> Оформить дизайн
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
        <div v-if="task.status === 'proposed'" class="pt-1">
          <!-- Готовая сторис или фото-пост: 2 пути — Опубликовать / В редактор -->
          <template v-if="canPublishNow(task)">
            <div class="flex items-stretch gap-2">
              <button @click="openPublishConfirm(task)" :disabled="actingId === task.id"
                class="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 rounded-l-lg bg-green-600 hover:bg-green-700 active:bg-green-800 text-white text-sm font-semibold disabled:opacity-50 transition-colors touch-manipulation">
                <Send :size="15" /> Опубликовать
              </button>
              <button @click="toggleSchedule(task.id)" :disabled="actingId === task.id"
                class="px-3 rounded-r-lg bg-green-700 hover:bg-green-800 text-white disabled:opacity-50 border-l border-green-500/40 transition-colors touch-manipulation" aria-label="Запланировать">
                <ChevronDown :size="16" :class="scheduleOpenId === task.id ? 'rotate-180' : ''" class="transition-transform" />
              </button>
            </div>
            <!-- Инлайн выбор времени (по шеврону) -->
            <div v-if="scheduleOpenId === task.id"
              class="mt-2 flex flex-col sm:flex-row gap-2 items-stretch p-3 rounded-lg bg-blue-50 dark:bg-blue-950 border border-blue-200 dark:border-blue-800">
              <span class="text-xs text-blue-700 dark:text-blue-300 flex items-center gap-1 shrink-0"><Calendar :size="14" /> Когда:</span>
              <input v-model="scheduleAt[task.id]" type="datetime-local" :min="localNow()"
                class="flex-1 min-w-0 px-2 py-2 rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 text-xs" />
              <button @click="publishScheduled(task)" :disabled="!scheduleAt[task.id] || actingId === task.id"
                class="flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-xs font-medium disabled:opacity-50 shrink-0 touch-manipulation">
                <Loader2 v-if="actingId === task.id" :size="14" class="animate-spin" /><Clock v-else :size="14" /> Запланировать
              </button>
            </div>
            <!-- Вторичное: Поправить кадр (только дизайн-сторис) / В редактор / Отклонить -->
            <div class="flex items-center gap-2 mt-2 flex-wrap">
              <button v-if="isDesigned(task)" @click="openDesignModal(task)" :disabled="actingId === task.id"
                class="flex items-center gap-1.5 px-3 py-2 rounded-lg border border-fuchsia-300 dark:border-fuchsia-700 text-xs font-medium text-fuchsia-600 dark:text-fuchsia-400 hover:bg-fuchsia-50 dark:hover:bg-fuchsia-950 disabled:opacity-50 touch-manipulation">
                <Sparkles :size="13" /> Поправить кадр
              </button>
              <button @click="approveAndOpen(task)" :disabled="actingId === task.id"
                class="flex items-center gap-1.5 px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-700 text-xs font-medium text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-800 disabled:opacity-50 touch-manipulation">
                <FileEdit :size="13" /> В редактор
              </button>
              <button @click="reject(task)" :disabled="actingId === task.id"
                class="flex items-center gap-1.5 px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-700 text-xs font-medium text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-800 disabled:opacity-50 touch-manipulation">
                <X :size="13" /> Отклонить
              </button>
            </div>
          </template>
          <!-- Прочее (сторис без дизайна / посты): классическое одобрение в черновик -->
          <div v-else class="flex gap-2">
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

    <!-- Одобренные черновики (свёрнуто, чтобы не растягивать полотно) -->
    <div v-if="!loading && approvedTasks.length" class="mt-5">
      <button @click="showApproved = !showApproved"
        class="flex items-center gap-1.5 text-sm text-green-600 dark:text-green-400 hover:text-green-700 dark:hover:text-green-300">
        <ChevronDown :size="16" :class="showApproved ? '' : '-rotate-90'" class="transition-transform" />
        <Check :size="14" /> Одобренные черновики ({{ approvedTasks.length }})
      </button>
      <div v-if="showApproved" class="space-y-2 mt-3">
        <div v-for="task in approvedTasks" :key="task.id"
          class="flex items-start gap-3 bg-green-50/40 dark:bg-green-950/20 rounded-lg p-3 border border-green-200 dark:border-green-900/40">
          <div class="flex-1 min-w-0">
            <div class="text-xs font-medium text-gray-600 dark:text-gray-300">
              {{ POST_TYPE_LABELS[task.postType || 'TEXT'] || task.postType }}<span v-if="task.title"> · {{ task.title }}</span>
            </div>
            <p class="text-xs text-gray-400 mt-0.5">{{ task.proposedText.slice(0, 100) }}{{ task.proposedText.length > 100 ? '…' : '' }}</p>
          </div>
          <button @click="openDraft(task)"
            class="shrink-0 flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-medium text-gray-600 dark:text-gray-300 hover:bg-green-100 dark:hover:bg-green-900/40">
            <FileEdit :size="13" /> Открыть
          </button>
        </div>
      </div>
    </div>

    <!-- Опубликовано (свёрнуто) -->
    <div v-if="!loading && publishedTasks.length" class="mt-5">
      <button @click="showPublished = !showPublished"
        class="flex items-center gap-1.5 text-sm text-green-600 dark:text-green-400 hover:text-green-700 dark:hover:text-green-300">
        <ChevronDown :size="16" :class="showPublished ? '' : '-rotate-90'" class="transition-transform" />
        <Send :size="14" /> Опубликовано ({{ publishedTasks.length }})
      </button>
      <div v-if="showPublished" class="space-y-2 mt-3">
        <div v-for="task in publishedTasks" :key="task.id"
          class="flex items-start gap-3 bg-green-50/40 dark:bg-green-950/20 rounded-lg p-3 border border-green-200 dark:border-green-900/40">
          <div v-if="task.media" class="shrink-0 w-10 h-[68px] rounded overflow-hidden bg-gray-100 dark:bg-gray-800">
            <img :src="task.media.thumbUrl || task.media.url" class="w-full h-full object-cover" />
          </div>
          <div class="flex-1 min-w-0">
            <div class="text-xs font-medium text-gray-600 dark:text-gray-300">
              {{ POST_TYPE_LABELS[task.postType || 'TEXT'] || task.postType }}<span v-if="task.title"> · {{ task.title }}</span>
            </div>
            <p class="text-xs text-gray-400 mt-0.5">{{ task.proposedText.slice(0, 90) }}{{ task.proposedText.length > 90 ? '…' : '' }}</p>
          </div>
          <span class="shrink-0 flex items-center gap-1 px-2 py-1 rounded-lg text-xs font-medium text-green-600 dark:text-green-400">
            <Check :size="13" /> в соцсетях
          </span>
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

    <!-- Подтверждение публикации сторис (bottom-sheet на мобильном) -->
    <Teleport to="body">
      <div v-if="confirmTask" class="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/60 p-0 sm:p-4"
        @click.self="!publishingConfirm && (confirmTask = null)">
        <div class="w-full sm:max-w-sm bg-white dark:bg-gray-900 rounded-t-2xl sm:rounded-2xl shadow-2xl max-h-[88vh] overflow-y-auto">
          <div class="flex justify-center pt-3 pb-1 sm:hidden"><div class="w-10 h-1 rounded-full bg-gray-300 dark:bg-gray-700"></div></div>
          <h3 class="text-sm font-semibold text-center pt-2 px-4">Опубликовать {{ isStoriesTask(confirmTask) ? 'сторис' : 'пост' }}</h3>
          <!-- Превью baked-сторис -->
          <div class="flex justify-center px-4 pt-3 pb-2">
            <div class="relative overflow-hidden rounded-xl shadow-md bg-gray-100 dark:bg-gray-800" style="width: 130px; aspect-ratio: 9/16;">
              <img v-if="confirmTask.media" :src="confirmTask.media.url" class="absolute inset-0 w-full h-full object-cover" />
            </div>
          </div>
          <!-- Выбор каналов: одна сторис в каждый выбранный канал отдельно -->
          <div class="px-4 pb-1">
            <div class="text-xs text-gray-500 mb-2 text-center">{{ isStoriesTask(confirmTask) ? 'Сторис' : 'Пост' }} опубликуется в каждый выбранный канал:</div>
            <div class="space-y-1.5">
              <button v-for="p in confirmTask.platforms" :key="p" @click="!publishingConfirm && togglePubPlatform(p)"
                class="w-full flex items-center gap-2.5 px-3 py-2.5 rounded-lg border transition-colors text-left touch-manipulation"
                :class="confirmPlatforms.includes(p) ? 'border-green-400 bg-green-50 dark:bg-green-950/40' : 'border-gray-200 dark:border-gray-700 opacity-60'">
                <span class="w-5 h-5 rounded-md border-2 flex items-center justify-center shrink-0"
                  :class="confirmPlatforms.includes(p) ? 'bg-green-600 border-green-600' : 'border-gray-300 dark:border-gray-600'">
                  <Check v-if="confirmPlatforms.includes(p)" :size="12" class="text-white" />
                </span>
                <span class="w-2 h-2 rounded-full shrink-0" :class="platformBgColor(p)"></span>
                <span class="flex-1 text-sm font-medium">{{ platformLabel(p) }} · {{ isStoriesTask(confirmTask) ? 'Stories' : 'Лента' }}</span>
                <!-- результат по каналу после публикации -->
                <span v-if="pubResults.find(r => r.platform === p)" class="text-xs font-medium shrink-0"
                  :class="pubResults.find(r => r.platform === p)!.success ? 'text-green-600' : 'text-red-500'">
                  {{ pubResults.find(r => r.platform === p)!.success ? '✓ готово' : '✗ ошибка' }}
                </span>
              </button>
            </div>
          </div>
          <p class="text-xs text-gray-400 text-center px-4 py-2.5">Публикация необратима — из соцсетей удаляется вручную</p>
          <div class="flex gap-2 p-4 pt-0">
            <button @click="confirmTask = null" :disabled="publishingConfirm"
              class="flex-1 px-4 py-3 rounded-xl border border-gray-200 dark:border-gray-700 text-sm font-medium text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-800 disabled:opacity-50">
              Назад
            </button>
            <button @click="doPublishNow(confirmTask)" :disabled="publishingConfirm || !confirmPlatforms.length"
              class="flex-1 flex items-center justify-center gap-2 px-4 py-3 rounded-xl bg-green-600 hover:bg-green-700 active:bg-green-800 text-white text-sm font-semibold disabled:opacity-50 transition-colors touch-manipulation">
              <Loader2 v-if="publishingConfirm" :size="16" class="animate-spin" /><Send v-else :size="16" />
              {{ publishingConfirm ? 'Публикую…' : `Опубликовать (${confirmPlatforms.length})` }}
            </button>
          </div>
        </div>
      </div>
    </Teleport>

    <!-- Корректировка кадра дизайн-сторис -->
    <StoryDesignModal
      v-if="designTask"
      :visible="true"
      :business-id="designTask.businessId"
      :media-id="designTask.media?.id || designTask.mediaFileId || ''"
      :title="designTask.title || designTask.proposedText.split('\n')[0]"
      cta="Записаться · nawode.ru"
      @done="onDesignDone"
      @close="designTask = null"
    />
  </div>
</template>
