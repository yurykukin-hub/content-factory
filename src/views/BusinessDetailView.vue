<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { http } from '@/api/client'
import { useAuthStore } from '@/stores/auth'
import { useToast } from '@/composables/useToast'
import { platformBgColor, platformLabel, accountTypeLabel } from '@/composables/usePlatform'
import StoryTemplatesPanel from '@/components/businesses/StoryTemplatesPanel.vue'
import AccessPanel from '@/components/businesses/AccessPanel.vue'
import ChannelsManager from '@/components/businesses/ChannelsManager.vue'
import {
  ArrowLeft, Building2, Save, Loader2, Megaphone, Users, MessageSquare,
  Hash, Plus, Trash2, Link, Radio, FileText,
  Ban, Sparkles,
} from 'lucide-vue-next'

interface PlatformAccount {
  id: string
  platform: string
  accountType: string
  accountName: string
  accountId: string
  hasToken?: boolean
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
  links?: { label: string; url: string }[]
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
const activeTab = ref<'brand' | 'channels' | 'overview' | 'templates'>('brand')

// Brand profile form
const profileForm = ref<Record<string, any>>({})
const savingProfile = ref(false)

async function loadBusiness() {
  loading.value = true
  try {
    business.value = await http.get<BusinessDetail>(`/businesses/${bizId.value}`)
    initProfileForm()
  } catch (e: any) {
    toast.error(e.message || 'Не удалось загрузить проект')
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
    links: bp?.links || [],
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

onMounted(() => {
  loadBusiness()
  // Handle ?tab=channels from external links (e.g. StoryEditor "Настроить каналы")
  const tabQuery = route.query.tab as string | undefined
  if (tabQuery === 'channels') activeTab.value = 'channels'
  if (tabQuery === 'templates') activeTab.value = 'templates'
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
        <button
          @click="activeTab = 'templates'"
          :class="[
            'flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-medium transition-all',
            activeTab === 'templates'
              ? 'bg-white dark:bg-gray-900 text-brand-600 dark:text-brand-400 shadow-sm'
              : 'text-gray-500 hover:text-gray-700 dark:hover:text-gray-300'
          ]"
        >
          <Sparkles :size="16" />
          Шаблоны
        </button>
      </div>

      <!-- ========== Brand Profile Tab ========== -->
      <div v-if="activeTab === 'brand'" class="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 p-6">
        <p class="text-sm text-gray-500 mb-5">
          Бренд-профиль определяет тон и стиль AI-генерации для этого проекта.
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
            <!-- Links for Stories -->
            <div class="mt-4 pt-4 border-t border-gray-200 dark:border-gray-700">
              <label class="block text-sm font-medium mb-2">
                <Link :size="14" class="inline mr-1" /> Ссылки (для кнопок в Stories)
              </label>
              <div v-for="(link, i) in (profileForm.links || [])" :key="i" class="flex gap-2 mb-2">
                <input v-model="link.label" placeholder="Название" class="w-1/3 px-2 py-1.5 rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 text-xs" />
                <input v-model="link.url" placeholder="https://..." class="flex-1 px-2 py-1.5 rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 text-xs" />
                <button @click="profileForm.links.splice(i, 1)" aria-label="Удалить ссылку" title="Удалить ссылку" class="p-1.5 rounded-lg hover:bg-red-100 dark:hover:bg-red-900">
                  <Trash2 :size="14" class="text-red-400" />
                </button>
              </div>
              <button @click="(profileForm.links = profileForm.links || []).push({ label: '', url: '' })"
                class="flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-medium text-brand-600 hover:bg-brand-50 dark:hover:bg-brand-950">
                <Plus :size="12" /> Добавить ссылку
              </button>
            </div>

            <button
              @click="saveProfile"
              :disabled="savingProfile"
              class="mt-4 flex items-center gap-2 px-4 py-2 rounded-lg bg-brand-600 hover:bg-brand-700 text-white text-sm font-medium disabled:opacity-50"
            >
              <Loader2 v-if="savingProfile" :size="16" class="animate-spin" />
              <Save v-else :size="16" />
              {{ savingProfile ? 'Сохранение...' : 'Сохранить' }}
            </button>
          </div>
        </div>
      </div>

      <!-- ========== Channels Tab ========== -->
      <ChannelsManager
        v-if="activeTab === 'channels'"
        :business-id="bizId"
        :accounts="business.platformAccounts || []"
        @changed="loadBusiness"
      />

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

        <!-- Access / Users -->
        <AccessPanel v-if="isAdmin" :business-id="bizId" />
      </div>
    </div>

    <!-- ========== Templates Tab ========== -->
    <StoryTemplatesPanel v-if="activeTab === 'templates'" :business-id="(route.params.id as string)" />

  </div>
</template>
