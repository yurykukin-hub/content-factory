<script setup lang="ts">
/**
 * FeedView — единый кокпит «Лента» (Фаза C1b). Заменяет DigestView + PostsView.
 * Источник данных — GET /api/feed (сливает AutoPostTask-предложения и Post).
 * North-star: предложил → правка на месте → «чик» → опубликовано, без захода в редактор.
 */
import { ref, computed, watch, onMounted, onBeforeUnmount } from 'vue'
import { useRouter } from 'vue-router'
import { http } from '@/api/client'
import { useToast } from '@/composables/useToast'
import { useBusinessesStore } from '@/stores/businesses'
import { useAuthStore } from '@/stores/auth'
import { useCreateModalStore } from '@/stores/createModal'
import { useSectionAccess } from '@/composables/useSectionAccess'
import { platformColor, platformLabel } from '@/composables/usePlatform'
import { formatDate } from '@/composables/useFormatters'
import {
  Newspaper, Sparkles, Settings2, Plus, Check, X, FileEdit, CalendarClock,
  ImagePlus, RefreshCw, Maximize2, Send, Clock, Calendar, Pencil, Wand2, Trash2, ChevronDown,
} from 'lucide-vue-next'
import {
  UiTabs, UiCard, UiButton, UiDropdown, UiBadge, UiEmptyState, UiSkeleton, UiTooltip, UiModal,
} from '@/components/ui'
import MediaPickerModal from '@/components/MediaPickerModal.vue'
import PostPreview from '@/components/posts/preview/PostPreview.vue'
import StoriesPreview from '@/components/posts/preview/StoriesPreview.vue'
import OverlayEditor from '@/components/overlay/OverlayEditor.vue'
import DigestSettingsModal from '@/components/feed/DigestSettingsModal.vue'

interface FeedPreview { platform: string; accountName: string; text: string; hashtags: string[] }
interface FeedMedia { id?: string; url: string; thumbUrl: string | null; altText: string | null; tags?: string[] }
interface FeedItem {
  kind: 'proposal' | 'post'
  id: string
  postId?: string
  taskId?: string
  status: 'proposed' | 'draft' | 'scheduled' | 'published'
  postType: string
  title: string | null
  text: string
  previews: FeedPreview[]
  media: FeedMedia[]
  platforms: string[]
  canPublishNow: { ok: boolean; reason?: string }
  createdAt: string
  aiReasoning?: string | null
}

interface PostDetailVersion {
  id: string
  status: string
  body: string
  hashtags: string[]
  platformAccount: { platform: string; accountName: string }
}
interface PostDetail {
  id: string
  postType: string
  versions: PostDetailVersion[]
}

const router = useRouter()
const toast = useToast()
const businesses = useBusinessesStore()
const auth = useAuthStore()
const createModal = useCreateModalStore()
const { canEdit } = useSectionAccess()
const isAdmin = computed(() => auth.user?.role === 'ADMIN')
const canEditPosts = computed(() => canEdit('posts'))

const itemKey = (item: FeedItem) => `${item.kind}:${item.id}`
const PLATFORM_ORDER = ['VK', 'TELEGRAM', 'INSTAGRAM']
const POST_TYPE_LABELS: Record<string, string> = {
  STORIES: 'Stories', TEXT: 'Пост', PHOTO: 'Фото-пост', VIDEO: 'Видео', REELS: 'Reels', CLIPS: 'Клипы',
}

// ---- Загрузка ленты ----
const items = ref<FeedItem[]>([])
const loading = ref(true)
const generating = ref(false)

async function loadFeed() {
  if (!businesses.currentBusiness) return
  loading.value = true
  try {
    items.value = await http.get<FeedItem[]>(`/feed?businessId=${businesses.currentBusiness.id}`)
  } catch (e: any) {
    toast.error('Ошибка загрузки: ' + (e.message || e))
  } finally {
    loading.value = false
  }
}

async function generateDigest() {
  generating.value = true
  try {
    const res = await http.post<{ created: number }>('/auto-posts/generate-digest', {})
    toast.success(res.created ? `Готово: ${res.created} предложений` : 'Новых предложений нет (возможно, уже сгенерированы сегодня)')
    await loadFeed()
  } catch (e: any) {
    toast.error('Ошибка: ' + (e.message || e))
  } finally {
    generating.value = false
  }
}

// ---- Табы статусов ----
const STATUS_TABS: { key: FeedItem['status']; label: string }[] = [
  { key: 'proposed', label: 'Предложения' },
  { key: 'draft', label: 'Черновики' },
  { key: 'scheduled', label: 'Запланировано' },
  { key: 'published', label: 'Опубликовано' },
]
const activeStatus = ref<string>('proposed')
const tabs = computed(() => STATUS_TABS.map(t => ({
  ...t, count: items.value.filter(i => i.status === t.key).length,
})))
const visibleItems = computed(() => items.value.filter(i => i.status === activeStatus.value))

const EMPTY_COPY: Record<FeedItem['status'], { title: string; description: string }> = {
  proposed: { title: 'Нет активных предложений', description: 'Агент готовит дайджест каждое утро. Или нажмите «Сгенерировать сейчас».' },
  draft: { title: 'Нет черновиков', description: 'Одобрите предложение или создайте контент вручную.' },
  scheduled: { title: 'Нет запланированных публикаций', description: 'Запланируйте публикацию из предложения или черновика.' },
  published: { title: 'Пока ничего не опубликовано', description: 'Опубликованный контент появится здесь.' },
}
const emptyCopy = computed(() => EMPTY_COPY[activeStatus.value as FeedItem['status']])

// ---- Детали Post (нужны версии с id для publish/schedule/text-edit) ----
const postDetailCache = ref<Record<string, PostDetail>>({})
async function ensurePostDetail(postId: string, force = false): Promise<PostDetail> {
  if (!force && postDetailCache.value[postId]) return postDetailCache.value[postId]
  const detail = await http.get<PostDetail>(`/posts/${postId}`)
  postDetailCache.value = { ...postDetailCache.value, [postId]: detail }
  return detail
}

// ---- Превью «как в соцсети»: активная платформа per item ----
const activePlatform = ref<Record<string, string>>({})
function orderedPreviews(item: FeedItem) {
  return [...item.previews].sort((a, b) => PLATFORM_ORDER.indexOf(a.platform) - PLATFORM_ORDER.indexOf(b.platform))
}
function previewPlatform(item: FeedItem): string {
  return activePlatform.value[itemKey(item)] || orderedPreviews(item)[0]?.platform || item.platforms[0] || 'VK'
}
function previewMedia(item: FeedItem) {
  return item.media.length ? [{ url: item.media[0].url, thumbUrl: item.media[0].url, mimeType: 'image/jpeg' }] : []
}
function isDesignedMedia(item: FeedItem): boolean {
  const tags = item.media[0]?.tags || []
  return tags.includes('story-design') || tags.includes('overlay')
}

// ---- Правка текста на месте ----
const editingItem = ref<FeedItem | null>(null)
const editingChannel = ref<string>('')
const editDrafts = ref<Record<string, { body: string; saving: boolean; dirty: boolean }>>({})
let draftTimer: ReturnType<typeof setTimeout> | null = null
const editingKey = computed(() => editingItem.value ? itemKey(editingItem.value) : null)

function effectiveText(item: FeedItem, platform: string): string {
  const d = editDrafts.value[platform]
  if (d) return d.body
  return item.previews.find(p => p.platform === platform)?.text ?? item.text
}
function makeDraft(item: FeedItem, platform: string) {
  editDrafts.value[platform] = { body: effectiveText(item, platform), saving: false, dirty: false }
}
function openTextEdit(item: FeedItem) {
  if (editingKey.value) flushDraft(editingChannel.value)
  editingItem.value = item
  editDrafts.value = {}
  const p = previewPlatform(item)
  makeDraft(item, p)
  editingChannel.value = p
}
function closeTextEdit() {
  if (editingChannel.value) flushDraft(editingChannel.value)
  editingItem.value = null
  editDrafts.value = {}
}
function onPreviewEdit(item: FeedItem, platform: string, text: string) {
  if (!editDrafts.value[platform]) makeDraft(item, platform)
  editDrafts.value[platform].body = text
  editingChannel.value = platform
  onDraftInput(platform)
}
function changeEditChannel(item: FeedItem, platform: string) {
  const prev = editingChannel.value
  if (prev && prev !== platform) flushDraft(prev)
  makeDraft(item, platform)
  editingChannel.value = platform
}
function onDraftInput(platform: string) {
  const d = editDrafts.value[platform]
  if (!d) return
  d.dirty = true
  if (draftTimer) clearTimeout(draftTimer)
  draftTimer = setTimeout(() => saveDraft(platform), 1000)
}
async function saveDraft(platform: string) {
  const d = editDrafts.value[platform]
  const item = editingItem.value
  if (!d || !d.dirty || !item) return
  d.saving = true
  try {
    if (item.kind === 'proposal') {
      const adaptations = item.previews.map(p => ({
        platform: p.platform,
        text: p.platform === platform ? d.body : p.text,
        hashtags: p.hashtags,
      }))
      await http.patch(`/auto-posts/${item.id}`, { adaptations })
    } else {
      const detail = await ensurePostDetail(item.postId!)
      const version = detail.versions.find(v => v.platformAccount.platform === platform)
      if (version) await http.put(`/post-versions/${version.id}`, { body: d.body })
    }
    const pv = item.previews.find(p => p.platform === platform)
    if (pv) pv.text = d.body
    d.dirty = false
  } catch {
    toast.error('Не удалось сохранить текст')
  } finally {
    d.saving = false
  }
}
function flushDraft(platform: string) {
  const d = editDrafts.value[platform]
  if (d?.dirty) saveDraft(platform)
}
function setPreviewPlatform(item: FeedItem, platform: string) {
  if (editingKey.value === itemKey(item)) changeEditChannel(item, platform)
  activePlatform.value = { ...activePlatform.value, [itemKey(item)]: platform }
}

// ---- Фото: замена через медиатеку ----
const pickerItem = ref<FeedItem | null>(null)
function openPicker(item: FeedItem) { pickerItem.value = item }
async function onPhotoSelected(file: { id: string; url: string; thumbUrl?: string | null; altText?: string | null }) {
  const item = pickerItem.value
  pickerItem.value = null
  if (!item) return
  actingKey.value = itemKey(item)
  try {
    if (item.kind === 'proposal') {
      await http.patch(`/auto-posts/${item.id}`, { mediaFileId: file.id })
    } else {
      const oldId = item.media[0]?.id
      if (oldId && oldId !== file.id) await http.post(`/media/${oldId}/attach`, { postId: null }).catch(() => {})
      await http.post(`/media/${file.id}/attach`, { postId: item.postId })
    }
    item.media = [{ id: file.id, url: file.url, thumbUrl: file.thumbUrl ?? null, altText: file.altText ?? null }]
    toast.success('Фото обновлено')
  } catch (e: any) {
    toast.error('Ошибка: ' + (e.message || e))
  } finally {
    actingKey.value = null
  }
}

// ---- Оформление/кадр — единый OverlayEditor (Фаза B) ----
const overlayItem = ref<FeedItem | null>(null)
function openOverlay(item: FeedItem) { overlayItem.value = item }
function closeOverlay() { overlayItem.value = null }
async function onOverlayBaked(payload: { mediaFileId: string; url: string; spec: unknown }) {
  const item = overlayItem.value
  if (!item) return
  item.media = [{ id: payload.mediaFileId, url: payload.url, thumbUrl: payload.url, altText: null, tags: ['overlay'] }]
  if (item.kind === 'proposal') {
    // Пост ещё не создан — привязываем запечённое медиа к предложению.
    try {
      await http.patch(`/auto-posts/${item.id}`, { mediaFileId: payload.mediaFileId })
    } catch {
      toast.error('Не удалось привязать оформление')
    }
  }
  // kind==='post': backend render-overlay уже привязал baked-медиа к посту (Post.overlaySpec + attach).
}

// ---- Лайтбокс ----
const lightboxUrl = ref<string | null>(null)
function openLightbox(url: string) { lightboxUrl.value = url }
function closeLightbox() { lightboxUrl.value = null }

// ---- Одобрить / Отклонить / В редактор ----
const actingKey = ref<string | null>(null)
async function approve(item: FeedItem) {
  actingKey.value = itemKey(item)
  try {
    await http.post(`/auto-posts/${item.id}/approve`, {})
    toast.success('Черновик создан')
    await loadFeed()
  } catch (e: any) {
    toast.error('Ошибка: ' + (e.message || e))
  } finally {
    actingKey.value = null
  }
}
async function reject(item: FeedItem) {
  actingKey.value = itemKey(item)
  try {
    await http.post(`/auto-posts/${item.id}/reject`, {})
    toast.info('Отклонено')
    await loadFeed()
  } catch (e: any) {
    toast.error('Ошибка: ' + (e.message || e))
  } finally {
    actingKey.value = null
  }
}
async function openEditor(item: FeedItem) {
  actingKey.value = itemKey(item)
  try {
    let postId = item.postId
    let postType = item.postType
    if (item.kind === 'proposal' && !postId) {
      const res = await http.post<{ postId: string; postType: string }>(`/auto-posts/${item.id}/open-editor`, {})
      postId = res.postId
      postType = res.postType || postType
    }
    router.push({ path: postType === 'STORIES' ? `/stories/${postId}` : `/posts/${postId}`, query: { from: 'feed' } })
  } catch (e: any) {
    toast.error('Ошибка: ' + (e.message || e))
  } finally {
    actingKey.value = null
  }
}

// ---- Публикация ----
function localNow(): string {
  return new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 16)
}
const scheduleOpenKey = ref<string | null>(null)
const scheduleAt = ref<Record<string, string>>({})
function toggleSchedule(item: FeedItem) {
  const key = itemKey(item)
  scheduleOpenKey.value = scheduleOpenKey.value === key ? null : key
  if (scheduleOpenKey.value && !scheduleAt.value[key]) {
    scheduleAt.value = { ...scheduleAt.value, [key]: localNow() }
  }
}
function reportResults(results: { platform: string; success: boolean; error: string | null }[]) {
  const ok = results.filter(r => r.success)
  const fail = results.filter(r => !r.success)
  if (!fail.length) toast.success(`Опубликовано: ${ok.map(r => platformLabel(r.platform)).join(', ')}`)
  else if (ok.length) toast.info(`Опубликовано: ${ok.map(r => platformLabel(r.platform)).join(', ')} · ошибки: ${fail.map(f => platformLabel(f.platform)).join(', ')}`)
  else toast.error('Не удалось опубликовать: ' + (fail[0]?.error || ''))
}
async function publishNow(item: FeedItem) {
  if (!item.canPublishNow.ok) return
  const key = itemKey(item)
  actingKey.value = key
  try {
    if (item.kind === 'proposal') {
      const res = await http.post<{ results: { platform: string; success: boolean; error: string | null }[] }>(
        `/auto-posts/${item.id}/approve-publish`, { when: 'now', platforms: item.platforms }
      )
      reportResults(res.results)
    } else {
      const detail = await ensurePostDetail(item.postId!, true)
      const targets = detail.versions.filter(v => v.status !== 'PUBLISHED')
      if (!targets.length) { toast.info('Нечего публиковать'); return }
      const results = await Promise.all(targets.map(async v => {
        try {
          const r = await http.post<{ success: boolean; error: string | null }>(`/post-versions/${v.id}/publish`, {})
          return { platform: v.platformAccount.platform, success: r.success !== false, error: r.error || null }
        } catch (e: any) {
          return { platform: v.platformAccount.platform, success: false, error: e.message || 'Ошибка' }
        }
      }))
      reportResults(results)
    }
    await loadFeed()
  } catch (e: any) {
    toast.error('Ошибка: ' + (e.message || e))
  } finally {
    actingKey.value = null
  }
}
async function publishScheduledAction(item: FeedItem) {
  const key = itemKey(item)
  const at = scheduleAt.value[key]
  if (!at) return
  actingKey.value = key
  try {
    if (item.kind === 'proposal') {
      await http.post(`/auto-posts/${item.id}/approve-publish`, { when: 'schedule', scheduledAt: new Date(at).toISOString() })
    } else {
      const detail = await ensurePostDetail(item.postId!, true)
      const targets = detail.versions.filter(v => v.status !== 'PUBLISHED')
      await Promise.all(targets.map(v => http.post(`/post-versions/${v.id}/schedule`, { scheduledAt: new Date(at).toISOString() })))
    }
    scheduleOpenKey.value = null
    toast.success('Запланировано на ' + new Date(at).toLocaleString('ru-RU', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }))
    await loadFeed()
  } catch (e: any) {
    toast.error('Ошибка: ' + (e.message || e))
  } finally {
    actingKey.value = null
  }
}

// ---- Удаление (kind='post') ----
const deleteItem = ref<FeedItem | null>(null)
async function confirmDelete() {
  const item = deleteItem.value
  deleteItem.value = null
  if (!item?.postId) return
  try {
    await http.delete(`/posts/${item.postId}`)
    toast.success('Удалено')
    await loadFeed()
  } catch (e: any) {
    toast.error(e.message || 'Ошибка')
  }
}

// ---- Настройки дайджеста ----
const showSettings = ref(false)

onMounted(loadFeed)
watch(() => businesses.currentBusiness?.id, () => {
  editingItem.value = null
  editDrafts.value = {}
  postDetailCache.value = {}
  loadFeed()
})
watch(activeStatus, () => { if (editingItem.value) closeTextEdit() })
onBeforeUnmount(() => { if (editingChannel.value) flushDraft(editingChannel.value) })
</script>

<template>
  <div class="max-w-3xl mx-auto">
    <!-- Header -->
    <div class="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-4">
      <h1 class="text-xl md:text-2xl font-bold flex items-center gap-2">
        <Newspaper :size="24" class="text-brand-500" /> Лента
      </h1>
      <div class="flex items-center gap-2 shrink-0">
        <UiTooltip v-if="isAdmin" text="Настройки дайджеста" position="bottom">
          <UiButton variant="secondary" icon-only aria-label="Настройки дайджеста" @click="showSettings = true">
            <template #icon><Settings2 :size="16" /></template>
          </UiButton>
        </UiTooltip>
        <UiButton v-if="isAdmin" variant="secondary" :loading="generating" @click="generateDigest">
          <template #icon><Sparkles :size="16" /></template>
          {{ generating ? 'Генерирую…' : 'Сгенерировать' }}
        </UiButton>
        <UiButton v-if="canEditPosts" @click="createModal.open()">
          <template #icon><Plus :size="16" /></template>
          Создать
        </UiButton>
      </div>
    </div>

    <!-- Status tabs -->
    <UiTabs v-model="activeStatus" :tabs="tabs" variant="segmented" class="mb-4" />

    <!-- Loading -->
    <div v-if="loading" class="space-y-3">
      <UiSkeleton v-for="i in 3" :key="i" variant="card" />
    </div>

    <!-- Empty -->
    <UiEmptyState v-else-if="!visibleItems.length" :title="emptyCopy.title" :description="emptyCopy.description">
      <template #icon><Newspaper :size="48" /></template>
      <template v-if="activeStatus === 'proposed' && isAdmin" #action>
        <UiButton variant="secondary" :loading="generating" @click="generateDigest">Сгенерировать сейчас</UiButton>
      </template>
    </UiEmptyState>

    <!-- Cards -->
    <div v-else class="space-y-4">
      <UiCard v-for="item in visibleItems" :key="itemKey(item)">
        <!-- Top row: type + platforms + date -->
        <div class="flex items-center gap-2 flex-wrap mb-2">
          <UiBadge variant="brand">{{ POST_TYPE_LABELS[item.postType] || item.postType }}</UiBadge>
          <span v-for="p in item.platforms" :key="p" :class="['px-1.5 py-0.5 rounded text-[11px] font-medium', platformColor(p)]">{{ p }}</span>
          <span class="text-xs text-gray-400 ml-auto flex items-center gap-1"><CalendarClock :size="12" /> {{ formatDate(item.createdAt) }}</span>
        </div>

        <!-- Title -->
        <h3 v-if="item.title" class="font-semibold text-base mb-1">{{ item.title }}</h3>

        <!-- Превью «как в соцсети»: табы платформ + PostPreview/StoriesPreview -->
        <div v-if="item.previews.length" class="mb-3">
          <UiTabs
            v-if="item.previews.length > 1"
            :model-value="previewPlatform(item)"
            :tabs="orderedPreviews(item).map(pv => ({ key: pv.platform, label: platformLabel(pv.platform) }))"
            variant="segmented"
            class="mb-2 inline-flex"
            @update:model-value="setPreviewPlatform(item, $event)"
          />
          <template v-for="pv in orderedPreviews(item)" :key="pv.platform">
            <template v-if="previewPlatform(item) === pv.platform">
              <!-- StoriesPreview (v-if) и PostPreview (v-else) ДОЛЖНЫ быть смежны, иначе v-else протечёт -->
              <StoriesPreview
                v-if="item.postType === 'STORIES'"
                :platform="pv.platform" :account-name="pv.accountName"
                :text="pv.text" :media-files="previewMedia(item)" :baked="isDesignedMedia(item)"
              />
              <PostPreview
                v-else
                :platform="pv.platform" :account-name="pv.accountName"
                :text="editingKey === itemKey(item) ? effectiveText(item, pv.platform) : pv.text"
                :hashtags="pv.hashtags" :media-files="previewMedia(item)" :post-type="item.postType"
                :editable="editingKey === itemKey(item) && item.postType !== 'STORIES'"
                @update:text="onPreviewEdit(item, pv.platform, $event)"
              />
            </template>
          </template>
        </div>

        <!-- Media controls: открыть / заменить / текст / оформление -->
        <div v-if="item.status !== 'published' && (item.media.length || item.postType === 'PHOTO' || item.postType === 'STORIES')"
          class="flex items-center justify-center gap-2 flex-wrap mb-3">
          <template v-if="item.media.length">
            <UiButton variant="secondary" size="sm" @click="openLightbox(item.media[0].url)">
              <template #icon><Maximize2 :size="13" /></template> Открыть фото
            </UiButton>
            <UiButton variant="secondary" size="sm" :disabled="actingKey === itemKey(item)" @click="openPicker(item)">
              <template #icon><RefreshCw :size="13" /></template> Заменить фото
            </UiButton>
            <UiButton
              v-if="item.postType !== 'STORIES'"
              :variant="editingKey === itemKey(item) ? 'primary' : 'secondary'" size="sm"
              @click="editingKey === itemKey(item) ? closeTextEdit() : openTextEdit(item)"
            >
              <template #icon><Pencil :size="13" /></template> {{ editingKey === itemKey(item) ? 'Готово' : 'Текст' }}
            </UiButton>
            <UiButton v-if="item.postType === 'STORIES' || item.postType === 'PHOTO'" size="sm" @click="openOverlay(item)">
              <template #icon><Wand2 :size="13" /></template> Оформление
            </UiButton>
          </template>
          <UiButton v-else variant="secondary" size="sm" @click="openPicker(item)">
            <template #icon><ImagePlus :size="15" /></template> Подобрать фото из галереи
          </UiButton>
        </div>
        <!-- Опубликованное — можно только править текст обычных постов -->
        <div v-else-if="item.status === 'published' && item.postType !== 'STORIES' && item.media.length === 0" class="flex items-center justify-center gap-2 flex-wrap mb-3">
          <span class="text-xs text-gray-400">Текст и фото зафиксированы после публикации</span>
        </div>

        <!-- Reasoning (только предложения) -->
        <p v-if="item.kind === 'proposal' && item.aiReasoning" class="text-xs text-gray-400 italic mb-3 flex items-start gap-1.5">
          <CalendarClock :size="14" class="shrink-0 mt-0.5" /><span>{{ item.aiReasoning }}</span>
        </p>

        <!-- Actions -->
        <div class="flex flex-wrap items-center gap-2 pt-1">
          <UiDropdown v-if="item.status !== 'published'" align="left">
            <template #trigger>
              <UiTooltip :text="!item.canPublishNow.ok ? item.canPublishNow.reason : undefined" position="top">
                <UiButton :disabled="!item.canPublishNow.ok" :loading="actingKey === itemKey(item)">
                  <template #icon><Send :size="15" /></template>
                  Опубликовать сейчас
                  <ChevronDown :size="14" class="ml-0.5" />
                </UiButton>
              </UiTooltip>
            </template>
            <template #items>
              <button class="w-full flex items-center gap-2 text-left px-3 py-2 text-sm hover:bg-gray-50 dark:hover:bg-gray-700" @click="publishNow(item)">
                <Send :size="14" /> Сейчас
              </button>
              <button class="w-full flex items-center gap-2 text-left px-3 py-2 text-sm hover:bg-gray-50 dark:hover:bg-gray-700" @click="toggleSchedule(item)">
                <Clock :size="14" /> Запланировать
              </button>
            </template>
          </UiDropdown>

          <template v-if="item.kind === 'proposal'">
            <UiButton variant="secondary" :loading="actingKey === itemKey(item)" @click="approve(item)">
              <template #icon><Check :size="15" /></template> Одобрить
            </UiButton>
            <UiButton variant="ghost" :loading="actingKey === itemKey(item)" @click="reject(item)">
              <template #icon><X :size="15" /></template> Отклонить
            </UiButton>
          </template>

          <UiButton variant="ghost" size="sm" :loading="actingKey === itemKey(item)" @click="openEditor(item)">
            <template #icon><FileEdit :size="14" /></template> В редактор
          </UiButton>

          <UiTooltip v-if="item.kind === 'post'" text="Удалить" position="top">
            <UiButton variant="ghost" size="sm" icon-only aria-label="Удалить" @click="deleteItem = item">
              <template #icon><Trash2 :size="14" /></template>
            </UiButton>
          </UiTooltip>

          <UiBadge v-if="item.status === 'published'" variant="success" class="ml-auto"><Check :size="12" /> Опубликовано</UiBadge>
          <UiBadge v-else-if="item.status === 'scheduled'" variant="info" class="ml-auto"><Clock :size="12" /> Запланировано</UiBadge>
        </div>

        <!-- Инлайн выбор времени -->
        <div v-if="scheduleOpenKey === itemKey(item)"
          class="mt-2 flex flex-col sm:flex-row gap-2 items-stretch p-3 rounded-lg bg-info-50 dark:bg-info-500/10 border border-info-200 dark:border-info-500/30">
          <span class="text-xs text-info-700 dark:text-info-400 flex items-center gap-1 shrink-0"><Calendar :size="14" /> Когда:</span>
          <input v-model="scheduleAt[itemKey(item)]" type="datetime-local" :min="localNow()"
            class="flex-1 min-w-0 px-2 py-2 rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 text-xs" />
          <UiButton size="sm" :loading="actingKey === itemKey(item)" :disabled="!scheduleAt[itemKey(item)]" @click="publishScheduledAction(item)">
            <template #icon><Clock :size="14" /></template> Запланировать
          </UiButton>
        </div>
      </UiCard>
    </div>

    <!-- Выбор фото из медиатеки -->
    <MediaPickerModal
      v-if="pickerItem"
      :visible="true"
      :business-id="businesses.currentBusiness?.id || ''"
      @selected="onPhotoSelected"
      @close="pickerItem = null"
    />

    <!-- Оформление/кадр — единый OverlayEditor -->
    <UiModal :model-value="!!overlayItem" title="Оформление" size="xl" @update:model-value="closeOverlay">
      <OverlayEditor
        v-if="overlayItem"
        :source-media-id="overlayItem.media[0]?.id || ''"
        :business-id="businesses.currentBusiness?.id || ''"
        :post-id="overlayItem.postId"
        :source-photo-url="overlayItem.media[0]?.url || null"
        @baked="onOverlayBaked"
      />
      <template #footer>
        <UiButton @click="closeOverlay">Готово</UiButton>
      </template>
    </UiModal>

    <!-- Лайтбокс фото -->
    <Teleport to="body">
      <div v-if="lightboxUrl" class="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80" @click="closeLightbox">
        <img :src="lightboxUrl" class="max-w-full max-h-[88vh] object-contain rounded-lg shadow-2xl" @click.stop />
        <button class="absolute top-4 right-4 w-9 h-9 rounded-full bg-white/90 shadow-lg flex items-center justify-center text-gray-700 hover:bg-white" @click="closeLightbox">
          <X :size="18" />
        </button>
      </div>
    </Teleport>

    <!-- Удаление -->
    <UiModal :model-value="!!deleteItem" title="Удалить контент?" size="sm" @update:model-value="deleteItem = null">
      <p class="text-sm text-gray-500 dark:text-gray-400">Это действие нельзя отменить. Пост и все его версии будут удалены.</p>
      <template #footer>
        <UiButton variant="secondary" @click="deleteItem = null">Отмена</UiButton>
        <UiButton variant="danger" @click="confirmDelete">Удалить</UiButton>
      </template>
    </UiModal>

    <!-- Настройки дайджеста -->
    <DigestSettingsModal v-model="showSettings" />
  </div>
</template>
