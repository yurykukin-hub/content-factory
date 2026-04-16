<script setup lang="ts">
import { ref, computed, watch, onMounted } from 'vue'
import { http } from '@/api/client'
import { useAuthStore } from '@/stores/auth'
import { useBusinessesStore } from '@/stores/businesses'
import { formatDate, formatNumber } from '@/composables/useFormatters'
import {
  Activity, DollarSign, Zap, AlertTriangle, Wallet, Coins,
  Download, ChevronLeft, ChevronRight, X,
} from 'lucide-vue-next'

const auth = useAuthStore()
const businesses = useBusinessesStore()
const isAdmin = computed(() => auth.user?.role === 'ADMIN')

// --- State ---
const loading = ref(true)
const logs = ref<any[]>([])
const total = ref(0)
const page = ref(1)
const totalPages = ref(1)
const stats = ref<any>(null)
const summaryRows = ref<any[]>([])
const summaryTotals = ref<any>(null)
const selectedLog = ref<any>(null)
const viewMode = ref<'detail' | 'summary'>('detail')
const summaryGroupBy = ref<'action' | 'model' | 'user'>('action')

// --- Filters ---
const datePreset = ref('30d')
const dateFrom = ref('')
const dateTo = ref('')
const businessId = ref('')
const userId = ref('')
const category = ref('')
const model = ref('')
const status = ref('')
const users = ref<{ id: string; name: string }[]>([])

const USD_RUB = 95

// --- Constants (duplicated from backend shared/ai-actions.ts) ---
const ACTION_CATEGORIES: Record<string, string[]> = {
  text: ['generate_plan', 'generate_post', 'adapt_platform', 'generate_hashtags',
    'enhance_image_prompt', 'suggest_image_templates', 'suggest_video_templates',
    'generate_story_title', 'generate_story_text', 'generate_scenario',
    'generate_edit_prompt', 'translate_prompt'],
  image: ['generate_image', 'edit_image', 'remove_background'],
  video: ['generate_video'],
  vision: ['describe_reference', 'merge_references'],
}

const ACTION_LABELS: Record<string, string> = {
  generate_plan: 'Генерация плана', generate_post: 'Генерация поста',
  adapt_platform: 'Адаптация', generate_hashtags: 'Хештеги',
  enhance_image_prompt: 'Улучшение промпта (фото)', suggest_image_templates: 'Подбор шаблонов (фото)',
  suggest_video_templates: 'Подбор шаблонов (видео)', generate_story_title: 'Заголовок Stories',
  generate_story_text: 'Текст Stories', generate_scenario: 'Сценарий',
  generate_edit_prompt: 'Промпт редактирования', translate_prompt: 'Перевод промпта',
  generate_image: 'Генерация изображения', edit_image: 'Редактирование фото',
  remove_background: 'Удаление фона', generate_video: 'Генерация видео',
  describe_reference: 'Описание референса', merge_references: 'Объединение референсов',
}

const CATEGORY_BADGES: Record<string, { label: string; class: string }> = {
  text: { label: 'Текст', class: 'bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300' },
  image: { label: 'Фото', class: 'bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300' },
  video: { label: 'Видео', class: 'bg-purple-100 text-purple-700 dark:bg-purple-900 dark:text-purple-300' },
  vision: { label: 'Vision', class: 'bg-amber-100 text-amber-700 dark:bg-amber-900 dark:text-amber-300' },
}

const DATE_PRESETS = [
  { key: 'today', label: 'Сегодня' },
  { key: '7d', label: '7 дн.' },
  { key: '30d', label: '30 дн.' },
  { key: '90d', label: '90 дн.' },
  { key: 'all', label: 'Всё' },
]

const CATEGORY_PILLS = [
  { key: '', label: 'Все' },
  { key: 'text', label: 'Текст' },
  { key: 'image', label: 'Фото' },
  { key: 'video', label: 'Видео' },
  { key: 'vision', label: 'Vision' },
]

// --- Helpers ---
function getActionCategory(action: string): string {
  for (const [cat, actions] of Object.entries(ACTION_CATEGORIES)) {
    if (actions.includes(action)) return cat
  }
  if (action.startsWith('enhance_video_prompt_')) return 'text'
  return 'text'
}

function getActionLabel(action: string): string {
  if (ACTION_LABELS[action]) return ACTION_LABELS[action]
  if (action.startsWith('enhance_video_prompt_')) {
    const mode = action.replace('enhance_video_prompt_', '')
    const modes: Record<string, string> = {
      enhance: 'базовое', director: 'режиссёр', structure: 'структура',
      focus: 'фокус', audio: 'аудио', camera: 'камера',
      translate: 'перевод', simplify: 'упрощение',
    }
    return `Улучшение видео (${modes[mode] || mode})`
  }
  return action
}

function modelShort(m: string): string { return m.split('/').pop() || m }

function costColor(cost: number): string {
  if (cost >= 0.05) return 'text-orange-600 dark:text-orange-400'
  if (cost >= 0.01) return 'text-yellow-600 dark:text-yellow-400'
  return 'text-green-600 dark:text-green-400'
}

function formatCost(usd: number): string { return '$' + usd.toFixed(4) }

// --- Date preset logic ---
function presetDates(preset: string): { from: string; to: string } {
  const now = new Date()
  const to = now.toISOString().split('T')[0]
  if (preset === 'today') return { from: to, to }
  if (preset === '7d') { const d = new Date(now.getTime() - 7 * 86400000); return { from: d.toISOString().split('T')[0], to } }
  if (preset === '30d') { const d = new Date(now.getTime() - 30 * 86400000); return { from: d.toISOString().split('T')[0], to } }
  if (preset === '90d') { const d = new Date(now.getTime() - 90 * 86400000); return { from: d.toISOString().split('T')[0], to } }
  return { from: '', to: '' }
}

// --- Build query string ---
function buildQuery(extra: Record<string, any> = {}): string {
  const params = new URLSearchParams()
  const dates = datePreset.value !== 'custom' ? presetDates(datePreset.value) : { from: dateFrom.value, to: dateTo.value }
  if (dates.from) params.set('dateFrom', dates.from)
  if (dates.to) params.set('dateTo', dates.to)
  if (businessId.value) params.set('businessId', businessId.value)
  if (userId.value && isAdmin.value) params.set('userId', userId.value)
  if (category.value) params.set('category', category.value)
  if (model.value) params.set('model', model.value)
  if (status.value) params.set('status', status.value)
  for (const [k, v] of Object.entries(extra)) { if (v) params.set(k, String(v)) }
  return params.toString()
}

// --- Data loading ---
async function loadLogs() {
  loading.value = true
  try {
    const q = buildQuery({ page: page.value, limit: 50 })
    const res = await http.get<any>(`/ai-logs?${q}`)
    logs.value = res.logs
    total.value = res.total
    totalPages.value = res.totalPages
  } catch { /* toast */ }
  loading.value = false
}

async function loadStats() {
  try {
    const q = buildQuery()
    stats.value = await http.get<any>(`/ai-logs/stats?${q}`)
  } catch { /* ignore */ }
}

async function loadSummary() {
  try {
    const q = buildQuery({ groupBy: summaryGroupBy.value })
    const res = await http.get<any>(`/ai-logs/summary?${q}`)
    summaryRows.value = res.rows
    summaryTotals.value = res.totals
  } catch { /* ignore */ }
}

async function loadUsers() {
  if (!isAdmin.value) return
  try {
    const res = await http.get<any[]>('/users')
    users.value = res.map((u: any) => ({ id: u.id, name: u.name }))
  } catch { /* ignore */ }
}

function reload() {
  page.value = 1
  loadLogs()
  loadStats()
  if (viewMode.value === 'summary') loadSummary()
}

function exportCsv() {
  const q = buildQuery()
  window.open(`/api/ai-logs/export?${q}`, '_blank')
}

function selectPreset(key: string) {
  datePreset.value = key
  reload()
}

// --- Trend chart ---
const trendMax = computed(() => {
  if (!stats.value?.dailyTrend?.length) return 1
  return Math.max(...stats.value.dailyTrend.map((d: any) => d.costUsd), 0.001)
})

// --- Watchers ---
watch([businessId, userId, category, model, status], reload)
watch(dateFrom, () => { if (datePreset.value === 'custom') reload() })
watch(dateTo, () => { if (datePreset.value === 'custom') reload() })
watch(viewMode, (v) => { if (v === 'summary') loadSummary() })
watch(summaryGroupBy, () => loadSummary())

onMounted(async () => {
  await businesses.load()
  await loadUsers()
  reload()
})
</script>

<template>
  <div class="max-w-[1400px] mx-auto">
    <h1 class="text-2xl font-bold mb-6 text-gray-900 dark:text-white">AI Логи</h1>

    <!-- Stat cards -->
    <div v-if="stats" class="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-4 mb-6">
      <!-- Calls -->
      <div class="bg-white dark:bg-gray-900 rounded-xl p-4 border border-gray-200 dark:border-gray-800">
        <div class="flex items-center gap-2 mb-2">
          <div class="p-2 rounded-lg bg-brand-50 dark:bg-brand-950"><Activity :size="18" class="text-brand-600 dark:text-brand-400" /></div>
          <span class="text-xs text-gray-500">Вызовов</span>
        </div>
        <div class="text-2xl font-bold text-gray-900 dark:text-white">{{ stats.totals.count.toLocaleString() }}</div>
      </div>
      <!-- Cost -->
      <div class="bg-white dark:bg-gray-900 rounded-xl p-4 border border-gray-200 dark:border-gray-800">
        <div class="flex items-center gap-2 mb-2">
          <div class="p-2 rounded-lg bg-green-50 dark:bg-green-950"><DollarSign :size="18" class="text-green-600 dark:text-green-400" /></div>
          <span class="text-xs text-gray-500">Расходы</span>
        </div>
        <div class="text-2xl font-bold text-gray-900 dark:text-white">${{ stats.totals.costUsd.toFixed(2) }}</div>
        <div class="text-xs text-gray-400 mt-0.5">~{{ stats.totals.costRub.toFixed(0) }} ₽</div>
      </div>
      <!-- Tokens -->
      <div class="bg-white dark:bg-gray-900 rounded-xl p-4 border border-gray-200 dark:border-gray-800">
        <div class="flex items-center gap-2 mb-2">
          <div class="p-2 rounded-lg bg-blue-50 dark:bg-blue-950"><Zap :size="18" class="text-blue-600 dark:text-blue-400" /></div>
          <span class="text-xs text-gray-500">Токены</span>
        </div>
        <div class="text-lg font-bold text-gray-900 dark:text-white">
          <span class="text-blue-600 dark:text-blue-400">↓</span>{{ formatNumber(stats.totals.tokensIn) }}
          <span class="text-orange-600 dark:text-orange-400 ml-1">↑</span>{{ formatNumber(stats.totals.tokensOut) }}
        </div>
        <div v-if="stats.totals.cachedTokens > 0" class="text-xs text-gray-400 mt-0.5">cached: {{ formatNumber(stats.totals.cachedTokens) }}</div>
      </div>
      <!-- Errors -->
      <div class="bg-white dark:bg-gray-900 rounded-xl p-4 border border-gray-200 dark:border-gray-800">
        <div class="flex items-center gap-2 mb-2">
          <div class="p-2 rounded-lg bg-red-50 dark:bg-red-950"><AlertTriangle :size="18" class="text-red-600 dark:text-red-400" /></div>
          <span class="text-xs text-gray-500">Ошибки</span>
        </div>
        <div class="text-2xl font-bold" :class="stats.totals.errorCount > 0 ? 'text-red-600 dark:text-red-400' : 'text-gray-900 dark:text-white'">
          {{ stats.totals.errorCount }}
        </div>
        <div v-if="stats.totals.count > 0" class="text-xs text-gray-400 mt-0.5">{{ ((stats.totals.errorCount / stats.totals.count) * 100).toFixed(1) }}%</div>
      </div>
      <!-- OpenRouter balance (admin) -->
      <div v-if="isAdmin && stats.balances?.openRouter" class="bg-white dark:bg-gray-900 rounded-xl p-4 border border-gray-200 dark:border-gray-800">
        <div class="flex items-center gap-2 mb-2">
          <div class="p-2 rounded-lg bg-indigo-50 dark:bg-indigo-950"><Wallet :size="18" class="text-indigo-600 dark:text-indigo-400" /></div>
          <span class="text-xs text-gray-500">OpenRouter</span>
        </div>
        <div class="text-2xl font-bold text-gray-900 dark:text-white">${{ stats.balances.openRouter.balanceUsd.toFixed(2) }}</div>
      </div>
      <!-- KIE balance (admin) -->
      <div v-if="isAdmin && stats.balances?.kie" class="bg-white dark:bg-gray-900 rounded-xl p-4 border border-gray-200 dark:border-gray-800">
        <div class="flex items-center gap-2 mb-2">
          <div class="p-2 rounded-lg bg-amber-50 dark:bg-amber-950"><Coins :size="18" class="text-amber-600 dark:text-amber-400" /></div>
          <span class="text-xs text-gray-500">KIE.ai</span>
        </div>
        <div class="text-2xl font-bold text-gray-900 dark:text-white">{{ stats.balances.kie.creditsRemaining.toLocaleString() }}</div>
        <div class="text-xs text-gray-400 mt-0.5">${{ stats.balances.kie.balanceUsd.toFixed(2) }}</div>
      </div>
    </div>

    <!-- Mini trend chart -->
    <div v-if="stats?.dailyTrend?.length > 1" class="bg-white dark:bg-gray-900 rounded-xl p-4 border border-gray-200 dark:border-gray-800 mb-4">
      <div class="text-xs text-gray-500 mb-2">Расходы по дням</div>
      <div class="flex items-end gap-[2px] h-12">
        <div
          v-for="(day, i) in stats.dailyTrend" :key="i"
          class="flex-1 rounded-t bg-brand-400 dark:bg-brand-600 hover:bg-brand-600 dark:hover:bg-brand-400 transition-colors cursor-default group relative"
          :style="{ height: Math.max((day.costUsd / trendMax) * 100, 4) + '%' }"
          :title="`${day.date}: $${day.costUsd.toFixed(4)} / ${day.count} вызовов`"
        />
      </div>
    </div>

    <!-- User cost breakdown (admin only) -->
    <div v-if="isAdmin && stats?.byUser?.length" class="bg-white dark:bg-gray-900 rounded-xl p-4 border border-gray-200 dark:border-gray-800 mb-4">
      <div class="text-xs text-gray-500 mb-2">Расходы по пользователям</div>
      <div class="flex flex-wrap gap-4">
        <div v-for="u in stats.byUser" :key="u.userId" class="flex items-center gap-2 text-sm">
          <span class="w-2 h-2 rounded-full bg-brand-500" />
          <span class="font-medium text-gray-900 dark:text-white">{{ u.userName }}</span>
          <span class="text-gray-500">${{ u.costUsd.toFixed(2) }}</span>
          <span class="text-xs text-gray-400">({{ u.count }})</span>
        </div>
      </div>
    </div>

    <!-- Category bar -->
    <div v-if="stats?.byCategory?.length" class="bg-white dark:bg-gray-900 rounded-xl p-4 border border-gray-200 dark:border-gray-800 mb-4">
      <div class="text-xs text-gray-500 mb-2">Доля по категориям</div>
      <div class="flex h-3 rounded-full overflow-hidden gap-0.5">
        <div v-for="cat in stats.byCategory" :key="cat.category"
          :style="{ width: (stats.totals.costUsd > 0 ? (cat.costUsd / stats.totals.costUsd) * 100 : 0) + '%' }"
          :class="[
            cat.category === 'text' ? 'bg-gray-400' : '',
            cat.category === 'image' ? 'bg-blue-500' : '',
            cat.category === 'video' ? 'bg-purple-500' : '',
            cat.category === 'vision' ? 'bg-amber-500' : '',
          ]"
          :title="`${cat.label}: $${cat.costUsd.toFixed(4)}`"
        />
      </div>
      <div class="flex gap-4 mt-2 text-xs text-gray-500">
        <span v-for="cat in stats.byCategory" :key="cat.category" class="flex items-center gap-1">
          <span :class="[
            'w-2 h-2 rounded-full',
            cat.category === 'text' ? 'bg-gray-400' : '',
            cat.category === 'image' ? 'bg-blue-500' : '',
            cat.category === 'video' ? 'bg-purple-500' : '',
            cat.category === 'vision' ? 'bg-amber-500' : '',
          ]" />
          {{ cat.label }} ${{ cat.costUsd.toFixed(2) }}
        </span>
      </div>
    </div>

    <!-- Filters -->
    <div class="bg-white dark:bg-gray-900 rounded-xl p-4 border border-gray-200 dark:border-gray-800 mb-4 space-y-3">
      <!-- Row 1: Date presets -->
      <div class="flex flex-wrap items-center gap-2">
        <button
          v-for="p in DATE_PRESETS" :key="p.key"
          @click="selectPreset(p.key)"
          :class="[
            'px-3 py-1.5 rounded-full text-xs font-medium transition-colors',
            datePreset === p.key
              ? 'bg-brand-600 text-white'
              : 'bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-gray-700',
          ]"
        >{{ p.label }}</button>
        <button
          @click="datePreset = 'custom'"
          :class="[
            'px-3 py-1.5 rounded-full text-xs font-medium transition-colors',
            datePreset === 'custom'
              ? 'bg-brand-600 text-white'
              : 'bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-gray-700',
          ]"
        >Период</button>
        <template v-if="datePreset === 'custom'">
          <input type="date" v-model="dateFrom" class="px-2 py-1 rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 text-sm" />
          <span class="text-gray-400">—</span>
          <input type="date" v-model="dateTo" class="px-2 py-1 rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 text-sm" />
        </template>
      </div>
      <!-- Row 2: Dropdowns + category pills -->
      <div class="flex flex-wrap items-center gap-2">
        <select v-model="businessId" class="px-3 py-1.5 rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 text-sm">
          <option value="">Все проекты</option>
          <option v-for="b in businesses.businesses" :key="b.id" :value="b.id">{{ b.name }}</option>
        </select>
        <select v-if="isAdmin" v-model="userId" class="px-3 py-1.5 rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 text-sm">
          <option value="">Все пользователи</option>
          <option v-for="u in users" :key="u.id" :value="u.id">{{ u.name }}</option>
        </select>
        <div class="flex gap-1">
          <button
            v-for="cp in CATEGORY_PILLS" :key="cp.key"
            @click="category = cp.key; reload()"
            :class="[
              'px-3 py-1.5 rounded-full text-xs font-medium transition-colors',
              category === cp.key
                ? 'bg-brand-600 text-white'
                : 'bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-gray-700',
            ]"
          >{{ cp.label }}</button>
        </div>
      </div>
      <!-- Row 3: Model + status + export -->
      <div class="flex flex-wrap items-center gap-2">
        <select v-model="model" class="px-3 py-1.5 rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 text-sm">
          <option value="">Все модели</option>
          <option value="anthropic/claude-3.5-haiku">Haiku</option>
          <option value="anthropic/claude-sonnet-4">Sonnet</option>
          <option value="google/gemini-2.0-flash-001">Gemini Flash</option>
          <option value="nano-banana-2">Nano Banana 2</option>
          <option value="flux-kontext-pro">FLUX Kontext</option>
          <option value="bytedance/seedance-2">Seedance 2</option>
          <option value="recraft">Recraft</option>
        </select>
        <select v-model="status" class="px-3 py-1.5 rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 text-sm">
          <option value="">Все статусы</option>
          <option value="success">Успешные</option>
          <option value="error">Ошибки</option>
        </select>
        <button @click="exportCsv()" class="ml-auto flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-gray-700 transition-colors">
          <Download :size="14" /> Экспорт CSV
        </button>
      </div>
    </div>

    <!-- View mode toggle -->
    <div class="flex gap-1 mb-4">
      <button
        @click="viewMode = 'detail'"
        :class="['px-4 py-2 rounded-lg text-sm font-medium transition-colors', viewMode === 'detail' ? 'bg-brand-600 text-white' : 'bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400']"
      >Подробно</button>
      <button
        @click="viewMode = 'summary'"
        :class="['px-4 py-2 rounded-lg text-sm font-medium transition-colors', viewMode === 'summary' ? 'bg-brand-600 text-white' : 'bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400']"
      >Сводка</button>
      <template v-if="viewMode === 'summary'">
        <select v-model="summaryGroupBy" class="ml-2 px-3 py-1.5 rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 text-sm">
          <option value="action">По действию</option>
          <option value="model">По модели</option>
          <option v-if="isAdmin" value="user">По пользователю</option>
        </select>
      </template>
    </div>

    <!-- DETAIL TABLE -->
    <div v-if="viewMode === 'detail'" class="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 overflow-hidden">
      <div class="overflow-x-auto">
        <table class="w-full text-sm">
          <thead class="bg-gray-50 dark:bg-gray-800 text-xs text-gray-500 uppercase">
            <tr>
              <th class="px-4 py-3 text-left">Дата</th>
              <th v-if="isAdmin" class="px-4 py-3 text-left">Пользователь</th>
              <th class="px-4 py-3 text-left">Проект</th>
              <th class="px-4 py-3 text-left">Действие</th>
              <th class="px-4 py-3 text-left">Модель</th>
              <th class="px-4 py-3 text-right">Токены</th>
              <th class="px-4 py-3 text-right">Стоимость</th>
              <th class="px-4 py-3 text-center w-8">⬤</th>
            </tr>
          </thead>
          <tbody class="divide-y divide-gray-100 dark:divide-gray-800">
            <template v-if="loading && logs.length === 0">
              <tr><td :colspan="isAdmin ? 8 : 7" class="px-4 py-12 text-center text-gray-400">Загрузка...</td></tr>
            </template>
            <template v-else-if="logs.length === 0">
              <tr>
                <td :colspan="isAdmin ? 8 : 7" class="px-4 py-12 text-center">
                  <Activity :size="48" class="mx-auto text-gray-300 dark:text-gray-600 mb-3" />
                  <p class="text-gray-500">Нет данных за выбранный период</p>
                </td>
              </tr>
            </template>
            <template v-for="log in logs" :key="log.id">
              <tr
                class="hover:bg-gray-50 dark:hover:bg-gray-800/50 cursor-pointer transition-colors"
                @click="selectedLog = selectedLog?.id === log.id ? null : log"
              >
                <td class="px-4 py-3 whitespace-nowrap text-xs font-mono text-gray-500">{{ formatDate(log.createdAt) }}</td>
                <td v-if="isAdmin" class="px-4 py-3 whitespace-nowrap text-gray-700 dark:text-gray-300">{{ log.user?.name || '—' }}</td>
                <td class="px-4 py-3 whitespace-nowrap text-gray-700 dark:text-gray-300">{{ log.business?.name || '—' }}</td>
                <td class="px-4 py-3">
                  <span class="text-gray-900 dark:text-white">{{ getActionLabel(log.action) }}</span>
                  <span :class="['ml-2 px-1.5 py-0.5 rounded-full text-[10px] font-medium', CATEGORY_BADGES[getActionCategory(log.action)]?.class]">
                    {{ CATEGORY_BADGES[getActionCategory(log.action)]?.label }}
                  </span>
                </td>
                <td class="px-4 py-3 whitespace-nowrap text-xs font-mono text-gray-500">{{ modelShort(log.model) }}</td>
                <td class="px-4 py-3 whitespace-nowrap text-right text-xs font-mono text-gray-500">
                  <template v-if="log.tokensIn || log.tokensOut">{{ formatNumber(log.tokensIn) }}/{{ formatNumber(log.tokensOut) }}</template>
                  <template v-else>—</template>
                </td>
                <td class="px-4 py-3 whitespace-nowrap text-right text-xs font-mono" :class="costColor(log.costUsd)">{{ formatCost(log.costUsd) }}</td>
                <td class="px-4 py-3 text-center">
                  <span v-if="log.status === 'success'" class="inline-block w-2 h-2 rounded-full bg-green-500" title="Успешно" />
                  <span v-else class="inline-block w-2 h-2 rounded-full bg-red-500" title="Ошибка" />
                </td>
              </tr>
              <!-- Expanded detail row -->
              <tr v-if="selectedLog?.id === log.id" class="bg-gray-50 dark:bg-gray-800/30">
                <td :colspan="isAdmin ? 8 : 7" class="px-6 py-4">
                  <div class="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm mb-3">
                    <div><span class="text-gray-500 text-xs">Модель</span><br><span class="font-mono text-gray-900 dark:text-white">{{ log.model }}</span></div>
                    <div><span class="text-gray-500 text-xs">Длительность</span><br><span class="text-gray-900 dark:text-white">{{ log.durationMs ? (log.durationMs / 1000).toFixed(1) + ' сек' : '—' }}</span></div>
                    <div><span class="text-gray-500 text-xs">Стоимость</span><br><span class="text-gray-900 dark:text-white">{{ formatCost(log.costUsd) }} (~{{ (log.costUsd * USD_RUB).toFixed(2) }}₽)</span></div>
                    <div><span class="text-gray-500 text-xs">Токены</span><br><span class="text-gray-900 dark:text-white">↓{{ log.tokensIn.toLocaleString() }} ↑{{ log.tokensOut.toLocaleString() }}{{ log.cachedTokens > 0 ? ` (cached: ${log.cachedTokens.toLocaleString()})` : '' }}</span></div>
                  </div>
                  <div v-if="log.prompt" class="mb-3">
                    <span class="text-gray-500 text-xs">Промпт:</span>
                    <pre class="mt-1 p-3 bg-white dark:bg-gray-900 rounded-lg border border-gray-200 dark:border-gray-700 text-xs text-gray-700 dark:text-gray-300 whitespace-pre-wrap max-h-40 overflow-y-auto">{{ log.prompt }}</pre>
                  </div>
                  <div v-if="log.status === 'error' && log.errorMessage" class="p-3 bg-red-50 dark:bg-red-950 rounded-lg border border-red-200 dark:border-red-800">
                    <span class="text-red-600 dark:text-red-400 text-xs font-medium">Ошибка:</span>
                    <pre class="mt-1 text-xs text-red-700 dark:text-red-300 whitespace-pre-wrap">{{ log.errorMessage }}</pre>
                  </div>
                </td>
              </tr>
            </template>
          </tbody>
        </table>
      </div>

      <!-- Pagination -->
      <div v-if="total > 0" class="flex items-center justify-between px-4 py-3 border-t border-gray-200 dark:border-gray-800 text-sm text-gray-500">
        <span>{{ (page - 1) * 50 + 1 }}–{{ Math.min(page * 50, total) }} из {{ total }}</span>
        <div class="flex items-center gap-2">
          <button @click="page--; loadLogs()" :disabled="page <= 1" class="px-3 py-1.5 rounded-lg bg-gray-100 dark:bg-gray-800 disabled:opacity-30 hover:bg-gray-200 dark:hover:bg-gray-700 transition-colors flex items-center gap-1">
            <ChevronLeft :size="16" /> Назад
          </button>
          <span class="text-gray-400">{{ page }} / {{ totalPages }}</span>
          <button @click="page++; loadLogs()" :disabled="page >= totalPages" class="px-3 py-1.5 rounded-lg bg-gray-100 dark:bg-gray-800 disabled:opacity-30 hover:bg-gray-200 dark:hover:bg-gray-700 transition-colors flex items-center gap-1">
            Далее <ChevronRight :size="16" />
          </button>
        </div>
      </div>
    </div>

    <!-- SUMMARY TABLE -->
    <div v-if="viewMode === 'summary'" class="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 overflow-hidden">
      <div class="overflow-x-auto">
        <table class="w-full text-sm">
          <thead class="bg-gray-50 dark:bg-gray-800 text-xs text-gray-500 uppercase">
            <tr>
              <th class="px-4 py-3 text-left">{{ summaryGroupBy === 'action' ? 'Действие' : summaryGroupBy === 'model' ? 'Модель' : 'Пользователь' }}</th>
              <th class="px-4 py-3 text-right">Вызовов</th>
              <th class="px-4 py-3 text-right">Ошибок</th>
              <th class="px-4 py-3 text-right">Токены</th>
              <th class="px-4 py-3 text-right">Расходы</th>
              <th class="px-4 py-3 text-right">%</th>
            </tr>
          </thead>
          <tbody class="divide-y divide-gray-100 dark:divide-gray-800">
            <tr v-for="row in summaryRows" :key="row.key" class="hover:bg-gray-50 dark:hover:bg-gray-800/50">
              <td class="px-4 py-3 text-gray-900 dark:text-white">{{ row.label }}</td>
              <td class="px-4 py-3 text-right font-mono text-gray-600 dark:text-gray-400">{{ row.count }}</td>
              <td class="px-4 py-3 text-right font-mono" :class="row.errorCount > 0 ? 'text-red-600 dark:text-red-400' : 'text-gray-400'">{{ row.errorCount }}</td>
              <td class="px-4 py-3 text-right font-mono text-xs text-gray-500">{{ formatNumber(row.tokensIn) }}/{{ formatNumber(row.tokensOut) }}</td>
              <td class="px-4 py-3 text-right font-mono" :class="costColor(row.costUsd)">{{ formatCost(row.costUsd) }}</td>
              <td class="px-4 py-3 text-right text-gray-500">{{ row.percent }}%</td>
            </tr>
            <!-- Totals -->
            <tr v-if="summaryTotals" class="bg-gray-50 dark:bg-gray-800 font-bold">
              <td class="px-4 py-3 text-gray-900 dark:text-white">ИТОГО</td>
              <td class="px-4 py-3 text-right font-mono text-gray-900 dark:text-white">{{ summaryTotals.count }}</td>
              <td class="px-4 py-3 text-right font-mono" :class="summaryTotals.errorCount > 0 ? 'text-red-600' : 'text-gray-400'">{{ summaryTotals.errorCount }}</td>
              <td class="px-4 py-3 text-right font-mono text-xs text-gray-700 dark:text-gray-300">{{ formatNumber(summaryTotals.tokensIn) }}/{{ formatNumber(summaryTotals.tokensOut) }}</td>
              <td class="px-4 py-3 text-right font-mono text-gray-900 dark:text-white">{{ formatCost(summaryTotals.costUsd) }}</td>
              <td class="px-4 py-3 text-right text-gray-500">100%</td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  </div>
</template>
