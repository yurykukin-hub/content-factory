<script setup lang="ts">
import { ref, computed, onMounted, watch } from 'vue'
import { http } from '@/api/client'
import { useBusinessesStore } from '@/stores/businesses'
import { useToast } from '@/composables/useToast'
import { formatDate } from '@/composables/useFormatters'
import {
  Image, Video, Upload, Search, Tag, X, Loader2, Trash2,
  Filter, Grid3X3, Link, ExternalLink
} from 'lucide-vue-next'

interface MediaFile {
  id: string
  postId: string | null
  businessId: string
  filename: string
  url: string
  thumbUrl: string | null
  mimeType: string
  sizeBytes: number
  tags: string[]
  createdAt: string
  post: { id: string; title: string; status: string } | null
}

const businesses = useBusinessesStore()
const toast = useToast()

const files = ref<MediaFile[]>([])
const allTags = ref<string[]>([])
const loading = ref(true)
const uploading = ref(false)

// Filters
const typeFilter = ref<'' | 'image' | 'video'>('')
const tagFilter = ref('')
const searchQuery = ref('')
const showUnattached = ref(false)

// Tag editor
const editingTagsId = ref<string | null>(null)
const tagInput = ref('')

async function loadFiles() {
  if (!businesses.currentBusiness) return
  loading.value = true
  try {
    const params = new URLSearchParams()
    if (typeFilter.value) params.set('type', typeFilter.value)
    if (tagFilter.value) params.set('tag', tagFilter.value)
    if (searchQuery.value) params.set('search', searchQuery.value)
    if (showUnattached.value) params.set('unattached', 'true')
    const qs = params.toString() ? `?${params}` : ''
    files.value = await http.get<MediaFile[]>(`/media/library/${businesses.currentBusiness.id}${qs}`)
  } catch (e: any) {
    toast.error('Ошибка загрузки медиа')
  } finally {
    loading.value = false
  }
}

async function loadTags() {
  if (!businesses.currentBusiness) return
  try {
    allTags.value = await http.get<string[]>(`/media/tags/${businesses.currentBusiness.id}`)
  } catch {}
}

async function uploadFile(e: Event) {
  const input = e.target as HTMLInputElement
  if (!input.files?.length || !businesses.currentBusiness) return
  uploading.value = true
  try {
    for (const file of input.files) {
      const formData = new FormData()
      formData.append('file', file)
      formData.append('businessId', businesses.currentBusiness.id)
      await fetch('/api/media/upload', { method: 'POST', body: formData, credentials: 'include' })
    }
    toast.success(`${input.files.length} файл(ов) загружено`)
    await loadFiles()
  } catch (e: any) {
    toast.error('Ошибка загрузки')
  } finally {
    uploading.value = false
    input.value = ''
  }
}

async function deleteFile(id: string) {
  if (!confirm('Удалить файл?')) return
  try {
    await http.delete(`/media/${id}`)
    files.value = files.value.filter(f => f.id !== id)
    toast.success('Файл удалён')
  } catch (e: any) {
    toast.error('Ошибка удаления')
  }
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

function formatSize(bytes: number) {
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(0) + ' KB'
  return (bytes / (1024 * 1024)).toFixed(1) + ' MB'
}

const isImage = (mime: string) => mime.startsWith('image/')
const stats = computed(() => ({
  total: files.value.length,
  images: files.value.filter(f => isImage(f.mimeType)).length,
  videos: files.value.filter(f => f.mimeType.startsWith('video/')).length,
  unattached: files.value.filter(f => !f.postId).length,
}))

onMounted(() => { loadFiles(); loadTags() })
watch(() => businesses.currentBusiness?.id, () => { loadFiles(); loadTags() })
watch([typeFilter, tagFilter, showUnattached], loadFiles)
</script>

<template>
  <div>
    <div class="flex items-center justify-between mb-6">
      <h1 class="text-2xl font-bold">Медиа-библиотека</h1>
      <label :class="['flex items-center gap-2 px-4 py-2 rounded-lg bg-brand-600 hover:bg-brand-700 text-white text-sm font-medium cursor-pointer transition-colors', uploading && 'opacity-50']">
        <Loader2 v-if="uploading" :size="16" class="animate-spin" />
        <Upload v-else :size="16" />
        Загрузить
        <input type="file" accept="image/*,video/*" multiple class="hidden" @change="uploadFile" :disabled="uploading" />
      </label>
    </div>

    <!-- Stats -->
    <div class="flex gap-4 mb-4 text-sm text-gray-500">
      <span>{{ stats.total }} файлов</span>
      <span>{{ stats.images }} фото</span>
      <span>{{ stats.videos }} видео</span>
      <span>{{ stats.unattached }} без поста</span>
    </div>

    <!-- Filters -->
    <div class="flex flex-wrap items-center gap-3 mb-6">
      <div class="flex gap-1 bg-gray-100 dark:bg-gray-800 rounded-lg p-1">
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

    <!-- Empty -->
    <div v-else-if="files.length === 0" class="bg-white dark:bg-gray-900 rounded-xl p-8 border border-gray-200 dark:border-gray-800 text-center">
      <Image :size="48" class="mx-auto text-gray-300 dark:text-gray-600 mb-3" />
      <p class="text-gray-500 mb-4">Нет медиафайлов. Загрузите фото или видео!</p>
    </div>

    <!-- Grid -->
    <div v-else class="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3">
      <div v-for="file in files" :key="file.id"
        class="group relative bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 overflow-hidden hover:border-brand-300 dark:hover:border-brand-700 transition-colors">

        <!-- Thumbnail -->
        <div class="aspect-square bg-gray-100 dark:bg-gray-800 relative">
          <img v-if="isImage(file.mimeType)"
            :src="file.thumbUrl || file.url"
            :alt="file.filename"
            class="w-full h-full object-cover" />
          <div v-else class="w-full h-full flex items-center justify-center">
            <Video :size="32" class="text-gray-400" />
          </div>

          <!-- Overlay actions -->
          <div class="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center gap-2">
            <a :href="file.url" target="_blank" class="p-2 bg-white/20 rounded-full hover:bg-white/30">
              <ExternalLink :size="16" class="text-white" />
            </a>
            <button @click="deleteFile(file.id)" class="p-2 bg-white/20 rounded-full hover:bg-red-500/50">
              <Trash2 :size="16" class="text-white" />
            </button>
          </div>

          <!-- Post badge -->
          <div v-if="file.post" class="absolute top-1.5 left-1.5">
            <router-link :to="`/posts/${file.post.id}`"
              class="flex items-center gap-0.5 px-1.5 py-0.5 bg-brand-600/80 text-white rounded text-[9px] font-medium hover:bg-brand-700">
              <Link :size="10" /> Пост
            </router-link>
          </div>

          <!-- Type badge -->
          <div class="absolute top-1.5 right-1.5 px-1.5 py-0.5 bg-black/50 text-white rounded text-[9px]">
            {{ file.mimeType.split('/')[1]?.toUpperCase() }}
          </div>
        </div>

        <!-- Info -->
        <div class="p-2.5">
          <div class="text-xs font-medium truncate text-gray-700 dark:text-gray-300">{{ file.filename }}</div>
          <div class="text-[10px] text-gray-400 mt-0.5">{{ formatSize(file.sizeBytes) }} · {{ formatDate(file.createdAt) }}</div>

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
  </div>
</template>
