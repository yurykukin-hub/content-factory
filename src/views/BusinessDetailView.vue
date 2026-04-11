<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { http } from '@/api/client'
import { useAuthStore } from '@/stores/auth'
import { useToast } from '@/composables/useToast'
import { platformBgColor, platformLabel, accountTypeLabel } from '@/composables/usePlatform'
import {
  ArrowLeft, Building2, Save, Loader2, Megaphone, Users, MessageSquare,
  Hash, Plus, Trash2, RefreshCw, CheckCircle, XCircle, Link,
  Eye, EyeOff, ChevronDown, ChevronUp, Radio, FileText, ClipboardList,
  Ban
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

interface BrandProfile {
  id: string
  tone: string
  targetAudience: string
  brandVoice: string
  hashtags: string[]
  keyTopics: string[]
  doNotMention: string[]
  postsPerWeek: number
}

interface BusinessDetail {
  id: string
  slug: string
  name: string
  description?: string
  isActive: boolean
  brandProfile?: BrandProfile
  platformAccounts?: PlatformAccount[]
  _count?: { posts: number; contentPlans: number }
}

interface TestResult {
  success: boolean
  name?: string
  photo?: string
  memberCount?: number
  description?: string
  error?: string
}

const route = useRoute()
const router = useRouter()
const auth = useAuthStore()
const toast = useToast()

const isAdmin = computed(() => auth.user?.role === 'ADMIN')
const bizId = computed(() => route.params.id as string)

// Data
const business = ref<BusinessDetail | null>(null)
const loading = ref(true)

// Tabs
const activeTab = ref<'brand' | 'channels' | 'overview'>('brand')

// Brand profile form
const profileForm = ref<Record<string, any>>({})
const savingProfile = ref(false)

// Channels: test
const testResults = ref<Record<string, TestResult>>({})
const testing = ref<string | null>(null)

// Channels: add form
const showAddForm = ref(false)
const addForm = ref({
  platform: 'VK' as string,
  accountType: 'GROUP' as string,
  accountName: '',
  accountId: '',
  accessToken: '',
})
const addSaving = ref(false)
const addShowToken = ref(false)

// Channels: expand/edit
const expandedChannelId = ref<string | null>(null)
const editForm = ref<Record<string, any>>({})
const editShowToken = ref(false)
const editSaving = ref(false)

async function loadBusiness() {
  loading.value = true
  try {
    business.value = await http.get<BusinessDetail>(`/businesses/${bizId.value}`)
    initProfileForm()
  } catch (e: any) {
    toast.error(e.message || 'Не удалось загрузить бизнес')
    router.push('/businesses')
  } finally {
    loading.value = false
  }
}

function initProfileForm() {
  if (!business.value) return
  const bp = business.value.brandProfile
  profileForm.value = {
    tone: bp?.tone || '',
    targetAudience: bp?.targetAudience || '',
    brandVoice: bp?.brandVoice || '',
    hashtags: (bp?.hashtags || []).join(', '),
    keyTopics: (bp?.keyTopics || []).join(', '),
    doNotMention: (bp?.doNotMention || []).join(', '),
    postsPerWeek: bp?.postsPerWeek || 3,
  }
}

// --- Brand profile ---
async function saveProfile() {
  savingProfile.value = true
  try {
    const data = {
      ...profileForm.value,
      hashtags: profileForm.value.hashtags.split(',').map((h: string) => h.trim()).filter(Boolean),
      keyTopics: profileForm.value.keyTopics.split(',').map((t: string) => t.trim()).filter(Boolean),
      doNotMention: profileForm.value.doNotMention.split(',').map((t: string) => t.trim()).filter(Boolean),
    }
    await http.put(`/businesses/${bizId.value}/brand-profile`, data)
    toast.success('Бренд-профиль сохранён')
    await loadBusiness()
  } catch (e: any) {
    toast.error(e.message || 'Произошла ошибка')
  } finally {
    savingProfile.value = false
  }
}

// --- Channels ---
function toggleChannelExpand(pa: PlatformAccount) {
  if (expandedChannelId.value === pa.id) {
    expandedChannelId.value = null
  } else {
    expandedChannelId.value = pa.id
    editShowToken.value = false
    editForm.value = {
      accountName: pa.accountName,
      accountId: pa.accountId,
      accessToken: pa.accessToken,
    }
  }
}

async function saveChannelEdit(paId: string) {
  editSaving.value = true
  try {
    await http.put(`/platforms/${paId}`, editForm.value)
    expandedChannelId.value = null
    toast.success('Канал обновлён')
    await loadBusiness()
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

function openAddForm() {
  addForm.value = { platform: 'VK', accountType: 'GROUP', accountName: '', accountId: '', accessToken: '' }
  showAddForm.value = true
  addShowToken.value = false
}

function updateAccountType() {
  if (addForm.value.platform === 'VK') addForm.value.accountType = 'GROUP'
  else if (addForm.value.platform === 'TELEGRAM') addForm.value.accountType = 'CHANNEL'
}

async function addChannel() {
  if (!addForm.value.accountName || !addForm.value.accessToken) return
  addSaving.value = true
  try {
    await http.post(`/businesses/${bizId.value}/platforms`, addForm.value)
    showAddForm.value = false
    toast.success('Канал подключён')
    await loadBusiness()
  } catch (e: any) {
    toast.error(e.message || 'Произошла ошибка')
  } finally {
    addSaving.value = false
  }
}

async function deleteChannel(id: string) {
  if (!confirm('Отключить канал?')) return
  try {
    await http.delete(`/platforms/${id}`)
    toast.success('Канал отключён')
    await loadBusiness()
  } catch (e: any) {
    toast.error(e.message || 'Произошла ошибка')
  }
}

onMounted(() => {
  loadBusiness()
  // Handle ?tab=channels from external links (e.g. StoryEditor "Настроить каналы")
  const tabQuery = route.query.tab as string | undefined
  if (tabQuery === 'channels') {
    activeTab.value = 'channels'
  }
})
</script>

<template>
  <div>
    <!-- Loading -->
    <div v-if="loading" class="flex items-center justify-center py-20">
      <Loader2 :size="32" class="animate-spin text-brand-500" />
    </div>

    <div v-else-if="business">
      <!-- Back + title -->
      <div class="mb-6">
        <button
          @click="router.push('/businesses')"
          class="flex items-center gap-1.5 text-sm text-gray-500 hover:text-brand-600 dark:hover:text-brand-400 transition-colors mb-3"
        >
          <ArrowLeft :size="16" />
          Назад к списку
        </button>
        <div class="flex items-center gap-3">
          <div class="p-2.5 bg-brand-100 dark:bg-brand-900 rounded-xl">
            <Building2 :size="22" class="text-brand-600 dark:text-brand-400" />
          </div>
          <div>
            <h1 class="text-2xl font-bold">{{ business.name }}</h1>
            <span class="text-sm text-gray-400">{{ business.slug }}</span>
          </div>
        </div>
      </div>

      <!-- Tabs -->
      <div class="flex gap-1 mb-6 bg-gray-100 dark:bg-gray-800 rounded-xl p-1 w-fit">
        <button
          @click="activeTab = 'brand'"
          :class="[
            'flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-medium transition-all',
            activeTab === 'brand'
              ? 'bg-white dark:bg-gray-900 text-brand-600 dark:text-brand-400 shadow-sm'
              : 'text-gray-500 hover:text-gray-700 dark:hover:text-gray-300'
          ]"
        >
          <Megaphone :size="16" />
          Бренд-профиль
        </button>
        <button
          @click="activeTab = 'channels'"
          :class="[
            'flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-medium transition-all',
            activeTab === 'channels'
              ? 'bg-white dark:bg-gray-900 text-brand-600 dark:text-brand-400 shadow-sm'
              : 'text-gray-500 hover:text-gray-700 dark:hover:text-gray-300'
          ]"
        >
          <Radio :size="16" />
          Каналы ({{ business.platformAccounts?.length || 0 }})
        </button>
        <button
          @click="activeTab = 'overview'"
          :class="[
            'flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-medium transition-all',
            activeTab === 'overview'
              ? 'bg-white dark:bg-gray-900 text-brand-600 dark:text-brand-400 shadow-sm'
              : 'text-gray-500 hover:text-gray-700 dark:hover:text-gray-300'
          ]"
        >
          <Building2 :size="16" />
          Обзор
        </button>
      </div>

      <!-- ========== Brand Profile Tab ========== -->
      <div v-if="activeTab === 'brand'" class="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 p-6">
        <p class="text-sm text-gray-500 mb-5">
          Бренд-профиль определяет тон и стиль AI-генерации для этого бизнеса.
        </p>

        <div class="space-y-4">
          <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label class="flex items-center gap-1.5 text-sm font-medium mb-1">
                <Megaphone :size="14" class="text-gray-400" /> Тон коммуникации
              </label>
              <input
                v-model="profileForm.tone"
                placeholder="дружелюбный, профессиональный"
                class="w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 focus:ring-2 focus:ring-brand-500 text-sm"
              />
              <p class="text-[11px] text-gray-400 mt-1">Примеры: дружелюбный, экспертный, ироничный, вдохновляющий, строгий</p>
            </div>
            <div>
              <label class="flex items-center gap-1.5 text-sm font-medium mb-1">
                <Users :size="14" class="text-gray-400" /> Целевая аудитория
              </label>
              <input
                v-model="profileForm.targetAudience"
                placeholder="молодые люди 20-35, Выборг"
                class="w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 focus:ring-2 focus:ring-brand-500 text-sm"
              />
              <p class="text-[11px] text-gray-400 mt-1">Кто читает? Возраст, интересы, география, B2B/B2C</p>
            </div>
          </div>

          <div>
            <label class="flex items-center gap-1.5 text-sm font-medium mb-1">
              <MessageSquare :size="14" class="text-gray-400" /> Стиль бренда (голос)
            </label>
            <textarea
              v-model="profileForm.brandVoice"
              rows="2"
              placeholder="Живой, с юмором, без канцеляризмов. Показываем закулисье..."
              class="w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 focus:ring-2 focus:ring-brand-500 text-sm"
            />
            <p class="text-[11px] text-gray-400 mt-1">Как бренд говорит? Формальный/неформальный, с юмором, экспертно, лично</p>
          </div>

          <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label class="flex items-center gap-1.5 text-sm font-medium mb-1">
                <Hash :size="14" class="text-gray-400" /> Постоянные хештеги
              </label>
              <input
                v-model="profileForm.hashtags"
                placeholder="SUP, Выборг, НаWоде"
                class="w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 focus:ring-2 focus:ring-brand-500 text-sm"
              />
              <p class="text-[11px] text-gray-400 mt-1">Через запятую. Будут добавляться к каждому посту</p>
            </div>
            <div>
              <label class="text-sm font-medium mb-1 block">Ключевые темы</label>
              <input
                v-model="profileForm.keyTopics"
                placeholder="SUP туры, прокат досок, закаты"
                class="w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 focus:ring-2 focus:ring-brand-500 text-sm"
              />
              <p class="text-[11px] text-gray-400 mt-1">О чём писать? AI будет генерить контент на эти темы</p>
            </div>
          </div>

          <div>
            <label class="text-sm font-medium mb-1 block text-red-500/80">
              <Ban :size="14" class="inline -mt-0.5 mr-1" />
              Не упоминать
            </label>
            <input
              v-model="profileForm.doNotMention"
              placeholder="конкуренты, политика, негативные отзывы"
              class="w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 focus:ring-2 focus:ring-brand-500 text-sm"
            />
            <p class="text-[11px] text-gray-400 mt-1">Через запятую. AI не будет упоминать эти темы</p>
          </div>

          <div class="flex items-center justify-between pt-2">
            <div class="flex items-center gap-2">
              <label class="text-sm font-medium">Постов/неделю:</label>
              <input
                v-model.number="profileForm.postsPerWeek"
                type="number"
                min="1"
                max="14"
                class="w-20 px-2 py-1.5 rounded border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 text-sm text-center"
              />
            </div>
            <button
              @click="saveProfile"
              :disabled="savingProfile"
              class="flex items-center gap-2 px-4 py-2 rounded-lg bg-brand-600 hover:bg-brand-700 text-white text-sm font-medium disabled:opacity-50"
            >
              <Loader2 v-if="savingProfile" :size="16" class="animate-spin" />
              <Save v-else :size="16" />
              {{ savingProfile ? 'Сохранение...' : 'Сохранить' }}
            </button>
          </div>
        </div>
      </div>

      <!-- ========== Channels Tab ========== -->
      <div v-if="activeTab === 'channels'" class="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 p-6">
        <p class="text-sm text-gray-500 mb-5">
          {{ isAdmin ? 'Подключите соцсети для мультипостинга. Один пост — публикация сразу в несколько каналов.' : 'Подключённые каналы для мультипостинга.' }}
        </p>

        <!-- Channel cards -->
        <div v-if="business.platformAccounts?.length" class="space-y-3 mb-4">
          <div
            v-for="pa in business.platformAccounts"
            :key="pa.id"
            :class="['rounded-lg bg-gray-50 dark:bg-gray-800 overflow-hidden transition-all', expandedChannelId === pa.id ? 'ring-2 ring-brand-400' : '']"
          >
            <!-- Header row -->
            <div
              :class="['flex items-center gap-4 p-4 transition-colors', isAdmin ? 'cursor-pointer hover:bg-gray-100 dark:hover:bg-gray-700/50' : '']"
              @click="isAdmin && toggleChannelExpand(pa)"
            >
              <!-- Platform badge -->
              <span :class="['w-10 h-10 rounded-lg flex items-center justify-center text-xs font-bold shrink-0 text-white', platformBgColor(pa.platform)]">
                {{ platformLabel(pa.platform) }}
              </span>

              <!-- Info -->
              <div class="flex-1 min-w-0">
                <div class="flex items-center gap-2">
                  <span class="font-medium text-sm">{{ pa.accountName }}</span>
                  <span class="text-[10px] px-1.5 py-0.5 rounded bg-gray-200 dark:bg-gray-700 text-gray-600 dark:text-gray-400">
                    {{ accountTypeLabel(pa.accountType || 'GROUP') }}
                  </span>
                </div>
                <div class="text-xs text-gray-400 mt-0.5">
                  ID: {{ pa.accountId }}
                </div>

                <!-- Test result -->
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

              <!-- Expand indicator (admin only) -->
              <template v-if="isAdmin">
                <ChevronUp v-if="expandedChannelId === pa.id" :size="18" class="text-gray-400 shrink-0" />
                <ChevronDown v-else :size="18" class="text-gray-400 shrink-0" />
              </template>
            </div>

            <!-- Expanded: edit form (admin only) -->
            <div v-if="isAdmin && expandedChannelId === pa.id" class="px-4 pb-4 pt-0 border-t border-gray-200 dark:border-gray-700">
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
                      @click.stop="testConnection(pa)"
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
                    @click.stop="saveChannelEdit(pa.id)"
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

        <div v-else class="text-sm text-gray-400 text-center py-4 mb-4">
          Нет подключённых каналов
        </div>

        <!-- Add channel button (admin only) -->
        <button
          v-if="isAdmin"
          @click="openAddForm"
          class="w-full flex items-center justify-center gap-2 px-3 py-2.5 rounded-lg border-2 border-dashed border-gray-300 dark:border-gray-700 text-sm text-gray-500 hover:border-brand-400 hover:text-brand-600 transition-colors"
        >
          <Plus :size="16" />
          Подключить канал
        </button>
      </div>

      <!-- ========== Overview Tab ========== -->
      <div v-if="activeTab === 'overview'" class="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 p-6">
        <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          <!-- Name -->
          <div class="p-4 rounded-lg bg-gray-50 dark:bg-gray-800">
            <div class="text-xs text-gray-400 mb-1">Название</div>
            <div class="font-semibold">{{ business.name }}</div>
          </div>

          <!-- Slug -->
          <div class="p-4 rounded-lg bg-gray-50 dark:bg-gray-800">
            <div class="text-xs text-gray-400 mb-1">Slug</div>
            <div class="font-mono text-sm">{{ business.slug }}</div>
          </div>

          <!-- Description -->
          <div class="p-4 rounded-lg bg-gray-50 dark:bg-gray-800">
            <div class="text-xs text-gray-400 mb-1">Описание</div>
            <div class="text-sm">{{ business.description || 'Не указано' }}</div>
          </div>

          <!-- Posts count -->
          <div class="p-4 rounded-lg bg-gray-50 dark:bg-gray-800">
            <div class="flex items-center gap-2 text-xs text-gray-400 mb-1">
              <FileText :size="14" />
              Постов
            </div>
            <div class="text-2xl font-bold text-brand-600 dark:text-brand-400">
              {{ business._count?.posts || 0 }}
            </div>
          </div>

          <!-- Plans count -->
          <div class="p-4 rounded-lg bg-gray-50 dark:bg-gray-800">
            <div class="flex items-center gap-2 text-xs text-gray-400 mb-1">
              <ClipboardList :size="14" />
              Контент-планов
            </div>
            <div class="text-2xl font-bold text-brand-600 dark:text-brand-400">
              {{ business._count?.contentPlans || 0 }}
            </div>
          </div>

          <!-- Channels count -->
          <div class="p-4 rounded-lg bg-gray-50 dark:bg-gray-800">
            <div class="flex items-center gap-2 text-xs text-gray-400 mb-1">
              <Radio :size="14" />
              Каналов
            </div>
            <div class="text-2xl font-bold text-brand-600 dark:text-brand-400">
              {{ business.platformAccounts?.length || 0 }}
            </div>
          </div>
        </div>

        <!-- Platform badges -->
        <div v-if="business.platformAccounts?.length" class="mt-5 pt-5 border-t border-gray-200 dark:border-gray-800">
          <div class="text-xs text-gray-400 mb-2">Подключённые каналы</div>
          <div class="flex flex-wrap gap-2">
            <div
              v-for="pa in business.platformAccounts"
              :key="pa.id"
              class="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-gray-50 dark:bg-gray-800"
            >
              <span :class="['w-6 h-6 rounded text-[10px] font-bold text-white flex items-center justify-center', platformBgColor(pa.platform)]">
                {{ platformLabel(pa.platform) }}
              </span>
              <span class="text-sm">{{ pa.accountName }}</span>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- ========== Add Channel Modal ========== -->
    <div v-if="showAddForm" class="fixed inset-0 z-50 flex items-center justify-center bg-black/50" @click.self="showAddForm = false">
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
                @click="addForm.platform = p; updateAccountType()"
                :class="[
                  'flex-1 py-2.5 rounded-lg text-sm font-medium transition-all border-2',
                  addForm.platform === p
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
          <div v-if="addForm.platform === 'VK'">
            <label class="block text-sm font-medium mb-1">Тип аккаунта</label>
            <select
              v-model="addForm.accountType"
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
              v-model="addForm.accountName"
              :placeholder="addForm.platform === 'VK' ? 'SUP клуб НаWоде' : 'Мой TG канал'"
              class="w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 focus:ring-2 focus:ring-brand-500 text-sm"
            />
          </div>

          <!-- Account ID -->
          <div>
            <label class="block text-sm font-medium mb-1">
              {{ addForm.platform === 'VK' ? 'ID группы (число из URL)' : 'Chat ID (@channel или число)' }}
            </label>
            <input
              v-model="addForm.accountId"
              :placeholder="addForm.platform === 'VK' ? '150371202' : '@mychannel или -100xxx'"
              class="w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 focus:ring-2 focus:ring-brand-500 text-sm font-mono"
            />
            <p v-if="addForm.platform === 'VK'" class="text-xs text-gray-400 mt-1">
              Найдите в URL: vk.com/club<strong>150371202</strong> &rarr; 150371202
            </p>
          </div>

          <!-- Token -->
          <div>
            <label class="block text-sm font-medium mb-1">
              {{ addForm.platform === 'VK' ? 'Community Token (ключ доступа)' : 'Bot Token (от @BotFather)' }}
            </label>
            <div class="relative">
              <input
                v-model="addForm.accessToken"
                :type="addShowToken ? 'text' : 'password'"
                :placeholder="addForm.platform === 'VK' ? 'vk1.a.xxx...' : '123456:ABCdef...'"
                class="w-full px-3 py-2 pr-10 rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 focus:ring-2 focus:ring-brand-500 text-sm font-mono"
              />
              <button
                @click="addShowToken = !addShowToken"
                class="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-gray-400 hover:text-gray-600"
              >
                <EyeOff v-if="addShowToken" :size="16" />
                <Eye v-else :size="16" />
              </button>
            </div>
            <p v-if="addForm.platform === 'VK'" class="text-xs text-gray-400 mt-1">
              Управление &rarr; Работа с API &rarr; Создать ключ (разрешить доступ к стене)
            </p>
            <p v-else class="text-xs text-gray-400 mt-1">
              Создайте бота в @BotFather и добавьте его как админа канала
            </p>
          </div>
        </div>

        <div class="flex justify-end gap-2 mt-5">
          <button @click="showAddForm = false" class="px-4 py-2 rounded-lg text-sm text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800">
            Отмена
          </button>
          <button
            @click="addChannel"
            :disabled="addSaving || !addForm.accountName || !addForm.accessToken || !addForm.accountId"
            class="flex items-center gap-2 px-4 py-2 rounded-lg bg-brand-600 hover:bg-brand-700 text-white text-sm font-medium disabled:opacity-50"
          >
            <Loader2 v-if="addSaving" :size="16" class="animate-spin" />
            <Link v-else :size="16" />
            {{ addSaving ? 'Подключение...' : 'Подключить' }}
          </button>
        </div>
      </div>
    </div>
  </div>
</template>
