<script setup lang="ts">
import { ref, onMounted, watch, computed } from 'vue'
import { http } from '@/api/client'
import { useToast } from '@/composables/useToast'
import { useBusinessesStore } from '@/stores/businesses'
import { useSectionAccess } from '@/composables/useSectionAccess'
import { formatNumber, formatDate } from '@/composables/useFormatters'
import {
  Eye, Heart, Radio, MousePointerClick, Target,
  RefreshCw, Sparkles, ExternalLink, CheckCircle2, XCircle, Info, AlertTriangle, Lightbulb,
} from 'lucide-vue-next'

const toast = useToast()
const businesses = useBusinessesStore()
const { canEdit } = useSectionAccess()

interface PostRow {
  postId: string | null
  platform: string
  source: string
  publicationType: string
  externalId: string
  externalUrl: string | null
  title: string | null
  body: string
  postType: string | null
  capturedAt: string
  reach: number | null
  views: number | null
  likes: number | null
  comments: number | null
  shares: number | null
  engagements: number
  engagementRate: number | null
  visits: number
  conversions: number
}
interface Overview {
  window: { days: number; from: string; to: string }
  totals: { posts: number; reach: number; views: number; likes: number; comments: number; shares: number; engagements: number; engagementRate: number | null }
  byPlatform: Array<{ platform: string; posts: number; reach: number; views: number; likes: number; engagements: number }>
  roi: { configured: boolean; visits: number; conversions: number; bySource: Array<{ source: string; visits: number; conversions: number }> }
  posts: PostRow[]
  adapters: { vkStats: boolean; metrika: boolean }
  lastCapturedAt: string | null
}
interface Report {
  id: string
  periodStart: string; periodEnd: string
  status: string
  summary: string
  findings: Array<{ type: string; title: string; detail?: string; metric?: string }>
  recommendations: Array<{ area: string; action: string; reason?: string }>
  createdAt: string
}

const days = ref(30)
const data = ref<Overview | null>(null)
const reports = ref<Report[]>([])
const loading = ref(true)
const collecting = ref(false)
const generating = ref(false)

const bizId = computed(() => businesses.currentBusinessId)

async function load() {
  if (!bizId.value) return
  loading.value = true
  try {
    const [ov, rep] = await Promise.all([
      http.get<Overview>(`/analytics/overview?businessId=${bizId.value}&days=${days.value}`),
      http.get<{ reports: Report[] }>(`/analytics/reports?businessId=${bizId.value}`),
    ])
    data.value = ov
    reports.value = rep.reports
  } catch (e: any) {
    toast.error(e.message || 'Ошибка загрузки аналитики')
  } finally {
    loading.value = false
  }
}

async function collect() {
  if (!bizId.value || collecting.value) return
  collecting.value = true
  try {
    await http.post('/analytics/collect', { businessId: bizId.value, force: true })
    toast.success('Метрики собраны')
    await load()
  } catch (e: any) {
    toast.error(e.message || 'Ошибка сбора метрик')
  } finally {
    collecting.value = false
  }
}

async function generateReport() {
  if (!bizId.value || generating.value) return
  generating.value = true
  try {
    await http.post('/analytics/report', { businessId: bizId.value, days: days.value })
    toast.success('Отчёт агента готов')
    await load()
  } catch (e: any) {
    toast.error(e.message || 'Не удалось создать отчёт')
  } finally {
    generating.value = false
  }
}

async function decide(id: string, decision: 'approve' | 'dismiss') {
  try {
    await http.post(`/analytics/reports/${id}/${decision}`, {})
    const r = reports.value.find(x => x.id === id)
    if (r) r.status = decision === 'approve' ? 'approved' : 'dismissed'
  } catch (e: any) {
    toast.error(e.message || 'Ошибка')
  }
}

function platformBadge(p: string): string {
  if (p === 'VK') return 'bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300'
  if (p === 'INSTAGRAM') return 'bg-fuchsia-100 text-fuchsia-700 dark:bg-fuchsia-900 dark:text-fuchsia-300'
  if (p === 'TELEGRAM') return 'bg-cyan-100 text-cyan-700 dark:bg-cyan-900 dark:text-cyan-300'
  return 'bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300'
}
function findingIcon(t: string) { return t === 'win' ? CheckCircle2 : t === 'loss' ? AlertTriangle : Lightbulb }
function findingColor(t: string): string {
  return t === 'win' ? 'text-green-600 dark:text-green-400' : t === 'loss' ? 'text-amber-600 dark:text-amber-400' : 'text-brand-600 dark:text-brand-400'
}

onMounted(load)
watch([bizId, days], load)
</script>

<template>
  <div>
    <!-- Header -->
    <div class="flex flex-wrap items-center justify-between gap-3 mb-6">
      <h1 class="text-2xl font-bold">Аналитика SMM</h1>
      <div class="flex items-center gap-2">
        <div class="inline-flex rounded-lg border border-gray-200 dark:border-gray-700 overflow-hidden">
          <button v-for="d in [7, 30, 90]" :key="d" @click="days = d"
            :class="['px-3 py-1.5 text-sm font-medium transition-colors', days === d ? 'bg-brand-600 text-white' : 'bg-white dark:bg-gray-900 text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800']">
            {{ d }}д
          </button>
        </div>
        <button v-if="canEdit('dashboard')" @click="collect" :disabled="collecting"
          class="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 hover:bg-gray-50 dark:hover:bg-gray-800 disabled:opacity-50">
          <RefreshCw :size="15" :class="collecting ? 'animate-spin' : ''" /> Собрать
        </button>
        <button v-if="canEdit('dashboard')" @click="generateReport" :disabled="generating"
          class="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium rounded-lg bg-brand-600 hover:bg-brand-700 text-white disabled:opacity-50">
          <Sparkles :size="15" :class="generating ? 'animate-pulse' : ''" /> Отчёт агента
        </button>
      </div>
    </div>

    <div v-if="loading" class="text-gray-500">Загрузка...</div>

    <template v-else-if="data">
      <!-- Adapter hints -->
      <div v-if="!data.adapters.vkStats || !data.roi.configured" class="mb-4 space-y-2">
        <div v-if="!data.roi.configured" class="flex items-start gap-2 text-sm rounded-lg p-3 bg-amber-50 dark:bg-amber-950/40 text-amber-800 dark:text-amber-300">
          <Info :size="16" class="mt-0.5 shrink-0" />
          <span>Конверсии (визиты → брони) не подключены. Добавьте OAuth Яндекс.Метрики в Настройках, чтобы видеть SMM-ROI.</span>
        </div>
        <div v-if="!data.adapters.vkStats" class="flex items-start gap-2 text-sm rounded-lg p-3 bg-blue-50 dark:bg-blue-950/40 text-blue-800 dark:text-blue-300">
          <Info :size="16" class="mt-0.5 shrink-0" />
          <span>Охваты и статистика VK-сторис требуют переподключения VK (scope <code>stats</code>) в Настройках → VK OAuth.</span>
        </div>
      </div>

      <!-- KPI cards -->
      <div class="grid grid-cols-2 lg:grid-cols-6 gap-3 mb-6">
        <div class="bg-white dark:bg-gray-900 rounded-xl p-4 border border-gray-200 dark:border-gray-800">
          <div class="text-xs text-gray-500 mb-1">Постов</div>
          <div class="text-2xl font-bold">{{ data.totals.posts }}</div>
        </div>
        <div class="bg-white dark:bg-gray-900 rounded-xl p-4 border border-gray-200 dark:border-gray-800">
          <div class="flex items-center gap-1.5 text-xs text-gray-500 mb-1"><Radio :size="13" /> Охват</div>
          <div class="text-2xl font-bold">{{ formatNumber(data.totals.reach) }}</div>
        </div>
        <div class="bg-white dark:bg-gray-900 rounded-xl p-4 border border-gray-200 dark:border-gray-800">
          <div class="flex items-center gap-1.5 text-xs text-gray-500 mb-1"><Eye :size="13" /> Просмотры</div>
          <div class="text-2xl font-bold">{{ formatNumber(data.totals.views) }}</div>
        </div>
        <div class="bg-white dark:bg-gray-900 rounded-xl p-4 border border-gray-200 dark:border-gray-800">
          <div class="flex items-center gap-1.5 text-xs text-gray-500 mb-1"><Heart :size="13" /> Вовлечён.</div>
          <div class="text-2xl font-bold">{{ formatNumber(data.totals.engagements) }}</div>
          <div class="text-xs text-gray-500 mt-0.5">ER {{ data.totals.engagementRate ?? '—' }}%</div>
        </div>
        <div class="bg-white dark:bg-gray-900 rounded-xl p-4 border border-gray-200 dark:border-gray-800">
          <div class="flex items-center gap-1.5 text-xs text-gray-500 mb-1"><MousePointerClick :size="13" /> Визиты</div>
          <div class="text-2xl font-bold">{{ data.roi.configured ? formatNumber(data.roi.visits) : '—' }}</div>
        </div>
        <div class="bg-white dark:bg-gray-900 rounded-xl p-4 border border-gray-200 dark:border-gray-800">
          <div class="flex items-center gap-1.5 text-xs text-gray-500 mb-1"><Target :size="13" /> Брони</div>
          <div class="text-2xl font-bold">{{ data.roi.configured ? formatNumber(data.roi.conversions) : '—' }}</div>
        </div>
      </div>

      <!-- By platform -->
      <div v-if="data.byPlatform.length" class="flex flex-wrap gap-2 mb-6">
        <div v-for="p in data.byPlatform" :key="p.platform"
          class="flex items-center gap-2 px-3 py-1.5 rounded-lg border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 text-sm">
          <span :class="['px-2 py-0.5 rounded text-xs font-semibold', platformBadge(p.platform)]">{{ p.platform }}</span>
          <span class="text-gray-500">{{ p.posts }} постов · охват {{ formatNumber(p.reach) }} · вовл. {{ formatNumber(p.engagements) }}</span>
        </div>
      </div>

      <!-- Posts table -->
      <div class="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 overflow-hidden mb-8">
        <div class="px-4 py-3 border-b border-gray-200 dark:border-gray-800 flex items-center justify-between">
          <h2 class="font-semibold">Посты по эффективности</h2>
          <span v-if="data.lastCapturedAt" class="text-xs text-gray-400">обновлено {{ formatDate(data.lastCapturedAt) }}</span>
        </div>
        <div v-if="!data.posts.length" class="p-8 text-center text-gray-500 text-sm">
          Нет данных. Нажмите «Собрать», чтобы получить метрики опубликованных постов.
        </div>
        <div v-else class="overflow-x-auto">
          <table class="w-full text-sm">
            <thead class="text-xs text-gray-500 border-b border-gray-200 dark:border-gray-800">
              <tr>
                <th class="text-left font-medium px-4 py-2">Пост</th>
                <th class="text-left font-medium px-3 py-2">Канал</th>
                <th class="text-right font-medium px-3 py-2">Охват</th>
                <th class="text-right font-medium px-3 py-2">Просм.</th>
                <th class="text-right font-medium px-3 py-2">Вовл.</th>
                <th class="text-right font-medium px-3 py-2">ER%</th>
                <th class="text-right font-medium px-3 py-2">Визиты</th>
                <th class="text-right font-medium px-3 py-2">Брони</th>
                <th class="px-2 py-2"></th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="(p, i) in data.posts" :key="i" class="border-b border-gray-100 dark:border-gray-800/60 hover:bg-gray-50 dark:hover:bg-gray-800/40">
                <td class="px-4 py-2 max-w-[280px]">
                  <div class="truncate">{{ p.title || p.body || '(без текста)' }}</div>
                  <div class="text-xs text-gray-400">{{ p.publicationType }}</div>
                </td>
                <td class="px-3 py-2"><span :class="['px-2 py-0.5 rounded text-xs font-semibold', platformBadge(p.platform)]">{{ p.platform }}</span></td>
                <td class="px-3 py-2 text-right tabular-nums">{{ p.reach != null ? formatNumber(p.reach) : '—' }}</td>
                <td class="px-3 py-2 text-right tabular-nums">{{ p.views != null ? formatNumber(p.views) : '—' }}</td>
                <td class="px-3 py-2 text-right tabular-nums">{{ formatNumber(p.engagements) }}</td>
                <td class="px-3 py-2 text-right tabular-nums">{{ p.engagementRate ?? '—' }}</td>
                <td class="px-3 py-2 text-right tabular-nums">{{ data.roi.configured ? formatNumber(p.visits) : '—' }}</td>
                <td class="px-3 py-2 text-right tabular-nums font-semibold" :class="p.conversions > 0 ? 'text-green-600 dark:text-green-400' : ''">{{ data.roi.configured ? p.conversions : '—' }}</td>
                <td class="px-2 py-2 text-right">
                  <a v-if="p.externalUrl" :href="p.externalUrl" target="_blank" rel="noopener" class="text-gray-400 hover:text-brand-600"><ExternalLink :size="14" /></a>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      <!-- Analyst reports -->
      <div class="mb-4 flex items-center gap-2">
        <Sparkles :size="18" class="text-brand-600 dark:text-brand-400" />
        <h2 class="text-lg font-semibold">Отчёты агента-аналитика</h2>
      </div>
      <div v-if="!reports.length" class="text-gray-500 text-sm mb-8">
        Отчётов пока нет. Нажмите «Отчёт агента» — AI разберёт период и даст рекомендации.
      </div>
      <div v-else class="space-y-4 mb-8">
        <div v-for="r in reports" :key="r.id" class="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 p-5">
          <div class="flex items-start justify-between gap-3 mb-2">
            <div>
              <div class="text-xs text-gray-400">{{ formatDate(r.periodStart) }} — {{ formatDate(r.periodEnd) }}</div>
              <p class="mt-1">{{ r.summary }}</p>
            </div>
            <span :class="['shrink-0 px-2 py-0.5 rounded text-xs font-semibold',
              r.status === 'approved' ? 'bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-300'
              : r.status === 'dismissed' ? 'bg-gray-100 text-gray-500 dark:bg-gray-800'
              : 'bg-amber-100 text-amber-700 dark:bg-amber-900 dark:text-amber-300']">
              {{ r.status === 'approved' ? 'Принято' : r.status === 'dismissed' ? 'Отклонено' : 'Новое' }}
            </span>
          </div>

          <div v-if="r.findings?.length" class="mt-3 space-y-1.5">
            <div v-for="(f, fi) in r.findings" :key="fi" class="flex items-start gap-2 text-sm">
              <component :is="findingIcon(f.type)" :size="15" :class="['mt-0.5 shrink-0', findingColor(f.type)]" />
              <span><b>{{ f.title }}</b><template v-if="f.detail"> — {{ f.detail }}</template></span>
            </div>
          </div>

          <div v-if="r.recommendations?.length" class="mt-3 rounded-lg bg-brand-50 dark:bg-brand-950/40 p-3">
            <div class="text-xs font-semibold text-brand-700 dark:text-brand-300 mb-1.5">Рекомендации</div>
            <ol class="list-decimal list-inside space-y-1 text-sm">
              <li v-for="(rec, ri) in r.recommendations" :key="ri">
                {{ rec.action }}<span v-if="rec.reason" class="text-gray-500"> — {{ rec.reason }}</span>
              </li>
            </ol>
          </div>

          <div v-if="r.status === 'proposed' && canEdit('dashboard')" class="mt-3 flex gap-2">
            <button @click="decide(r.id, 'approve')" class="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-lg bg-green-600 hover:bg-green-700 text-white">
              <CheckCircle2 :size="15" /> Принять
            </button>
            <button @click="decide(r.id, 'dismiss')" class="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-lg border border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-800">
              <XCircle :size="15" /> Отклонить
            </button>
          </div>
        </div>
      </div>
    </template>
  </div>
</template>
