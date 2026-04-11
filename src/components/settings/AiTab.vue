<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { http } from '@/api/client'
import { useToast } from '@/composables/useToast'
import { Sparkles, Key, Save, Loader2, CheckCircle, Eye, EyeOff, BarChart3, Cpu, Sliders } from 'lucide-vue-next'

const toast = useToast()
const apiKey = ref('')
const maskedKey = ref('')
const hasKey = ref(false)
const showKey = ref(false)
const saving = ref(false)
const saved = ref(false)
const loading = ref(true)

async function loadConfig() {
  loading.value = true
  try {
    const config = await http.get<Record<string, string>>('/settings/config')
    maskedKey.value = config.openrouter_api_key || ''
    hasKey.value = !!maskedKey.value
  } catch (e) {
    toast.error('Ошибка загрузки настроек AI')
  } finally {
    loading.value = false
  }
}

async function saveApiKey() {
  if (!apiKey.value.trim()) return
  saving.value = true
  saved.value = false
  try {
    await http.put('/settings/config', {
      key: 'openrouter_api_key',
      value: apiKey.value.trim(),
    })
    saved.value = true
    hasKey.value = true
    maskedKey.value = `${apiKey.value.slice(0, 10)}...${apiKey.value.slice(-4)}`
    apiKey.value = ''
    setTimeout(() => { saved.value = false }, 3000)
  } catch (e: any) {
    toast.error(e.message || 'Произошла ошибка')
  } finally {
    saving.value = false
  }
}

onMounted(loadConfig)
</script>

<template>
  <div class="space-y-6">
    <!-- API Key -->
    <div class="bg-white dark:bg-gray-900 rounded-xl p-6 border border-gray-200 dark:border-gray-800">
      <h2 class="font-semibold mb-4 flex items-center gap-2">
        <Key :size="18" class="text-purple-500" />
        OpenRouter API Key
      </h2>

      <div v-if="loading" class="text-sm text-gray-400">Загрузка...</div>

      <div v-else>
        <!-- Current key status -->
        <div v-if="hasKey" class="flex items-center gap-2 mb-4 p-3 rounded-lg bg-green-50 dark:bg-green-950 border border-green-200 dark:border-green-800">
          <CheckCircle :size="16" class="text-green-600 shrink-0" />
          <div>
            <div class="text-sm font-medium text-green-700 dark:text-green-300">Ключ установлен</div>
            <div class="text-xs text-green-600 dark:text-green-400 font-mono">{{ maskedKey }}</div>
          </div>
        </div>

        <div v-else class="mb-4 p-3 rounded-lg bg-amber-50 dark:bg-amber-950 border border-amber-200 dark:border-amber-800">
          <div class="text-sm font-medium text-amber-700 dark:text-amber-300">Ключ не установлен</div>
          <div class="text-xs text-amber-600 dark:text-amber-400">AI-генерация не будет работать без API ключа</div>
        </div>

        <!-- Input for new/updated key -->
        <div class="space-y-3">
          <div>
            <label class="block text-sm font-medium mb-1">
              {{ hasKey ? 'Заменить ключ' : 'Вставьте API Key' }}
            </label>
            <div class="relative">
              <input
                v-model="apiKey"
                :type="showKey ? 'text' : 'password'"
                placeholder="sk-or-v1-..."
                class="w-full px-3 py-2 pr-10 rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 focus:ring-2 focus:ring-purple-500 text-sm font-mono"
              />
              <button
                @click="showKey = !showKey"
                class="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-gray-400 hover:text-gray-600"
              >
                <EyeOff v-if="showKey" :size="16" />
                <Eye v-else :size="16" />
              </button>
            </div>
            <p class="text-xs text-gray-400 mt-1">
              Получить на <a href="https://openrouter.ai/keys" target="_blank" class="text-purple-500 hover:underline">openrouter.ai/keys</a>
            </p>
          </div>

          <div class="flex items-center gap-2">
            <button
              @click="saveApiKey"
              :disabled="saving || !apiKey.trim()"
              class="flex items-center gap-2 px-4 py-2 rounded-lg bg-purple-600 hover:bg-purple-700 text-white text-sm font-medium disabled:opacity-50"
            >
              <Loader2 v-if="saving" :size="16" class="animate-spin" />
              <Save v-else :size="16" />
              {{ saving ? 'Сохранение...' : 'Сохранить' }}
            </button>
            <span v-if="saved" class="flex items-center gap-1 text-xs text-green-600">
              <CheckCircle :size="14" />
              Сохранено!
            </span>
          </div>
        </div>
      </div>
    </div>

    <!-- Future features -->
    <div class="bg-white dark:bg-gray-900 rounded-xl p-6 border border-gray-200 dark:border-gray-800">
      <h2 class="font-semibold mb-4 flex items-center gap-2">
        <Sparkles :size="18" class="text-gray-400" />
        Скоро
      </h2>
      <div class="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div class="p-4 rounded-lg bg-gray-50 dark:bg-gray-800 text-center">
          <Cpu :size="24" class="mx-auto text-gray-400 mb-2" />
          <div class="text-sm font-medium">Выбор моделей</div>
          <div class="text-xs text-gray-400 mt-1">Sonnet / Haiku / Flux</div>
        </div>
        <div class="p-4 rounded-lg bg-gray-50 dark:bg-gray-800 text-center">
          <BarChart3 :size="24" class="mx-auto text-gray-400 mb-2" />
          <div class="text-sm font-medium">Статистика</div>
          <div class="text-xs text-gray-400 mt-1">Токены, стоимость</div>
        </div>
        <div class="p-4 rounded-lg bg-gray-50 dark:bg-gray-800 text-center">
          <Sliders :size="24" class="mx-auto text-gray-400 mb-2" />
          <div class="text-sm font-medium">Промпт-шаблоны</div>
          <div class="text-xs text-gray-400 mt-1">Настройка генерации</div>
        </div>
      </div>
    </div>
  </div>
</template>
