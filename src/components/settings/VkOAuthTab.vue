<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { http } from '@/api/client'
import {
  Link, Unlink, Key, Save, Loader2, CheckCircle, XCircle,
  ExternalLink, RefreshCw, Eye, EyeOff, AlertCircle
} from 'lucide-vue-next'

interface OAuthStatus {
  connected: boolean
  appId?: string
  hasAppSecret: boolean
  expiresAt?: string
  lastError?: string
}

const status = ref<OAuthStatus | null>(null)
const loading = ref(true)

// App config form
const appId = ref('')
const appSecret = ref('')
const showSecret = ref(false)
const savingConfig = ref(false)
const configSaved = ref(false)

// OAuth flow
const authUrl = ref('')
const initiating = ref(false)
const codeInput = ref('')
const deviceIdInput = ref('')
const exchanging = ref(false)

// Actions
const refreshing = ref(false)
const disconnecting = ref(false)

async function loadStatus() {
  loading.value = true
  try {
    status.value = await http.get<OAuthStatus>('/vk-oauth/status')
    if (status.value.appId) appId.value = status.value.appId
  } catch (e) {
    console.error('VK OAuth status error:', e)
  } finally {
    loading.value = false
  }
}

async function saveAppConfig() {
  if (!appId.value.trim()) return
  savingConfig.value = true
  configSaved.value = false
  try {
    await http.put('/vk-oauth/app-config', { appId: appId.value.trim(), appSecret: appSecret.value.trim() })
    configSaved.value = true
    await loadStatus()
    setTimeout(() => { configSaved.value = false }, 3000)
  } catch (e: any) {
    alert('Ошибка: ' + (e.message || e))
  } finally {
    savingConfig.value = false
  }
}

async function initOAuth() {
  initiating.value = true
  try {
    const result = await http.post<{ authUrl: string }>('/vk-oauth/init', {})
    authUrl.value = result.authUrl
    window.open(result.authUrl, '_blank')
  } catch (e: any) {
    alert('Ошибка: ' + (e.message || e))
  } finally {
    initiating.value = false
  }
}

async function exchangeCode() {
  if (!codeInput.value.trim() || !deviceIdInput.value.trim()) return
  exchanging.value = true
  try {
    const result = await http.post<{ success: boolean; error?: string }>('/vk-oauth/callback', {
      code: codeInput.value.trim(),
      deviceId: deviceIdInput.value.trim(),
    })
    if (result.success) {
      codeInput.value = ''
      deviceIdInput.value = ''
      authUrl.value = ''
      await loadStatus()
    } else {
      alert('Ошибка: ' + result.error)
    }
  } catch (e: any) {
    alert('Ошибка: ' + (e.message || e))
  } finally {
    exchanging.value = false
  }
}

async function manualRefresh() {
  refreshing.value = true
  try {
    const result = await http.post<{ success: boolean; error?: string }>('/vk-oauth/refresh', {})
    if (!result.success) alert('Ошибка: ' + result.error)
    await loadStatus()
  } catch (e: any) {
    alert('Ошибка: ' + (e.message || e))
  } finally {
    refreshing.value = false
  }
}

async function disconnectOAuth() {
  if (!confirm('Отключить VK OAuth? Токены будут удалены.')) return
  disconnecting.value = true
  try {
    await http.post('/vk-oauth/disconnect', {})
    await loadStatus()
  } catch (e: any) {
    alert('Ошибка: ' + (e.message || e))
  } finally {
    disconnecting.value = false
  }
}

function formatExpiry(iso: string) {
  const d = new Date(iso)
  const now = Date.now()
  const mins = Math.round((d.getTime() - now) / 60000)
  if (mins < 0) return 'Истёк'
  if (mins < 60) return `${mins} мин`
  return d.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })
}

onMounted(loadStatus)
</script>

<template>
  <div class="space-y-6">
    <p class="text-sm text-gray-500">
      VK OAuth позволяет публиковать посты с фото и видео. User Token обновляется автоматически.
    </p>

    <div v-if="loading" class="text-sm text-gray-400">Загрузка...</div>

    <template v-else>
      <!-- Status card -->
      <div class="bg-white dark:bg-gray-900 rounded-xl p-6 border border-gray-200 dark:border-gray-800">
        <h2 class="font-semibold mb-4 flex items-center gap-2">
          <Link :size="18" class="text-blue-500" />
          Статус подключения
        </h2>

        <!-- Connected -->
        <div v-if="status?.connected" class="space-y-4">
          <div class="flex items-center gap-3 p-3 rounded-lg bg-green-50 dark:bg-green-950 border border-green-200 dark:border-green-800">
            <CheckCircle :size="20" class="text-green-600 shrink-0" />
            <div class="flex-1">
              <div class="text-sm font-medium text-green-700 dark:text-green-300">ВКонтакте подключён</div>
              <div v-if="status.expiresAt" class="text-xs text-green-600 dark:text-green-400">
                Токен действует ещё {{ formatExpiry(status.expiresAt) }}
              </div>
            </div>
            <div class="flex gap-2">
              <button @click="manualRefresh" :disabled="refreshing"
                class="flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-medium text-gray-600 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-gray-700">
                <Loader2 v-if="refreshing" :size="14" class="animate-spin" />
                <RefreshCw v-else :size="14" />
                Обновить
              </button>
              <button @click="disconnectOAuth" :disabled="disconnecting"
                class="flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-medium text-red-500 hover:bg-red-50 dark:hover:bg-red-950">
                <Unlink :size="14" />
                Отключить
              </button>
            </div>
          </div>

          <!-- Last error -->
          <div v-if="status.lastError" class="flex items-start gap-2 p-3 rounded-lg bg-red-50 dark:bg-red-950 border border-red-200 dark:border-red-800">
            <AlertCircle :size="16" class="text-red-500 shrink-0 mt-0.5" />
            <div class="text-xs text-red-600 dark:text-red-400">{{ status.lastError }}</div>
          </div>
        </div>

        <!-- Not connected -->
        <div v-else>
          <div class="flex items-center gap-2 p-3 rounded-lg bg-gray-100 dark:bg-gray-800 mb-4">
            <XCircle :size="16" class="text-gray-400" />
            <span class="text-sm text-gray-500">Не подключено</span>
          </div>
        </div>
      </div>

      <!-- App config -->
      <div class="bg-white dark:bg-gray-900 rounded-xl p-6 border border-gray-200 dark:border-gray-800">
        <h2 class="font-semibold mb-4 flex items-center gap-2">
          <Key :size="18" class="text-gray-400" />
          VK App (ID приложения)
        </h2>

        <div class="space-y-3">
          <div>
            <label class="block text-sm font-medium mb-1">App ID</label>
            <input v-model="appId" placeholder="54086314"
              class="w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 focus:ring-2 focus:ring-blue-500 text-sm font-mono" />
            <p class="text-xs text-gray-400 mt-1">
              Из <a href="https://id.vk.com/about/business/go" target="_blank" class="text-blue-500 hover:underline">VK ID → Приложения</a>
            </p>
          </div>
          <div>
            <label class="block text-sm font-medium mb-1">App Secret (защищённый ключ)</label>
            <div class="relative">
              <input v-model="appSecret" :type="showSecret ? 'text' : 'password'" placeholder="Защищённый ключ..."
                class="w-full px-3 py-2 pr-10 rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 focus:ring-2 focus:ring-blue-500 text-sm font-mono" />
              <button @click="showSecret = !showSecret" class="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-gray-400 hover:text-gray-600">
                <EyeOff v-if="showSecret" :size="16" />
                <Eye v-else :size="16" />
              </button>
            </div>
          </div>
          <div class="flex items-center gap-2">
            <button @click="saveAppConfig" :disabled="savingConfig || !appId.trim()"
              class="flex items-center gap-2 px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium disabled:opacity-50">
              <Loader2 v-if="savingConfig" :size="16" class="animate-spin" />
              <Save v-else :size="16" />
              Сохранить
            </button>
            <span v-if="configSaved" class="text-xs text-green-600 flex items-center gap-1">
              <CheckCircle :size="14" /> Сохранено!
            </span>
          </div>
        </div>
      </div>

      <!-- OAuth flow -->
      <div v-if="status?.appId && !status?.connected" class="bg-white dark:bg-gray-900 rounded-xl p-6 border border-gray-200 dark:border-gray-800">
        <h2 class="font-semibold mb-4 flex items-center gap-2">
          <ExternalLink :size="18" class="text-blue-500" />
          Подключение
        </h2>

        <!-- Step 1: Generate URL -->
        <div v-if="!authUrl" class="text-center py-4">
          <p class="text-sm text-gray-500 mb-4">Нажмите для авторизации через ВКонтакте</p>
          <button @click="initOAuth" :disabled="initiating"
            class="flex items-center gap-2 mx-auto px-6 py-3 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium disabled:opacity-50">
            <Loader2 v-if="initiating" :size="16" class="animate-spin" />
            <Link v-else :size="16" />
            Подключить ВКонтакте
          </button>
        </div>

        <!-- Step 2: Enter code -->
        <div v-else class="space-y-4">
          <div class="p-3 rounded-lg bg-blue-50 dark:bg-blue-950 border border-blue-200 dark:border-blue-800">
            <p class="text-sm text-blue-700 dark:text-blue-300 font-medium mb-1">Шаг 1: Авторизуйтесь в VK</p>
            <p class="text-xs text-blue-600 dark:text-blue-400">Окно VK должно было открыться. Если нет —
              <a :href="authUrl" target="_blank" class="underline">нажмите здесь</a>
            </p>
          </div>

          <div>
            <p class="text-sm font-medium mb-2">Шаг 2: Скопируйте <code class="bg-gray-100 dark:bg-gray-800 px-1 rounded">code</code> из URL</p>
            <input v-model="codeInput" placeholder="vk2.a.xxx..."
              class="w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 text-sm font-mono text-xs" />
          </div>

          <div>
            <p class="text-sm font-medium mb-2">Шаг 3: Скопируйте <code class="bg-gray-100 dark:bg-gray-800 px-1 rounded">device_id</code> из URL</p>
            <input v-model="deviceIdInput" placeholder="UgxNual..."
              class="w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 text-sm font-mono text-xs" />
          </div>

          <div class="flex gap-2">
            <button @click="authUrl = ''" class="px-4 py-2 rounded-lg text-sm text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-800">
              Отмена
            </button>
            <button @click="exchangeCode" :disabled="exchanging || !codeInput.trim() || !deviceIdInput.trim()"
              class="flex items-center gap-2 px-4 py-2 rounded-lg bg-green-600 hover:bg-green-700 text-white text-sm font-medium disabled:opacity-50">
              <Loader2 v-if="exchanging" :size="16" class="animate-spin" />
              <CheckCircle v-else :size="16" />
              {{ exchanging ? 'Обмен...' : 'Получить токен' }}
            </button>
          </div>
        </div>
      </div>
    </template>
  </div>
</template>
