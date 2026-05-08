<script setup lang="ts">
import { ref, computed, onMounted, watch } from 'vue'
import { http } from '@/api/client'
import { useToast } from '@/composables/useToast'
import { useBusinessesStore } from '@/stores/businesses'
import SharedRefModal from '@/components/shared/SharedRefModal.vue'
import type { CharacterData } from '@/components/shared/SharedRefModal.vue'
import { useSectionAccess } from '@/composables/useSectionAccess'
import {
  UserCircle, Plus, Trash2, Pencil, Search, Filter,
  ImageIcon, Images,
} from 'lucide-vue-next'

const { canEdit: canEditSection } = useSectionAccess()

interface CharacterImage {
  id: string; url: string; thumbUrl: string | null; filename: string
  mediaFileId: string; description: string; isMain: boolean; sortOrder: number; source: string
}

interface Character {
  id: string; name: string; description: string; type: string; style: string
  isActive: boolean
  referenceMedia?: { id: string; url: string; thumbUrl: string | null } | null
  images?: CharacterImage[]
  businessIds?: string[]; businessNames?: string[]
}

const toast = useToast()
const businesses = useBusinessesStore()

const characters = ref<Character[]>([])
const loading = ref(true)

// Search & filter
const searchQuery = ref('')
const filterType = ref<string | null>(null)

// SharedRefModal
const showRefModal = ref(false)
const editingCharacter = ref<CharacterData | null>(null)
const deleteConfirmId = ref<string | null>(null)

const typeLabels: Record<string, string> = {
  person: 'Человек', mascot: 'Маскот', avatar: 'Аватар',
  object: 'Объект', location: 'Локация',
}
const typeColors: Record<string, string> = {
  person: 'bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300',
  mascot: 'bg-amber-100 text-amber-700 dark:bg-amber-900 dark:text-amber-300',
  avatar: 'bg-purple-100 text-purple-700 dark:bg-purple-900 dark:text-purple-300',
  object: 'bg-cyan-100 text-cyan-700 dark:bg-cyan-900 dark:text-cyan-300',
  location: 'bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-300',
}

const filteredCharacters = computed(() => {
  let list = characters.value
  if (businesses.currentBusinessId) {
    list = list.filter(c => c.businessIds?.includes(businesses.currentBusinessId!))
  }
  if (filterType.value) {
    list = list.filter(c => c.type === filterType.value)
  }
  if (searchQuery.value.trim()) {
    const q = searchQuery.value.toLowerCase()
    list = list.filter(c =>
      c.name.toLowerCase().includes(q) ||
      c.description?.toLowerCase().includes(q)
    )
  }
  return list
})

async function loadCharacters() {
  loading.value = true
  try {
    characters.value = await http.get<Character[]>('/characters')
  } catch {
    toast.error('Ошибка загрузки референсов')
  } finally {
    loading.value = false
  }
}

function openCreate() {
  editingCharacter.value = null
  showRefModal.value = true
}

function openEdit(char: Character) {
  editingCharacter.value = char as CharacterData
  showRefModal.value = true
}

function onRefSaved() {
  showRefModal.value = false
  editingCharacter.value = null
  loadCharacters()
}

async function deleteCharacter(id: string) {
  deleteConfirmId.value = null
  try {
    await http.delete(`/characters/${id}`)
    characters.value = characters.value.filter(c => c.id !== id)
    toast.success('Референс удалён')
  } catch (e: any) {
    toast.error(e.message || 'Ошибка удаления')
  }
}

function getAvatar(char: Character) {
  const main = char.images?.find(i => i.isMain)
  return main?.thumbUrl || main?.url || char.referenceMedia?.thumbUrl || char.referenceMedia?.url || null
}

function getImageCount(char: Character) {
  return char.images?.length || (char.referenceMedia ? 1 : 0)
}

function getPreviewImages(char: Character, max = 4) {
  if (char.images?.length) return char.images.slice(0, max)
  return []
}

onMounted(loadCharacters)
watch(() => businesses.currentBusinessId, () => loadCharacters())
</script>

<template>
  <div>
    <!-- Header -->
    <div class="flex items-center justify-between mb-4">
      <h1 class="text-xl md:text-2xl font-bold flex items-center gap-2">
        <UserCircle :size="24" class="text-brand-500" />
        Референсы
      </h1>
      <button v-if="canEditSection('characters')"
        @click="openCreate()"
        class="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-brand-600 hover:bg-brand-700 text-white text-sm font-medium transition-colors"
      >
        <Plus :size="14" />
        <span class="hidden sm:inline">Создать</span>
      </button>
    </div>

    <!-- Search + Type filter -->
    <div class="flex items-center gap-2 mb-4 mt-2">
      <div class="relative flex-1 max-w-xs">
        <Search :size="14" class="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
        <input v-model="searchQuery" placeholder="Поиск по имени..."
          class="w-full pl-8 pr-3 py-2 rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 text-sm outline-none focus:border-brand-400 transition-colors" />
      </div>
      <div class="flex gap-1 overflow-x-auto">
        <button @click="filterType = null"
          :class="['px-2.5 py-1.5 rounded-lg text-xs font-medium transition-colors border whitespace-nowrap',
            !filterType
              ? 'bg-brand-100 dark:bg-brand-900/50 text-brand-700 dark:text-brand-300 border-brand-300 dark:border-brand-700'
              : 'bg-gray-100 dark:bg-gray-800 text-gray-500 border-transparent hover:border-gray-300'
          ]">Все</button>
        <button v-for="(label, key) in typeLabels" :key="key" @click="filterType = filterType === key ? null : key"
          :class="['px-2.5 py-1.5 rounded-lg text-xs font-medium transition-colors border whitespace-nowrap',
            filterType === key
              ? 'bg-brand-100 dark:bg-brand-900/50 text-brand-700 dark:text-brand-300 border-brand-300 dark:border-brand-700'
              : 'bg-gray-100 dark:bg-gray-800 text-gray-500 border-transparent hover:border-gray-300'
          ]">{{ label }}</button>
      </div>
    </div>

    <!-- Loading -->
    <div v-if="loading" class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
      <div v-for="i in 3" :key="i" class="bg-white dark:bg-gray-900 rounded-xl p-4 border border-gray-200 dark:border-gray-800 animate-pulse">
        <div class="flex items-start gap-3">
          <div class="w-14 h-14 rounded-xl bg-gray-200 dark:bg-gray-700"></div>
          <div class="flex-1">
            <div class="h-4 bg-gray-200 dark:bg-gray-700 rounded w-1/2 mb-2"></div>
            <div class="h-3 bg-gray-200 dark:bg-gray-700 rounded w-3/4"></div>
          </div>
        </div>
      </div>
    </div>

    <!-- Empty state -->
    <div v-else-if="filteredCharacters.length === 0" class="bg-white dark:bg-gray-900 rounded-xl p-8 border border-gray-200 dark:border-gray-800 text-center">
      <UserCircle :size="48" class="mx-auto text-gray-300 dark:text-gray-600 mb-3" />
      <p class="text-gray-500 mb-1">{{ searchQuery || filterType ? 'Ничего не найдено' : 'Референсов пока нет' }}</p>
      <p class="text-xs text-gray-400 mb-4">Создайте референс — AI будет использовать его при генерации</p>
      <button v-if="!searchQuery && !filterType"
        @click="openCreate()"
        class="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-brand-600 text-white text-sm font-medium"
      >
        <Plus :size="14" /> Создать первого
      </button>
    </div>

    <!-- Characters grid -->
    <div v-else class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
      <div
        v-for="char in filteredCharacters"
        :key="char.id"
        @click="openEdit(char)"
        class="relative bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 hover:border-brand-300 dark:hover:border-brand-700 transition-colors overflow-hidden cursor-pointer group"
      >
        <div class="p-4">
          <div class="flex items-start gap-3">
            <!-- Avatar -->
            <div class="w-14 h-14 rounded-xl bg-gray-100 dark:bg-gray-800 overflow-hidden shrink-0 flex items-center justify-center">
              <img v-if="getAvatar(char)" :src="getAvatar(char)!" :alt="char.name" class="w-full h-full object-cover" />
              <UserCircle v-else :size="28" class="text-gray-400" />
            </div>
            <div class="flex-1 min-w-0">
              <div class="flex items-center gap-2 mb-1">
                <h3 class="text-sm font-bold truncate">{{ char.name }}</h3>
                <span :class="['px-1.5 py-0.5 rounded text-[10px] font-medium shrink-0', typeColors[char.type] || typeColors.person]">
                  {{ typeLabels[char.type] || char.type }}
                </span>
              </div>
              <p v-if="char.description" class="text-xs text-gray-500 line-clamp-2">{{ char.description }}</p>
              <p v-if="char.style" class="text-[10px] text-gray-400 mt-1">Стиль: {{ char.style }}</p>
            </div>
          </div>

          <!-- Image preview strip -->
          <div v-if="getPreviewImages(char).length > 0" class="flex gap-1.5 mt-3 pt-3 border-t border-gray-100 dark:border-gray-800">
            <div v-for="img in getPreviewImages(char)" :key="img.id"
              class="w-10 h-10 rounded-lg overflow-hidden bg-gray-100 dark:bg-gray-800 shrink-0">
              <img :src="img.thumbUrl || img.url" :alt="img.filename" class="w-full h-full object-cover" />
            </div>
            <div v-if="getImageCount(char) > 4"
              class="w-10 h-10 rounded-lg bg-gray-100 dark:bg-gray-800 flex items-center justify-center shrink-0">
              <span class="text-[10px] font-medium text-gray-500">+{{ getImageCount(char) - 4 }}</span>
            </div>
            <div class="flex items-center ml-auto">
              <Images :size="12" class="text-gray-400 mr-1" />
              <span class="text-[10px] text-gray-400">{{ getImageCount(char) }}</span>
            </div>
          </div>

          <!-- Business badges -->
          <div v-if="char.businessNames?.length" :class="[
            'flex flex-wrap gap-1 mt-3',
            getPreviewImages(char).length > 0 ? '' : 'pt-3 border-t border-gray-100 dark:border-gray-800'
          ]">
            <span v-for="bn in char.businessNames" :key="bn"
              class="px-2 py-0.5 rounded-full text-[10px] font-medium bg-gray-100 dark:bg-gray-800 text-gray-500">
              {{ bn }}
            </span>
          </div>
        </div>

        <!-- Actions (stop propagation to not open modal) -->
        <div class="absolute top-3 right-3 flex gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
          <button @click.stop="openEdit(char)" class="p-1.5 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors">
            <Pencil :size="13" class="text-gray-400" />
          </button>
          <button @click.stop="deleteConfirmId = char.id" class="p-1.5 rounded-lg hover:bg-red-50 dark:hover:bg-red-950 transition-colors">
            <Trash2 :size="13" class="text-gray-400 hover:text-red-500" />
          </button>
        </div>
      </div>
    </div>

    <!-- SharedRefModal (create/edit) -->
    <SharedRefModal
      :visible="showRefModal"
      :business-id="businesses.currentBusinessId || businesses.businesses[0]?.id || ''"
      :character="editingCharacter"
      color-scheme="fuchsia"
      @close="showRefModal = false; editingCharacter = null"
      @saved="onRefSaved()"
    />

    <!-- Delete confirmation -->
    <Teleport to="body">
      <div v-if="deleteConfirmId"
        class="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
        @click.self="deleteConfirmId = null">
        <div class="bg-white dark:bg-gray-900 rounded-2xl p-5 w-full max-w-sm shadow-xl">
          <h3 class="text-base font-bold mb-2">Удалить референс?</h3>
          <p class="text-sm text-gray-500 mb-4">Референс будет удалён из всех проектов. Это нельзя отменить.</p>
          <div class="flex gap-2">
            <button @click="deleteConfirmId = null"
              class="flex-1 px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-700 text-sm font-medium text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800">
              Отмена
            </button>
            <button @click="deleteCharacter(deleteConfirmId!)"
              class="flex-1 px-3 py-2 rounded-lg bg-red-600 hover:bg-red-700 text-white text-sm font-medium">
              Удалить
            </button>
          </div>
        </div>
      </div>
    </Teleport>
  </div>
</template>

<style scoped>
.line-clamp-2 {
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}
</style>
