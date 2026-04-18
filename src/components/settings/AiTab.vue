<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { http } from '@/api/client'
import { useToast } from '@/composables/useToast'
import { useRates } from '@/composables/useRates'
import { Sparkles, Key, Save, Loader2, CheckCircle, Eye, EyeOff, BarChart3, Cpu, Sliders, Percent, Mic, Video, DollarSign } from 'lucide-vue-next'

const toast = useToast()
const { USD_RUB } = useRates()
const apiKey = ref('')
const maskedKey = ref('')
const hasKey = ref(false)
const showKey = ref(false)
const saving = ref(false)
const saved = ref(false)
const loading = ref(true)
const markupPercent = ref(50)
const savingMarkup = ref(false)
const savedMarkup = ref(false)

// USD/RUB rate
const usdRubRate = ref(95)
const savingRate = ref(false)
const savedRate = ref(false)

// OpenAI (Whisper)
const openaiKey = ref('')
const openaiMaskedKey = ref('')
const hasOpenaiKey = ref(false)
const showOpenaiKey = ref(false)
const savingOpenai = ref(false)
const savedOpenai = ref(false)

// KIE.ai
const kieKey = ref('')
const kieMaskedKey = ref('')
const hasKieKey = ref(false)
const showKieKey = ref(false)
const savingKie = ref(false)
const savedKie = ref(false)

async function loadConfig() {
  loading.value = true
  try {
    const config = await http.get<Record<string, string>>('/settings/config')
    maskedKey.value = config.openrouter_api_key || ''
    hasKey.value = !!maskedKey.value
    openaiMaskedKey.value = config.openai_api_key || ''
    hasOpenaiKey.value = !!openaiMaskedKey.value
    kieMaskedKey.value = config.kie_api_key || ''
    hasKieKey.value = !!kieMaskedKey.value
    if (config.ai_markup_percent) markupPercent.value = parseFloat(config.ai_markup_percent) || 50
    if (config.usd_rub_rate) usdRubRate.value = parseFloat(config.usd_rub_rate) || 95
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

async function saveOpenaiKey() {
  if (!openaiKey.value.trim()) return
  savingOpenai.value = true
  savedOpenai.value = false
  try {
    await http.put('/settings/config', {
      key: 'openai_api_key',
      value: openaiKey.value.trim(),
    })
    savedOpenai.value = true
    hasOpenaiKey.value = true
    openaiMaskedKey.value = `${openaiKey.value.slice(0, 10)}...${openaiKey.value.slice(-4)}`
    openaiKey.value = ''
    setTimeout(() => { savedOpenai.value = false }, 3000)
  } catch (e: any) {
    toast.error(e.message || 'Произошла ошибка')
  } finally {
    savingOpenai.value = false
  }
}

async function saveKieKey() {
  if (!kieKey.value.trim()) return
  savingKie.value = true
  savedKie.value = false
  try {
    await http.put('/settings/config', {
      key: 'kie_api_key',
      value: kieKey.value.trim(),
    })
    savedKie.value = true
    hasKieKey.value = true
    kieMaskedKey.value = `${kieKey.value.slice(0, 10)}...${kieKey.value.slice(-4)}`
    kieKey.value = ''
    setTimeout(() => { savedKie.value = false }, 3000)
  } catch (e: any) {
    toast.error(e.message || 'Произошла ошибка')
  } finally {
    savingKie.value = false
  }
}

async function saveRate() {
  savingRate.value = true
  savedRate.value = false
  try {
    await http.put('/settings/config', { key: 'usd_rub_rate', value: String(usdRubRate.value) })
    savedRate.value = true
    setTimeout(() => { savedRate.value = false }, 3000)
  } catch (e: any) {
    toast.error(e.message || 'Ошибка')
  } finally {
    savingRate.value = false
  }
}

async function saveMarkup() {
  savingMarkup.value = true
  savedMarkup.value = false
  try {
    await http.put('/settings/config', { key: 'ai_markup_percent', value: String(markupPercent.value) })
    savedMarkup.value = true
    setTimeout(() => { savedMarkup.value = false }, 3000)
  } catch (e: any) {
    toast.error(e.message || 'Ошибка')
  } finally {
    savingMarkup.value = false
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

    <!-- OpenAI API Key (Whisper) -->
    <div class="bg-white dark:bg-gray-900 rounded-xl p-6 border border-gray-200 dark:border-gray-800">
      <h2 class="font-semibold mb-4 flex items-center gap-2">
        <Mic :size="18" class="text-blue-500" />
        OpenAI API Key
        <span class="text-xs font-normal text-gray-400">(Whisper — голосовой ввод)</span>
      </h2>

      <div v-if="loading" class="text-sm text-gray-400">Загрузка...</div>

      <div v-else>
        <div v-if="hasOpenaiKey" class="flex items-center gap-2 mb-4 p-3 rounded-lg bg-green-50 dark:bg-green-950 border border-green-200 dark:border-green-800">
          <CheckCircle :size="16" class="text-green-600 shrink-0" />
          <div>
            <div class="text-sm font-medium text-green-700 dark:text-green-300">Ключ установлен — голосовой ввод активен</div>
            <div class="text-xs text-green-600 dark:text-green-400 font-mono">{{ openaiMaskedKey }}</div>
          </div>
        </div>

        <div v-else class="mb-4 p-3 rounded-lg bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700">
          <div class="text-sm font-medium text-gray-500">Ключ не установлен</div>
          <div class="text-xs text-gray-400">Голосовой ввод в студиях будет недоступен</div>
        </div>

        <div class="space-y-3">
          <div>
            <label class="block text-sm font-medium mb-1">
              {{ hasOpenaiKey ? 'Заменить ключ' : 'Вставьте API Key' }}
            </label>
            <div class="relative">
              <input
                v-model="openaiKey"
                :type="showOpenaiKey ? 'text' : 'password'"
                placeholder="sk-proj-..."
                class="w-full px-3 py-2 pr-10 rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 focus:ring-2 focus:ring-blue-500 text-sm font-mono"
              />
              <button
                @click="showOpenaiKey = !showOpenaiKey"
                class="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-gray-400 hover:text-gray-600"
              >
                <EyeOff v-if="showOpenaiKey" :size="16" />
                <Eye v-else :size="16" />
              </button>
            </div>
            <p class="text-xs text-gray-400 mt-1">
              Получить на <a href="https://platform.openai.com/api-keys" target="_blank" class="text-blue-500 hover:underline">platform.openai.com/api-keys</a>.
              Стоимость: ~$0.006/мин (~0.6 ₽/мин)
            </p>
          </div>

          <div class="flex items-center gap-2">
            <button
              @click="saveOpenaiKey"
              :disabled="savingOpenai || !openaiKey.trim()"
              class="flex items-center gap-2 px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium disabled:opacity-50"
            >
              <Loader2 v-if="savingOpenai" :size="16" class="animate-spin" />
              <Save v-else :size="16" />
              {{ savingOpenai ? 'Сохранение...' : 'Сохранить' }}
            </button>
            <span v-if="savedOpenai" class="flex items-center gap-1 text-xs text-green-600">
              <CheckCircle :size="14" />
              Сохранено!
            </span>
          </div>
        </div>
      </div>
    </div>

    <!-- KIE.ai API Key -->
    <div class="bg-white dark:bg-gray-900 rounded-xl p-6 border border-gray-200 dark:border-gray-800">
      <h2 class="font-semibold mb-4 flex items-center gap-2">
        <Video :size="18" class="text-orange-500" />
        KIE.ai API Key
        <span class="text-xs font-normal text-gray-400">(картинки, видео, музыка)</span>
      </h2>

      <div v-if="loading" class="text-sm text-gray-400">Загрузка...</div>

      <div v-else>
        <div v-if="hasKieKey" class="flex items-center gap-2 mb-4 p-3 rounded-lg bg-green-50 dark:bg-green-950 border border-green-200 dark:border-green-800">
          <CheckCircle :size="16" class="text-green-600 shrink-0" />
          <div>
            <div class="text-sm font-medium text-green-700 dark:text-green-300">Ключ установлен</div>
            <div class="text-xs text-green-600 dark:text-green-400 font-mono">{{ kieMaskedKey }}</div>
          </div>
        </div>

        <div v-else class="mb-4 p-3 rounded-lg bg-amber-50 dark:bg-amber-950 border border-amber-200 dark:border-amber-800">
          <div class="text-sm font-medium text-amber-700 dark:text-amber-300">Ключ не установлен</div>
          <div class="text-xs text-amber-600 dark:text-amber-400">Генерация картинок, видео и музыки не будет работать</div>
        </div>

        <div class="space-y-3">
          <div>
            <label class="block text-sm font-medium mb-1">
              {{ hasKieKey ? 'Заменить ключ' : 'Вставьте API Key' }}
            </label>
            <div class="relative">
              <input
                v-model="kieKey"
                :type="showKieKey ? 'text' : 'password'"
                placeholder="kie-..."
                class="w-full px-3 py-2 pr-10 rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 focus:ring-2 focus:ring-orange-500 text-sm font-mono"
              />
              <button
                @click="showKieKey = !showKieKey"
                class="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-gray-400 hover:text-gray-600"
              >
                <EyeOff v-if="showKieKey" :size="16" />
                <Eye v-else :size="16" />
              </button>
            </div>
            <p class="text-xs text-gray-400 mt-1">
              Получить на <a href="https://kie.ai" target="_blank" class="text-orange-500 hover:underline">kie.ai</a>.
              Nano Banana (картинки), Seedance (видео), Suno (музыка)
            </p>
          </div>

          <div class="flex items-center gap-2">
            <button
              @click="saveKieKey"
              :disabled="savingKie || !kieKey.trim()"
              class="flex items-center gap-2 px-4 py-2 rounded-lg bg-orange-600 hover:bg-orange-700 text-white text-sm font-medium disabled:opacity-50"
            >
              <Loader2 v-if="savingKie" :size="16" class="animate-spin" />
              <Save v-else :size="16" />
              {{ savingKie ? 'Сохранение...' : 'Сохранить' }}
            </button>
            <span v-if="savedKie" class="flex items-center gap-1 text-xs text-green-600">
              <CheckCircle :size="14" />
              Сохранено!
            </span>
          </div>
        </div>
      </div>
    </div>

    <!-- Markup -->
    <div class="bg-white dark:bg-gray-900 rounded-xl p-6 border border-gray-200 dark:border-gray-800">
      <h2 class="font-semibold mb-4 flex items-center gap-2">
        <Percent :size="18" class="text-green-500" />
        Наценка на AI-генерации
      </h2>
      <p class="text-sm text-gray-500 mb-4">Наценка добавляется к себестоимости AI-вызова. Пользователи видят цену с наценкой, вы — себестоимость + профит в AI Логах.</p>
      <div class="flex items-center gap-3">
        <div class="relative">
          <input
            v-model.number="markupPercent"
            type="number"
            min="0"
            max="500"
            step="5"
            class="w-24 px-3 py-2 pr-8 rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 text-sm font-mono"
          />
          <span class="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 text-sm">%</span>
        </div>
        <button
          @click="saveMarkup"
          :disabled="savingMarkup"
          class="flex items-center gap-2 px-4 py-2 rounded-lg bg-green-600 hover:bg-green-700 text-white text-sm font-medium disabled:opacity-50"
        >
          <Loader2 v-if="savingMarkup" :size="16" class="animate-spin" />
          <Save v-else :size="16" />
          Сохранить
        </button>
        <span v-if="savedMarkup" class="flex items-center gap-1 text-xs text-green-600">
          <CheckCircle :size="14" /> Сохранено!
        </span>
      </div>
      <div class="mt-3 text-xs text-gray-400">
        Пример: себестоимость $0.06 × наценка {{ markupPercent }}% = пользователь платит {{ (0.06 * USD_RUB * (1 + markupPercent / 100)).toFixed(2) }} ₽
      </div>
    </div>
    <!-- USD/RUB Rate -->
    <div class="bg-white dark:bg-gray-900 rounded-xl p-6 border border-gray-200 dark:border-gray-800">
      <h2 class="font-semibold mb-4 flex items-center gap-2">
        <DollarSign :size="18" class="text-indigo-500" />
        Курс USD/RUB
      </h2>
      <p class="text-sm text-gray-500 mb-4">Используется для пересчёта стоимости AI-вызовов в рубли. Обновляйте периодически вручную.</p>
      <div class="flex items-center gap-3">
        <div class="flex items-center gap-2">
          <span class="text-sm text-gray-500">$1 =</span>
          <input
            v-model.number="usdRubRate"
            type="number"
            min="1"
            max="999"
            step="0.5"
            class="w-24 px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 text-sm font-mono"
          />
          <span class="text-sm text-gray-500">₽</span>
        </div>
        <button
          @click="saveRate"
          :disabled="savingRate"
          class="flex items-center gap-2 px-4 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-medium disabled:opacity-50"
        >
          <Loader2 v-if="savingRate" :size="16" class="animate-spin" />
          <Save v-else :size="16" />
          Сохранить
        </button>
        <span v-if="savedRate" class="flex items-center gap-1 text-xs text-green-600">
          <CheckCircle :size="14" /> Сохранено!
        </span>
      </div>
    </div>
  </div>
</template>
