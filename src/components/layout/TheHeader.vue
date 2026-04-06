<script setup lang="ts">
import { useRouter } from 'vue-router'
import { useAuthStore } from '@/stores/auth'
import { useBusinessesStore } from '@/stores/businesses'
import { useThemeStore } from '@/stores/theme'
import { LogOut, Sun, Moon } from 'lucide-vue-next'

const auth = useAuthStore()
const businesses = useBusinessesStore()
const theme = useThemeStore()
const router = useRouter()

async function handleLogout() {
  await auth.logout()
  router.push('/login')
}
</script>

<template>
  <header class="h-16 bg-white dark:bg-gray-900 border-b border-gray-200 dark:border-gray-800 flex items-center justify-between px-6">
    <!-- Business Switcher -->
    <div class="flex items-center gap-3">
      <select
        v-if="businesses.businesses.length > 0"
        :value="businesses.currentBusinessId"
        @change="businesses.setCurrent(($event.target as HTMLSelectElement).value)"
        class="bg-gray-100 dark:bg-gray-800 border-0 rounded-lg px-3 py-2 text-sm font-medium focus:ring-2 focus:ring-brand-500"
      >
        <option v-for="biz in businesses.businesses" :key="biz.id" :value="biz.id">
          {{ biz.name }}
        </option>
      </select>
    </div>

    <!-- Right side -->
    <div class="flex items-center gap-3">
      <button
        @click="theme.toggle()"
        class="p-2 rounded-lg text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-800"
      >
        <Sun v-if="theme.isDark" :size="20" />
        <Moon v-else :size="20" />
      </button>

      <span class="text-sm text-gray-500 dark:text-gray-400">{{ auth.user?.name }}</span>

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
