<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { http } from '@/api/client'
import { useBusinessesStore } from '@/stores/businesses'
import { useToast } from '@/composables/useToast'
import { accountTypeLabel } from '@/composables/usePlatform'
import {
  Plus, Trash2, Loader2, CheckCircle, XCircle, RefreshCw,
  Radio, Link, ExternalLink, Eye, EyeOff, ChevronDown, ChevronUp,
  Save, Pencil
} from 'lucide-vue-next'

interface PlatformAccount {
  id: string
  platform: string
  accountType: string
  accountName: string
  accountId: string
  accessToken: string
  isActive: boolean
}

interface TestResult {
  success: boolean
  name?: string
  photo?: string
  memberCount?: number
  description?: string
  error?: string
}

const businesses = useBusinessesStore()
const toast = useToast()

// Test results per platform ID
const testResults = ref<Record<string, TestResult>>({})
const testing = ref<string | null>(null)

// Add channel form
const showForm = ref(false)
const formBizId = ref('')
const form = ref({
  platform: 'VK' as string,
  accountType: 'GROUP' as string,
  accountName: '',
  accountId: '',
  accessToken: '',
})
const saving = ref(false)
const showToken = ref(false)

// Expand/edit existing channel
const expandedId = ref<string | null>(null)
const editForm = ref<Record<string, any>>({})
const editShowToken = ref(false)
const editSaving = ref(false)

function toggleExpand(pa: PlatformAccount) {
  if (expandedId.value === pa.id) {
    expandedId.value = null
  } else {
    expandedId.value = pa.id
    editShowToken.value = false
    editForm.value = {
      accountName: pa.accountName,
      accountId: pa.accountId,
      accessToken: pa.accessToken,
    }
  }
}

async function saveEdit(paId: string) {
  editSaving.value = true
  try {
    await http.put(`/platforms/${paId}`, editForm.value)
    await businesses.load()
    expandedId.value = null
  } catch (e: any) {
    toast.error(e.message || 'Произошла ошибка')
  } finally {
    editSaving.value = false
  }
}

async function testConnection(pa: PlatformAccount) {
  testing.value = pa.id
  try {
    const result = await http.post<TestResult>(`/platforms/${pa.id}/test`, {})
    testResults.value[pa.id] = result
  } catch (e: any) {
    testResults.value[pa.id] = { success: false, error: e.message || 'Ошибка' }
  } finally {
    testing.value = null
  }
}

function openAddForm(bizId: string) {
  formBizId.value = bizId
  form.value = { platform: 'VK', accountType: 'GROUP', accountName: '', accountId: '', accessToken: '' }
  showForm.value = true
  showToken.value = false
}

function updateAccountType() {
  if (form.value.platform === 'VK') form.value.accountType = 'GROUP'
  else if (form.value.platform === 'TELEGRAM') form.value.accountType = 'CHANNEL'
}

async function addChannel() {
  if (!form.value.accountName || !form.value.accessToken) return
  saving.value = true
  try {
    await http.post(`/businesses/${formBizId.value}/platforms`, form.value)
    showForm.value = false
    await businesses.load()
  } catch (e: any) {
    toast.error(e.message || 'Произошла ошибка')
  } finally {
    saving.value = false
  }
}

async function deleteChannel(id: string) {
  if (!confirm('Отключить канал?')) return
  try {
    await http.delete(`/platforms/${id}`)
    await businesses.load()
  } catch (e: any) {
    toast.error(e.message || 'Произошла ошибка')
  }
}

function platformBadge(platform: string) {
  const map: Record<string, { label: string; class: string }> = {
    VK: { label: 'VK', class: 'bg-blue-500 text-white' },
    TELEGRAM: { label: 'TG', class: 'bg-sky-500 text-white' },
    INSTAGRAM: { label: 'IG', class: 'bg-gradient-to-r from-purple-500 to-pink-500 text-white' },
  }
  return map[platform] || { label: platform, class: 'bg-gray-500 text-white' }
}


onMounted(() => {
  if (!businesses.businesses.length) businesses.load()
})
</script>

<template>
  <div class="space-y-6">
    <p class="text-sm text-gray-500">
      Подключите соцсети для мультипостинга. Один пост — публикация сразу в несколько каналов.
    </p>

    <!-- Per-business sections -->
    <div
      v-for="biz in businesses.businesses"
      :key="biz.id"
      class="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800"
    >
      <div class="px-5 py-4 border-b border-gray-100 dark:border-gray-800 flex items-center justify-between">
        <h3 class="font-semibold flex items-center gap-2">
          <Radio :size="18" class="text-brand-500" />
          {{ biz.name }}
        </h3>
        <span class="text-xs text-gray-400">
          {{ biz.platformAccounts?.length || 0 }} {{ (biz.platformAccounts?.length || 0) === 1 ? 'канал' : 'каналов' }}
        </span>
      </div>

      <div class="p-5">
        <!-- Channel cards -->
        <div v-if="biz.platformAccounts?.length" class="space-y-3 mb-4">
          <div
            v-for="pa in biz.platformAccounts"
            :key="pa.id"
            :class="['rounded-lg bg-gray-50 dark:bg-gray-800 overflow-hidden transition-all', expandedId === pa.id ? 'ring-2 ring-brand-400' : '']"
          >
            <!-- Header row (clickable) -->
            <div
              class="flex items-center gap-4 p-4 cursor-pointer hover:bg-gray-100 dark:hover:bg-gray-700/50 transition-colors"
              @click="toggleExpand(pa as any)"
            >
              <!-- Platform badge -->
              <span :class="['w-10 h-10 rounded-lg flex items-center justify-center text-xs font-bold shrink-0', platformBadge(pa.platform).class]">
                {{ platformBadge(pa.platform).label }}
              </span>

              <!-- Info -->
              <div class="flex-1 min-w-0">
                <div class="flex items-center gap-2">
                  <span class="font-medium text-sm">{{ pa.accountName }}</span>
                  <span class="text-[10px] px-1.5 py-0.5 rounded bg-gray-200 dark:bg-gray-700 text-gray-600 dark:text-gray-400">
                    {{ accountTypeLabel((pa as any).accountType || 'GROUP') }}
                  </span>
                </div>
                <div class="text-xs text-gray-400 mt-0.5">
                  ID: {{ pa.accountId }}
                </div>

                <!-- Test result (compact, in header) -->
                <div v-if="testResults[pa.id]" class="mt-1">
                  <div v-if="testResults[pa.id].success" class="flex items-center gap-1.5 text-xs text-green-600 dark:text-green-400">
                    <CheckCircle :size="12" />
                    <span class="font-medium">{{ testResults[pa.id].name }}</span>
                    <span v-if="testResults[pa.id].memberCount" class="text-gray-400">({{ testResults[pa.id].memberCount }})</span>
                  </div>
                  <div v-else class="flex items-center gap-1 text-xs text-red-500">
                    <XCircle :size="12" />
                    {{ testResults[pa.id].error }}
                  </div>
                </div>
              </div>

              <!-- Expand indicator -->
              <ChevronUp v-if="expandedId === pa.id" :size="18" class="text-gray-400 shrink-0" />
              <ChevronDown v-else :size="18" class="text-gray-400 shrink-0" />
            </div>

            <!-- Expanded: edit form -->
            <div v-if="expandedId === pa.id" class="px-4 pb-4 pt-0 border-t border-gray-200 dark:border-gray-700">
              <div class="pt-4 space-y-3">
                <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label class="block text-xs font-medium text-gray-500 mb-1">Название</label>
                    <input
                      v-model="editForm.accountName"
                      class="w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 focus:ring-2 focus:ring-brand-500 text-sm"
                    />
                  </div>
                  <div>
                    <label class="block text-xs font-medium text-gray-500 mb-1">
                      {{ pa.platform === 'VK' ? 'ID группы' : 'Chat ID' }}
                    </label>
                    <input
                      v-model="editForm.accountId"
                      class="w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 focus:ring-2 focus:ring-brand-500 text-sm font-mono"
                    />
                  </div>
                </div>

                <div>
                  <label class="block text-xs font-medium text-gray-500 mb-1">
                    {{ pa.platform === 'VK' ? 'Community Token' : 'Bot Token' }}
                  </label>
                  <div class="relative">
                    <input
                      v-model="editForm.accessToken"
                      :type="editShowToken ? 'text' : 'password'"
                      class="w-full px-3 py-2 pr-10 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 focus:ring-2 focus:ring-brand-500 text-sm font-mono"
                    />
                    <button
                      @click="editShowToken = !editShowToken"
                      class="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-gray-400 hover:text-gray-600"
                    >
                      <EyeOff v-if="editShowToken" :size="16" />
                      <Eye v-else :size="16" />
                    </button>
                  </div>
                </div>

                <!-- Actions row -->
                <div class="flex items-center justify-between pt-1">
                  <div class="flex items-center gap-2">
                    <button
                      @click.stop="testConnection(pa as any)"
                      :disabled="testing === pa.id"
                      class="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium text-gray-600 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-gray-600 transition-colors"
                    >
                      <Loader2 v-if="testing === pa.id" :size="14" class="animate-spin" />
                      <RefreshCw v-else :size="14" />
                      Тест
                    </button>
                    <button
                      @click.stop="deleteChannel(pa.id)"
                      class="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium text-red-500 hover:bg-red-50 dark:hover:bg-red-950 transition-colors"
                    >
                      <Trash2 :size="14" />
                      Отключить
                    </button>
                  </div>
                  <button
                    @click.stop="saveEdit(pa.id)"
                    :disabled="editSaving"
                    class="flex items-center gap-1.5 px-4 py-1.5 rounded-lg bg-brand-600 hover:bg-brand-700 text-white text-xs font-medium disabled:opacity-50"
                  >
                    <Loader2 v-if="editSaving" :size="14" class="animate-spin" />
                    <Save v-else :size="14" />
                    Сохранить
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>

        <div v-else class="text-sm text-gray-400 text-center py-3 mb-3">
          Нет подключённых каналов
        </div>

        <!-- Add channel button -->
        <button
          @click="openAddForm(biz.id)"
          class="w-full flex items-center justify-center gap-2 px-3 py-2.5 rounded-lg border-2 border-dashed border-gray-300 dark:border-gray-700 text-sm text-gray-500 hover:border-brand-400 hover:text-brand-600 transition-colors"
        >
          <Plus :size="16" />
          Подключить канал
        </button>
      </div>
    </div>

    <!-- Add channel modal -->
    <div v-if="showForm" class="fixed inset-0 z-50 flex items-center justify-center bg-black/50" @click.self="showForm = false">
      <div class="bg-white dark:bg-gray-900 rounded-2xl p-6 w-full max-w-md shadow-xl">
        <h2 class="text-lg font-bold mb-4 flex items-center gap-2">
          <Link :size="20" class="text-brand-500" />
          Подключить канал
        </h2>

        <div class="space-y-3">
          <!-- Platform select -->
          <div>
            <label class="block text-sm font-medium mb-1">Платформа</label>
            <div class="flex gap-2">
              <button
                v-for="p in ['VK', 'TELEGRAM']"
                :key="p"
                @click="form.platform = p; updateAccountType()"
                :class="[
                  'flex-1 py-2.5 rounded-lg text-sm font-medium transition-all border-2',
                  form.platform === p
                    ? 'border-brand-500 bg-brand-50 dark:bg-brand-950 text-brand-700 dark:text-brand-300'
                    : 'border-gray-200 dark:border-gray-700 text-gray-500 hover:border-gray-300'
                ]"
              >
                {{ p === 'VK' ? 'ВКонтакте' : 'Telegram' }}
              </button>
              <button
                disabled
                class="flex-1 py-2.5 rounded-lg text-sm font-medium border-2 border-gray-200 dark:border-gray-700 text-gray-300 dark:text-gray-600 cursor-not-allowed"
              >
                Instagram <span class="text-[10px]">скоро</span>
              </button>
            </div>
          </div>

          <!-- VK: account type -->
          <div v-if="form.platform === 'VK'">
            <label class="block text-sm font-medium mb-1">Тип аккаунта</label>
            <select
              v-model="form.accountType"
              class="w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 text-sm"
            >
              <option value="GROUP">Сообщество (группа)</option>
              <option value="PERSONAL" disabled>Личная страница (скоро)</option>
            </select>
          </div>

          <!-- Name -->
          <div>
            <label class="block text-sm font-medium mb-1">Название</label>
            <input
              v-model="form.accountName"
              :placeholder="form.platform === 'VK' ? 'SUP клуб НаWоде' : 'Мой TG канал'"
              class="w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 focus:ring-2 focus:ring-brand-500 text-sm"
            />
          </div>

          <!-- Account ID -->
          <div>
            <label class="block text-sm font-medium mb-1">
              {{ form.platform === 'VK' ? 'ID группы (число из URL)' : 'Chat ID (@channel или число)' }}
            </label>
            <input
              v-model="form.accountId"
              :placeholder="form.platform === 'VK' ? '150371202' : '@mychannel или -100xxx'"
              class="w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 focus:ring-2 focus:ring-brand-500 text-sm font-mono"
            />
            <p v-if="form.platform === 'VK'" class="text-xs text-gray-400 mt-1">
              Найдите в URL: vk.com/club<strong>150371202</strong> → 150371202
            </p>
          </div>

          <!-- Token -->
          <div>
            <label class="block text-sm font-medium mb-1">
              {{ form.platform === 'VK' ? 'Community Token (ключ доступа)' : 'Bot Token (от @BotFather)' }}
            </label>
            <div class="relative">
              <input
                v-model="form.accessToken"
                :type="showToken ? 'text' : 'password'"
                :placeholder="form.platform === 'VK' ? 'vk1.a.xxx...' : '123456:ABCdef...'"
                class="w-full px-3 py-2 pr-10 rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 focus:ring-2 focus:ring-brand-500 text-sm font-mono"
              />
              <button
                @click="showToken = !showToken"
                class="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-gray-400 hover:text-gray-600"
              >
                <EyeOff v-if="showToken" :size="16" />
                <Eye v-else :size="16" />
              </button>
            </div>
            <p v-if="form.platform === 'VK'" class="text-xs text-gray-400 mt-1">
              Управление → Работа с API → Создать ключ (разрешить доступ к стене)
            </p>
            <p v-else class="text-xs text-gray-400 mt-1">
              Создайте бота в @BotFather и добавьте его как админа канала
            </p>
          </div>
        </div>

        <div class="flex justify-end gap-2 mt-5">
          <button @click="showForm = false" class="px-4 py-2 rounded-lg text-sm text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800">
            Отмена
          </button>
          <button
            @click="addChannel"
            :disabled="saving || !form.accountName || !form.accessToken || !form.accountId"
            class="flex items-center gap-2 px-4 py-2 rounded-lg bg-brand-600 hover:bg-brand-700 text-white text-sm font-medium disabled:opacity-50"
          >
            <Loader2 v-if="saving" :size="16" class="animate-spin" />
            <Link v-else :size="16" />
            {{ saving ? 'Подключение...' : 'Подключить' }}
          </button>
        </div>
      </div>
    </div>
  </div>
</template>
