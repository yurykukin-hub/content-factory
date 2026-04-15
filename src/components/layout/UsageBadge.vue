<script setup lang="ts">
import { ref, onMounted, onUnmounted, computed } from 'vue'
import { http } from '@/api/client'
import { Coins, TrendingUp, Zap, Video, ImageIcon, MessageSquare } from 'lucide-vue-next'

interface AiStats {
  openrouter: { balanceUsd: number; limitUsd: number | null } | null
  month: {
    totalUsd: number
    totalRub: number
    calls: number
    breakdown: { text: number; image: number; video: number }
  }
  today: { totalUsd: number; calls: number }
}

const stats = ref<AiStats | null>(null)
const open = ref(false)
let pollTimer: ReturnType<typeof setInterval> | null = null

async function load() {
  try {
    stats.value = await http.get<AiStats>('/dashboard/ai-stats')
  } catch { /* silent */ }
}

onMounted(() => {
  load()
  pollTimer = setInterval(load, 60_000)
})

onUnmounted(() => {
  if (pollTimer) clearInterval(pollTimer)
})

const balanceColor = computed(() => {
  if (!stats.value?.openrouter) return 'text-gray-400'
  const b = stats.value.openrouter.balanceUsd
  if (b < 0.10) return 'text-red-500'
  if (b < 1) return 'text-amber-500'
  return 'text-emerald-500 dark:text-emerald-400'
})

function fmt(n: number): string {
  if (n >= 1) return n.toFixed(2)
  if (n >= 0.01) return n.toFixed(3)
  return n.toFixed(4)
}

const monthName = computed(() => {
  return new Date().toLocaleString('ru', { month: 'long' })
})
</script>

<template>
  <div v-if="stats" class="relative hidden md:block">
    <!-- Badge button -->
    <button @click="open = !open"
      :class="['flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[11px] font-medium transition-colors border',
        open
          ? 'bg-gray-100 dark:bg-gray-800 border-gray-300 dark:border-gray-600'
          : 'border-transparent hover:bg-gray-100 dark:hover:bg-gray-800']">
      <Coins :size="13" :class="balanceColor" />
      <span class="text-gray-600 dark:text-gray-300">${{ fmt(stats.month.totalUsd) }}</span>
      <span class="text-gray-400">·</span>
      <span class="text-gray-400">~{{ stats.month.totalRub }}₽</span>
    </button>

    <!-- Backdrop -->
    <div v-if="open" class="fixed inset-0 z-20" @click="open = false" />

    <!-- Dropdown -->
    <div v-if="open"
      class="absolute right-0 top-full mt-1 w-64 bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-xl shadow-xl z-30 overflow-hidden">

      <!-- OpenRouter balance -->
      <div v-if="stats.openrouter" class="px-4 py-3 border-b border-gray-100 dark:border-gray-800">
        <div class="text-[9px] font-semibold text-gray-400 uppercase tracking-wider mb-1">OpenRouter</div>
        <div class="flex items-center justify-between">
          <span class="text-sm text-gray-500">Баланс</span>
          <span :class="['text-sm font-bold', balanceColor]">
            ${{ fmt(stats.openrouter.balanceUsd) }}
          </span>
        </div>
      </div>

      <!-- Month breakdown -->
      <div class="px-4 py-3 border-b border-gray-100 dark:border-gray-800">
        <div class="text-[9px] font-semibold text-gray-400 uppercase tracking-wider mb-2">
          Расходы за {{ monthName }}
        </div>

        <div class="space-y-1.5">
          <div class="flex items-center justify-between text-xs">
            <span class="flex items-center gap-1.5 text-gray-500">
              <MessageSquare :size="11" class="text-blue-400" /> Текст AI
            </span>
            <span class="text-gray-600 dark:text-gray-300 font-medium">
              ${{ fmt(stats.month.breakdown.text) }}
              <span class="text-gray-400 ml-1">{{ Math.round(stats.month.breakdown.text * 95) }}₽</span>
            </span>
          </div>

          <div class="flex items-center justify-between text-xs">
            <span class="flex items-center gap-1.5 text-gray-500">
              <ImageIcon :size="11" class="text-purple-400" /> Картинки
            </span>
            <span class="text-gray-600 dark:text-gray-300 font-medium">
              ${{ fmt(stats.month.breakdown.image) }}
              <span class="text-gray-400 ml-1">{{ Math.round(stats.month.breakdown.image * 95) }}₽</span>
            </span>
          </div>

          <div class="flex items-center justify-between text-xs">
            <span class="flex items-center gap-1.5 text-gray-500">
              <Video :size="11" class="text-emerald-400" /> Видео
            </span>
            <span class="text-gray-600 dark:text-gray-300 font-medium">
              ${{ fmt(stats.month.breakdown.video) }}
              <span class="text-gray-400 ml-1">{{ Math.round(stats.month.breakdown.video * 95) }}₽</span>
            </span>
          </div>
        </div>

        <div class="mt-2 pt-2 border-t border-gray-100 dark:border-gray-800 flex items-center justify-between text-xs">
          <span class="text-gray-500 font-medium">Итого</span>
          <span class="font-bold text-gray-700 dark:text-gray-200">
            ${{ fmt(stats.month.totalUsd) }}
            <span class="text-gray-400 font-normal ml-1">~{{ stats.month.totalRub }}₽</span>
          </span>
        </div>
        <div class="flex items-center justify-between text-[10px] text-gray-400 mt-1">
          <span>Вызовов</span>
          <span>{{ stats.month.calls }}</span>
        </div>
      </div>

      <!-- Today -->
      <div class="px-4 py-2.5">
        <div class="flex items-center justify-between text-xs">
          <span class="flex items-center gap-1.5 text-gray-500">
            <Zap :size="11" class="text-amber-400" /> Сегодня
          </span>
          <span class="text-gray-600 dark:text-gray-300 font-medium">
            ${{ fmt(stats.today.totalUsd) }} · {{ stats.today.calls }} выз.
          </span>
        </div>
      </div>
    </div>
  </div>
</template>
