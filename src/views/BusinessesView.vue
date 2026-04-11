<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { http } from '@/api/client'
import { useBusinessesStore, type Business } from '@/stores/businesses'
import { useToast } from '@/composables/useToast'
import { platformBgColor, platformLabel } from '@/composables/usePlatform'
import {
  Building2, ChevronDown, ChevronUp, Plus, Save, Trash2, Loader2,
  Globe, MessageSquare, Camera, Link, Hash, Users, Megaphone
} from 'lucide-vue-next'

interface FullBusiness extends Business {
  _count?: { posts: number; contentPlans: number }
}

const businesses = useBusinessesStore()
const toast = useToast()
const expandedId = ref<string | null>(null)
const activeTab = ref<'profile' | 'platforms'>('profile')

// Brand profile form
const profileForm = ref<Record<string, any>>({})
const savingProfile = ref(false)

// Platform form
const showPlatformForm = ref(false)
const platformForm = ref({ platform: 'VK' as string, accountName: '', accountId: '', accessToken: '' })
const savingPlatform = ref(false)

function toggleExpand(biz: FullBusiness) {
  if (expandedId.value === biz.id) {
    expandedId.value = null
  } else {
    expandedId.value = biz.id
    activeTab.value = 'profile'
    // Pre-fill profile form
    profileForm.value = {
      tone: biz.brandProfile?.tone || '',
      targetAudience: biz.brandProfile?.targetAudience || '',
      brandVoice: biz.brandProfile?.brandVoice || '',
      hashtags: (biz.brandProfile?.hashtags || []).join(', '),
      keyTopics: (biz.brandProfile?.keyTopics || []).join(', '),
      postsPerWeek: biz.brandProfile?.postsPerWeek || 3,
    }
  }
}

async function saveProfile(bizId: string) {
  savingProfile.value = true
  try {
    const data = {
      ...profileForm.value,
      hashtags: profileForm.value.hashtags.split(',').map((h: string) => h.trim()).filter(Boolean),
      keyTopics: profileForm.value.keyTopics.split(',').map((t: string) => t.trim()).filter(Boolean),
    }
    await http.put(`/businesses/${bizId}/brand-profile`, data)
    await businesses.load()
  } catch (e: any) {
    toast.error(e.message || 'Произошла ошибка')
  } finally {
    savingProfile.value = false
  }
}

async function addPlatform(bizId: string) {
  if (!platformForm.value.accountName || !platformForm.value.accessToken) return
  savingPlatform.value = true
  try {
    await http.post(`/businesses/${bizId}/platforms`, platformForm.value)
    showPlatformForm.value = false
    platformForm.value = { platform: 'VK', accountName: '', accountId: '', accessToken: '' }
    await businesses.load()
  } catch (e: any) {
    toast.error(e.message || 'Произошла ошибка')
  } finally {
    savingPlatform.value = false
  }
}

async function deletePlatform(platformId: string) {
  if (!confirm('Отключить платформу?')) return
  try {
    await http.delete(`/platforms/${platformId}`)
    await businesses.load()
  } catch (e: any) {
    toast.error(e.message || 'Произошла ошибка')
  }
}

onMounted(() => {
  if (!businesses.businesses.length) businesses.load()
})
</script>

<template>
  <div>
    <h1 class="text-2xl font-bold mb-6">Бизнесы</h1>

    <div class="space-y-3">
      <div
        v-for="biz in businesses.businesses"
        :key="biz.id"
        class="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 overflow-hidden"
      >
        <!-- Header -->
        <div
          class="flex items-center justify-between p-5 cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-800/50 transition-colors"
          @click="toggleExpand(biz)"
        >
          <div class="flex items-center gap-3">
            <div class="p-2 bg-brand-100 dark:bg-brand-900 rounded-lg">
              <Building2 :size="20" class="text-brand-600 dark:text-brand-400" />
            </div>
            <div>
              <h3 class="font-semibold">{{ biz.name }}</h3>
              <div class="flex items-center gap-3 mt-0.5">
                <span class="text-xs text-gray-400">{{ biz.slug }}</span>
                <span v-if="biz.platformAccounts?.length" class="flex items-center gap-1">
                  <span
                    v-for="pa in biz.platformAccounts"
                    :key="pa.id"
                    :class="['w-5 h-5 rounded text-[9px] font-bold text-white flex items-center justify-center', platformBgColor(pa.platform)]"
                  >
                    {{ platformIcon(pa.platform) }}
                  </span>
                </span>
              </div>
            </div>
          </div>
          <ChevronUp v-if="expandedId === biz.id" :size="20" class="text-gray-400" />
          <ChevronDown v-else :size="20" class="text-gray-400" />
        </div>

        <!-- Expanded content -->
        <div v-if="expandedId === biz.id" class="border-t border-gray-200 dark:border-gray-800">
          <!-- Tabs -->
          <div class="flex border-b border-gray-200 dark:border-gray-800">
            <button
              @click="activeTab = 'profile'"
              :class="['px-4 py-2.5 text-sm font-medium border-b-2 transition-colors', activeTab === 'profile' ? 'border-brand-500 text-brand-600 dark:text-brand-400' : 'border-transparent text-gray-500 hover:text-gray-700']"
            >
              Бренд-профиль
            </button>
            <button
              @click="activeTab = 'platforms'"
              :class="['px-4 py-2.5 text-sm font-medium border-b-2 transition-colors', activeTab === 'platforms' ? 'border-brand-500 text-brand-600 dark:text-brand-400' : 'border-transparent text-gray-500 hover:text-gray-700']"
            >
              Платформы ({{ biz.platformAccounts?.length || 0 }})
            </button>
          </div>

          <!-- Profile tab -->
          <div v-if="activeTab === 'profile'" class="p-5 space-y-3">
            <div class="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div>
                <label class="flex items-center gap-1.5 text-sm font-medium mb-1">
                  <Megaphone :size="14" class="text-gray-400" />
                  Тон коммуникации
                </label>
                <input
                  v-model="profileForm.tone"
                  placeholder="дружелюбный, профессиональный"
                  class="w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 focus:ring-2 focus:ring-brand-500 text-sm"
                />
              </div>
              <div>
                <label class="flex items-center gap-1.5 text-sm font-medium mb-1">
                  <Users :size="14" class="text-gray-400" />
                  Целевая аудитория
                </label>
                <input
                  v-model="profileForm.targetAudience"
                  placeholder="молодые люди 20-35, любители активного отдыха"
                  class="w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 focus:ring-2 focus:ring-brand-500 text-sm"
                />
              </div>
            </div>

            <div>
              <label class="flex items-center gap-1.5 text-sm font-medium mb-1">
                <MessageSquare :size="14" class="text-gray-400" />
                Стиль бренда
              </label>
              <textarea
                v-model="profileForm.brandVoice"
                rows="2"
                placeholder="Описание стиля текстов: живой, с юмором, без канцеляризмов..."
                class="w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 focus:ring-2 focus:ring-brand-500 text-sm"
              />
            </div>

            <div class="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div>
                <label class="flex items-center gap-1.5 text-sm font-medium mb-1">
                  <Hash :size="14" class="text-gray-400" />
                  Постоянные хештеги (через запятую)
                </label>
                <input
                  v-model="profileForm.hashtags"
                  placeholder="SUP, Выборг, НаWоде"
                  class="w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 focus:ring-2 focus:ring-brand-500 text-sm"
                />
              </div>
              <div>
                <label class="flex items-center gap-1.5 text-sm font-medium mb-1">
                  Ключевые темы (через запятую)
                </label>
                <input
                  v-model="profileForm.keyTopics"
                  placeholder="SUP туры, прокат досок, отдых на воде"
                  class="w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 focus:ring-2 focus:ring-brand-500 text-sm"
                />
              </div>
            </div>

            <div>
              <label class="text-sm font-medium mb-1 block">Постов в неделю</label>
              <input
                v-model.number="profileForm.postsPerWeek"
                type="number"
                min="1"
                max="14"
                class="w-24 px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 focus:ring-2 focus:ring-brand-500 text-sm"
              />
            </div>

            <button
              @click="saveProfile(biz.id)"
              :disabled="savingProfile"
              class="flex items-center gap-2 px-4 py-2 rounded-lg bg-brand-600 hover:bg-brand-700 text-white text-sm font-medium disabled:opacity-50"
            >
              <Loader2 v-if="savingProfile" :size="16" class="animate-spin" />
              <Save v-else :size="16" />
              {{ savingProfile ? 'Сохранение...' : 'Сохранить профиль' }}
            </button>
          </div>

          <!-- Platforms tab -->
          <div v-if="activeTab === 'platforms'" class="p-5">
            <!-- Existing platforms -->
            <div v-if="biz.platformAccounts?.length" class="space-y-2 mb-4">
              <div
                v-for="pa in biz.platformAccounts"
                :key="pa.id"
                class="flex items-center justify-between p-3 rounded-lg bg-gray-50 dark:bg-gray-800"
              >
                <div class="flex items-center gap-3">
                  <span :class="['w-8 h-8 rounded-lg text-xs font-bold text-white flex items-center justify-center', platformBgColor(pa.platform)]">
                    {{ platformIcon(pa.platform) }}
                  </span>
                  <div>
                    <div class="text-sm font-medium">{{ pa.accountName }}</div>
                    <div class="text-xs text-gray-400">ID: {{ pa.accountId }}</div>
                  </div>
                </div>
                <button
                  @click="deletePlatform(pa.id)"
                  class="p-1.5 rounded text-gray-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-950 transition-colors"
                >
                  <Trash2 :size="14" />
                </button>
              </div>
            </div>

            <div v-else class="text-sm text-gray-400 text-center py-4 mb-4">
              Нет подключённых платформ
            </div>

            <!-- Add platform -->
            <button
              v-if="!showPlatformForm"
              @click="showPlatformForm = true"
              class="w-full flex items-center justify-center gap-2 px-3 py-2.5 rounded-lg border-2 border-dashed border-gray-300 dark:border-gray-700 text-sm text-gray-500 hover:border-brand-400 hover:text-brand-600 transition-colors"
            >
              <Plus :size="16" />
              Подключить платформу
            </button>

            <!-- Platform form -->
            <div v-if="showPlatformForm" class="p-4 rounded-lg bg-gray-50 dark:bg-gray-800 space-y-3">
              <div>
                <label class="block text-sm font-medium mb-1">Платформа</label>
                <select
                  v-model="platformForm.platform"
                  class="w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-sm"
                >
                  <option value="VK">VK</option>
                  <option value="TELEGRAM">Telegram</option>
                  <option value="INSTAGRAM">Instagram</option>
                </select>
              </div>
              <div>
                <label class="block text-sm font-medium mb-1">Название аккаунта</label>
                <input
                  v-model="platformForm.accountName"
                  placeholder="SUP клуб НаWоде"
                  class="w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-sm"
                />
              </div>
              <div>
                <label class="block text-sm font-medium mb-1">
                  {{ platformForm.platform === 'VK' ? 'ID группы (число)' : platformForm.platform === 'TELEGRAM' ? 'Chat ID (@channel или число)' : 'User ID' }}
                </label>
                <input
                  v-model="platformForm.accountId"
                  placeholder="150371202"
                  class="w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-sm"
                />
              </div>
              <div>
                <label class="block text-sm font-medium mb-1">Access Token</label>
                <input
                  v-model="platformForm.accessToken"
                  type="password"
                  placeholder="vk1.a.xxx..."
                  class="w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-sm font-mono"
                />
              </div>
              <div class="flex gap-2">
                <button @click="showPlatformForm = false" class="px-3 py-2 rounded-lg text-sm text-gray-500 hover:bg-gray-200 dark:hover:bg-gray-700">
                  Отмена
                </button>
                <button
                  @click="addPlatform(biz.id)"
                  :disabled="savingPlatform || !platformForm.accountName || !platformForm.accessToken"
                  class="flex-1 flex items-center justify-center gap-2 px-3 py-2 rounded-lg bg-brand-600 hover:bg-brand-700 text-white text-sm font-medium disabled:opacity-50"
                >
                  <Loader2 v-if="savingPlatform" :size="16" class="animate-spin" />
                  <Link v-else :size="16" />
                  {{ savingPlatform ? 'Подключение...' : 'Подключить' }}
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>
