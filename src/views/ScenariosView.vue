<script setup lang="ts">
import { ref, computed, onMounted, watch } from 'vue'
import { http } from '@/api/client'
import { useToast } from '@/composables/useToast'
import { useBusinessesStore } from '@/stores/businesses'
import { formatDate } from '@/composables/useFormatters'
import BusinessFilter from '@/components/BusinessFilter.vue'
import { useRouter } from 'vue-router'
import {
  Clapperboard, Plus, Trash2, Sparkles, Loader2, ChevronDown, ChevronUp,
  GripVertical, Edit3, Check, X, Film,
} from 'lucide-vue-next'

interface Scene {
  sceneNumber: number
  description: string
  voiceover: string
  durationSec: number
  imagePrompt: string
}

interface Scenario {
  id: string
  businessId: string
  title: string
  description: string
  scenes: Scene[]
  status: string
  generatedBy: string
  aiPromptUsed: string | null
  createdAt: string
  updatedAt: string
  business?: { id: string; name: string; slug: string }
}

const toast = useToast()
const router = useRouter()
const businesses = useBusinessesStore()

const scenarios = ref<Scenario[]>([])
const loading = ref(true)
const selectedBizId = ref<string | null>(businesses.currentBusinessId)

// AI generation
const showAiModal = ref(false)
const aiTopic = ref('')
const aiSceneCount = ref(5)
const aiStyle = ref('')
const generating = ref(false)

// Editing
const expandedId = ref<string | null>(null)
const editingScenarioId = ref<string | null>(null)
const editForm = ref({ title: '', description: '', status: 'DRAFT' })
const saving = ref(false)

// Delete
const deleteConfirmId = ref<string | null>(null)

const statusLabels: Record<string, string> = {
  DRAFT: 'Черновик',
  READY: 'Готов',
  IN_PRODUCTION: 'В продакшне',
  COMPLETED: 'Завершён',
}

const statusColors: Record<string, string> = {
  DRAFT: 'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400',
  READY: 'bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300',
  IN_PRODUCTION: 'bg-amber-100 text-amber-700 dark:bg-amber-900 dark:text-amber-300',
  COMPLETED: 'bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-300',
}

const filteredScenarios = computed(() => {
  if (!selectedBizId.value) return scenarios.value
  return scenarios.value.filter(s => s.businessId === selectedBizId.value)
})

const totalDuration = (scenes: Scene[]) =>
  scenes.reduce((sum, s) => sum + (s.durationSec || 0), 0)

async function loadScenarios() {
  loading.value = true
  try {
    const query = selectedBizId.value ? `?businessId=${selectedBizId.value}` : ''
    scenarios.value = await http.get<Scenario[]>(`/scenarios${query}`)
  } catch (e) {
    toast.error('Ошибка загрузки сценариев')
  } finally {
    loading.value = false
  }
}

async function createScenario() {
  if (!selectedBizId.value) {
    toast.error('Выберите бизнес')
    return
  }
  try {
    const scenario = await http.post<Scenario>('/scenarios', {
      businessId: selectedBizId.value,
      title: 'Новый сценарий',
      scenes: [{ sceneNumber: 1, description: '', voiceover: '', durationSec: 5, imagePrompt: '' }],
    })
    scenarios.value.unshift(scenario)
    expandedId.value = scenario.id
    startEditing(scenario)
    toast.success('Сценарий создан')
  } catch (e: any) {
    toast.error(e.message || 'Ошибка создания')
  }
}

// AI generation
async function generateScenario() {
  if (!selectedBizId.value || !aiTopic.value.trim()) return
  generating.value = true
  try {
    const result = await http.post<{ title: string; scenes: Scene[] }>('/ai/generate-scenario', {
      businessId: selectedBizId.value,
      topic: aiTopic.value.trim(),
      sceneCount: aiSceneCount.value,
      style: aiStyle.value || undefined,
    })

    // Create scenario with AI-generated content
    const scenario = await http.post<Scenario>('/scenarios', {
      businessId: selectedBizId.value,
      title: result.title || aiTopic.value,
      description: `AI-сценарий: ${aiTopic.value}`,
      scenes: result.scenes,
      generatedBy: 'ai',
      aiPromptUsed: aiTopic.value,
    })
    scenarios.value.unshift(scenario)
    expandedId.value = scenario.id
    showAiModal.value = false
    aiTopic.value = ''
    aiStyle.value = ''
    toast.success('Сценарий сгенерирован!')
  } catch (e: any) {
    toast.error(e.message || 'Ошибка генерации')
  } finally {
    generating.value = false
  }
}

function toggleExpand(id: string) {
  expandedId.value = expandedId.value === id ? null : id
}

function startEditing(scenario: Scenario) {
  editingScenarioId.value = scenario.id
  editForm.value = {
    title: scenario.title,
    description: scenario.description,
    status: scenario.status,
  }
}

async function saveEditing(scenario: Scenario) {
  saving.value = true
  try {
    const updated = await http.put<Scenario>(`/scenarios/${scenario.id}`, editForm.value)
    const idx = scenarios.value.findIndex(s => s.id === scenario.id)
    if (idx !== -1) scenarios.value[idx] = updated
    editingScenarioId.value = null
    toast.success('Сохранено')
  } catch (e: any) {
    toast.error(e.message || 'Ошибка сохранения')
  } finally {
    saving.value = false
  }
}

async function updateScene(scenarioId: string, sceneIndex: number, field: string, value: any) {
  const scenario = scenarios.value.find(s => s.id === scenarioId)
  if (!scenario) return

  const scenes = [...scenario.scenes]
  ;(scenes[sceneIndex] as any)[field] = value

  try {
    const updated = await http.put<Scenario>(`/scenarios/${scenarioId}`, { scenes })
    const idx = scenarios.value.findIndex(s => s.id === scenarioId)
    if (idx !== -1) scenarios.value[idx] = updated
  } catch (e: any) {
    toast.error('Ошибка сохранения сцены')
  }
}

async function addScene(scenarioId: string) {
  const scenario = scenarios.value.find(s => s.id === scenarioId)
  if (!scenario) return

  const scenes = [...scenario.scenes]
  scenes.push({
    sceneNumber: scenes.length + 1,
    description: '',
    voiceover: '',
    durationSec: 5,
    imagePrompt: '',
  })

  try {
    const updated = await http.put<Scenario>(`/scenarios/${scenarioId}`, { scenes })
    const idx = scenarios.value.findIndex(s => s.id === scenarioId)
    if (idx !== -1) scenarios.value[idx] = updated
  } catch (e: any) {
    toast.error('Ошибка добавления сцены')
  }
}

async function removeScene(scenarioId: string, sceneIndex: number) {
  const scenario = scenarios.value.find(s => s.id === scenarioId)
  if (!scenario || scenario.scenes.length <= 1) return

  const scenes = scenario.scenes
    .filter((_, i) => i !== sceneIndex)
    .map((s, i) => ({ ...s, sceneNumber: i + 1 }))

  try {
    const updated = await http.put<Scenario>(`/scenarios/${scenarioId}`, { scenes })
    const idx = scenarios.value.findIndex(s => s.id === scenarioId)
    if (idx !== -1) scenarios.value[idx] = updated
  } catch (e: any) {
    toast.error('Ошибка удаления сцены')
  }
}

async function deleteScenario(id: string) {
  deleteConfirmId.value = null
  try {
    await http.delete(`/scenarios/${id}`)
    scenarios.value = scenarios.value.filter(s => s.id !== id)
    if (expandedId.value === id) expandedId.value = null
    toast.success('Удалено')
  } catch (e: any) {
    toast.error(e.message || 'Ошибка удаления')
  }
}

const creatingStories = ref<string | null>(null)

async function createStoriesFromScenario(scenarioId: string) {
  creatingStories.value = scenarioId
  try {
    const result = await http.post<{ ok: boolean; postsCreated: number; posts: { id: string; title: string }[]; message: string }>(
      `/scenarios/${scenarioId}/create-stories`, {}
    )
    toast.success(`${result.postsCreated} Stories создано!`)
    await loadScenarios()
    // Перейти к первой Story
    if (result.posts.length) {
      router.push(`/stories/${result.posts[0].id}`)
    }
  } catch (e: any) {
    toast.error(e.message || 'Ошибка создания Stories')
  } finally {
    creatingStories.value = null
  }
}

async function updateScenarioStatus(scenarioId: string, status: string) {
  try {
    const updated = await http.put<Scenario>(`/scenarios/${scenarioId}`, { status })
    const idx = scenarios.value.findIndex(s => s.id === scenarioId)
    if (idx !== -1) scenarios.value[idx] = updated
  } catch (e: any) {
    toast.error('Ошибка обновления статуса')
  }
}

watch(selectedBizId, () => loadScenarios())
onMounted(loadScenarios)
</script>

<template>
  <div>
    <!-- Header -->
    <div class="flex items-center justify-between mb-4">
      <h1 class="text-xl md:text-2xl font-bold flex items-center gap-2">
        <Clapperboard :size="24" class="text-brand-500" />
        Сценарии
      </h1>
      <div class="flex items-center gap-2">
        <button
          @click="showAiModal = true"
          class="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-gradient-to-r from-purple-600 to-brand-600 hover:from-purple-700 hover:to-brand-700 text-white text-sm font-medium transition-all"
        >
          <Sparkles :size="14" />
          <span class="hidden sm:inline">AI Сценарий</span>
        </button>
        <button
          @click="createScenario"
          class="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-brand-600 hover:bg-brand-700 text-white text-sm font-medium transition-colors"
        >
          <Plus :size="14" />
          <span class="hidden sm:inline">Новый</span>
        </button>
      </div>
    </div>

    <!-- Business filter -->
    <BusinessFilter v-model="selectedBizId" />

    <!-- Loading -->
    <div v-if="loading" class="space-y-3">
      <div v-for="i in 3" :key="i" class="bg-white dark:bg-gray-900 rounded-xl p-4 border border-gray-200 dark:border-gray-800 animate-pulse">
        <div class="h-5 bg-gray-200 dark:bg-gray-700 rounded w-1/3 mb-2"></div>
        <div class="h-3 bg-gray-200 dark:bg-gray-700 rounded w-2/3"></div>
      </div>
    </div>

    <!-- Empty state -->
    <div v-else-if="filteredScenarios.length === 0" class="bg-white dark:bg-gray-900 rounded-xl p-8 border border-gray-200 dark:border-gray-800 text-center">
      <Clapperboard :size="48" class="mx-auto text-gray-300 dark:text-gray-600 mb-3" />
      <p class="text-gray-500 mb-4">Создайте сценарий для видео или Stories</p>
      <button
        @click="showAiModal = true"
        class="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-gradient-to-r from-purple-600 to-brand-600 text-white text-sm font-medium"
      >
        <Sparkles :size="14" />
        Сгенерировать с AI
      </button>
    </div>

    <!-- Scenarios list -->
    <div v-else class="space-y-3">
      <div
        v-for="scenario in filteredScenarios"
        :key="scenario.id"
        class="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 overflow-hidden"
      >
        <!-- Header row -->
        <div
          class="flex items-center gap-3 p-4 cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-800/50 transition-colors"
          @click="toggleExpand(scenario.id)"
        >
          <component :is="expandedId === scenario.id ? ChevronUp : ChevronDown" :size="16" class="text-gray-400 shrink-0" />
          <div class="flex-1 min-w-0">
            <!-- Inline title editing -->
            <div v-if="editingScenarioId === scenario.id" class="flex items-center gap-2" @click.stop>
              <input
                v-model="editForm.title"
                class="flex-1 text-sm font-semibold bg-transparent border-b border-brand-400 outline-none py-0.5"
                @keydown.enter="saveEditing(scenario)"
              />
              <button @click="saveEditing(scenario)" class="p-1 text-green-500 hover:bg-green-50 dark:hover:bg-green-950 rounded">
                <Check :size="14" />
              </button>
              <button @click="editingScenarioId = null" class="p-1 text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800 rounded">
                <X :size="14" />
              </button>
            </div>
            <h3 v-else class="font-semibold text-sm truncate">{{ scenario.title }}</h3>
            <p class="text-xs text-gray-500 mt-0.5">
              {{ scenario.scenes.length }} сцен · {{ totalDuration(scenario.scenes) }} сек
              <span v-if="scenario.business"> · {{ scenario.business.name }}</span>
            </p>
          </div>
          <span :class="['px-2 py-0.5 rounded-full text-[10px] font-medium', statusColors[scenario.status] || statusColors.DRAFT]">
            {{ statusLabels[scenario.status] || scenario.status }}
          </span>
          <div class="flex items-center gap-1" @click.stop>
            <button
              @click="startEditing(scenario)"
              class="p-1.5 rounded-lg text-gray-400 hover:text-brand-500 hover:bg-brand-50 dark:hover:bg-brand-950 transition-colors"
            >
              <Edit3 :size="14" />
            </button>
            <button
              @click="deleteConfirmId = scenario.id"
              class="p-1.5 rounded-lg text-gray-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-950 transition-colors"
            >
              <Trash2 :size="14" />
            </button>
          </div>
        </div>

        <!-- Expanded: scenes list -->
        <div v-if="expandedId === scenario.id" class="border-t border-gray-100 dark:border-gray-800">
          <!-- Status selector -->
          <div class="px-4 py-2 bg-gray-50 dark:bg-gray-800/50 flex items-center gap-2 text-xs">
            <span class="text-gray-500">Статус:</span>
            <select
              :value="scenario.status"
              @change="updateScenarioStatus(scenario.id, ($event.target as HTMLSelectElement).value)"
              class="text-xs bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded px-2 py-1"
            >
              <option value="DRAFT">Черновик</option>
              <option value="READY">Готов</option>
              <option value="IN_PRODUCTION">В продакшне</option>
              <option value="COMPLETED">Завершён</option>
            </select>
            <span v-if="scenario.generatedBy === 'ai'" class="ml-auto text-purple-500 flex items-center gap-1">
              <Sparkles :size="10" /> AI
            </span>
          </div>

          <!-- Scenes -->
          <div class="divide-y divide-gray-100 dark:divide-gray-800">
            <div
              v-for="(scene, idx) in scenario.scenes"
              :key="idx"
              class="p-4 hover:bg-gray-50 dark:hover:bg-gray-800/30 transition-colors"
            >
              <div class="flex items-start gap-3">
                <div class="flex items-center gap-1 shrink-0 mt-1">
                  <GripVertical :size="14" class="text-gray-300" />
                  <span class="w-6 h-6 rounded-full bg-brand-100 dark:bg-brand-900 text-brand-600 dark:text-brand-400 flex items-center justify-center text-xs font-bold">
                    {{ scene.sceneNumber }}
                  </span>
                </div>
                <div class="flex-1 space-y-2">
                  <textarea
                    :value="scene.description"
                    @blur="updateScene(scenario.id, idx, 'description', ($event.target as HTMLTextAreaElement).value)"
                    placeholder="Описание визуала..."
                    rows="2"
                    class="w-full text-sm bg-transparent border border-gray-200 dark:border-gray-700 rounded-lg px-3 py-2 outline-none focus:border-brand-400 resize-none"
                  />
                  <textarea
                    :value="scene.voiceover"
                    @blur="updateScene(scenario.id, idx, 'voiceover', ($event.target as HTMLTextAreaElement).value)"
                    placeholder="Закадровый текст..."
                    rows="2"
                    class="w-full text-xs bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg px-3 py-2 outline-none focus:border-brand-400 resize-none italic"
                  />
                  <div class="flex items-center gap-3">
                    <label class="flex items-center gap-1 text-xs text-gray-500">
                      Длит.:
                      <input
                        type="number"
                        :value="scene.durationSec"
                        @blur="updateScene(scenario.id, idx, 'durationSec', Number(($event.target as HTMLInputElement).value))"
                        min="1" max="300"
                        class="w-14 text-xs bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded px-2 py-1 outline-none"
                      />
                      сек
                    </label>
                    <input
                      :value="scene.imagePrompt"
                      @blur="updateScene(scenario.id, idx, 'imagePrompt', ($event.target as HTMLInputElement).value)"
                      placeholder="Промпт для картинки/видео..."
                      class="flex-1 text-xs bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded px-2 py-1 outline-none focus:border-brand-400"
                    />
                    <button
                      v-if="scenario.scenes.length > 1"
                      @click="removeScene(scenario.id, idx)"
                      class="p-1 rounded text-gray-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-950"
                    >
                      <Trash2 :size="12" />
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </div>

          <!-- Add scene + Create Stories buttons -->
          <div class="p-3 border-t border-gray-100 dark:border-gray-800 flex gap-2">
            <button
              @click="addScene(scenario.id)"
              class="flex-1 py-2 rounded-lg border-2 border-dashed border-gray-300 dark:border-gray-700 text-xs text-gray-500 hover:border-brand-400 hover:text-brand-500 transition-colors flex items-center justify-center gap-1"
            >
              <Plus :size="12" /> Добавить сцену
            </button>
            <button
              @click="createStoriesFromScenario(scenario.id)"
              :disabled="creatingStories === scenario.id || scenario.scenes.length === 0"
              class="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-brand-600 hover:bg-brand-700 text-white text-xs font-medium disabled:opacity-50 transition-colors shrink-0"
            >
              <Loader2 v-if="creatingStories === scenario.id" :size="12" class="animate-spin" />
              <Film v-else :size="12" />
              {{ creatingStories === scenario.id ? 'Создаю...' : 'Создать Stories' }}
            </button>
          </div>
        </div>
      </div>
    </div>

    <!-- AI Generation Modal -->
    <Teleport to="body">
      <div
        v-if="showAiModal"
        class="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
        @click.self="showAiModal = false"
      >
        <div class="bg-white dark:bg-gray-900 rounded-2xl p-5 w-full max-w-md shadow-xl">
          <h3 class="text-base font-bold mb-4 flex items-center gap-2">
            <Sparkles :size="18" class="text-purple-500" />
            AI Сценарий
          </h3>

          <div class="space-y-3">
            <div>
              <label class="text-xs font-medium text-gray-600 dark:text-gray-400 mb-1 block">Тема *</label>
              <input
                v-model="aiTopic"
                placeholder="Напр.: Утренний SUP-тур на рассвете"
                class="w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 text-sm outline-none focus:border-brand-500"
              />
            </div>
            <div class="flex gap-3">
              <div class="flex-1">
                <label class="text-xs font-medium text-gray-600 dark:text-gray-400 mb-1 block">Сцен</label>
                <input
                  v-model.number="aiSceneCount"
                  type="number" min="2" max="20"
                  class="w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 text-sm outline-none focus:border-brand-500"
                />
              </div>
              <div class="flex-1">
                <label class="text-xs font-medium text-gray-600 dark:text-gray-400 mb-1 block">Стиль</label>
                <input
                  v-model="aiStyle"
                  placeholder="динамичный, вовлекающий"
                  class="w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 text-sm outline-none focus:border-brand-500"
                />
              </div>
            </div>
          </div>

          <div class="flex gap-2 mt-5">
            <button
              @click="showAiModal = false"
              class="flex-1 px-3 py-2.5 rounded-lg border border-gray-300 dark:border-gray-700 text-sm font-medium text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800"
            >
              Отмена
            </button>
            <button
              @click="generateScenario"
              :disabled="generating || !aiTopic.trim() || !selectedBizId"
              class="flex-1 px-3 py-2.5 rounded-lg bg-gradient-to-r from-purple-600 to-brand-600 text-white text-sm font-medium disabled:opacity-50 flex items-center justify-center gap-2"
            >
              <Loader2 v-if="generating" :size="14" class="animate-spin" />
              <Sparkles v-else :size="14" />
              {{ generating ? 'Генерация...' : 'Сгенерировать' }}
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
          <h3 class="text-base font-bold mb-2">Удалить сценарий?</h3>
          <p class="text-sm text-gray-500 mb-4">Все сцены будут удалены. Это действие нельзя отменить.</p>
          <div class="flex gap-2">
            <button
              @click="deleteConfirmId = null"
              class="flex-1 px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-700 text-sm font-medium text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800"
            >
              Отмена
            </button>
            <button
              @click="deleteScenario(deleteConfirmId!)"
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
