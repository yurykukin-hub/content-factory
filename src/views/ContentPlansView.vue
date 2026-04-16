<script setup lang="ts">
import { ref, computed, onMounted, watch } from 'vue'
import { http } from '@/api/client'
import { useBusinessesStore } from '@/stores/businesses'
import { useRouter } from 'vue-router'
import { useToast } from '@/composables/useToast'
import { formatDate, formatDateFull } from '@/composables/useFormatters'
import {
  ClipboardList, Sparkles, Plus, Loader2, Table, CalendarDays,
  Pencil, Wand2, ExternalLink, X, ChevronLeft, ChevronRight, Trash2
} from 'lucide-vue-next'
import BusinessFilter from '@/components/BusinessFilter.vue'
import { useSectionAccess } from '@/composables/useSectionAccess'
import { postTypeLabel } from '@/composables/useLabels'

const { canEdit: canEditSection } = useSectionAccess()

interface ContentPlanItem {
  id: string
  date: string
  dayOfWeek: string
  topic: string
  postType: string
  description: string | null
  status: string
  postId: string | null
  post: { id: string; status: string; title: string } | null
}

interface ContentPlan {
  id: string
  title: string
  startDate: string
  endDate: string
  status: string
  generatedBy: string
  _count?: { items: number }
  items?: ContentPlanItem[]
}

const businesses = useBusinessesStore()
const router = useRouter()
const toast = useToast()

const plans = ref<ContentPlan[]>([])
const activePlan = ref<ContentPlan | null>(null)
const loading = ref(true)
const viewMode = ref<'table' | 'calendar'>('table')

// AI modal
const showAiModal = ref(false)
const aiForm = ref({
  startDate: new Date().toISOString().slice(0, 10),
  endDate: new Date(Date.now() + 14 * 86400000).toISOString().slice(0, 10),
  postsPerWeek: 3,
  focus: '',
  rubrics: [] as string[],
})
const aiLoading = ref(false)

// Item actions
const itemLoading = ref<string | null>(null)
const batchLoading = ref(false)
const batchResult = ref<{ generated: number; total: number } | null>(null)

// Calendar nav
const calendarMonth = ref(new Date())

const RUBRIC_OPTIONS = [
  'вдохновляющий', 'полезный', 'продающий', 'вовлекающий',
  'закулисье', 'команда', 'отзывы', 'FAQ',
]

async function loadPlans() {
  if (!businesses.currentBusiness) return
  loading.value = true
  try {
    plans.value = await http.get<ContentPlan[]>(`/businesses/${businesses.currentBusiness.id}/plans`)
  } catch (e) {
    toast.error('Ошибка загрузки планов')
  } finally {
    loading.value = false
  }
}

async function openPlan(planId: string) {
  try {
    activePlan.value = await http.get<ContentPlan>(`/plans/${planId}`)
    if (activePlan.value?.items?.length) {
      calendarMonth.value = new Date(activePlan.value.items[0].date)
    }
  } catch (e) {
    toast.error('Ошибка загрузки плана')
  }
}

async function generatePlan() {
  if (!businesses.currentBusiness) return
  aiLoading.value = true
  try {
    const result = await http.post<{ plan: ContentPlan }>('/ai/generate-plan', {
      businessId: businesses.currentBusiness.id,
      ...aiForm.value,
      rubrics: aiForm.value.rubrics.length ? aiForm.value.rubrics : undefined,
      focus: aiForm.value.focus || undefined,
    })
    showAiModal.value = false
    await loadPlans()
    await openPlan(result.plan.id)
  } catch (e: any) {
    toast.error(e.message || 'Произошла ошибка')
  } finally {
    aiLoading.value = false
  }
}

async function createPostFromItem(itemId: string) {
  itemLoading.value = itemId
  try {
    const post = await http.post<{ id: string }>(`/plan-items/${itemId}/create-post`, {})
    router.push(`/posts/${post.id}`)
  } catch (e: any) {
    toast.error(e.message || 'Произошла ошибка')
  } finally {
    itemLoading.value = null
  }
}

async function aiGenerateFromItem(itemId: string) {
  itemLoading.value = itemId
  try {
    const result = await http.post<{ post: { id: string } }>(`/plan-items/${itemId}/ai-generate`, {})
    router.push(`/posts/${result.post.id}`)
  } catch (e: any) {
    toast.error(e.message || 'Произошла ошибка')
  } finally {
    itemLoading.value = null
  }
}

async function batchGenerateAll() {
  if (!activePlan.value) return
  batchLoading.value = true
  batchResult.value = null
  try {
    const result = await http.post<{ generated: number; total: number }>(`/plans/${activePlan.value.id}/generate-all`, {})
    batchResult.value = result
    await openPlan(activePlan.value.id)
    setTimeout(() => { batchResult.value = null }, 5000)
  } catch (e: any) {
    toast.error(e.message || 'Произошла ошибка')
  } finally {
    batchLoading.value = false
  }
}

async function skipItem(itemId: string) {
  try {
    await http.put(`/plan-items/${itemId}`, { status: 'SKIPPED' })
    if (activePlan.value) await openPlan(activePlan.value.id)
  } catch (e: any) {
    toast.error(e.message || 'Произошла ошибка')
  }
}

async function deletePlan(planId: string) {
  if (!confirm('Удалить контент-план?')) return
  try {
    await http.delete(`/plans/${planId}`)
    activePlan.value = null
    await loadPlans()
  } catch (e: any) {
    toast.error(e.message || 'Произошла ошибка')
  }
}

function toggleRubric(r: string) {
  const idx = aiForm.value.rubrics.indexOf(r)
  if (idx >= 0) aiForm.value.rubrics.splice(idx, 1)
  else aiForm.value.rubrics.push(r)
}

function statusBadge(status: string) {
  const map: Record<string, { label: string; class: string }> = {
    PLANNED: { label: 'Запланирован', class: 'bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300' },
    IN_PROGRESS: { label: 'В работе', class: 'bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300' },
    PUBLISHED: { label: 'Опубликован', class: 'bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-300' },
    SKIPPED: { label: 'Пропущен', class: 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900 dark:text-yellow-300' },
    DRAFT: { label: 'Черновик', class: 'bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300' },
    ACTIVE: { label: 'Активный', class: 'bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-300' },
    COMPLETED: { label: 'Завершён', class: 'bg-purple-100 text-purple-700 dark:bg-purple-900 dark:text-purple-300' },
  }
  return map[status] || map.PLANNED
}

function typeColor(type: string) {
  const map: Record<string, string> = {
    TEXT: 'bg-gray-400', PHOTO: 'bg-blue-500', VIDEO: 'bg-purple-500',
    REELS: 'bg-pink-500', STORIES: 'bg-orange-500',
  }
  return map[type] || 'bg-gray-400'
}

// Calendar helpers
const calendarDays = computed(() => {
  if (!activePlan.value?.items) return []
  const year = calendarMonth.value.getFullYear()
  const month = calendarMonth.value.getMonth()
  const firstDay = new Date(year, month, 1)
  const lastDay = new Date(year, month + 1, 0)
  let startDay = firstDay.getDay() || 7
  const days: { date: Date; items: ContentPlanItem[]; isCurrentMonth: boolean }[] = []

  for (let i = 1 - startDay + 1; i <= lastDay.getDate(); i++) {
    const d = new Date(year, month, i)
    const dateStr = d.toISOString().slice(0, 10)
    days.push({
      date: d,
      isCurrentMonth: i >= 1,
      items: activePlan.value!.items!.filter(it => it.date.slice(0, 10) === dateStr),
    })
  }
  while (days.length % 7 !== 0) {
    const d = new Date(year, month, lastDay.getDate() + (days.length - lastDay.getDate() - startDay + 2))
    days.push({ date: d, isCurrentMonth: false, items: [] })
  }
  return days
})

function prevMonth() { calendarMonth.value = new Date(calendarMonth.value.getFullYear(), calendarMonth.value.getMonth() - 1) }
function nextMonth() { calendarMonth.value = new Date(calendarMonth.value.getFullYear(), calendarMonth.value.getMonth() + 1) }

const calendarTitle = computed(() => {
  return calendarMonth.value.toLocaleDateString('ru-RU', { month: 'long', year: 'numeric' })
})

onMounted(loadPlans)
watch(() => businesses.currentBusiness?.id, loadPlans)
</script>

<template>
  <div>
    <!-- Business filter -->
    <BusinessFilter
      :model-value="businesses.currentBusinessId!"
      @update:model-value="(id: string) => { businesses.setCurrent(id); loadPlans() }"
    />

    <div class="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-6">
      <h1 class="text-xl md:text-2xl font-bold">Контент-планы</h1>
      <button v-if="canEditSection('plans')" @click="showAiModal = true"
        class="flex items-center gap-2 px-4 py-2 rounded-lg bg-purple-600 hover:bg-purple-700 text-white text-sm font-medium">
        <Sparkles :size="16" /> AI Сгенерировать
      </button>
    </div>

    <div v-if="loading" class="text-gray-500 py-8 text-center">Загрузка...</div>

    <div v-else-if="!activePlan">
      <div v-if="plans.length === 0" class="bg-white dark:bg-gray-900 rounded-xl p-8 border border-gray-200 dark:border-gray-800 text-center">
        <ClipboardList :size="48" class="mx-auto text-gray-300 dark:text-gray-600 mb-3" />
        <p class="text-gray-500 mb-4">Нет контент-планов. Сгенерируйте AI-план!</p>
        <button @click="showAiModal = true" class="px-4 py-2 rounded-lg bg-purple-600 hover:bg-purple-700 text-white text-sm font-medium">
          <Sparkles :size="16" class="inline mr-1" /> Сгенерировать
        </button>
      </div>

      <div v-else class="space-y-3">
        <div v-for="plan in plans" :key="plan.id"
          class="bg-white dark:bg-gray-900 rounded-xl p-5 border border-gray-200 dark:border-gray-800 hover:border-brand-300 dark:hover:border-brand-700 cursor-pointer transition-colors"
          @click="openPlan(plan.id)">
          <div class="flex items-center justify-between">
            <div>
              <h3 class="font-semibold">{{ plan.title }}</h3>
              <div class="flex items-center gap-3 mt-1 text-xs text-gray-400">
                <span>{{ formatDateFull(plan.startDate) }} — {{ formatDateFull(plan.endDate) }}</span>
                <span>{{ plan._count?.items || 0 }} постов</span>
                <span v-if="plan.generatedBy === 'ai'" class="px-1.5 py-0.5 rounded bg-purple-100 text-purple-700 dark:bg-purple-900 dark:text-purple-300 text-[10px]">AI</span>
              </div>
            </div>
            <div class="flex items-center gap-2">
              <span :class="['px-2 py-0.5 rounded-full text-xs font-medium', statusBadge(plan.status).class]">{{ statusBadge(plan.status).label }}</span>
              <button @click.stop="deletePlan(plan.id)" class="p-1.5 rounded text-gray-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-950"><Trash2 :size="14" /></button>
            </div>
          </div>
        </div>
      </div>
    </div>

    <div v-else>
      <div class="mb-4">
        <button @click="activePlan = null" class="flex items-center gap-1 text-sm text-gray-500 hover:text-gray-700 dark:hover:text-gray-300 mb-3">
          <ChevronLeft :size="16" /> Назад к списку
        </button>
        <div class="flex items-center justify-between">
          <div>
            <h2 class="text-lg font-bold">{{ activePlan.title }}</h2>
            <div class="text-xs text-gray-400 mt-0.5">
              {{ formatDateFull(activePlan.startDate) }} — {{ formatDateFull(activePlan.endDate) }} · {{ activePlan.items?.length || 0 }} постов
              · {{ activePlan.items?.filter(i => i.postId).length || 0 }} написано
            </div>
          </div>
          <div class="flex items-center gap-3">
            <!-- Batch generate -->
            <button
              v-if="activePlan.items?.some(i => !i.postId && i.status === 'PLANNED')"
              @click="batchGenerateAll"
              :disabled="batchLoading"
              class="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-purple-600 hover:bg-purple-700 text-white text-xs font-medium disabled:opacity-50"
            >
              <Loader2 v-if="batchLoading" :size="14" class="animate-spin" />
              <Wand2 v-else :size="14" />
              {{ batchLoading ? 'Генерация...' : 'AI: все посты' }}
            </button>
            <!-- Batch result toast -->
            <span v-if="batchResult" class="text-xs text-green-600 font-medium">
              ✓ {{ batchResult.generated }}/{{ batchResult.total }} сгенерировано
            </span>
            <!-- View mode toggle -->
            <div class="hidden md:flex gap-1 bg-gray-100 dark:bg-gray-800 rounded-lg p-1">
              <button @click="viewMode = 'table'" :class="['flex items-center gap-1 px-3 py-1.5 rounded text-xs font-medium', viewMode === 'table' ? 'bg-white dark:bg-gray-900 shadow-sm text-brand-600' : 'text-gray-500']">
                <Table :size="14" /> Таблица
              </button>
              <button @click="viewMode = 'calendar'" :class="['flex items-center gap-1 px-3 py-1.5 rounded text-xs font-medium', viewMode === 'calendar' ? 'bg-white dark:bg-gray-900 shadow-sm text-brand-600' : 'text-gray-500']">
                <CalendarDays :size="14" /> Календарь
              </button>
            </div>
          </div>
        </div>
      </div>

      <!-- TABLE -->
      <div v-if="viewMode === 'table'" class="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 overflow-hidden">
        <div class="overflow-x-auto">
          <table class="w-full text-sm">
            <thead class="bg-gray-50 dark:bg-gray-800 text-xs text-gray-500 uppercase">
              <tr>
                <th class="px-4 py-3 text-left">Дата</th>
                <th class="px-4 py-3 text-left">День</th>
                <th class="px-4 py-3 text-left">Тема</th>
                <th class="px-4 py-3 text-left">Тип</th>
                <th class="px-4 py-3 text-left">Описание</th>
                <th class="px-4 py-3 text-left">Статус</th>
                <th class="px-4 py-3 text-right">Действия</th>
              </tr>
            </thead>
            <tbody class="divide-y divide-gray-100 dark:divide-gray-800">
              <tr v-for="item in activePlan.items" :key="item.id" class="hover:bg-gray-50 dark:hover:bg-gray-800/50">
                <td class="px-4 py-3 whitespace-nowrap font-mono text-xs">{{ formatDate(item.date) }}</td>
                <td class="px-4 py-3 whitespace-nowrap text-xs text-gray-500">{{ item.dayOfWeek }}</td>
                <td class="px-4 py-3 font-medium">{{ item.topic }}</td>
                <td class="px-4 py-3">
                  <span :class="['inline-block w-2 h-2 rounded-full mr-1', typeColor(item.postType)]"></span>
                  <span class="text-xs text-gray-500">{{ postTypeLabel(item.postType) }}</span>
                </td>
                <td class="px-4 py-3 text-xs text-gray-500 max-w-[200px] truncate">{{ item.description }}</td>
                <td class="px-4 py-3">
                  <span :class="['px-2 py-0.5 rounded-full text-[10px] font-medium', statusBadge(item.status).class]">{{ statusBadge(item.status).label }}</span>
                </td>
                <td class="px-4 py-3 text-right">
                  <div v-if="item.post" class="flex items-center justify-end gap-1">
                    <router-link :to="`/posts/${item.post.id}`" class="flex items-center gap-1 text-xs text-brand-600 hover:underline">
                      <ExternalLink :size="12" /> Открыть
                    </router-link>
                  </div>
                  <div v-else-if="item.status !== 'SKIPPED'" class="flex items-center justify-end gap-1">
                    <button @click="createPostFromItem(item.id)" :disabled="itemLoading === item.id"
                      class="p-1.5 rounded text-gray-400 hover:text-brand-600 hover:bg-brand-50 dark:hover:bg-brand-950" title="Написать вручную">
                      <Loader2 v-if="itemLoading === item.id" :size="14" class="animate-spin" />
                      <Pencil v-else :size="14" />
                    </button>
                    <button @click="aiGenerateFromItem(item.id)" :disabled="itemLoading === item.id"
                      class="p-1.5 rounded text-gray-400 hover:text-purple-600 hover:bg-purple-50 dark:hover:bg-purple-950" title="AI написать">
                      <Wand2 :size="14" />
                    </button>
                    <button @click="skipItem(item.id)"
                      class="p-1.5 rounded text-gray-400 hover:text-yellow-600 hover:bg-yellow-50 dark:hover:bg-yellow-950" title="Пропустить">
                      <X :size="14" />
                    </button>
                  </div>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      <!-- CALENDAR (hidden on mobile — 7 columns don't fit) -->
      <div v-if="viewMode === 'calendar'" class="hidden md:block bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 p-4">
        <div class="flex items-center justify-between mb-4">
          <button @click="prevMonth" class="p-2 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800"><ChevronLeft :size="18" /></button>
          <span class="font-semibold capitalize">{{ calendarTitle }}</span>
          <button @click="nextMonth" class="p-2 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800"><ChevronRight :size="18" /></button>
        </div>
        <div class="grid grid-cols-7 gap-1 mb-1">
          <div v-for="d in ['Пн','Вт','Ср','Чт','Пт','Сб','Вс']" :key="d" class="text-center text-[10px] text-gray-400 font-medium py-1">{{ d }}</div>
        </div>
        <div class="grid grid-cols-7 gap-1">
          <div v-for="(day, i) in calendarDays" :key="i"
            :class="['min-h-[80px] p-1.5 rounded-lg border text-xs', day.isCurrentMonth ? 'border-gray-200 dark:border-gray-700' : 'border-transparent opacity-40']">
            <div class="text-[10px] text-gray-400 mb-1">{{ day.date.getDate() }}</div>
            <div v-for="item in day.items" :key="item.id"
              :class="['px-1.5 py-0.5 rounded text-[10px] font-medium mb-0.5 truncate cursor-pointer', item.status === 'PUBLISHED' ? 'bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-300' : item.status === 'SKIPPED' ? 'bg-yellow-100 text-yellow-700' : 'bg-brand-50 text-brand-700 dark:bg-brand-950 dark:text-brand-300']"
              :title="item.topic + (item.description ? ': ' + item.description : '')"
              @click="item.post ? router.push(`/posts/${item.post.id}`) : createPostFromItem(item.id)">
              <span :class="['inline-block w-1.5 h-1.5 rounded-full mr-0.5', typeColor(item.postType)]"></span>
              {{ item.topic }}
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- AI Modal -->
    <div v-if="showAiModal" class="fixed inset-0 z-50 flex items-center justify-center bg-black/50" @click.self="showAiModal = false">
      <div class="bg-white dark:bg-gray-900 rounded-2xl p-6 w-full max-w-lg shadow-xl">
        <h2 class="text-lg font-bold mb-4 flex items-center gap-2">
          <Sparkles :size="20" class="text-purple-500" />
          AI Контент-план
        </h2>
        <div class="space-y-4">
          <div class="grid grid-cols-2 gap-3">
            <div>
              <label class="block text-sm font-medium mb-1">С</label>
              <input v-model="aiForm.startDate" type="date" class="w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 text-sm" />
            </div>
            <div>
              <label class="block text-sm font-medium mb-1">По</label>
              <input v-model="aiForm.endDate" type="date" class="w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 text-sm" />
            </div>
          </div>
          <div>
            <label class="block text-sm font-medium mb-1">Постов в неделю</label>
            <div class="flex gap-2">
              <button v-for="n in [3, 4, 5, 7]" :key="n" @click="aiForm.postsPerWeek = n"
                :class="['px-4 py-2 rounded-lg text-sm font-medium border-2 transition-all', aiForm.postsPerWeek === n ? 'border-purple-500 bg-purple-50 dark:bg-purple-950 text-purple-700 dark:text-purple-300' : 'border-gray-200 dark:border-gray-700 text-gray-500']">
                {{ n }}
              </button>
            </div>
          </div>
          <div>
            <label class="block text-sm font-medium mb-1">Фокус периода (необязательно)</label>
            <textarea v-model="aiForm.focus" rows="2" placeholder="Открытие сезона, летние акции, знакомство с командой..."
              class="w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 text-sm" />
          </div>
          <div>
            <label class="block text-sm font-medium mb-2">Рубрики</label>
            <div class="flex flex-wrap gap-2">
              <button v-for="r in RUBRIC_OPTIONS" :key="r" @click="toggleRubric(r)"
                :class="['px-3 py-1.5 rounded-full text-xs font-medium border transition-all', aiForm.rubrics.includes(r) ? 'border-purple-500 bg-purple-50 dark:bg-purple-950 text-purple-700 dark:text-purple-300' : 'border-gray-200 dark:border-gray-700 text-gray-500 hover:border-gray-300']">
                {{ r }}
              </button>
            </div>
            <p class="text-[10px] text-gray-400 mt-1">Если не выбрать — AI выберет микс сам</p>
          </div>
        </div>
        <div class="flex justify-end gap-2 mt-5">
          <button @click="showAiModal = false" class="px-4 py-2 rounded-lg text-sm text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800">Отмена</button>
          <button @click="generatePlan" :disabled="aiLoading"
            class="flex items-center gap-2 px-4 py-2 rounded-lg bg-purple-600 hover:bg-purple-700 text-white text-sm font-medium disabled:opacity-50">
            <Loader2 v-if="aiLoading" :size="16" class="animate-spin" />
            <Sparkles v-else :size="16" />
            {{ aiLoading ? 'Генерация...' : 'Сгенерировать' }}
          </button>
        </div>
      </div>
    </div>
  </div>
</template>
