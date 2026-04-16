<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { http } from '@/api/client'
import { useToast } from '@/composables/useToast'
import { Film, Send, Clock, Sparkles } from 'lucide-vue-next'

const toast = useToast()

interface DashboardData {
  totalBusinesses: number
  totalPosts: number
  postsThisWeek: number
  publishedThisWeek: number
  scheduledPosts: number
  aiUsage: {
    calls: number
    costUsd: number
    tokensIn: number
    tokensOut: number
  }
}

const data = ref<DashboardData | null>(null)
const loading = ref(true)

onMounted(async () => {
  try {
    data.value = await http.get<DashboardData>('/dashboard')
  } catch (e) {
    toast.error('Ошибка загрузки дашборда')
  } finally {
    loading.value = false
  }
})
</script>

<template>
  <div>
    <h1 class="text-2xl font-bold mb-6">Обзор</h1>

    <div v-if="loading" class="text-gray-500">Загрузка...</div>

    <div v-else-if="data" class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
      <!-- Total posts -->
      <div class="bg-white dark:bg-gray-900 rounded-xl p-5 border border-gray-200 dark:border-gray-800">
        <div class="flex items-center gap-3 mb-3">
          <div class="p-2 bg-brand-100 dark:bg-brand-900 rounded-lg">
            <Film :size="20" class="text-brand-600 dark:text-brand-400" />
          </div>
          <span class="text-sm text-gray-500">Всего контента</span>
        </div>
        <div class="text-3xl font-bold">{{ data.totalPosts }}</div>
        <div class="text-sm text-gray-500 mt-1">+{{ data.postsThisWeek }} за неделю</div>
      </div>

      <!-- Published this week -->
      <div class="bg-white dark:bg-gray-900 rounded-xl p-5 border border-gray-200 dark:border-gray-800">
        <div class="flex items-center gap-3 mb-3">
          <div class="p-2 bg-green-100 dark:bg-green-900 rounded-lg">
            <Send :size="20" class="text-green-600 dark:text-green-400" />
          </div>
          <span class="text-sm text-gray-500">Опубликовано</span>
        </div>
        <div class="text-3xl font-bold">{{ data.publishedThisWeek }}</div>
        <div class="text-sm text-gray-500 mt-1">за последнюю неделю</div>
      </div>

      <!-- Scheduled -->
      <div class="bg-white dark:bg-gray-900 rounded-xl p-5 border border-gray-200 dark:border-gray-800">
        <div class="flex items-center gap-3 mb-3">
          <div class="p-2 bg-amber-100 dark:bg-amber-900 rounded-lg">
            <Clock :size="20" class="text-amber-600 dark:text-amber-400" />
          </div>
          <span class="text-sm text-gray-500">Запланировано</span>
        </div>
        <div class="text-3xl font-bold">{{ data.scheduledPosts }}</div>
        <div class="text-sm text-gray-500 mt-1">ожидают публикации</div>
      </div>

      <!-- AI Usage -->
      <div class="bg-white dark:bg-gray-900 rounded-xl p-5 border border-gray-200 dark:border-gray-800">
        <div class="flex items-center gap-3 mb-3">
          <div class="p-2 bg-purple-100 dark:bg-purple-900 rounded-lg">
            <Sparkles :size="20" class="text-purple-600 dark:text-purple-400" />
          </div>
          <span class="text-sm text-gray-500">AI за месяц</span>
        </div>
        <div class="text-3xl font-bold">{{ data.aiUsage.calls }}</div>
        <div class="text-sm text-gray-500 mt-1">${{ data.aiUsage.costUsd.toFixed(2) }} потрачено</div>
      </div>
    </div>

    <!-- Placeholder for future widgets -->
    <div class="mt-8 bg-white dark:bg-gray-900 rounded-xl p-6 border border-gray-200 dark:border-gray-800">
      <h2 class="text-lg font-semibold mb-4">Быстрые действия</h2>
      <div class="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <router-link to="/posts" class="flex items-center gap-2 p-3 rounded-lg bg-brand-50 dark:bg-brand-950 hover:bg-brand-100 dark:hover:bg-brand-900 text-brand-700 dark:text-brand-300 transition-colors">
          <Film :size="18" />
          <span class="text-sm font-medium">Создать историю</span>
        </router-link>
        <router-link to="/plans" class="flex items-center gap-2 p-3 rounded-lg bg-purple-50 dark:bg-purple-950 hover:bg-purple-100 dark:hover:bg-purple-900 text-purple-700 dark:text-purple-300 transition-colors">
          <Sparkles :size="18" />
          <span class="text-sm font-medium">AI Контент-план</span>
        </router-link>
        <router-link to="/businesses" class="flex items-center gap-2 p-3 rounded-lg bg-gray-50 dark:bg-gray-800 hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-700 dark:text-gray-300 transition-colors">
          <Settings :size="18" />
          <span class="text-sm font-medium">Настроить проекты</span>
        </router-link>
      </div>
    </div>
  </div>
</template>

<script lang="ts">
import { Settings } from 'lucide-vue-next'
</script>
