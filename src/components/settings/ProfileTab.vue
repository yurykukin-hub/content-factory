<script setup lang="ts">
import { useAuthStore } from '@/stores/auth'
import { useThemeStore } from '@/stores/theme'
import { User, Sun, Moon, Shield, Lock, Code } from 'lucide-vue-next'

const auth = useAuthStore()
const theme = useThemeStore()

function roleLabel(role: string) {
  const map: Record<string, string> = {
    ADMIN: 'Администратор',
    EDITOR: 'Редактор',
    VIEWER: 'Наблюдатель',
  }
  return map[role] || role
}
</script>

<template>
  <div class="space-y-6">
    <!-- User info -->
    <div class="bg-white dark:bg-gray-900 rounded-xl p-6 border border-gray-200 dark:border-gray-800">
      <h2 class="font-semibold mb-4 flex items-center gap-2">
        <User :size="18" />
        Профиль
      </h2>
      <div class="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div>
          <label class="text-xs text-gray-400 block mb-1">Имя</label>
          <div class="text-sm font-medium">{{ auth.user?.name || '—' }}</div>
        </div>
        <div>
          <label class="text-xs text-gray-400 block mb-1">Логин</label>
          <div class="text-sm font-mono">{{ auth.user?.login || '—' }}</div>
        </div>
        <div>
          <label class="text-xs text-gray-400 block mb-1">Роль</label>
          <div class="flex items-center gap-1.5">
            <Shield :size="14" class="text-brand-500" />
            <span class="text-sm font-medium">{{ roleLabel(auth.user?.role || '') }}</span>
          </div>
        </div>
      </div>
    </div>

    <!-- Theme -->
    <div class="bg-white dark:bg-gray-900 rounded-xl p-6 border border-gray-200 dark:border-gray-800">
      <h2 class="font-semibold mb-4">Внешний вид</h2>
      <div class="flex items-center justify-between">
        <div>
          <div class="text-sm font-medium">Тема оформления</div>
          <div class="text-xs text-gray-400">{{ theme.isDark ? 'Тёмная тема' : 'Светлая тема' }}</div>
        </div>
        <button
          @click="theme.toggle()"
          :class="[
            'flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all border',
            theme.isDark
              ? 'border-yellow-600 bg-yellow-950 text-yellow-300 hover:bg-yellow-900'
              : 'border-gray-300 bg-gray-100 text-gray-700 hover:bg-gray-200'
          ]"
        >
          <Sun v-if="theme.isDark" :size="16" />
          <Moon v-else :size="16" />
          {{ theme.isDark ? 'Светлая' : 'Тёмная' }}
        </button>
      </div>
    </div>

    <!-- Dev mode -->
    <div v-if="auth.user?.role === 'ADMIN'" class="bg-white dark:bg-gray-900 rounded-xl p-6 border border-gray-200 dark:border-gray-800">
      <div class="flex items-center justify-between">
        <div>
          <h2 class="font-semibold flex items-center gap-2">
            <Code :size="18" />
            Режим разработчика
          </h2>
          <p class="text-xs text-gray-400 mt-1">Показывает выбор AI-моделей в редакторе изображений</p>
        </div>
        <button
          @click="theme.toggleDevMode()"
          :class="[
            'relative w-11 h-6 rounded-full transition-colors',
            theme.devMode ? 'bg-brand-600' : 'bg-gray-300 dark:bg-gray-600'
          ]"
        >
          <span :class="[
            'absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white shadow transition-transform',
            theme.devMode && 'translate-x-5'
          ]" />
        </button>
      </div>
    </div>

    <!-- Change password (placeholder) -->
    <div class="bg-white dark:bg-gray-900 rounded-xl p-6 border border-gray-200 dark:border-gray-800">
      <h2 class="font-semibold mb-2 flex items-center gap-2">
        <Lock :size="18" />
        Безопасность
      </h2>
      <p class="text-sm text-gray-400">Смена пароля и двухфакторная аутентификация — скоро.</p>
    </div>
  </div>
</template>
