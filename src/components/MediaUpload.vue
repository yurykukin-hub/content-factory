<script setup lang="ts">
import { ref } from 'vue'
import { http } from '@/api/client'
import { useToast } from '@/composables/useToast'
import { Upload, X, Loader2, Image, Film, Music, Wand2, Eraser } from 'lucide-vue-next'
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
}>()

const toast = useToast()
const uploading = ref(false)
const dragOver = ref(false)
const removingBgId = ref<string | null>(null)
const editingFile = ref<MediaFile | null>(null)

async function removeBg(file: MediaFile) {
  if (removingBgId.value) return
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
    })
    if (!res.ok) throw new Error('Upload failed')
    const mediaFile = await res.json() as MediaFile
    emit('uploaded', mediaFile)
  } catch (e: any) {
    toast.error('Ошибка загрузки: ' + (e.message || ''))
  } finally {
    uploading.value = false
  }
}

async function removeFile(id: string) {
  try {
    await http.delete(`/media/${id}`)
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
    <!-- File gallery -->
    <div v-if="files.length" class="grid grid-cols-3 sm:grid-cols-4 gap-2 mb-3">
      <div
        v-for="f in files"
        :key="f.id"
        class="relative group rounded-lg overflow-hidden bg-gray-100 dark:bg-gray-800 aspect-square"
      >
        <img
          v-if="f.mimeType.startsWith('image/')"
          :src="f.thumbUrl || f.url"
          :alt="f.filename"
          class="w-full h-full object-cover"
        />
        <div v-else class="w-full h-full flex flex-col items-center justify-center text-gray-400">
          <component :is="mediaIcon(f.mimeType)" :size="24" />
          <span class="text-[10px] mt-1 truncate max-w-full px-1">{{ f.filename }}</span>
        </div>
        <!-- Overlay buttons -->
        <div class="absolute inset-0 bg-black/0 group-hover:bg-black/30 transition-colors" />
        <div class="absolute top-1 right-1 flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
          <button v-if="f.mimeType.startsWith('image/')" @click="editingFile = f" title="Редактировать AI"
            class="p-1 rounded-full bg-purple-600/80 hover:bg-purple-600 text-white">
            <Wand2 :size="13" />
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
        <span class="absolute bottom-1 left-1 text-[9px] text-white bg-black/50 px-1 rounded">
          {{ formatSize(f.sizeBytes) }}
        </span>
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
  </div>
</template>
