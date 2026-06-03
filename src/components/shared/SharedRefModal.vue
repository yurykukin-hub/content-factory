<script setup lang="ts">
import { ref, computed, watch } from 'vue'
import { http, TAB_ID } from '@/api/client'
import { useToast } from '@/composables/useToast'
import MediaPickerModal from '@/components/MediaPickerModal.vue'
import {
  X, Upload, Plus, Loader2, Sparkles, Star, Trash2,
  ChevronUp, ChevronDown, ImagePlus, Wand2, FolderOpen,
} from 'lucide-vue-next'

export interface CharacterData {
  id: string
  name: string
  description: string
  type: string
  style: string
  referenceMedia?: { id?: string; url: string; thumbUrl: string | null } | null
  images?: Array<{
    id: string; url: string; thumbUrl: string | null; filename: string
    mediaFileId: string; description: string; isMain: boolean; sortOrder: number; source: string
  }>
}

const props = defineProps<{
  visible: boolean
  businessId: string
  character?: CharacterData | null
  colorScheme?: 'emerald' | 'fuchsia'
}>()

const emit = defineEmits<{
  close: []
  saved: []
}>()

const toast = useToast()
const color = computed(() => props.colorScheme || 'emerald')
const isEditMode = computed(() => !!props.character?.id)

// Form state
const name = ref('')
const type = ref<string>('person')
const description = ref('')
const style = ref('')
const saving = ref(false)
const describing = ref(false)
const generatingSheet = ref(false)

// Gallery state (edit mode — managed via API)
const images = ref<CharacterData['images']>([])

// Pending uploads (create mode — not saved yet)
const pendingUploads = ref<Array<{ mediaFileId: string; url: string; thumbUrl: string | null; filename: string }>>([])

// Media picker
const showMediaPicker = ref(false)

const TYPE_OPTIONS = [
  { id: 'person', label: 'Персона' },
  { id: 'mascot', label: 'Маскот' },
  { id: 'avatar', label: 'Аватар' },
  { id: 'object', label: 'Объект' },
  { id: 'location', label: 'Локация' },
]

const hasPhotos = computed(() => {
  if (isEditMode.value) return (images.value?.length ?? 0) > 0
  return pendingUploads.value.length > 0
})
const canSave = computed(() => name.value.trim().length > 0)
const mainImageUrl = computed(() => {
  if (isEditMode.value) {
    const main = images.value?.find(i => i.isMain)
    return main?.thumbUrl || main?.url || images.value?.[0]?.url || null
  }
  return pendingUploads.value[0]?.thumbUrl || pendingUploads.value[0]?.url || null
})

// Populate form when character prop changes
watch(() => props.character, (char) => {
  if (char) {
    name.value = char.name || ''
    type.value = char.type || 'person'
    description.value = char.description || ''
    style.value = char.style || ''
    images.value = char.images ? [...char.images] : []
  }
}, { immediate: true })

// Reset on close
watch(() => props.visible, (val) => {
  if (!val) {
    if (!props.character) {
      name.value = ''
      type.value = 'person'
      description.value = ''
      style.value = ''
      pendingUploads.value = []
      images.value = []
    }
    // Edit mode: НЕ сбрасываем images — восстановятся из character prop
  }
})

// --- Upload ---

async function uploadPhoto(event: Event) {
  const input = event.target as HTMLInputElement
  if (!input.files?.length || !props.businessId) return
  const fd = new FormData()
  fd.append('file', input.files[0])
  fd.append('businessId', props.businessId)
  fd.append('tags', JSON.stringify(['reference']))
  try {
    const res = await fetch('/api/media/upload', { method: 'POST', credentials: 'include', headers: { 'X-Tab-ID': TAB_ID }, body: fd })
    if (!res.ok) throw new Error()
    const m = await res.json()

    if (isEditMode.value && props.character?.id) {
      // Edit mode: immediately add via API
      const img = await http.post<any>(`/characters/${props.character.id}/images`, {
        mediaFileId: m.id,
        isMain: images.value?.length === 0,
      })
      images.value = [...(images.value || []), img]
      toast.success('Фото добавлено')
    } else {
      // Create mode: queue for save
      pendingUploads.value.push({ mediaFileId: m.id, url: m.url, thumbUrl: m.thumbUrl, filename: m.filename })
      if (!name.value) {
        const raw = m.filename.replace(/\.[^.]+$/, '').replace(/[-_]/g, ' ')
        name.value = raw.charAt(0).toUpperCase() + raw.slice(1)
      }
    }
  } catch { toast.error('Ошибка загрузки') }
  input.value = ''
}

// --- Media picker ---

function onMediaSelected(file: any) {
  if (isEditMode.value && props.character?.id) {
    addImageFromLibrary(file)
  } else {
    pendingUploads.value.push({ mediaFileId: file.id, url: file.url, thumbUrl: file.thumbUrl, filename: file.filename })
  }
  showMediaPicker.value = false
}

function onMediaSelectedMulti(files: any[]) {
  for (const file of files) {
    if (isEditMode.value && props.character?.id) {
      addImageFromLibrary(file)
    } else {
      pendingUploads.value.push({ mediaFileId: file.id, url: file.url, thumbUrl: file.thumbUrl, filename: file.filename })
    }
  }
  showMediaPicker.value = false
}

async function addImageFromLibrary(file: any) {
  if (!props.character?.id) return
  try {
    const img = await http.post<any>(`/characters/${props.character.id}/images`, {
      mediaFileId: file.id,
      isMain: images.value?.length === 0,
    })
    images.value = [...(images.value || []), img]
  } catch (e: any) {
    toast.error(e.message?.includes('Unique') ? 'Фото уже добавлено' : 'Ошибка добавления')
  }
}

// --- Image actions (edit mode) ---

async function setMain(imgId: string) {
  if (!props.character?.id) return
  try {
    await http.put(`/characters/${props.character.id}/images/${imgId}`, { isMain: true })
    images.value = images.value?.map(i => ({ ...i, isMain: i.id === imgId })) || []
    toast.success('Главное фото обновлено')
  } catch { toast.error('Ошибка') }
}

async function deleteImage(imgId: string) {
  if (!props.character?.id) return
  try {
    await http.delete(`/characters/${props.character.id}/images/${imgId}`)
    images.value = images.value?.filter(i => i.id !== imgId) || []
    toast.success('Фото удалено')
  } catch { toast.error('Ошибка удаления') }
}

async function updateImageDescription(imgId: string, desc: string) {
  if (!props.character?.id) return
  try {
    await http.put(`/characters/${props.character.id}/images/${imgId}`, { description: desc })
    images.value = images.value?.map(i => i.id === imgId ? { ...i, description: desc } : i) || []
  } catch { /* silent */ }
}

async function moveImage(imgId: string, direction: 'up' | 'down') {
  if (!props.character?.id || !images.value) return
  const idx = images.value.findIndex(i => i.id === imgId)
  if (idx < 0) return
  const swapIdx = direction === 'up' ? idx - 1 : idx + 1
  if (swapIdx < 0 || swapIdx >= images.value.length) return

  const items = images.value.map((img, i) => ({ id: img.id, sortOrder: i }))
  // Swap
  const temp = items[idx].sortOrder
  items[idx].sortOrder = items[swapIdx].sortOrder
  items[swapIdx].sortOrder = temp

  try {
    await http.post(`/characters/${props.character.id}/images/reorder`, { items })
    const arr = [...images.value]
    ;[arr[idx], arr[swapIdx]] = [arr[swapIdx], arr[idx]]
    images.value = arr
  } catch { toast.error('Ошибка сортировки') }
}

// --- AI describe ---

async function autoDescribe() {
  const imgUrl = mainImageUrl.value
  if (!imgUrl) return
  describing.value = true
  try {
    const res = await http.post<{ description: string }>('/ai/describe-image', {
      imageUrl: imgUrl,
      type: type.value,
      businessId: props.businessId,
    })
    description.value = res.description
    toast.success('Описание сгенерировано')
  } catch (e: any) { toast.error(e.message || 'Ошибка AI') }
  finally { describing.value = false }
}

async function describeImage(imgId: string, imgUrl: string) {
  if (!props.character?.id) return
  try {
    const res = await http.post<{ description: string }>('/ai/describe-image', {
      imageUrl: imgUrl,
      type: type.value,
      businessId: props.businessId,
    })
    await updateImageDescription(imgId, res.description)
    toast.success('Описание фото обновлено')
  } catch (e: any) { toast.error(e.message || 'Ошибка AI') }
}

// --- Character Sheet generation ---

async function generateSheet() {
  if (!props.character?.id) return
  generatingSheet.value = true
  try {
    await http.post(`/characters/${props.character.id}/generate-sheet`, {})
    toast.success('Генерация карты референса запущена. Результат появится в галерее через 1-2 минуты')
  } catch (e: any) { toast.error(e.message || 'Ошибка генерации') }
  finally { generatingSheet.value = false }
}

// --- Save ---

async function save() {
  if (!canSave.value || !props.businessId) return
  saving.value = true
  try {
    const payload: any = {
      name: name.value.trim(),
      description: description.value.trim(),
      type: type.value,
      style: style.value.trim(),
      businessIds: [props.businessId],
    }

    if (isEditMode.value && props.character?.id) {
      await http.put(`/characters/${props.character.id}`, payload)
      toast.success('Референс обновлён')
    } else {
      // Create character + add pending images
      const created = await http.post<any>('/characters', payload)
      if (pendingUploads.value.length > 0) {
        for (let i = 0; i < pendingUploads.value.length; i++) {
          await http.post(`/characters/${created.id}/images`, {
            mediaFileId: pendingUploads.value[i].mediaFileId,
            isMain: i === 0,
          })
        }
      }
      toast.success('Референс создан')
    }

    emit('saved')
    emit('close')
  } catch (e: any) { toast.error(e.message || 'Ошибка сохранения') }
  finally { saving.value = false }
}

function removePending(idx: number) {
  pendingUploads.value.splice(idx, 1)
}
</script>

<template>
  <Teleport to="body">
    <div v-if="visible" class="fixed inset-0 z-50 flex items-center justify-center bg-black/60" @click.self="emit('close')">
      <div class="bg-white dark:bg-gray-900 rounded-2xl shadow-2xl max-w-lg w-full mx-4 overflow-hidden">

        <!-- Header -->
        <div class="flex items-center justify-between px-5 py-4 border-b border-gray-200 dark:border-gray-800">
          <h3 class="text-base font-bold">{{ isEditMode ? 'Референс' : 'Создать референс' }}</h3>
          <button @click="emit('close')" class="p-1 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 transition-colors">
            <X :size="18" />
          </button>
        </div>

        <!-- Body -->
        <div class="p-5 space-y-4 max-h-[75vh] overflow-y-auto">

          <!-- === Photo Gallery (edit mode) === -->
          <div v-if="isEditMode && images && images.length > 0">
            <div class="flex items-center justify-between mb-2">
              <p class="text-xs font-medium text-gray-500">Фото ({{ images.length }})</p>
              <div class="flex gap-1">
                <label :class="[
                  'flex items-center gap-1 px-2 py-1 rounded-lg text-[10px] font-medium cursor-pointer transition-colors',
                  color === 'fuchsia' ? 'hover:bg-fuchsia-50 dark:hover:bg-fuchsia-900/20 text-fuchsia-600' : 'hover:bg-emerald-50 dark:hover:bg-emerald-900/20 text-emerald-600'
                ]">
                  <Upload :size="12" /> Загрузить
                  <input type="file" accept="image/*" class="hidden" @change="uploadPhoto" />
                </label>
                <button @click="showMediaPicker = true" :class="[
                  'flex items-center gap-1 px-2 py-1 rounded-lg text-[10px] font-medium transition-colors',
                  color === 'fuchsia' ? 'hover:bg-fuchsia-50 dark:hover:bg-fuchsia-900/20 text-fuchsia-600' : 'hover:bg-emerald-50 dark:hover:bg-emerald-900/20 text-emerald-600'
                ]">
                  <FolderOpen :size="12" /> Медиатека
                </button>
              </div>
            </div>

            <div class="grid grid-cols-3 gap-2">
              <div v-for="(img, idx) in images" :key="img.id"
                class="group relative rounded-xl overflow-hidden border border-gray-200 dark:border-gray-700 aspect-square">
                <img :src="img.thumbUrl || img.url" :alt="img.filename" class="w-full h-full object-cover" />

                <!-- Overlay actions -->
                <div class="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center gap-1.5">
                  <!-- Set as main -->
                  <button v-if="!img.isMain" @click="setMain(img.id)" title="Сделать главным"
                    class="w-7 h-7 rounded-full bg-white/80 flex items-center justify-center hover:bg-yellow-100 transition-colors">
                    <Star :size="14" class="text-gray-600" />
                  </button>
                  <!-- AI describe this photo -->
                  <button @click="describeImage(img.id, img.url)" title="AI-описание"
                    class="w-7 h-7 rounded-full bg-white/80 flex items-center justify-center hover:bg-purple-100 transition-colors">
                    <Sparkles :size="14" class="text-gray-600" />
                  </button>
                  <!-- Move up/down -->
                  <button v-if="idx > 0" @click="moveImage(img.id, 'up')" title="Вверх"
                    class="w-7 h-7 rounded-full bg-white/80 flex items-center justify-center hover:bg-blue-100 transition-colors">
                    <ChevronUp :size="14" class="text-gray-600" />
                  </button>
                  <button v-if="images && idx < images.length - 1" @click="moveImage(img.id, 'down')" title="Вниз"
                    class="w-7 h-7 rounded-full bg-white/80 flex items-center justify-center hover:bg-blue-100 transition-colors">
                    <ChevronDown :size="14" class="text-gray-600" />
                  </button>
                  <!-- Delete -->
                  <button @click="deleteImage(img.id)" title="Удалить"
                    class="w-7 h-7 rounded-full bg-white/80 flex items-center justify-center hover:bg-red-100 transition-colors">
                    <Trash2 :size="14" class="text-red-500" />
                  </button>
                </div>

                <!-- Main star badge -->
                <div v-if="img.isMain" class="absolute top-1 left-1">
                  <Star :size="14" class="text-yellow-400 fill-yellow-400 drop-shadow" />
                </div>

                <!-- Source badge -->
                <div v-if="img.source === 'character_sheet'" class="absolute top-1 right-1">
                  <span class="text-[8px] px-1 py-0.5 rounded bg-purple-500/80 text-white font-medium">Sheet</span>
                </div>

                <!-- Description preview -->
                <div v-if="img.description" class="absolute bottom-0 left-0 right-0 px-1.5 py-1 bg-gradient-to-t from-black/60 to-transparent">
                  <p class="text-[9px] text-white/90 truncate">{{ img.description }}</p>
                </div>
              </div>

              <!-- Add more (inside grid) -->
              <label class="aspect-square rounded-xl border-2 border-dashed border-gray-300 dark:border-gray-700 flex flex-col items-center justify-center cursor-pointer hover:border-gray-400 transition-colors">
                <ImagePlus :size="20" class="text-gray-400 mb-1" />
                <span class="text-[10px] text-gray-400">Ещё</span>
                <input type="file" accept="image/*" class="hidden" @change="uploadPhoto" />
              </label>
            </div>
          </div>

          <!-- === Photo upload (create mode or edit with no photos) === -->
          <div v-else>
            <div class="space-y-2">
              <p class="text-xs font-medium text-gray-500">
                {{ isEditMode ? 'Нет фото — загрузите' : 'Фото' }}
              </p>
              <div class="flex gap-2 flex-wrap">
                <div v-for="(p, idx) in pendingUploads" :key="idx"
                  class="relative group w-20 h-20 rounded-xl overflow-hidden border border-gray-200 dark:border-gray-700">
                  <img :src="p.thumbUrl || p.url" class="w-full h-full object-cover" />
                  <button @click="removePending(idx)"
                    class="absolute top-0.5 right-0.5 w-5 h-5 bg-red-500/80 rounded-full flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
                    <X :size="10" class="text-white" />
                  </button>
                  <div v-if="idx === 0" class="absolute top-0.5 left-0.5">
                    <Star :size="12" class="text-yellow-400 fill-yellow-400 drop-shadow" />
                  </div>
                </div>

                <!-- Upload button -->
                <label :class="[
                  'w-20 h-20 rounded-xl border-2 border-dashed flex flex-col items-center justify-center cursor-pointer transition-colors',
                  color === 'fuchsia'
                    ? 'border-gray-300 dark:border-gray-700 hover:border-fuchsia-400'
                    : 'border-gray-300 dark:border-gray-700 hover:border-emerald-400'
                ]">
                  <Upload :size="18" class="text-gray-400 mb-1" />
                  <span class="text-[9px] text-gray-400">Загрузить</span>
                  <input type="file" accept="image/*" class="hidden" @change="uploadPhoto" />
                </label>

                <!-- From library -->
                <button @click="showMediaPicker = true" :class="[
                  'w-20 h-20 rounded-xl border-2 border-dashed flex flex-col items-center justify-center transition-colors',
                  color === 'fuchsia'
                    ? 'border-gray-300 dark:border-gray-700 hover:border-fuchsia-400'
                    : 'border-gray-300 dark:border-gray-700 hover:border-emerald-400'
                ]">
                  <FolderOpen :size="18" class="text-gray-400 mb-1" />
                  <span class="text-[9px] text-gray-400">Медиатека</span>
                </button>
              </div>
            </div>
          </div>

          <!-- Character Sheet button (edit mode only, need photos) -->
          <button v-if="isEditMode && hasPhotos" @click="generateSheet" :disabled="generatingSheet"
            :class="[
              'w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl text-sm font-medium transition-all',
              color === 'fuchsia'
                ? 'bg-fuchsia-50 dark:bg-fuchsia-900/20 text-fuchsia-700 dark:text-fuchsia-300 hover:bg-fuchsia-100 dark:hover:bg-fuchsia-900/30'
                : 'bg-emerald-50 dark:bg-emerald-900/20 text-emerald-700 dark:text-emerald-300 hover:bg-emerald-100 dark:hover:bg-emerald-900/30'
            ]">
            <Loader2 v-if="generatingSheet" :size="16" class="animate-spin" />
            <Wand2 v-else :size="16" />
            Создать карту референса (AI)
          </button>

          <!-- Name -->
          <input v-model="name" placeholder="Введите имя"
            :class="[
              'w-full px-3 py-2.5 rounded-xl border bg-gray-50 dark:bg-gray-800 text-sm outline-none transition-colors',
              color === 'fuchsia'
                ? 'border-gray-300 dark:border-gray-700 focus:border-fuchsia-400'
                : 'border-gray-300 dark:border-gray-700 focus:border-emerald-400'
            ]" />

          <!-- Type -->
          <div class="flex gap-1.5 flex-wrap">
            <button v-for="t in TYPE_OPTIONS" :key="t.id"
              @click="type = t.id"
              :class="[
                'px-3 py-1.5 rounded-lg text-xs font-medium transition-all border',
                type === t.id
                  ? color === 'fuchsia'
                    ? 'bg-fuchsia-100 dark:bg-fuchsia-900/50 text-fuchsia-700 dark:text-fuchsia-300 border-fuchsia-300 dark:border-fuchsia-700'
                    : 'bg-emerald-100 dark:bg-emerald-900/50 text-emerald-700 dark:text-emerald-300 border-emerald-300 dark:border-emerald-700'
                  : 'bg-gray-100 dark:bg-gray-800 text-gray-500 border-transparent hover:border-gray-300 dark:hover:border-gray-600'
              ]">
              {{ t.label }}
            </button>
          </div>

          <!-- Description + Auto -->
          <div class="relative">
            <textarea v-model="description" rows="3"
              placeholder="Опишите ключевые особенности: внешность, стиль, детали..."
              :class="[
                'w-full px-3 py-2.5 rounded-xl border bg-gray-50 dark:bg-gray-800 text-sm outline-none resize-none transition-colors',
                color === 'fuchsia'
                  ? 'border-gray-300 dark:border-gray-700 focus:border-fuchsia-400'
                  : 'border-gray-300 dark:border-gray-700 focus:border-emerald-400'
              ]" />
            <button v-if="hasPhotos" @click="autoDescribe" :disabled="describing"
              class="absolute bottom-2 right-2 flex items-center gap-1 px-2.5 py-1 rounded-lg text-[10px] font-medium bg-gray-200 dark:bg-gray-700 text-gray-600 dark:text-gray-300 hover:bg-gray-300 dark:hover:bg-gray-600 disabled:opacity-50 transition-colors">
              <Loader2 v-if="describing" :size="10" class="animate-spin" />
              <Sparkles v-else :size="10" />
              Auto
            </button>
          </div>

          <!-- Style (optional) -->
          <input v-model="style" placeholder="Стиль (cartoon, realistic, anime...)"
            class="w-full px-3 py-2 rounded-xl border border-gray-300 dark:border-gray-700 bg-gray-50 dark:bg-gray-800 text-sm outline-none focus:border-gray-400 transition-colors" />
        </div>

        <!-- Footer -->
        <div class="flex items-center justify-end gap-2 px-5 py-4 border-t border-gray-200 dark:border-gray-800">
          <button @click="emit('close')"
            class="px-4 py-2 rounded-lg text-sm font-medium text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors">
            Отмена
          </button>
          <button @click="save" :disabled="!canSave || saving"
            :class="[
              'flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-medium transition-colors',
              canSave
                ? color === 'fuchsia'
                  ? 'bg-fuchsia-600 hover:bg-fuchsia-700 text-white'
                  : 'bg-emerald-600 hover:bg-emerald-700 text-white'
                : 'bg-gray-200 dark:bg-gray-700 text-gray-400 cursor-not-allowed'
            ]">
            <Loader2 v-if="saving" :size="14" class="animate-spin" />
            {{ isEditMode ? 'Сохранить' : 'Создать' }}
          </button>
        </div>
      </div>
    </div>
  </Teleport>

  <!-- Media Picker Modal -->
  <MediaPickerModal
    v-if="showMediaPicker"
    :visible="showMediaPicker"
    :business-id="businessId"
    :multi-select="true"
    :max-select="20"
    @close="showMediaPicker = false"
    @selected="onMediaSelected"
    @selected-multi="onMediaSelectedMulti"
  />
</template>
