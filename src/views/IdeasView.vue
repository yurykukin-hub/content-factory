<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { http } from '@/api/client'
import { useToast } from '@/composables/useToast'
import { formatDate } from '@/composables/useFormatters'
import { Lightbulb, Plus, Trash2, Loader2, Check } from 'lucide-vue-next'

interface Idea {
  id: string
  title: string
  body: string
  createdAt: string
  updatedAt: string
}

const toast = useToast()

const ideas = ref<Idea[]>([])
const loading = ref(true)
const editingId = ref<string | null>(null)
const editForm = ref({ title: '', body: '' })
const saving = ref(false)
const deleteConfirmId = ref<string | null>(null)

let saveTimer: ReturnType<typeof setTimeout> | null = null

async function loadIdeas() {
  loading.value = true
  try {
    ideas.value = await http.get<Idea[]>('/ideas')
  } catch (e) {
    toast.error('Ошибка загрузки идей')
  } finally {
    loading.value = false
  }
}

async function createIdea() {
  try {
    const idea = await http.post<Idea>('/ideas', { title: '', body: '' })
    ideas.value.unshift(idea)
    startEditing(idea)
  } catch (e: any) {
    toast.error(e.message || 'Ошибка создания')
  }
}

function startEditing(idea: Idea) {
  // Save current editing if any
  if (editingId.value && editingId.value !== idea.id) {
    saveNow()
  }
  editingId.value = idea.id
  editForm.value = { title: idea.title, body: idea.body }
}

function onInput() {
  if (saveTimer) clearTimeout(saveTimer)
  saveTimer = setTimeout(saveNow, 1000)
}

async function saveNow() {
  if (!editingId.value) return
  if (saveTimer) { clearTimeout(saveTimer); saveTimer = null }

  const id = editingId.value
  saving.value = true
  try {
    const updated = await http.put<Idea>(`/ideas/${id}`, editForm.value)
    const idx = ideas.value.findIndex(i => i.id === id)
    if (idx !== -1) ideas.value[idx] = updated
  } catch (e: any) {
    toast.error('Ошибка сохранения')
  } finally {
    saving.value = false
  }
}

function closeEditing() {
  saveNow()
  editingId.value = null
}

async function deleteIdea(id: string) {
  deleteConfirmId.value = null
  try {
    await http.delete(`/ideas/${id}`)
    ideas.value = ideas.value.filter(i => i.id !== id)
    if (editingId.value === id) editingId.value = null
    toast.success('Удалено')
  } catch (e: any) {
    toast.error(e.message || 'Ошибка удаления')
  }
}

onMounted(loadIdeas)
</script>

<template>
  <div>
    <!-- Header -->
    <div class="flex items-center justify-between mb-5">
      <h1 class="text-xl md:text-2xl font-bold">Идеи</h1>
      <button
        @click="createIdea"
        class="flex items-center gap-2 px-4 py-2.5 rounded-lg bg-brand-600 hover:bg-brand-700 text-white text-sm font-medium transition-colors"
      >
        <Plus :size="16" />
        <span class="hidden sm:inline">Новая идея</span>
      </button>
    </div>

    <!-- Skeleton -->
    <div v-if="loading" class="space-y-3">
      <div v-for="i in 3" :key="i" class="bg-white dark:bg-gray-900 rounded-xl p-4 border border-gray-200 dark:border-gray-800 animate-pulse">
        <div class="h-4 bg-gray-200 dark:bg-gray-700 rounded w-1/3 mb-2"></div>
        <div class="h-3 bg-gray-200 dark:bg-gray-700 rounded w-2/3"></div>
      </div>
    </div>

    <!-- Empty state -->
    <div v-else-if="ideas.length === 0" class="bg-white dark:bg-gray-900 rounded-xl p-8 border border-gray-200 dark:border-gray-800 text-center">
      <Lightbulb :size="48" class="mx-auto text-gray-300 dark:text-gray-600 mb-3" />
      <p class="text-gray-500 mb-4">Запишите свои идеи для контента</p>
      <button
        @click="createIdea"
        class="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-brand-600 hover:bg-brand-700 text-white text-sm font-medium transition-colors"
      >
        <Plus :size="16" />
        Создать первую идею
      </button>
    </div>

    <!-- Ideas list -->
    <div v-else class="space-y-3">
      <div
        v-for="idea in ideas"
        :key="idea.id"
        :class="[
          'bg-white dark:bg-gray-900 rounded-xl border transition-all',
          editingId === idea.id
            ? 'border-brand-400 dark:border-brand-600 shadow-sm'
            : 'border-gray-200 dark:border-gray-800 hover:border-brand-300 dark:hover:border-brand-700 cursor-pointer',
        ]"
      >
        <!-- Editing mode -->
        <div v-if="editingId === idea.id" class="p-4">
          <input
            v-model="editForm.title"
            @input="onInput"
            placeholder="Заголовок (необязательно)"
            class="w-full text-base font-semibold bg-transparent border-0 outline-none placeholder:text-gray-400 dark:placeholder:text-gray-600 mb-2"
          />
          <textarea
            v-model="editForm.body"
            @input="onInput"
            placeholder="Опишите идею..."
            rows="4"
            class="w-full text-sm bg-transparent border-0 outline-none resize-none placeholder:text-gray-400 dark:placeholder:text-gray-600"
          />
          <div class="flex items-center justify-between mt-3 pt-3 border-t border-gray-100 dark:border-gray-800">
            <div class="flex items-center gap-2 text-xs text-gray-400">
              <Loader2 v-if="saving" :size="12" class="animate-spin" />
              <Check v-else :size="12" class="text-green-500" />
              <span>{{ saving ? 'Сохранение...' : 'Сохранено' }}</span>
            </div>
            <div class="flex items-center gap-1">
              <button
                @click.stop="deleteConfirmId = idea.id"
                class="p-1.5 rounded-lg text-gray-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-950 transition-colors"
              >
                <Trash2 :size="14" />
              </button>
              <button
                @click="closeEditing"
                class="px-3 py-1.5 rounded-lg text-xs font-medium text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800"
              >
                Готово
              </button>
            </div>
          </div>
        </div>

        <!-- View mode -->
        <div v-else class="p-4" @click="startEditing(idea)">
          <div class="flex items-start justify-between gap-2">
            <div class="flex-1 min-w-0">
              <h3 class="font-semibold text-sm md:text-base truncate mb-0.5">
                {{ idea.title || 'Без заголовка' }}
              </h3>
              <p v-if="idea.body" class="text-xs md:text-sm text-gray-500 dark:text-gray-400 line-clamp-2">
                {{ idea.body }}
              </p>
              <p v-else class="text-xs text-gray-400 italic">Нажмите чтобы написать...</p>
            </div>
            <span class="text-[10px] md:text-xs text-gray-400 shrink-0 mt-0.5">
              {{ formatDate(idea.updatedAt) }}
            </span>
          </div>
        </div>
      </div>
    </div>

    <!-- Delete confirmation modal -->
    <Teleport to="body">
      <div
        v-if="deleteConfirmId"
        class="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
        @click.self="deleteConfirmId = null"
      >
        <div class="bg-white dark:bg-gray-900 rounded-2xl p-5 w-full max-w-sm shadow-xl">
          <h3 class="text-base font-bold mb-2">Удалить идею?</h3>
          <p class="text-sm text-gray-500 mb-4">Это действие нельзя отменить.</p>
          <div class="flex gap-2">
            <button
              @click="deleteConfirmId = null"
              class="flex-1 px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-700 text-sm font-medium text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800"
            >
              Отмена
            </button>
            <button
              @click="deleteIdea(deleteConfirmId!)"
              class="flex-1 px-3 py-2 rounded-lg bg-red-600 hover:bg-red-700 text-white text-sm font-medium"
            >
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
