<script setup lang="ts">
import { ref } from 'vue'
import { useRouter } from 'vue-router'
import { Eye, EyeOff } from 'lucide-vue-next'
import { useAuthStore } from '@/stores/auth'
import { useBusinessesStore } from '@/stores/businesses'

const auth = useAuthStore()
const businesses = useBusinessesStore()
const router = useRouter()

const login = ref('')
const password = ref('')
const error = ref('')
const loading = ref(false)
const showPassword = ref(false)
// По умолчанию вкл: свой рабочий комп (30д). Снять → сессия (стирается при закрытии браузера).
const rememberMe = ref(true)

async function handleSubmit() {
  error.value = ''
  loading.value = true
  try {
    await auth.login(login.value, password.value, rememberMe.value)
    await businesses.load()
    router.push('/')
  } catch (e: any) {
    error.value = e.message || 'Ошибка входа'
  } finally {
    loading.value = false
  }
}
</script>

<template>
  <div class="min-h-screen flex items-center justify-center bg-gray-50 dark:bg-gray-950">
    <div class="bg-white dark:bg-gray-900 rounded-2xl shadow-lg p-8 w-full max-w-sm">
      <h1 class="text-2xl font-bold text-center text-brand-600 dark:text-brand-400 mb-2">
        Content Factory
      </h1>
      <p class="text-sm text-gray-500 text-center mb-6">AI-контент-фабрика</p>

      <form @submit.prevent="handleSubmit" class="space-y-4">
        <div>
          <label class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Логин</label>
          <input
            v-model="login"
            type="text"
            required
            autofocus
            autocomplete="username"
            class="w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 focus:ring-2 focus:ring-brand-500 focus:border-brand-500"
          />
        </div>
        <div>
          <label class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Пароль</label>
          <div class="relative">
            <input
              v-model="password"
              :type="showPassword ? 'text' : 'password'"
              required
              autocomplete="current-password"
              class="w-full px-3 py-2 pr-10 rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 focus:ring-2 focus:ring-brand-500 focus:border-brand-500"
            />
            <button
              type="button"
              @click="showPassword = !showPassword"
              class="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300"
            >
              <EyeOff v-if="showPassword" :size="16" />
              <Eye v-else :size="16" />
            </button>
          </div>
        </div>

        <label class="flex items-center gap-2 text-sm text-gray-600 dark:text-gray-400 cursor-pointer select-none">
          <input v-model="rememberMe" type="checkbox" class="rounded border-gray-300 dark:border-gray-600 text-brand-600 focus:ring-brand-500" />
          Запомнить меня
        </label>

        <div v-if="error" class="text-sm text-red-500">{{ error }}</div>

        <button
          type="submit"
          :disabled="loading"
          class="w-full py-2.5 rounded-lg bg-brand-600 hover:bg-brand-700 text-white font-medium transition-colors disabled:opacity-50"
        >
          {{ loading ? 'Вход...' : 'Войти' }}
        </button>
      </form>
    </div>
  </div>
</template>
