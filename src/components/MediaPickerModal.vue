<script setup lang="ts">
import { ref, computed, watch } from 'vue'
import { http } from '@/api/client'
import { X, Search, Loader2, Image, Check } from 'lucide-vue-next'

interface MediaFile {
  id: string
  url: string
  thumbUrl: string | null
  filename: string
  mimeType: string
  sizeBytes: number
}

const props = withDefaults(defineProps<{
  visible: boolean
  businessId: string
  multiSelect?: boolean
  maxSelect?: number
}>(), {
  multiSelect: false,
  maxSelect: 14,
})

const emit = defineEmits<{
  close: []
  selected: [file: MediaFile]
  selectedMulti: [files: MediaFile[]]
}>()

const files = ref<MediaFile[]>([])
const loading = ref(false)
const search = ref('')
const selectedId = ref<string | null>(null)
const selectedIds = ref<string[]>([])

async function loadMedia() {
  loading.value = true
  try {
    const params = new URLSearchParams({ type: 'image' })
    if (search.value.trim()) params.set('search', search.value.trim())
    const res = await http.get<{ files: MediaFile[] }>(`/media/library/${props.businessId}?${params}`)
    files.value = res.files
  } catch {
    files.value = []
  } finally {
    loading.value = false
  }
}

function toggleSelect(id: string) {
  if (props.multiSelect) {
    const idx = selectedIds.value.indexOf(id)
    if (idx >= 0) {
      selectedIds.value.splice(idx, 1)
    } else if (selectedIds.value.length < props.maxSelect) {
      selectedIds.value.push(id)
    }
  } else {
    selectedId.value = selectedId.value === id ? null : id
  }
}

function confirm() {
  if (props.multiSelect) {
    const selected = files.value.filter(f => selectedIds.value.includes(f.id))
    if (selected.length) {
      emit('selectedMulti', selected)
      emit('close')
      selectedIds.value = []
      search.value = ''
    }
  } else {
    const file = files.value.find(f => f.id === selectedId.value)
    if (file) {
      emit('selected', file)
      emit('close')
      selectedId.value = null
      search.value = ''
    }
  }
}

const isSelected = (id: string) => props.multiSelect ? selectedIds.value.includes(id) : selectedId.value === id
const selectionCount = computed(() => props.multiSelect ? selectedIds.value.length : (selectedId.value ? 1 : 0))
const canConfirm = computed(() => selectionCount.value > 0)

function formatSize(bytes: number) {
  if (bytes < 1024) return bytes + ' B'
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(0) + ' KB'
  return (bytes / (1024 * 1024)).toFixed(1) + ' MB'
}

// Загрузить при открытии
watch(() => props.visible, (v) => {
  if (v) {
    selectedId.value = null
    selectedIds.value = []
    search.value = ''
    loadMedia()
  }
})

function onSearch() {
  selectedId.value = null
  loadMedia()
}
</script>

<template>
  <div v-if="visible" class="fixed inset-0 z-50 flex items-center justify-center bg-black/50" @click.self="emit('close')">
    <div class="bg-white dark:bg-gray-900 rounded-2xl p-6 w-full max-w-2xl shadow-xl max-h-[85vh] flex flex-col">
      <!-- Header -->
      <div class="flex items-center justify-between mb-4">
        <h2 class="text-lg font-bold flex items-center gap-2">
          <Image :size="20" class="text-brand-500" /> Выбрать из медиатеки
        </h2>
        <button @click="emit('close')" class="p-1 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800">
          <X :size="18" class="text-gray-400" />
        </button>
      </div>

      <!-- Search -->
      <div class="relative mb-4">
        <Search :size="16" class="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
        <input
          v-model="search"
          @keydown.enter="onSearch"
          placeholder="Поиск по названию... Enter для поиска"
          class="w-full pl-9 pr-3 py-2 rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 text-sm focus:ring-2 focus:ring-brand-500"
        />
      </div>

      <!-- Grid -->
      <div class="flex-1 overflow-y-auto min-h-0">
        <div v-if="loading" class="flex items-center justify-center py-12">
          <Loader2 :size="24" class="animate-spin text-brand-500" />
        </div>

        <div v-else-if="!files.length" class="text-center py-12">
          <Image :size="32" class="mx-auto text-gray-300 dark:text-gray-600 mb-2" />
          <p class="text-sm text-gray-500">Нет изображений в медиатеке</p>
          <p v-if="search" class="text-xs text-gray-400 mt-1">Попробуйте другой запрос</p>
        </div>

        <div v-else class="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 gap-2">
          <button
            v-for="f in files"
            :key="f.id"
            @click="toggleSelect(f.id)"
            :class="[
              'relative group rounded-lg overflow-hidden aspect-square border-2 transition-all',
              isSelected(f.id)
                ? 'border-brand-500 ring-2 ring-brand-500/30 scale-[0.96]'
                : 'border-transparent hover:border-gray-300 dark:hover:border-gray-600',
            ]"
          >
            <img
              :src="f.thumbUrl || f.url"
              :alt="f.filename"
              class="w-full h-full object-cover"
              loading="lazy"
            />
            <!-- Check overlay -->
            <div v-if="isSelected(f.id)" class="absolute inset-0 bg-brand-500/20 flex items-center justify-center">
              <div class="w-7 h-7 rounded-full bg-brand-500 flex items-center justify-center shadow-lg">
                <Check :size="16" class="text-white" />
              </div>
            </div>
            <!-- Info overlay on hover -->
            <div class="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/60 to-transparent p-1.5 opacity-0 group-hover:opacity-100 transition-opacity">
              <p class="text-[9px] text-white truncate">{{ f.filename }}</p>
              <p class="text-[8px] text-white/70">{{ formatSize(f.sizeBytes) }}</p>
            </div>
          </button>
        </div>
      </div>

      <!-- Footer -->
      <div class="flex items-center justify-between mt-4 pt-4 border-t border-gray-200 dark:border-gray-800">
        <span class="text-xs text-gray-400">
          {{ files.length }} изображений{{ selectionCount ? ` · ${selectionCount} выбрано` : '' }}
          <span v-if="multiSelect && maxSelect" class="text-gray-500"> (макс. {{ maxSelect }})</span>
        </span>
        <div class="flex gap-2">
          <button @click="emit('close')" class="px-4 py-2 rounded-lg text-sm text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800">
            Отмена
          </button>
          <button
            @click="confirm"
            :disabled="!canConfirm"
            class="flex items-center gap-2 px-4 py-2 rounded-lg bg-brand-600 hover:bg-brand-700 text-white text-sm font-medium disabled:opacity-50 transition-colors"
          >
            <Check :size="16" /> Выбрать{{ selectionCount > 1 ? ` (${selectionCount})` : '' }}
          </button>
        </div>
      </div>
    </div>
  </div>
</template>
