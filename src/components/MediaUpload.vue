<script setup lang="ts">
import { ref, computed } from 'vue'
import { http, TAB_ID } from '@/api/client'
import { useToast } from '@/composables/useToast'
import { Upload, X, Loader2, Image, Film, Music, Wand2, Eraser, Crop, ChevronLeft, ChevronRight } from 'lucide-vue-next'
import ImageEditModal from '@/components/ai/ImageEditModal.vue'

interface MediaFile {
  id: string
  url: string
  thumbUrl: string | null
  filename: string
  mimeType: string
  sizeBytes: number
}

const props = defineProps<{
  businessId: string
  postId?: string
  files: MediaFile[]
}>()

const emit = defineEmits<{
  uploaded: [file: MediaFile]
  removed: [id: string]
  reorder: [orderedIds: string[]]
}>()

const toast = useToast()
const uploading = ref(false)
const dragOver = ref(false)
const removingBgId = ref<string | null>(null)
const editingFile = ref<MediaFile | null>(null)

// Порядок медиа карусели: desktop — drag&drop, мобильный — стрелки ◀▶. Публикация идёт по этому порядку.
const dragIndex = ref<number | null>(null)
// Нативный HTML5 drag работает только мышью; на тач-экранах (телефон) он лишь вибрирует и «вешает»
// серую плитку без drop. На телефоне переупорядочиваем стрелками ◀▶, drag оставляем десктопу.
const supportsDrag = typeof window !== 'undefined' && !window.matchMedia('(pointer: coarse)').matches
function onDragStart(idx: number) { dragIndex.value = idx }
function onCardDrop(idx: number) {
  const from = dragIndex.value
  dragIndex.value = null
  if (from === null || from === idx) return
  const ids = props.files.map(f => f.id)
  const [moved] = ids.splice(from, 1)
  ids.splice(idx, 0, moved)
  emit('reorder', ids)
}
function moveItem(idx: number, dir: -1 | 1) {
  const j = idx + dir
  if (j < 0 || j >= props.files.length) return
  const ids = props.files.map(f => f.id)
  ;[ids[idx], ids[j]] = [ids[j], ids[idx]]
  emit('reorder', ids)
}

// Подгон формата (обрезка / размытый фон) — адаптация под ленту IG и др.
const fittingFile = ref<MediaFile | null>(null)
const fitRatio = ref('4:5')
const fitMode = ref<'crop' | 'pad'>('pad')
const fitLoading = ref(false)
const FIT_RATIOS = ['1:1', '4:5', '3:4', '9:16', '16:9']
const fitAspectCss = computed(() => fitRatio.value.replace(':', ' / '))

async function applyFit() {
  if (!fittingFile.value || fitLoading.value) return
  fitLoading.value = true
  try {
    const srcId = fittingFile.value.id
    const newFile = await http.post<MediaFile>('/media/fit', {
      mediaId: srcId,
      businessId: props.businessId,
      postId: props.postId,
      ratio: fitRatio.value,
      mode: fitMode.value,
    })
    emit('uploaded', newFile)
    // Открепить исходник от поста (остаётся в медиатеке)
    if (props.postId) {
      await http.post(`/media/${srcId}/attach`, { postId: null }).catch(() => {})
      emit('removed', srcId)
    }
    toast.success('Формат применён')
    fittingFile.value = null
  } catch (e: any) {
    toast.error('Ошибка: ' + (e.message || e))
  } finally {
    fitLoading.value = false
  }
}

async function removeBg(file: MediaFile) {
  if (removingBgId.value) return
  if (!confirm('Удалить фон с изображения?')) return
  removingBgId.value = file.id
  try {
    const result = await http.post<{ mediaFile: MediaFile }>('/ai/remove-background', {
      businessId: props.businessId,
      mediaId: file.id,
      postId: props.postId,
    })
    emit('uploaded', result.mediaFile)
    toast.success('Фон удалён')
  } catch (e: any) { toast.error('Ошибка: ' + (e.message || e)) }
  finally { removingBgId.value = null }
}

function onEdited(file: MediaFile) {
  emit('uploaded', file)
  editingFile.value = null
}

async function handleFiles(fileList: FileList | null) {
  if (!fileList) return
  for (const file of Array.from(fileList)) {
    await uploadFile(file)
  }
}

async function uploadFile(file: File) {
  uploading.value = true
  try {
    const formData = new FormData()
    formData.append('file', file)
    formData.append('businessId', props.businessId)
    if (props.postId) formData.append('postId', props.postId)

    const res = await fetch('/api/media/upload', {
      method: 'POST',
      body: formData,
      credentials: 'include',
      headers: { 'X-Tab-ID': TAB_ID },
    })
    if (!res.ok) {
      const err = await res.json().catch(() => ({})) as { error?: string }
      throw new Error(err.error || `Файл не загружен (HTTP ${res.status})`)
    }
    const mediaFile = await res.json() as MediaFile
    emit('uploaded', mediaFile)
  } catch (e: any) {
    toast.error('Ошибка загрузки: ' + (e.message || ''))
  } finally {
    uploading.value = false
  }
}

async function removeFile(id: string) {
  if (!confirm('Открепить файл от поста?')) return
  try {
    // Detach from post, don't delete from media library
    await http.post(`/media/${id}/attach`, { postId: null })
    emit('removed', id)
  } catch (e: any) {
    toast.error(e.message || 'Произошла ошибка')
  }
}

function onDrop(e: DragEvent) {
  dragOver.value = false
  handleFiles(e.dataTransfer?.files || null)
}

function mediaIcon(mime: string) {
  if (mime.startsWith('image/')) return Image
  if (mime.startsWith('video/')) return Film
  if (mime.startsWith('audio/')) return Music
  return Upload
}

function formatSize(bytes: number) {
  if (bytes < 1024) return bytes + ' B'
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB'
  return (bytes / (1024 * 1024)).toFixed(1) + ' MB'
}
</script>

<template>
  <div>
    <!-- File gallery — показывает реальное соотношение (фикс. высота, ширина по кадру) -->
    <div v-if="files.length" class="flex flex-wrap gap-2 mb-3">
      <div
        v-for="(f, idx) in files"
        :key="f.id"
        :draggable="files.length > 1 && supportsDrag"
        @dragstart="onDragStart(idx)"
        @dragover.prevent
        @drop="onCardDrop(idx)"
        @dragend="dragIndex = null"
        :class="['relative group rounded-lg overflow-hidden bg-gray-100 dark:bg-gray-800 flex items-center justify-center transition-opacity',
          files.length > 1 && supportsDrag ? 'cursor-move' : '', dragIndex === idx ? 'opacity-40' : '']"
      >
        <img
          v-if="f.mimeType.startsWith('image/')"
          :src="f.url"
          :alt="f.filename"
          loading="lazy"
          class="h-32 w-auto block pointer-events-none"
        />
        <div v-else class="h-32 w-32 flex flex-col items-center justify-center text-gray-400 pointer-events-none">
          <component :is="mediaIcon(f.mimeType)" :size="24" />
          <span class="text-[10px] mt-1 truncate max-w-full px-1">{{ f.filename }}</span>
        </div>
        <!-- Overlay buttons -->
        <div class="absolute inset-0 bg-black/0 group-hover:bg-black/30 transition-colors pointer-events-none" />
        <!-- Номер кадра в карусели -->
        <span v-if="files.length > 1" class="absolute top-1 left-1 w-5 h-5 rounded-full bg-black/60 text-white text-[10px] font-bold flex items-center justify-center z-10">{{ idx + 1 }}</span>
        <div class="absolute top-1 right-1 flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity z-10">
          <button v-if="f.mimeType.startsWith('image/')" @click="editingFile = f" title="Редактировать AI"
            class="p-1 rounded-full bg-purple-600/80 hover:bg-purple-600 text-white">
            <Wand2 :size="13" />
          </button>
          <button v-if="f.mimeType.startsWith('image/')" @click="fittingFile = f" title="Подогнать формат (обрезка / поля)"
            class="p-1 rounded-full bg-blue-600/80 hover:bg-blue-600 text-white">
            <Crop :size="13" />
          </button>
          <button v-if="f.mimeType.startsWith('image/')" @click="removeBg(f)" :disabled="removingBgId === f.id" title="Убрать фон"
            class="p-1 rounded-full bg-purple-600/80 hover:bg-purple-600 text-white disabled:opacity-50">
            <Loader2 v-if="removingBgId === f.id" :size="13" class="animate-spin" /><Eraser v-else :size="13" />
          </button>
          <button @click="removeFile(f.id)" title="Удалить"
            class="p-1 rounded-full bg-black/50 hover:bg-red-600/80 text-white">
            <X :size="13" />
          </button>
        </div>
        <!-- Размер (только одиночное фото — у карусели низ занят стрелками) -->
        <span v-if="files.length === 1" class="absolute bottom-1 left-1 text-[9px] text-white bg-black/50 px-1 rounded z-10">
          {{ formatSize(f.sizeBytes) }}
        </span>
        <!-- Перемещение в карусели: стрелки ◀ ▶ (надёжно на мобильном) -->
        <div v-if="files.length > 1" class="absolute inset-x-0 bottom-0 flex items-center justify-between px-1 pb-1 z-10">
          <button @click="moveItem(idx, -1)" :disabled="idx === 0" title="Левее"
            class="w-6 h-6 rounded-full bg-black/55 hover:bg-black/80 text-white flex items-center justify-center disabled:opacity-25 disabled:cursor-default">
            <ChevronLeft :size="14" />
          </button>
          <button @click="moveItem(idx, 1)" :disabled="idx === files.length - 1" title="Правее"
            class="w-6 h-6 rounded-full bg-black/55 hover:bg-black/80 text-white flex items-center justify-center disabled:opacity-25 disabled:cursor-default">
            <ChevronRight :size="14" />
          </button>
        </div>
      </div>
    </div>

    <!-- Drop zone -->
    <div
      :class="[
        'border-2 border-dashed rounded-lg p-4 text-center transition-colors cursor-pointer',
        dragOver
          ? 'border-brand-400 bg-brand-50 dark:bg-brand-950'
          : 'border-gray-300 dark:border-gray-700 hover:border-brand-400',
        uploading ? 'opacity-50 pointer-events-none' : ''
      ]"
      @dragover.prevent="dragOver = true"
      @dragleave="dragOver = false"
      @drop.prevent="onDrop"
      @click="($refs.fileInput as HTMLInputElement)?.click()"
    >
      <Loader2 v-if="uploading" :size="20" class="mx-auto animate-spin text-brand-500" />
      <Upload v-else :size="20" class="mx-auto text-gray-400" />
      <p class="text-xs text-gray-500 mt-1">
        {{ uploading ? 'Загрузка...' : 'Перетащите файлы или нажмите' }}
      </p>
      <p class="text-[10px] text-gray-400">Фото, видео, аудио (до 100 MB)</p>
      <input
        ref="fileInput"
        type="file"
        multiple
        accept="image/*,video/*,audio/*"
        class="hidden"
        @change="handleFiles(($event.target as HTMLInputElement).files)"
      />
    </div>

    <!-- AI Edit Modal -->
    <ImageEditModal
      v-if="editingFile"
      :visible="!!editingFile"
      :image-url="editingFile.url"
      :media-id="editingFile.id"
      :business-id="businessId"
      :post-id="postId"
      @close="editingFile = null"
      @edited="onEdited"
    />

    <!-- Format fit modal (обрезка / размытый фон, на выбор) -->
    <div v-if="fittingFile" class="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" @click.self="fittingFile = null">
      <div class="bg-white dark:bg-gray-900 rounded-2xl p-5 w-full max-w-sm shadow-xl">
        <h3 class="text-base font-bold mb-3 flex items-center gap-2"><Crop :size="18" class="text-blue-500" /> Подгон формата</h3>

        <!-- Живое превью: реальное соотношение + выбранный режим -->
        <div class="flex justify-center mb-1">
          <div class="rounded-lg overflow-hidden bg-black relative" :style="{ aspectRatio: fitAspectCss, height: '210px', maxWidth: '100%' }">
            <img v-if="fitMode === 'pad'" :src="fittingFile.url" class="absolute inset-0 w-full h-full object-cover blur-lg scale-110 opacity-80" />
            <img :src="fittingFile.url" :class="['relative w-full h-full', fitMode === 'crop' ? 'object-cover' : 'object-contain']" />
          </div>
        </div>
        <p class="text-[10px] text-gray-400 text-center mb-3">Превью {{ fitRatio }} · {{ fitMode === 'crop' ? 'обрезка (по центру; реально — умная по содержимому)' : 'размытый фон' }}</p>

        <label class="block text-xs font-medium text-gray-500 mb-1.5">Соотношение</label>
        <div class="flex flex-wrap gap-1.5 mb-3">
          <button v-for="r in FIT_RATIOS" :key="r" @click="fitRatio = r"
            :class="['px-2.5 py-1 rounded-lg text-xs font-medium border transition-colors',
              fitRatio === r ? 'border-blue-500 bg-blue-50 dark:bg-blue-950 text-blue-700 dark:text-blue-300' : 'border-gray-200 dark:border-gray-700 text-gray-500 hover:border-blue-300']">
            {{ r }}
          </button>
        </div>

        <label class="block text-xs font-medium text-gray-500 mb-1.5">Режим</label>
        <div class="grid grid-cols-2 gap-2 mb-4">
          <button @click="fitMode = 'pad'"
            :class="['px-3 py-2 rounded-lg text-xs font-medium border text-center', fitMode === 'pad' ? 'border-blue-500 bg-blue-50 dark:bg-blue-950 text-blue-700 dark:text-blue-300' : 'border-gray-200 dark:border-gray-700 text-gray-500']">
            Размытый фон<br><span class="text-[10px] opacity-70">без обрезки</span>
          </button>
          <button @click="fitMode = 'crop'"
            :class="['px-3 py-2 rounded-lg text-xs font-medium border text-center', fitMode === 'crop' ? 'border-blue-500 bg-blue-50 dark:bg-blue-950 text-blue-700 dark:text-blue-300' : 'border-gray-200 dark:border-gray-700 text-gray-500']">
            Обрезка<br><span class="text-[10px] opacity-70">умная, под формат</span>
          </button>
        </div>

        <div class="flex gap-2">
          <button @click="fittingFile = null" class="flex-1 px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-700 text-sm font-medium text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800">Отмена</button>
          <button @click="applyFit" :disabled="fitLoading"
            class="flex-1 flex items-center justify-center gap-2 px-3 py-2 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium disabled:opacity-50">
            <Loader2 v-if="fitLoading" :size="15" class="animate-spin" /><Crop v-else :size="15" /> Применить
          </button>
        </div>
        <p class="text-[10px] text-gray-400 mt-2 text-center">Создаст подогнанную копию (исходник останется в медиатеке). Для ленты IG — 4:5.</p>
      </div>
    </div>
  </div>
</template>
