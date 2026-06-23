<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted, watch } from 'vue'
import { http, TAB_ID } from '@/api/client'
import { useBusinessesStore } from '@/stores/businesses'
import { useToast } from '@/composables/useToast'
import { formatDate } from '@/composables/useFormatters'
import {
  Image, Video, Upload, Search, Tag, X, Loader2, Trash2,
  Grid3X3, Link, ExternalLink, Wand2,
  FolderPlus, Folder, FolderOpen, ChevronRight, Home, Sparkles,
  Pencil, Grid2X2, LayoutGrid, Check, ArrowRightLeft, RotateCcw, RotateCw,
} from 'lucide-vue-next'
import ImageEditModal from '@/components/ai/ImageEditModal.vue'
import DesignLayerEditor from '@/components/shared/DesignLayerEditor.vue'
import { useSectionAccess } from '@/composables/useSectionAccess'
import { uploadConcurrent } from '@/composables/useConcurrentUpload'

const { canEdit: canEditSection } = useSectionAccess()

interface MediaFile {
  id: string
  postId: string | null
  businessId: string
  folderId: string | null
  filename: string
  url: string
  thumbUrl: string | null
  mimeType: string
  sizeBytes: number
  tags: string[]
  altText: string | null
  aiModel: string | null
  aiCostUsd: number | null
  createdAt: string
  post: { id: string; title: string; status: string } | null
  folder: { id: string; name: string } | null
}

interface MediaFolder {
  id: string
  businessId: string
  name: string
  parentId: string | null
  createdAt: string
  _count: { children: number; files: number }
}

type CardSize = 'S' | 'M' | 'L'

const businesses = useBusinessesStore()
const toast = useToast()

const files = ref<MediaFile[]>([])
const folders = ref<MediaFolder[]>([])
const allTags = ref<string[]>([])
const loading = ref(true)
const loadingMore = ref(false)
const hasMore = ref(false)
const uploading = ref(false)
const editingFile = ref<MediaFile | null>(null)
const designFile = ref<MediaFile | null>(null)
const previewFile = ref<MediaFile | null>(null)
const describingPreviewId = ref<string | null>(null)
const rotatingId = ref<string | null>(null)

// Прогресс массовой загрузки + список упавших файлов (чтобы Света видела, что переслать)
const uploadProgress = ref<{ done: number; total: number } | null>(null)
const failedUploads = ref<string[]>([])

// Серверная разбивка counts (фото/видео/без поста) — снимает 3× O(n) .filter() на больших списках
const serverCounts = ref<{ images: number; videos: number; unattached: number } | null>(null)

async function describePreviewFile() {
  if (!previewFile.value) return
  describingPreviewId.value = previewFile.value.id
  try {
    const res = await http.post<{ description: string }>('/ai/describe-image', {
      imageUrl: previewFile.value.url,
      type: 'auto',
    })
    previewFile.value.altText = res.description
    // Also update in the files list
    const f = files.value.find(f => f.id === previewFile.value?.id)
    if (f) f.altText = res.description
    toast.success('Описание сгенерировано')
  } catch (e: any) { toast.error(e.message || 'Ошибка AI') }
  finally { describingPreviewId.value = null }
}

// Поворот изображения на сервере (перезапись оригинала + thumbnail). angle: 90 | 180 | 270.
async function rotateImage(angle: number) {
  if (!previewFile.value || rotatingId.value) return
  const target = previewFile.value
  rotatingId.value = target.id
  try {
    const updated = await http.post<MediaFile>(`/media/${target.id}/rotate`, { angle })
    // Cache-busting: серверный URL не меняется → добавляем ?v=<ts>, чтобы браузер пере-зафетчил повёрнутую версию
    const bust = `?v=${Date.now()}`
    const freshUrl = (u: string) => u.split('?')[0] + bust
    const newUrl = freshUrl(target.url)
    const newThumb = target.thumbUrl ? freshUrl(target.thumbUrl) : null
    target.url = newUrl
    target.thumbUrl = newThumb
    if (typeof updated.sizeBytes === 'number') target.sizeBytes = updated.sizeBytes
    // Синхронизируем тот же файл в сетке
    const f = files.value.find(x => x.id === target.id)
    if (f) {
      f.url = newUrl
      f.thumbUrl = newThumb
      if (typeof updated.sizeBytes === 'number') f.sizeBytes = updated.sizeBytes
    }
    toast.success('Повёрнуто')
  } catch (e: any) {
    toast.error(e.message || 'Ошибка поворота')
  } finally {
    rotatingId.value = null
  }
}

// Повторить описание для фото со статусом describe_failed (поллер не ретраит автоматически)
async function retryDescribe(file: MediaFile) {
  if (describingPreviewId.value) return
  describingPreviewId.value = file.id
  try {
    const res = await http.post<{ description: string }>('/ai/describe-image', { imageUrl: file.url, type: 'auto' })
    file.altText = res.description
    file.aiModel = null
    toast.success('Описание сгенерировано')
  } catch (e: any) { toast.error(e.message || 'Ошибка AI') }
  finally { describingPreviewId.value = null }
}

// Folder navigation
const currentFolderId = ref<string | null>(null)
const breadcrumbs = ref<{ id: string; name: string }[]>([])

// Card size (persisted in localStorage)
const cardSize = ref<CardSize>(
  (localStorage.getItem('media-card-size') as CardSize) || 'M'
)
watch(cardSize, (v) => localStorage.setItem('media-card-size', v))

// Folder create/rename dialog
const showFolderDialog = ref(false)
const folderDialogMode = ref<'create' | 'rename'>('create')
const folderDialogName = ref('')
const renamingFolderId = ref<string | null>(null)

// Select mode + move
const selectedFiles = ref<Set<string>>(new Set())
const selectMode = ref(false)
const showMoveDialog = ref(false)
const moveTargetFolderId = ref<string | null>(null)
const moveFolders = ref<MediaFolder[]>([])

// Filters
const typeFilter = ref<'' | 'image' | 'video'>('')
const tagFilter = ref('')
const searchQuery = ref('')
const showUnattached = ref(false)

// Tag editor
const editingTagsId = ref<string | null>(null)
const tagInput = ref('')

// Grid classes based on card size
const gridClass = computed(() => {
  switch (cardSize.value) {
    case 'S': return 'grid grid-cols-3 sm:grid-cols-5 md:grid-cols-6 lg:grid-cols-8 gap-1.5'
    case 'M': return 'grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3'
    case 'L': return 'grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4'
  }
})

const folderGridClass = computed(() => {
  switch (cardSize.value) {
    case 'S': return 'grid grid-cols-3 sm:grid-cols-5 md:grid-cols-6 lg:grid-cols-8 gap-1.5'
    case 'M': return 'grid grid-cols-2 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6 gap-2'
    case 'L': return 'grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3'
  }
})

const isSmall = computed(() => cardSize.value === 'S')

// When searching — show all files across folders
const isSearching = computed(() => !!searchQuery.value || !!tagFilter.value || showUnattached.value)

function buildMediaParams(cursor?: string) {
  const params = new URLSearchParams()
  if (typeFilter.value) params.set('type', typeFilter.value)
  if (tagFilter.value) params.set('tag', tagFilter.value)
  if (searchQuery.value) params.set('search', searchQuery.value)
  if (showUnattached.value) params.set('unattached', 'true')
  if (!isSearching.value) params.set('folderId', currentFolderId.value || 'root')
  if (cursor) params.set('cursor', cursor)
  return params
}

async function loadFiles() {
  if (!businesses.currentBusiness) return
  loading.value = true
  try {
    const qs = buildMediaParams().toString()
    const res = await http.get<{ files: MediaFile[]; hasMore: boolean; totalCount?: number; counts?: { images: number; videos: number; unattached: number } }>(
      `/media/library/${businesses.currentBusiness.id}?${qs}`
    )
    files.value = res.files
    hasMore.value = res.hasMore
    if (res.totalCount !== undefined) totalCount.value = res.totalCount
    if (res.counts) serverCounts.value = res.counts
  } catch (e: any) {
    toast.error('Ошибка загрузки медиа')
  } finally {
    loading.value = false
  }
}

async function loadMore() {
  if (!businesses.currentBusiness || !hasMore.value || loadingMore.value) return
  const lastFile = files.value[files.value.length - 1]
  if (!lastFile) return
  loadingMore.value = true
  try {
    const qs = buildMediaParams(lastFile.id).toString()
    const res = await http.get<{ files: MediaFile[]; hasMore: boolean }>(
      `/media/library/${businesses.currentBusiness.id}?${qs}`
    )
    files.value.push(...res.files)
    hasMore.value = res.hasMore
  } catch (e: any) {
    toast.error('Ошибка загрузки')
  } finally {
    loadingMore.value = false
  }
}

async function loadFolders() {
  if (!businesses.currentBusiness) return
  try {
    const params = currentFolderId.value ? `?parentId=${currentFolderId.value}` : ''
    folders.value = await http.get<MediaFolder[]>(`/media/folders/${businesses.currentBusiness.id}${params}`)
  } catch {}
}

async function loadBreadcrumbs() {
  if (!businesses.currentBusiness || !currentFolderId.value) {
    breadcrumbs.value = []
    return
  }
  try {
    breadcrumbs.value = await http.get(`/media/folders/${businesses.currentBusiness.id}/path/${currentFolderId.value}`)
  } catch {
    breadcrumbs.value = []
  }
}

async function loadTags() {
  if (!businesses.currentBusiness) return
  try {
    allTags.value = await http.get<string[]>(`/media/tags/${businesses.currentBusiness.id}`)
  } catch {}
}

async function loadAll() {
  await Promise.all([loadFiles(), loadFolders(), loadBreadcrumbs(), loadTags()])
}

function navigateToFolder(folderId: string | null) {
  currentFolderId.value = folderId
  selectedFiles.value.clear()
  selectMode.value = false
  loadFiles()
  loadFolders()
  loadBreadcrumbs()
}

async function uploadFile(e: Event) {
  const input = e.target as HTMLInputElement
  if (!input.files?.length || !businesses.currentBusiness) return
  const bizId = businesses.currentBusiness.id
  const folderId = currentFolderId.value
  const fileArr = Array.from(input.files)
  input.value = '' // сразу сбрасываем — иначе повторный выбор тех же файлов не сработает
  uploading.value = true
  failedUploads.value = []
  uploadProgress.value = { done: 0, total: fileArr.length }

  const results = await uploadConcurrent(
    fileArr,
    async (file): Promise<MediaFile> => {
      const formData = new FormData()
      formData.append('file', file)
      formData.append('businessId', bizId)
      if (folderId) formData.append('folderId', folderId)
      const res = await fetch('/api/media/upload', {
        method: 'POST', body: formData, credentials: 'include', headers: { 'X-Tab-ID': TAB_ID },
      })
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        throw new Error((err as any).error || `HTTP ${res.status}`)
      }
      return (await res.json()) as MediaFile
    },
    {
      concurrency: 3,
      onProgress: (done, total) => { uploadProgress.value = { done, total } },
      onResult: (r) => {
        if (r.ok && r.data) {
          // Оптимистичная вставка: файл сразу виден в начале сетки (бэк сортирует createdAt desc).
          // Только если мы в той же папке и без активного поиска/фильтра.
          if (!isSearching.value && (folderId || null) === (currentFolderId.value || null)) {
            files.value.unshift(r.data)
          }
        } else {
          failedUploads.value.push(r.file.name)
        }
      },
    },
  )

  uploading.value = false
  uploadProgress.value = null

  const okCount = results.filter(r => r.ok).length
  const failCount = results.length - okCount
  if (failCount === 0) toast.success(`${okCount} файл(ов) загружено`)
  else if (okCount > 0) toast.error(`Загружено ${okCount}, не удалось ${failCount}`)
  else toast.error('Не удалось загрузить файлы')

  // Синхронизация: подтянуть теги/папки + актуальные counts и серверную сортировку
  await Promise.all([loadTags(), loadFolders()])
  await loadFiles()
}

async function deleteFile(id: string) {
  if (!confirm('Удалить файл?')) return
  try {
    await http.delete(`/media/${id}`)
    files.value = files.value.filter(f => f.id !== id)
    selectedFiles.value.delete(id)
    toast.success('Файл удалён')
  } catch (e: any) {
    toast.error('Ошибка удаления')
  }
}

function onEdited(newFile: any) {
  files.value.unshift(newFile)
  editingFile.value = null
}

function onBaked(newFile: any) {
  files.value.unshift(newFile)
  designFile.value = null
}

function startEditTags(file: MediaFile) {
  editingTagsId.value = file.id
  tagInput.value = file.tags.join(', ')
}

async function saveTags(fileId: string) {
  const tags = tagInput.value.split(',').map(t => t.trim()).filter(Boolean)
  try {
    await http.put(`/media/${fileId}/tags`, { tags })
    const file = files.value.find(f => f.id === fileId)
    if (file) file.tags = tags
    editingTagsId.value = null
    toast.success('Теги сохранены')
    await loadTags()
  } catch (e: any) {
    toast.error('Ошибка сохранения тегов')
  }
}

// --- Folder CRUD ---
function openCreateFolder() {
  folderDialogMode.value = 'create'
  folderDialogName.value = ''
  showFolderDialog.value = true
}

function openRenameFolder(folder: MediaFolder) {
  folderDialogMode.value = 'rename'
  folderDialogName.value = folder.name
  renamingFolderId.value = folder.id
  showFolderDialog.value = true
}

async function submitFolderDialog() {
  if (!folderDialogName.value.trim()) return
  try {
    if (folderDialogMode.value === 'create') {
      await http.post('/media/folders', {
        businessId: businesses.currentBusiness!.id,
        name: folderDialogName.value.trim(),
        parentId: currentFolderId.value,
      })
      toast.success('Папка создана')
    } else {
      await http.put(`/media/folders/${renamingFolderId.value}`, {
        name: folderDialogName.value.trim(),
      })
      toast.success('Папка переименована')
    }
    showFolderDialog.value = false
    loadFolders()
    loadBreadcrumbs()
  } catch (e: any) {
    toast.error('Ошибка: ' + (e.message || e))
  }
}

async function deleteFolder(folder: MediaFolder) {
  const count = folder._count.files + folder._count.children
  const msg = count > 0
    ? `Удалить папку «${folder.name}»? ${folder._count.files} файлов и ${folder._count.children} подпапок будут перемещены в текущую папку.`
    : `Удалить пустую папку «${folder.name}»?`
  if (!confirm(msg)) return
  try {
    await http.delete(`/media/folders/${folder.id}`)
    toast.success('Папка удалена')
    loadFolders()
    loadFiles()
  } catch (e: any) {
    toast.error('Ошибка удаления')
  }
}

// --- Select & Move ---
function toggleSelectFile(id: string) {
  if (selectedFiles.value.has(id)) {
    selectedFiles.value.delete(id)
  } else {
    selectedFiles.value.add(id)
  }
}

function toggleSelectMode() {
  selectMode.value = !selectMode.value
  if (!selectMode.value) selectedFiles.value.clear()
}

async function openMoveDialog() {
  if (selectedFiles.value.size === 0) return
  try {
    moveFolders.value = await http.get<MediaFolder[]>(`/media/folders/${businesses.currentBusiness!.id}`)
    moveTargetFolderId.value = null
    showMoveDialog.value = true
  } catch { toast.error('Ошибка загрузки папок') }
}

async function moveFiles() {
  if (selectedFiles.value.size === 0) return
  try {
    await http.post('/media/move', {
      fileIds: [...selectedFiles.value],
      folderId: moveTargetFolderId.value,
    })
    toast.success(`Перемещено ${selectedFiles.value.size} файлов`)
    selectedFiles.value.clear()
    selectMode.value = false
    showMoveDialog.value = false
    loadFiles()
    loadFolders()
  } catch (e: any) {
    toast.error('Ошибка перемещения')
  }
}

function formatSize(bytes: number) {
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(0) + ' KB'
  return (bytes / (1024 * 1024)).toFixed(1) + ' MB'
}

// MIME helpers with filename-extension fallback (for octet-stream files like MOV)
const VIDEO_EXTS = new Set(['.mov', '.mp4', '.webm', '.avi', '.mkv', '.m4v', '.wmv', '.3gp'])
const IMAGE_EXTS = new Set(['.jpg', '.jpeg', '.png', '.webp', '.gif', '.svg', '.heic'])

const getExt = (fn: string) => fn.slice(fn.lastIndexOf('.')).toLowerCase()

const isImage = (mime: string, filename?: string) =>
  mime.startsWith('image/') ||
  !!(filename && mime === 'application/octet-stream' && IMAGE_EXTS.has(getExt(filename)))

const isVideo = (mime: string, filename?: string) =>
  mime.startsWith('video/') ||
  !!(filename && mime === 'application/octet-stream' && VIDEO_EXTS.has(getExt(filename)))

const displayType = (mime: string, filename?: string) => {
  if (mime !== 'application/octet-stream') return mime.split('/')[1]?.toUpperCase() || 'FILE'
  if (filename) { const e = getExt(filename).slice(1).toUpperCase(); if (e) return e }
  return 'FILE'
}

const totalCount = ref(0)
const stats = computed(() => ({
  total: totalCount.value || files.value.length,
  loaded: files.value.length,
  // Серверные counts (стабильны, без O(n) на каждый ре-рендер); фолбэк — локальный подсчёт
  images: serverCounts.value?.images ?? files.value.filter(f => isImage(f.mimeType, f.filename)).length,
  videos: serverCounts.value?.videos ?? files.value.filter(f => isVideo(f.mimeType, f.filename)).length,
  unattached: serverCounts.value?.unattached ?? files.value.filter(f => !f.postId).length,
}))

// content-visibility: браузер пропускает рендер офф-скрин карточек. Высота-плейсхолдер под размер карточки.
const cardContainStyle = computed(() => {
  const h = cardSize.value === 'S' ? 140 : cardSize.value === 'M' ? 280 : 380
  return { contentVisibility: 'auto', containIntrinsicSize: `auto ${h}px` } as Record<string, string>
})

// --- SSE: живое обновление AI-описаний (фоновый image-describer пишет altText) ---
let sseSource: EventSource | null = null
let sseReconnectTimer: ReturnType<typeof setTimeout> | null = null

function connectSSE() {
  sseSource = new EventSource(`/api/sse?tabId=${TAB_ID}`)
  sseSource.onmessage = (e) => {
    if (e.data === 'ping' || e.data === 'connected') return
    try {
      const event = JSON.parse(e.data)
      if (event.type === 'media_described') {
        // Только для текущего бизнеса
        if (businesses.currentBusiness && event.businessId !== businesses.currentBusiness.id) return
        const newModel = event.status === 'failed' ? 'describe_failed' : null
        const f = files.value.find(x => x.id === event.mediaId)
        if (f) { f.altText = event.altText; f.aiModel = newModel }
        if (previewFile.value?.id === event.mediaId) {
          previewFile.value.altText = event.altText
          previewFile.value.aiModel = newModel
        }
      }
    } catch {}
  }
  sseSource.onerror = () => {
    sseSource?.close()
    sseReconnectTimer = setTimeout(connectSSE, 5000)
  }
}

onMounted(() => { loadAll(); connectSSE() })
onUnmounted(() => {
  sseSource?.close()
  if (sseReconnectTimer) clearTimeout(sseReconnectTimer)
  if (filterDebounce) clearTimeout(filterDebounce)
})
watch(() => businesses.currentBusiness?.id, () => {
  currentFolderId.value = null
  breadcrumbs.value = []
  serverCounts.value = null
  loadAll()
})
// Debounce фильтров (~250мс): быстрые клики по табам/тегам не плодят дублирующие запросы
let filterDebounce: ReturnType<typeof setTimeout> | null = null
watch([typeFilter, tagFilter, showUnattached], () => {
  if (filterDebounce) clearTimeout(filterDebounce)
  filterDebounce = setTimeout(loadFiles, 250)
})
</script>

<template>
  <div>
    <!-- Header row -->
    <div class="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-4">
      <div class="flex items-center gap-3">
        <h1 class="text-xl md:text-2xl font-bold">Медиа-библиотека</h1>
      </div>
      <div class="flex items-center gap-2">
        <!-- Card size toggle -->
        <div class="flex bg-gray-100 dark:bg-gray-800 rounded-lg p-0.5">
          <button v-for="size in (['S', 'M', 'L'] as CardSize[])" :key="size"
            @click="cardSize = size"
            :class="[
              'px-2 py-1 rounded text-xs font-medium transition-colors',
              cardSize === size
                ? 'bg-white dark:bg-gray-700 shadow-sm text-brand-600 dark:text-brand-400'
                : 'text-gray-500 hover:text-gray-700 dark:hover:text-gray-300'
            ]"
            :title="size === 'S' ? 'Мелкие' : size === 'M' ? 'Средние' : 'Крупные'">
            <LayoutGrid v-if="size === 'S'" :size="14" />
            <Grid3X3 v-else-if="size === 'M'" :size="14" />
            <Grid2X2 v-else :size="14" />
          </button>
        </div>

        <!-- Select mode -->
        <button @click="toggleSelectMode"
          :class="[
            'flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium transition-colors',
            selectMode
              ? 'bg-brand-100 dark:bg-brand-900/30 text-brand-700 dark:text-brand-300'
              : 'bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-gray-700'
          ]">
          <Check :size="14" />
          <span class="hidden sm:inline">{{ selectMode ? `${selectedFiles.size} выбрано` : 'Выбрать' }}</span>
        </button>

        <!-- Move selected -->
        <button v-if="selectMode && selectedFiles.size > 0" @click="openMoveDialog"
          class="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-300 hover:bg-amber-200 dark:hover:bg-amber-700/30 transition-colors">
          <ArrowRightLeft :size="14" />
          <span class="hidden sm:inline">Переместить</span>
        </button>

        <!-- Create folder -->
        <button @click="openCreateFolder"
          class="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-gray-700 transition-colors">
          <FolderPlus :size="16" />
          <span class="hidden sm:inline">Папка</span>
        </button>

        <!-- Upload -->
        <label v-if="canEditSection('media')" :class="['flex items-center gap-2 px-4 py-1.5 rounded-lg bg-brand-600 hover:bg-brand-700 text-white text-sm font-medium cursor-pointer transition-colors', uploading && 'opacity-50 cursor-wait']">
          <Loader2 v-if="uploading" :size="16" class="animate-spin" />
          <Upload v-else :size="16" />
          <span class="hidden sm:inline">{{ uploadProgress ? `${uploadProgress.done} / ${uploadProgress.total}` : 'Загрузить' }}</span>
          <input type="file" accept="image/*,video/*" multiple class="hidden" @change="uploadFile" :disabled="uploading" />
        </label>
      </div>
    </div>

    <!-- Failed uploads notice -->
    <div v-if="failedUploads.length"
      class="mb-3 p-2.5 rounded-lg bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 text-xs text-red-700 dark:text-red-300 flex items-start gap-2">
      <X :size="14" class="shrink-0 mt-0.5" />
      <div class="flex-1">
        Не удалось загрузить {{ failedUploads.length }} файл(ов): {{ failedUploads.join(', ') }}
      </div>
      <button @click="failedUploads = []" class="shrink-0 text-red-400 hover:text-red-600" title="Скрыть">
        <X :size="14" />
      </button>
    </div>

    <!-- Breadcrumbs -->
    <div class="flex items-center gap-1 mb-3 text-sm overflow-x-auto">
      <button @click="navigateToFolder(null)"
        :class="[
          'flex items-center gap-1 px-2 py-1 rounded-md transition-colors whitespace-nowrap',
          !currentFolderId
            ? 'bg-brand-50 dark:bg-brand-950 text-brand-700 dark:text-brand-300 font-medium'
            : 'text-gray-500 hover:text-gray-700 dark:hover:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800'
        ]">
        <Home :size="14" />
        Все файлы
      </button>
      <template v-for="crumb in breadcrumbs" :key="crumb.id">
        <ChevronRight :size="14" class="text-gray-400 flex-shrink-0" />
        <button @click="navigateToFolder(crumb.id)"
          :class="[
            'px-2 py-1 rounded-md transition-colors whitespace-nowrap',
            currentFolderId === crumb.id
              ? 'bg-brand-50 dark:bg-brand-950 text-brand-700 dark:text-brand-300 font-medium'
              : 'text-gray-500 hover:text-gray-700 dark:hover:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800'
          ]">
          {{ crumb.name }}
        </button>
      </template>
    </div>

    <!-- Stats -->
    <div class="flex gap-4 mb-3 text-sm text-gray-500">
      <span>{{ stats.total }} файлов</span>
      <span v-if="hasMore" class="text-gray-400">({{ stats.loaded }} загружено)</span>
      <span>{{ stats.images }} фото</span>
      <span>{{ stats.videos }} видео</span>
      <span>{{ stats.unattached }} без поста</span>
    </div>

    <!-- Filters -->
    <div class="flex flex-wrap items-center gap-3 mb-5">
      <div class="flex gap-0.5 bg-gray-100 dark:bg-gray-800 rounded-lg p-0.5">
        <button @click="typeFilter = ''" :class="['px-3 py-1.5 rounded text-xs font-medium', !typeFilter ? 'bg-white dark:bg-gray-900 shadow-sm text-brand-600' : 'text-gray-500']">
          <Grid3X3 :size="14" class="inline mr-1" /> Все
        </button>
        <button @click="typeFilter = 'image'" :class="['px-3 py-1.5 rounded text-xs font-medium', typeFilter === 'image' ? 'bg-white dark:bg-gray-900 shadow-sm text-brand-600' : 'text-gray-500']">
          <Image :size="14" class="inline mr-1" /> Фото
        </button>
        <button @click="typeFilter = 'video'" :class="['px-3 py-1.5 rounded text-xs font-medium', typeFilter === 'video' ? 'bg-white dark:bg-gray-900 shadow-sm text-brand-600' : 'text-gray-500']">
          <Video :size="14" class="inline mr-1" /> Видео
        </button>
      </div>

      <div class="relative">
        <Search :size="14" class="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
        <input v-model="searchQuery" @keyup.enter="loadFiles" placeholder="Поиск по имени..."
          class="pl-9 pr-3 py-1.5 rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 text-sm w-48" />
      </div>

      <select v-if="allTags.length" v-model="tagFilter"
        class="px-3 py-1.5 rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 text-sm">
        <option value="">Все теги</option>
        <option v-for="t in allTags" :key="t" :value="t">{{ t }}</option>
      </select>

      <label class="flex items-center gap-1.5 text-xs text-gray-500 cursor-pointer">
        <input type="checkbox" v-model="showUnattached" class="rounded border-gray-300 text-brand-600" />
        Без поста
      </label>
    </div>

    <!-- Loading -->
    <div v-if="loading" class="text-gray-500 py-8 text-center">Загрузка...</div>

    <template v-else>
      <!-- Folders grid (hidden when searching) -->
      <div v-if="!isSearching && folders.length > 0" :class="[folderGridClass, 'mb-4']">
        <div v-for="folder in folders" :key="folder.id"
          class="group relative flex items-center gap-2 px-3 py-2.5 bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 cursor-pointer hover:border-brand-300 dark:hover:border-brand-700 hover:bg-brand-50/50 dark:hover:bg-brand-950/30 transition-colors"
          @click="navigateToFolder(folder.id)">
          <FolderOpen :size="isSmall ? 16 : 20" class="text-amber-500 flex-shrink-0" />
          <div class="flex-1 min-w-0">
            <div :class="['font-medium truncate text-gray-700 dark:text-gray-300', isSmall ? 'text-[11px]' : 'text-sm']">
              {{ folder.name }}
            </div>
            <div v-if="!isSmall" class="text-[10px] text-gray-400 mt-0.5">
              {{ folder._count.files }} файлов<span v-if="folder._count.children"> · {{ folder._count.children }} папок</span>
            </div>
          </div>
          <!-- Folder actions (hover) -->
          <div class="hidden group-hover:flex items-center gap-0.5 absolute right-1.5 top-1/2 -translate-y-1/2">
            <button @click.stop="openRenameFolder(folder)"
              class="p-1 rounded hover:bg-gray-200 dark:hover:bg-gray-700 text-gray-400 hover:text-gray-600">
              <Pencil :size="12" />
            </button>
            <button @click.stop="deleteFolder(folder)"
              class="p-1 rounded hover:bg-red-100 dark:hover:bg-red-900/30 text-gray-400 hover:text-red-500">
              <Trash2 :size="12" />
            </button>
          </div>
        </div>
      </div>

      <!-- Empty state -->
      <div v-if="files.length === 0 && folders.length === 0"
        class="bg-white dark:bg-gray-900 rounded-xl p-8 border border-gray-200 dark:border-gray-800 text-center">
        <Image :size="48" class="mx-auto text-gray-300 dark:text-gray-600 mb-3" />
        <p class="text-gray-500 mb-4">
          {{ currentFolderId ? 'Папка пуста. Загрузите файлы или создайте подпапку.' : 'Нет медиафайлов. Загрузите фото или видео!' }}
        </p>
      </div>

      <!-- Files grid -->
      <div v-if="files.length > 0" :class="gridClass">
        <div v-for="file in files" :key="file.id"
          :style="cardContainStyle"
          :class="[
            'group relative bg-white dark:bg-gray-900 rounded-xl border overflow-hidden transition-colors',
            selectMode && selectedFiles.has(file.id)
              ? 'border-brand-500 dark:border-brand-400 ring-2 ring-brand-200 dark:ring-brand-800'
              : 'border-gray-200 dark:border-gray-800 hover:border-brand-300 dark:hover:border-brand-700'
          ]"
          @click="selectMode ? toggleSelectFile(file.id) : (previewFile = file)">

          <!-- Thumbnail -->
          <div class="aspect-square bg-gray-100 dark:bg-gray-800 relative">
            <img v-if="isImage(file.mimeType, file.filename)"
              :src="file.thumbUrl || file.url"
              :alt="file.filename"
              class="w-full h-full object-cover" loading="lazy" />
            <!-- Video: show thumbUrl if available, otherwise placeholder (no <video> in grid — saves bandwidth) -->
            <img v-else-if="isVideo(file.mimeType, file.filename) && file.thumbUrl"
              :src="file.thumbUrl"
              :alt="file.filename"
              class="w-full h-full object-cover" loading="lazy" />
            <div v-else-if="isVideo(file.mimeType, file.filename)"
              class="w-full h-full flex flex-col items-center justify-center gap-1.5 text-gray-400">
              <Video :size="isSmall ? 24 : 32" />
              <span v-if="!isSmall" class="text-[10px]">{{ formatSize(file.sizeBytes) }}</span>
            </div>
            <div v-else class="w-full h-full flex items-center justify-center">
              <Video :size="32" class="text-gray-400" />
            </div>

            <!-- Select checkbox -->
            <div v-if="selectMode" class="absolute top-1.5 left-1.5 z-10">
              <div :class="[
                'w-5 h-5 rounded-md border-2 flex items-center justify-center transition-colors cursor-pointer',
                selectedFiles.has(file.id)
                  ? 'bg-brand-600 border-brand-600'
                  : 'bg-white/80 dark:bg-gray-900/80 border-gray-300 dark:border-gray-600'
              ]">
                <Check v-if="selectedFiles.has(file.id)" :size="12" class="text-white" />
              </div>
            </div>


            <!-- Post badge -->
            <div v-if="file.post && !selectMode" class="absolute top-1.5 left-1.5">
              <router-link :to="`/posts/${file.post.id}`"
                class="flex items-center gap-0.5 px-1.5 py-0.5 bg-brand-600/80 text-white rounded text-[9px] font-medium hover:bg-brand-700">
                <Link :size="10" /> Пост
              </router-link>
            </div>

            <!-- Folder badge (when searching across folders) -->
            <div v-if="isSearching && file.folder" class="absolute bottom-1.5 left-1.5">
              <button @click.stop="navigateToFolder(file.folder!.id)"
                class="flex items-center gap-0.5 px-1.5 py-0.5 bg-amber-500/80 text-white rounded text-[9px] font-medium hover:bg-amber-600">
                <Folder :size="10" /> {{ file.folder.name }}
              </button>
            </div>

            <!-- Type badge -->
            <div v-if="!isSmall" class="absolute top-1.5 right-1.5 px-1.5 py-0.5 bg-black/50 text-white rounded text-[9px]">
              {{ displayType(file.mimeType, file.filename) }}
            </div>
          </div>

          <!-- Info (hidden in S mode for compactness) -->
          <div v-if="!isSmall" class="p-2.5">
            <div class="text-xs font-medium truncate text-gray-700 dark:text-gray-300">{{ file.filename }}</div>
            <div class="text-[10px] text-gray-400 mt-0.5">{{ formatSize(file.sizeBytes) }} · {{ formatDate(file.createdAt) }}</div>

            <!-- AI status: описывается / не удалось / имя модели генерации -->
            <div v-if="file.aiModel === 'describe_pending'" class="flex items-center gap-1 mt-1 text-[9px] text-purple-500 dark:text-purple-400">
              <Loader2 :size="10" class="animate-spin" /> AI описывает…
            </div>
            <div v-else-if="file.aiModel === 'describe_failed'" class="flex items-center gap-1.5 mt-1">
              <span class="text-[9px] text-amber-500">Описание не удалось</span>
              <button @click.stop="retryDescribe(file)" :disabled="describingPreviewId === file.id"
                class="text-[9px] text-brand-600 hover:underline disabled:opacity-50">Повторить</button>
            </div>
            <div v-else-if="file.aiModel" class="flex items-center gap-1.5 mt-1">
              <span class="px-1.5 py-0.5 bg-purple-100 dark:bg-purple-900/50 text-purple-600 dark:text-purple-400 rounded text-[9px] font-medium">AI</span>
              <span class="text-[9px] text-gray-400 truncate" :title="file.altText || ''">{{ file.aiModel }}</span>
              <span v-if="file.aiCostUsd" class="text-[9px] text-gray-400">${{ file.aiCostUsd.toFixed(2) }}</span>
            </div>
            <!-- Описание (для любого описанного фото, в т.ч. с aiModel=null после авто-описания) -->
            <p v-if="file.altText" class="text-[9px] text-gray-400 mt-0.5 line-clamp-2 italic" :title="file.altText">{{ file.altText }}</p>

            <!-- Tags -->
            <div class="mt-1.5">
              <div v-if="editingTagsId === file.id" class="flex gap-1">
                <input v-model="tagInput" @keyup.enter="saveTags(file.id)" placeholder="теги..."
                  class="flex-1 px-1.5 py-0.5 rounded border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 text-[10px]" />
                <button @click="saveTags(file.id)" class="text-brand-600 text-[10px] font-medium">OK</button>
                <button @click="editingTagsId = null" class="text-gray-400 text-[10px]">X</button>
              </div>
              <div v-else class="flex flex-wrap gap-1 items-center">
                <span v-for="t in file.tags" :key="t" class="px-1.5 py-0.5 bg-brand-50 dark:bg-brand-950 text-brand-700 dark:text-brand-300 rounded text-[9px]">{{ t }}</span>
                <button @click="startEditTags(file)" class="text-gray-400 hover:text-brand-600">
                  <Tag :size="10" />
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>

      <!-- Load more -->
      <div v-if="hasMore" class="flex justify-center mt-6">
        <button @click="loadMore" :disabled="loadingMore"
          class="flex items-center gap-2 px-6 py-2.5 rounded-xl text-sm font-medium bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-gray-700 disabled:opacity-50 transition-colors">
          <Loader2 v-if="loadingMore" :size="16" class="animate-spin" />
          {{ loadingMore ? 'Загрузка...' : `Показать ещё` }}
        </button>
      </div>
    </template>

    <!-- Preview Modal -->
    <Teleport to="body">
      <div v-if="previewFile" class="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4" @click.self="previewFile = null">
        <div class="bg-white dark:bg-gray-900 rounded-2xl shadow-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto">
          <!-- Image preview -->
          <img v-if="isImage(previewFile.mimeType, previewFile.filename)"
            :src="previewFile.url"
            :alt="previewFile.altText || previewFile.filename"
            class="w-full max-h-[50vh] object-contain bg-black rounded-t-2xl" />
          <!-- Video preview -->
          <video v-else-if="isVideo(previewFile.mimeType, previewFile.filename)"
            :src="previewFile.url"
            controls autoplay loop playsinline
            class="w-full max-h-[50vh] bg-black rounded-t-2xl" />
          <!-- Info -->
          <div class="p-4">
            <div class="flex items-center justify-between mb-1">
              <div class="text-sm font-medium truncate flex-1 mr-2">{{ previewFile.filename }}</div>
              <span class="text-[10px] text-gray-400 shrink-0">{{ formatSize(previewFile.sizeBytes) }}</span>
            </div>
            <!-- Description + Auto button (always visible) -->
            <div class="mb-2">
              <p v-if="previewFile.altText" class="text-xs text-gray-500 dark:text-gray-400 leading-relaxed mb-1">{{ previewFile.altText }}</p>
              <p v-else class="text-xs text-gray-400 italic mb-1">Нет описания</p>
              <button @click="describePreviewFile" :disabled="describingPreviewId === previewFile.id"
                class="flex items-center gap-1 px-2 py-1 rounded-lg text-[10px] font-medium bg-purple-100 dark:bg-purple-900/50 text-purple-600 dark:text-purple-400 hover:bg-purple-200 dark:hover:bg-purple-800 disabled:opacity-50 transition-colors">
                <Loader2 v-if="describingPreviewId === previewFile.id" :size="10" class="animate-spin" />
                <Sparkles v-else :size="10" />
                {{ previewFile.altText ? 'Перегенерировать' : 'Сгенерировать описание' }}
              </button>
            </div>
            <!-- Meta -->
            <div class="flex items-center gap-2 text-[10px] text-gray-400 mb-3">
              <span>{{ displayType(previewFile.mimeType, previewFile.filename) }}</span>
              <span v-if="previewFile.aiModel === 'describe_pending'" class="px-1.5 py-0.5 bg-purple-100 dark:bg-purple-900/50 text-purple-600 dark:text-purple-400 rounded font-medium">AI описывает…</span>
              <span v-else-if="previewFile.aiModel === 'describe_failed'" class="px-1.5 py-0.5 bg-amber-100 dark:bg-amber-900/50 text-amber-600 dark:text-amber-400 rounded font-medium">описание не удалось</span>
              <span v-else-if="previewFile.aiModel" class="px-1.5 py-0.5 bg-purple-100 dark:bg-purple-900/50 text-purple-600 dark:text-purple-400 rounded font-medium">{{ previewFile.aiModel }}</span>
              <span>{{ formatDate(previewFile.createdAt) }}</span>
            </div>
            <!-- Actions -->
            <div class="flex flex-wrap gap-2 mb-3">
              <button v-if="isImage(previewFile.mimeType, previewFile.filename)" @click="rotateImage(270)" :disabled="rotatingId === previewFile.id"
                class="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-gray-700 disabled:opacity-50 transition-colors" title="Повернуть влево">
                <Loader2 v-if="rotatingId === previewFile.id" :size="12" class="animate-spin" />
                <RotateCcw v-else :size="12" /> Влево
              </button>
              <button v-if="isImage(previewFile.mimeType, previewFile.filename)" @click="rotateImage(90)" :disabled="rotatingId === previewFile.id"
                class="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-gray-700 disabled:opacity-50 transition-colors" title="Повернуть вправо">
                <Loader2 v-if="rotatingId === previewFile.id" :size="12" class="animate-spin" />
                <RotateCw v-else :size="12" /> Вправо
              </button>
              <button v-if="isImage(previewFile.mimeType, previewFile.filename) || isVideo(previewFile.mimeType, previewFile.filename)" @click="designFile = previewFile; previewFile = null"
                class="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-fuchsia-100 dark:bg-fuchsia-900/50 text-fuchsia-600 dark:text-fuchsia-400 hover:bg-fuchsia-200 dark:hover:bg-fuchsia-800 transition-colors">
                <Sparkles :size="12" /> Дизайн-слой
              </button>
              <button v-if="isImage(previewFile.mimeType, previewFile.filename)" @click="editingFile = previewFile; previewFile = null"
                class="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-purple-100 dark:bg-purple-900/50 text-purple-600 dark:text-purple-400 hover:bg-purple-200 dark:hover:bg-purple-800 transition-colors">
                <Wand2 :size="12" /> AI-редактор
              </button>
              <a :href="previewFile.url" :download="previewFile.filename"
                class="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-gray-700 transition-colors">
                <ExternalLink :size="12" /> Скачать
              </a>
              <button @click="deleteFile(previewFile!.id); previewFile = null"
                class="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-red-50 dark:bg-red-900/30 text-red-600 dark:text-red-400 hover:bg-red-100 dark:hover:bg-red-900/50 transition-colors">
                <Trash2 :size="12" /> Удалить
              </button>
            </div>
          </div>
          <!-- Footer -->
          <div class="px-4 pb-4">
            <button @click="previewFile = null"
              class="w-full py-2 rounded-lg bg-gray-100 dark:bg-gray-800 text-sm font-medium text-gray-600 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-gray-700 transition-colors">
              Закрыть
            </button>
          </div>
        </div>
      </div>
    </Teleport>

    <!-- AI Edit Modal -->
    <ImageEditModal
      v-if="editingFile"
      :visible="!!editingFile"
      :image-url="editingFile.url"
      :media-id="editingFile.id"
      :business-id="editingFile.businessId"
      @close="editingFile = null"
      @edited="onEdited"
    />

    <!-- Design Layer Editor (Фаза 1: запекание текст-дизайна на фото/видео) -->
    <DesignLayerEditor
      v-if="designFile"
      :media-file="designFile"
      :business-id="designFile.businessId"
      @close="designFile = null"
      @baked="onBaked"
    />

    <!-- Create/Rename Folder Dialog -->
    <Teleport to="body">
      <Transition
        enter-active-class="transition-opacity duration-150"
        enter-from-class="opacity-0"
        leave-active-class="transition-opacity duration-150"
        leave-to-class="opacity-0">
        <div v-if="showFolderDialog" class="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm"
          @click.self="showFolderDialog = false">
          <div class="bg-white dark:bg-gray-900 rounded-xl shadow-xl border border-gray-200 dark:border-gray-800 w-full max-w-sm mx-4 p-5">
            <h3 class="text-lg font-semibold mb-4">
              {{ folderDialogMode === 'create' ? 'Новая папка' : 'Переименовать папку' }}
            </h3>
            <input v-model="folderDialogName" @keyup.enter="submitFolderDialog" autofocus
              placeholder="Название папки"
              class="w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 text-sm" />
            <div class="flex justify-end gap-2 mt-4">
              <button @click="showFolderDialog = false"
                class="px-4 py-2 rounded-lg text-sm text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-800">
                Отмена
              </button>
              <button @click="submitFolderDialog" :disabled="!folderDialogName.trim()"
                class="px-4 py-2 rounded-lg text-sm font-medium bg-brand-600 hover:bg-brand-700 text-white disabled:opacity-50">
                {{ folderDialogMode === 'create' ? 'Создать' : 'Сохранить' }}
              </button>
            </div>
          </div>
        </div>
      </Transition>
    </Teleport>

    <!-- Move Files Dialog -->
    <Teleport to="body">
      <Transition
        enter-active-class="transition-opacity duration-150"
        enter-from-class="opacity-0"
        leave-active-class="transition-opacity duration-150"
        leave-to-class="opacity-0">
        <div v-if="showMoveDialog" class="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm"
          @click.self="showMoveDialog = false">
          <div class="bg-white dark:bg-gray-900 rounded-xl shadow-xl border border-gray-200 dark:border-gray-800 w-full max-w-sm mx-4 p-5">
            <h3 class="text-lg font-semibold mb-1">Переместить {{ selectedFiles.size }} файлов</h3>
            <p class="text-sm text-gray-500 mb-4">Выберите папку назначения</p>

            <div class="space-y-1 max-h-60 overflow-y-auto">
              <!-- Root option -->
              <button @click="moveTargetFolderId = null"
                :class="[
                  'w-full flex items-center gap-2 px-3 py-2 rounded-lg text-sm text-left transition-colors',
                  moveTargetFolderId === null
                    ? 'bg-brand-50 dark:bg-brand-950 text-brand-700 dark:text-brand-300 font-medium'
                    : 'hover:bg-gray-100 dark:hover:bg-gray-800 text-gray-700 dark:text-gray-300'
                ]">
                <Home :size="16" class="text-gray-400" />
                Корень (без папки)
              </button>

              <button v-for="f in moveFolders" :key="f.id" @click="moveTargetFolderId = f.id"
                :class="[
                  'w-full flex items-center gap-2 px-3 py-2 rounded-lg text-sm text-left transition-colors',
                  moveTargetFolderId === f.id
                    ? 'bg-brand-50 dark:bg-brand-950 text-brand-700 dark:text-brand-300 font-medium'
                    : 'hover:bg-gray-100 dark:hover:bg-gray-800 text-gray-700 dark:text-gray-300'
                ]">
                <Folder :size="16" class="text-amber-500" />
                {{ f.name }}
                <span class="text-[10px] text-gray-400 ml-auto">{{ f._count.files }}</span>
              </button>
            </div>

            <div class="flex justify-end gap-2 mt-4">
              <button @click="showMoveDialog = false"
                class="px-4 py-2 rounded-lg text-sm text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-800">
                Отмена
              </button>
              <button @click="moveFiles"
                class="px-4 py-2 rounded-lg text-sm font-medium bg-brand-600 hover:bg-brand-700 text-white">
                Переместить
              </button>
            </div>
          </div>
        </div>
      </Transition>
    </Teleport>
  </div>
</template>
