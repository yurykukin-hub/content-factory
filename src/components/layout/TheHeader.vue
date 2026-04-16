<script setup lang="ts">
import { useRouter } from 'vue-router'
import { useAuthStore } from '@/stores/auth'
import { useThemeStore } from '@/stores/theme'
import { useSidebarStore } from '@/stores/sidebar'
import { LogOut, Sun, Moon, Menu } from 'lucide-vue-next'
import UsageBadge from './UsageBadge.vue'

const auth = useAuthStore()
const theme = useThemeStore()
const sidebar = useSidebarStore()
const router = useRouter()

async function handleLogout() {
  await auth.logout()
  router.push('/login')
}
</script>

<template>
  <header class="h-14 md:h-16 bg-white dark:bg-gray-900 border-b border-gray-200 dark:border-gray-800 flex items-center justify-between px-3 md:px-6">
    <!-- Left: hamburger (mobile only) -->
    <div class="flex items-center gap-2">
      <button
        @click="sidebar.toggle()"
        class="md:hidden p-2 rounded-lg text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-800"
      >
        <Menu :size="20" />
      </button>
      <span class="md:hidden text-sm font-bold text-brand-600 dark:text-brand-400">CF</span>
    </div>

    <!-- Right side -->
    <div class="flex items-center gap-2 md:gap-3">
      <button
        @click="theme.toggle()"
        class="p-2 rounded-lg text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-800"
      >
        <Sun v-if="theme.isDark" :size="20" />
        <Moon v-else :size="20" />
      </button>

      <!-- AI Usage badge (ADMIN only) -->
      <UsageBadge v-if="auth.user?.role === 'ADMIN'" />

      <!-- Balance -->
      <div
        v-if="auth.user?.balanceKopecks !== undefined && auth.user?.role !== 'ADMIN'"
        class="hidden sm:flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-medium"
        :class="(auth.user.balanceKopecks ?? 0) > 0
          ? 'bg-green-50 text-green-700 dark:bg-green-950 dark:text-green-400'
          : 'bg-red-50 text-red-700 dark:bg-red-950 dark:text-red-400'"
      >
        {{ ((auth.user.balanceKopecks ?? 0) / 100).toFixed(0) }} ₽
      </div>

      <span class="hidden sm:inline text-sm text-gray-500 dark:text-gray-400">{{ auth.user?.name }}</span>

      <button
        @click="handleLogout"
        class="p-2 rounded-lg text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-800"
        title="Выйти"
      >
        <LogOut :size="20" />
      </button>
    </div>
  </header>
</template>
