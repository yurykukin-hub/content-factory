<script setup lang="ts">
import { ref, computed, onMounted, watch } from 'vue'
import { http } from '@/api/client'
import { useToast } from '@/composables/useToast'
import { useBusinessesStore } from '@/stores/businesses'
import { formatDate } from '@/composables/useFormatters'
import BusinessFilter from '@/components/BusinessFilter.vue'
import {
  UserCircle, Plus, Trash2, Pencil, Loader2, Save,
  Image as ImageIcon, X,
} from 'lucide-vue-next'

interface Character {
  id: string; name: string; description: string; type: string; style: string
  isActive: boolean; referenceMediaId: string | null
  referenceMedia?: { id: string; url: string; thumbUrl: string | null } | null
  businessIds?: string[]; businessNames?: string[]
}

const toast = useToast()
const businesses = useBusinessesStore()

const characters = ref<Character[]>([])
const loading = ref(true)
const selectedBizId = ref<string | null>(businesses.currentBusinessId)

// Form
const showForm = ref(false)
const editingId = ref<string | null>(null)
const form = ref({
  name: '', description: '', type: 'person', style: '',
  referenceMediaId: null as string | null,
  businessIds: [] as string[],
})
const saving = ref(false)
const deleteConfirmId = ref<string | null>(null)

const typeLabels: Record<string, string> = { person: 'Человек', mascot: 'Маскот', avatar: 'Аватар' }
const typeColors: Record<string, string> = {
  person: 'bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300',
  mascot: 'bg-amber-100 text-amber-700 dark:bg-amber-900 dark:text-amber-300',
  avatar: 'bg-purple-100 text-purple-700 dark:bg-purple-900 dark:text-purple-300',
}

const filteredCharacters = computed(() => {
  if (!selectedBizId.value) return characters.value
  return characters.value.filter(c => c.businessIds?.includes(selectedBizId.value!))
})

async function loadCharacters() {
  loading.value = true
  try {
    characters.value = await http.get<Character[]>('/characters')
  } catch (e) {
    toast.error('Ошибка загрузки персонажей')
  } finally {
    loading.value = false
  }
}

function openForm(char?: Character) {
  if (char) {
    editingId.value = char.id
    form.value = {
      name: char.name, description: char.description, type: char.type,
      style: char.style, referenceMediaId: char.referenceMediaId,
      businessIds: char.businessIds || [],
    }
  } else {
    editingId.value = null
    form.value = {
      name: '', description: '', type: 'person', style: '',
      referenceMediaId: null,
      businessIds: selectedBizId.value ? [selectedBizId.value] : [],
    }
  }
  showForm.value = true
}

async function saveCharacter() {
  if (!form.value.name.trim() || !form.value.businessIds.length) return
  saving.value = true
  const isEdit = !!editingId.value
  try {
    if (isEdit) {
      await http.put(`/characters/${editingId.value}`, form.value)
    } else {
      await http.post('/characters', form.value)
    }
    showForm.value = false
    editingId.value = null
    await loadCharacters()
    toast.success(isEdit ? 'Персонаж обновлён' : 'Персонаж создан')
  } catch (e: any) {
    toast.error(e.message || 'Ошибка')
  } finally {
    saving.value = false
  }
}

async function deleteCharacter(id: string) {
  deleteConfirmId.value = null
  try {
    await http.delete(`/characters/${id}`)
    characters.value = characters.value.filter(c => c.id !== id)
    toast.success('Персонаж удалён')
  } catch (e: any) {
    toast.error(e.message || 'Ошибка удаления')
  }
}

async function uploadPhoto(event: Event) {
  const input = event.target as HTMLInputElement
  if (!input.files?.length) return

  const bizId = form.value.businessIds[0] || businesses.businesses[0]?.id
  if (!bizId) { toast.error('Выберите бизнес'); return }

  const formData = new FormData()
  formData.append('file', input.files[0])
  formData.append('businessId', bizId)
  formData.append('tags', JSON.stringify(['character', 'reference']))

  try {
    const res = await fetch('/api/media/upload', {
      method: 'POST', credentials: 'include', body: formData,
    })
    if (!res.ok) throw new Error('Upload failed')
    const media = await res.json()
    form.value.referenceMediaId = media.id
    toast.success('Фото загружено')
  } catch {
    toast.error('Ошибка загрузки фото')
  }
  input.value = ''
}

onMounted(loadCharacters)
</script>

<template>
  <div>
    <!-- Header -->
    <div class="flex items-center justify-between mb-4">
      <h1 class="text-xl md:text-2xl font-bold flex items-center gap-2">
        <UserCircle :size="24" class="text-brand-500" />
        Персонажи
      </h1>
      <button
        @click="openForm()"
        class="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-brand-600 hover:bg-brand-700 text-white text-sm font-medium transition-colors"
      >
        <Plus :size="14" />
        <span class="hidden sm:inline">Создать</span>
      </button>
    </div>

    <!-- Business filter -->
    <BusinessFilter v-model="selectedBizId" />

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
      <p class="text-gray-500 mb-1">Персонажей пока нет</p>
      <p class="text-xs text-gray-400 mb-4">Создайте персонажа — AI будет генерировать контент с ним</p>
      <button
        @click="openForm()"
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
        class="relative bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 hover:border-brand-300 dark:hover:border-brand-700 transition-colors overflow-hidden"
      >
        <div class="p-4">
          <div class="flex items-start gap-3">
            <!-- Avatar -->
            <div class="w-14 h-14 rounded-xl bg-gray-100 dark:bg-gray-800 overflow-hidden shrink-0 flex items-center justify-center">
              <img
                v-if="char.referenceMedia?.thumbUrl || char.referenceMedia?.url"
                :src="char.referenceMedia.thumbUrl || char.referenceMedia.url"
                :alt="char.name"
                class="w-full h-full object-cover"
              />
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
          <!-- Business badges -->
          <div v-if="char.businessNames?.length" class="flex flex-wrap gap-1 mt-3 pt-3 border-t border-gray-100 dark:border-gray-800">
            <span
              v-for="bn in char.businessNames" :key="bn"
              class="px-2 py-0.5 rounded-full text-[10px] font-medium bg-gray-100 dark:bg-gray-800 text-gray-500"
            >{{ bn }}</span>
          </div>
        </div>
        <!-- Actions -->
        <div class="absolute top-3 right-3 flex gap-0.5">
          <button @click="openForm(char)" class="p-1.5 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors">
            <Pencil :size="13" class="text-gray-400" />
          </button>
          <button @click="deleteConfirmId = char.id" class="p-1.5 rounded-lg hover:bg-red-50 dark:hover:bg-red-950 transition-colors">
            <Trash2 :size="13" class="text-gray-400 hover:text-red-500" />
          </button>
        </div>
      </div>
    </div>

    <!-- Create/Edit Modal -->
    <Teleport to="body">
      <div
        v-if="showForm"
        class="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
        @click.self="showForm = false"
      >
        <div class="bg-white dark:bg-gray-900 rounded-2xl p-5 w-full max-w-lg shadow-xl max-h-[90vh] overflow-y-auto">
          <div class="flex items-center justify-between mb-4">
            <h3 class="text-base font-bold">{{ editingId ? 'Редактировать' : 'Новый персонаж' }}</h3>
            <button @click="showForm = false" class="p-1 rounded-lg text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800">
              <X :size="18" />
            </button>
          </div>

          <div class="space-y-3">
            <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label class="block text-xs font-medium mb-1">Имя *</label>
                <input v-model="form.name" class="w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 text-sm outline-none focus:border-brand-500" placeholder="Юрий" />
              </div>
              <div>
                <label class="block text-xs font-medium mb-1">Тип</label>
                <select v-model="form.type" class="w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 text-sm">
                  <option value="person">Человек</option>
                  <option value="mascot">Маскот</option>
                  <option value="avatar">Аватар</option>
                </select>
              </div>
            </div>

            <div>
              <label class="block text-xs font-medium mb-1">Описание для AI</label>
              <textarea v-model="form.description" rows="2" class="w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 text-sm outline-none focus:border-brand-500 resize-none" placeholder="Молодой мужчина, тёмные волосы, спортивное телосложение..." />
              <p class="text-[10px] text-gray-400 mt-0.5">Опишите внешность — AI использует это при генерации</p>
            </div>

            <!-- Бизнесы (мультивыбор) -->
            <div>
              <label class="block text-xs font-medium mb-1.5">Бизнесы *</label>
              <div class="flex flex-wrap gap-1.5">
                <label
                  v-for="biz in businesses.businesses" :key="biz.id"
                  :class="[
                    'flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium cursor-pointer transition-colors border',
                    form.businessIds.includes(biz.id)
                      ? 'bg-brand-100 dark:bg-brand-900 text-brand-700 dark:text-brand-300 border-brand-300 dark:border-brand-700'
                      : 'bg-gray-100 dark:bg-gray-800 text-gray-500 border-gray-200 dark:border-gray-700 hover:border-brand-300',
                  ]"
                >
                  <input type="checkbox" :value="biz.id" v-model="form.businessIds" class="hidden" />
                  {{ biz.name }}
                </label>
              </div>
              <p class="text-[10px] text-gray-400 mt-1">Персонаж будет доступен для AI-генерации в выбранных бизнесах</p>
            </div>

            <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label class="block text-xs font-medium mb-1">Стиль</label>
                <input v-model="form.style" class="w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 text-sm outline-none focus:border-brand-500" placeholder="realistic, cartoon, anime..." />
              </div>
              <div>
                <label class="block text-xs font-medium mb-1">Фото-референс</label>
                <div class="flex items-center gap-2">
                  <label class="flex items-center gap-1.5 px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 text-sm cursor-pointer hover:border-brand-400 transition-colors">
                    <ImageIcon :size="14" class="text-gray-400" />
                    {{ form.referenceMediaId ? 'Заменить' : 'Загрузить' }}
                    <input type="file" accept="image/*" @change="uploadPhoto" class="hidden" />
                  </label>
                  <span v-if="form.referenceMediaId" class="text-xs text-green-600">Загружено</span>
                </div>
              </div>
            </div>
          </div>

          <div class="flex gap-2 mt-5">
            <button
              @click="showForm = false"
              class="flex-1 px-3 py-2.5 rounded-lg border border-gray-300 dark:border-gray-700 text-sm font-medium text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800"
            >Отмена</button>
            <button
              @click="saveCharacter"
              :disabled="saving || !form.name.trim() || !form.businessIds.length"
              class="flex-1 px-3 py-2.5 rounded-lg bg-brand-600 hover:bg-brand-700 text-white text-sm font-medium disabled:opacity-50 flex items-center justify-center gap-2"
            >
              <Loader2 v-if="saving" :size="14" class="animate-spin" />
              <Save v-else :size="14" />
              {{ saving ? 'Сохранение...' : editingId ? 'Сохранить' : 'Создать' }}
            </button>
          </div>
        </div>
      </div>
    </Teleport>

    <!-- Delete confirmation -->
    <Teleport to="body">
      <div
        v-if="deleteConfirmId"
        class="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
        @click.self="deleteConfirmId = null"
      >
        <div class="bg-white dark:bg-gray-900 rounded-2xl p-5 w-full max-w-sm shadow-xl">
          <h3 class="text-base font-bold mb-2">Удалить персонажа?</h3>
          <p class="text-sm text-gray-500 mb-4">Персонаж будет удалён из всех бизнесов. Это нельзя отменить.</p>
          <div class="flex gap-2">
            <button @click="deleteConfirmId = null" class="flex-1 px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-700 text-sm font-medium text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800">
              Отмена
            </button>
            <button @click="deleteCharacter(deleteConfirmId!)" class="flex-1 px-3 py-2 rounded-lg bg-red-600 hover:bg-red-700 text-white text-sm font-medium">
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
