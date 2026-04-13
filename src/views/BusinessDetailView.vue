<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { http } from '@/api/client'
import { useAuthStore } from '@/stores/auth'
import { useBusinessesStore } from '@/stores/businesses'
import { useToast } from '@/composables/useToast'
import { platformBgColor, platformLabel, accountTypeLabel } from '@/composables/usePlatform'
import {
  ArrowLeft, Building2, Save, Loader2, Megaphone, Users, MessageSquare,
  Hash, Plus, Trash2, RefreshCw, CheckCircle, XCircle, Link,
  Eye, EyeOff, ChevronDown, ChevronUp, Radio, FileText, ClipboardList,
  Ban, Sparkles, Pencil, UserCircle, Image as ImageIcon
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

const businessesStore = useBusinessesStore()
const isAdmin = computed(() => auth.user?.role === 'ADMIN')
const bizId = computed(() => route.params.id as string)

// Data
const business = ref<BusinessDetail | null>(null)
const loading = ref(true)

// Tabs
const activeTab = ref<'brand' | 'channels' | 'overview' | 'templates' | 'characters'>('brand')

// Story templates
interface StoryTemplate {
  id: string; name: string; emoji: string; overlayText: string
  textPosition: string; textColor: string; fontSize: string; bgStyle: string; linkType: string; sortOrder: number
}
const templates = ref<StoryTemplate[]>([])
const editingTpl = ref<Partial<StoryTemplate> | null>(null)
const savingTpl = ref(false)

async function loadTemplates() {
  if (!route.params.id) return
  try { templates.value = await http.get<StoryTemplate[]>(`/businesses/${route.params.id}/story-templates`) } catch {}
}

// Characters
interface Character {
  id: string; name: string; description: string; type: string; style: string
  isActive: boolean; referenceMediaId: string | null
  referenceMedia?: { id: string; url: string; thumbUrl: string | null } | null
  businessIds?: string[]; businessNames?: string[]
}
const characters = ref<Character[]>([])
const showCharForm = ref(false)
const charForm = ref({ name: '', description: '', type: 'person', style: '', referenceMediaId: null as string | null, businessIds: [] as string[] })
const charSaving = ref(false)
const editingCharId = ref<string | null>(null)

const charTypeLabels: Record<string, string> = { person: 'Человек', mascot: 'Маскот', avatar: 'Аватар' }
const charTypeColors: Record<string, string> = {
  person: 'bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300',
  mascot: 'bg-amber-100 text-amber-700 dark:bg-amber-900 dark:text-amber-300',
  avatar: 'bg-purple-100 text-purple-700 dark:bg-purple-900 dark:text-purple-300',
}

async function loadCharacters() {
  if (!route.params.id) return
  try { characters.value = await http.get<Character[]>(`/businesses/${route.params.id}/characters`) } catch {}
}

function openCharForm(char?: Character) {
  if (char) {
    editingCharId.value = char.id
    charForm.value = { name: char.name, description: char.description, type: char.type, style: char.style, referenceMediaId: char.referenceMediaId, businessIds: char.businessIds || [bizId.value] }
  } else {
    editingCharId.value = null
    charForm.value = { name: '', description: '', type: 'person', style: '', referenceMediaId: null, businessIds: [bizId.value] }
  }
  showCharForm.value = true
}

async function saveChar() {
  if (!charForm.value.name.trim() || !charForm.value.businessIds.length) return
  charSaving.value = true
  const isEdit = !!editingCharId.value
  try {
    if (isEdit) {
      await http.put(`/characters/${editingCharId.value}`, charForm.value)
    } else {
      await http.post('/characters', charForm.value)
    }
    showCharForm.value = false
    editingCharId.value = null
    await loadCharacters()
    toast.success(isEdit ? 'Персонаж обновлён' : 'Персонаж создан')
  } catch (e: any) { toast.error(e.message || 'Ошибка') }
  finally { charSaving.value = false }
}

async function deleteChar(id: string) {
  if (!confirm('Удалить персонажа?')) return
  try { await http.delete(`/characters/${id}`); await loadCharacters(); toast.success('Удалён') } catch {}
}

async function uploadCharPhoto(event: Event) {
  const input = event.target as HTMLInputElement
  if (!input.files?.length) return
  const formData = new FormData()
  formData.append('file', input.files[0])
  formData.append('businessId', route.params.id as string)
  formData.append('tags', JSON.stringify(['character', 'reference']))

  try {
    const res = await fetch('/api/media/upload', {
      method: 'POST',
      credentials: 'include',
      body: formData,
    })
    if (!res.ok) throw new Error('Upload failed')
    const media = await res.json()
    charForm.value.referenceMediaId = media.id
    toast.success('Фото загружено')
  } catch (e: any) { toast.error('Ошибка загрузки фото') }
  input.value = ''
}

async function saveTpl() {
  if (!editingTpl.value?.name?.trim()) return
  savingTpl.value = true
  try {
    if (editingTpl.value.id) {
      await http.put(`/story-templates/${editingTpl.value.id}`, editingTpl.value)
    } else {
      await http.post(`/businesses/${route.params.id}/story-templates`, editingTpl.value)
    }
    editingTpl.value = null
    await loadTemplates()
    toast.success('Шаблон сохранён')
  } catch (e: any) { toast.error(e.message || 'Ошибка') }
  finally { savingTpl.value = false }
}

async function deleteTpl(id: string) {
  if (!confirm('Удалить шаблон?')) return
  try { await http.delete(`/story-templates/${id}`); await loadTemplates(); toast.success('Удалён') } catch {}
}

function newTpl() {
  editingTpl.value = { name: '', emoji: '', overlayText: '', textPosition: 'bottom', textColor: '#ffffff', fontSize: 'M', bgStyle: 'dark', linkType: '', sortOrder: templates.value.length }
}

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

// Access management
interface UserAccess {
  id: string
  login: string
  name: string
  role: 'ADMIN' | 'EDITOR' | 'VIEWER'
  isActive: boolean
  businesses: { businessId: string }[]
}
const allUsers = ref<UserAccess[]>([])
const accessLoading = ref(false)

const usersWithAccess = computed(() =>
  allUsers.value.filter(u => u.role === 'ADMIN' || u.businesses.some(b => b.businessId === bizId.value))
)

const usersWithoutAccess = computed(() =>
  allUsers.value.filter(u => u.role !== 'ADMIN' && !u.businesses.some(b => b.businessId === bizId.value) && u.isActive)
)

async function loadUsers() {
  if (!isAdmin.value) return
  accessLoading.value = true
  try {
    allUsers.value = await http.get<UserAccess[]>('/users')
  } catch {} finally { accessLoading.value = false }
}

async function grantAccess(userId: string) {
  const user = allUsers.value.find(u => u.id === userId)
  if (!user) return
  const currentBizIds = user.businesses.map(b => b.businessId)
  try {
    await http.put(`/users/${userId}`, { businessIds: [...currentBizIds, bizId.value] })
    toast.success('Доступ выдан')
    await loadUsers()
  } catch (e: any) { toast.error(e.message || 'Ошибка') }
}

async function revokeAccess(userId: string) {
  const user = allUsers.value.find(u => u.id === userId)
  if (!user) return
  const newBizIds = user.businesses.map(b => b.businessId).filter(id => id !== bizId.value)
  try {
    await http.put(`/users/${userId}`, { businessIds: newBizIds })
    toast.success('Доступ отозван')
    await loadUsers()
  } catch (e: any) { toast.error(e.message || 'Ошибка') }
}

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
  loadUsers()
  loadTemplates()
  loadCharacters()
  // Handle ?tab=channels from external links (e.g. StoryEditor "Настроить каналы")
  const tabQuery = route.query.tab as string | undefined
  if (tabQuery === 'channels') activeTab.value = 'channels'
  if (tabQuery === 'templates') activeTab.value = 'templates'
  if (tabQuery === 'characters') activeTab.value = 'characters'
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
        <button
          @click="activeTab = 'characters'"
          :class="[
            'flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-medium transition-all',
            activeTab === 'characters'
              ? 'bg-white dark:bg-gray-900 text-brand-600 dark:text-brand-400 shadow-sm'
              : 'text-gray-500 hover:text-gray-700 dark:hover:text-gray-300'
          ]"
        >
          <UserCircle :size="16" />
          Персонажи ({{ characters.length }})
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
            <!-- Links for Stories -->
            <div class="mt-4 pt-4 border-t border-gray-200 dark:border-gray-700">
              <label class="block text-sm font-medium mb-2">
                <Link :size="14" class="inline mr-1" /> Ссылки (для кнопок в Stories)
              </label>
              <div v-for="(link, i) in (profileForm.links || [])" :key="i" class="flex gap-2 mb-2">
                <input v-model="link.label" placeholder="Название" class="w-1/3 px-2 py-1.5 rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 text-xs" />
                <input v-model="link.url" placeholder="https://..." class="flex-1 px-2 py-1.5 rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 text-xs" />
                <button @click="profileForm.links.splice(i, 1)" class="p-1.5 rounded-lg hover:bg-red-100 dark:hover:bg-red-900">
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

        <!-- Access / Users -->
        <div v-if="isAdmin" class="mt-5 pt-5 border-t border-gray-200 dark:border-gray-800">
          <div class="flex items-center justify-between mb-3">
            <div class="text-xs text-gray-400">Доступ к бизнесу</div>
          </div>

          <!-- Users with access -->
          <div class="space-y-2 mb-3">
            <div
              v-for="user in usersWithAccess"
              :key="user.id"
              class="flex items-center justify-between px-3 py-2 rounded-lg bg-gray-50 dark:bg-gray-800"
            >
              <div class="flex items-center gap-2">
                <span class="text-sm font-medium">{{ user.name }}</span>
                <span class="text-xs text-gray-400">@{{ user.login }}</span>
                <span :class="[
                  'px-1.5 py-0.5 rounded text-[10px] font-medium',
                  user.role === 'ADMIN' ? 'bg-red-100 text-red-700 dark:bg-red-900 dark:text-red-300' : 'bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300'
                ]">
                  {{ user.role === 'ADMIN' ? 'Админ' : user.role === 'EDITOR' ? 'Редактор' : 'Просмотр' }}
                </span>
              </div>
              <button
                v-if="user.role !== 'ADMIN'"
                @click="revokeAccess(user.id)"
                class="text-xs text-red-500 hover:text-red-700 hover:underline"
              >
                Отозвать
              </button>
              <span v-else class="text-[10px] text-gray-400">все бизнесы</span>
            </div>
          </div>

          <!-- Add user -->
          <div v-if="usersWithoutAccess.length" class="flex items-center gap-2">
            <select
              ref="addUserSelect"
              class="flex-1 px-2 py-1.5 rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 text-xs"
            >
              <option v-for="u in usersWithoutAccess" :key="u.id" :value="u.id">
                {{ u.name }} (@{{ u.login }})
              </option>
            </select>
            <button
              @click="grantAccess(($refs.addUserSelect as HTMLSelectElement)?.value)"
              class="px-3 py-1.5 rounded-lg bg-brand-600 text-white text-xs font-medium hover:bg-brand-700"
            >
              Дать доступ
            </button>
          </div>
          <div v-else-if="!accessLoading" class="text-xs text-gray-400">Все пользователи уже имеют доступ</div>
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

    <!-- ========== Templates Tab ========== -->
    <div v-if="activeTab === 'templates'" class="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 p-6">
      <div class="flex items-center justify-between mb-4">
        <h2 class="text-lg font-bold">Шаблоны Stories</h2>
        <button @click="newTpl" class="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-brand-600 hover:bg-brand-700 text-white text-sm font-medium">
          <Plus :size="14" /> Создать
        </button>
      </div>

      <!-- Edit form -->
      <div v-if="editingTpl" class="mb-6 p-4 rounded-xl bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 space-y-3">
        <div class="grid grid-cols-2 gap-3">
          <div>
            <label class="block text-xs font-medium mb-1">Название</label>
            <input v-model="editingTpl.name" class="w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 text-sm" placeholder="Акция" />
          </div>
          <div>
            <label class="block text-xs font-medium mb-1">Эмодзи</label>
            <input v-model="editingTpl.emoji" class="w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 text-sm" placeholder="🔥" maxlength="4" />
          </div>
        </div>
        <div>
          <label class="block text-xs font-medium mb-1">Текст на фото</label>
          <textarea v-model="editingTpl.overlayText" rows="2" class="w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 text-sm" placeholder="Скидка 20% на утренний прокат!" />
        </div>
        <div class="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <div>
            <label class="block text-xs font-medium mb-1">Позиция</label>
            <select v-model="editingTpl.textPosition" class="w-full px-2 py-1.5 rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 text-xs">
              <option value="top">Вверху</option>
              <option value="center">Центр</option>
              <option value="bottom">Внизу</option>
            </select>
          </div>
          <div>
            <label class="block text-xs font-medium mb-1">Размер</label>
            <select v-model="editingTpl.fontSize" class="w-full px-2 py-1.5 rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 text-xs">
              <option value="S">S</option>
              <option value="M">M</option>
              <option value="L">L</option>
            </select>
          </div>
          <div>
            <label class="block text-xs font-medium mb-1">Подложка</label>
            <select v-model="editingTpl.bgStyle" class="w-full px-2 py-1.5 rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 text-xs">
              <option value="dark">Тёмная</option>
              <option value="light">Светлая</option>
              <option value="none">Без</option>
            </select>
          </div>
          <div>
            <label class="block text-xs font-medium mb-1">Цвет текста</label>
            <input v-model="editingTpl.textColor" type="color" class="w-full h-8 rounded-lg border border-gray-300 dark:border-gray-700 cursor-pointer" />
          </div>
        </div>
        <div>
          <label class="block text-xs font-medium mb-1">Кнопка VK</label>
          <select v-model="editingTpl.linkType" class="w-full px-2 py-1.5 rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 text-xs">
            <option value="">Без ссылки</option>
            <option value="learn_more">Подробнее</option>
            <option value="book">Забронировать</option>
            <option value="order">Заказать</option>
          </select>
        </div>
        <div class="flex gap-2">
          <button @click="saveTpl" :disabled="savingTpl || !editingTpl.name?.trim()"
            class="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-brand-600 hover:bg-brand-700 text-white text-sm font-medium disabled:opacity-50">
            <Loader2 v-if="savingTpl" :size="14" class="animate-spin" /><Save v-else :size="14" />
            {{ editingTpl.id ? 'Сохранить' : 'Создать' }}
          </button>
          <button @click="editingTpl = null" class="px-4 py-2 rounded-lg text-sm text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-800">Отмена</button>
        </div>
      </div>

      <!-- Templates list -->
      <div v-if="templates.length" class="space-y-2">
        <div v-for="tpl in templates" :key="tpl.id"
          class="flex items-center justify-between p-3 rounded-lg bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700">
          <div class="flex items-center gap-2 min-w-0">
            <span v-if="tpl.emoji" class="text-lg">{{ tpl.emoji }}</span>
            <div class="min-w-0">
              <div class="text-sm font-medium truncate">{{ tpl.name }}</div>
              <div v-if="tpl.overlayText" class="text-xs text-gray-400 truncate">{{ tpl.overlayText }}</div>
            </div>
          </div>
          <div class="flex gap-1 shrink-0">
            <button @click="editingTpl = { ...tpl }" class="p-1.5 rounded-lg hover:bg-gray-200 dark:hover:bg-gray-700">
              <Pencil :size="14" class="text-gray-400" />
            </button>
            <button @click="deleteTpl(tpl.id)" class="p-1.5 rounded-lg hover:bg-red-100 dark:hover:bg-red-900">
              <Trash2 :size="14" class="text-red-400" />
            </button>
          </div>
        </div>
      </div>
      <div v-else-if="!editingTpl" class="text-center py-8 text-sm text-gray-400">
        Шаблонов пока нет. Нажмите «Создать» чтобы добавить первый.
      </div>
    </div>

    <!-- ========== Characters Tab ========== -->
    <div v-if="activeTab === 'characters'" class="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 p-6">
      <div class="flex items-center justify-between mb-4">
        <div>
          <h2 class="text-lg font-bold">Персонажи</h2>
          <p class="text-xs text-gray-500 mt-0.5">Лица, маскоты и аватары для AI-генерации контента</p>
        </div>
        <button @click="openCharForm()" class="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-brand-600 hover:bg-brand-700 text-white text-sm font-medium">
          <Plus :size="14" /> Создать
        </button>
      </div>

      <!-- Character form modal -->
      <div v-if="showCharForm" class="mb-6 p-4 rounded-xl bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 space-y-3">
        <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label class="block text-xs font-medium mb-1">Имя *</label>
            <input v-model="charForm.name" class="w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 text-sm" placeholder="Юрий" />
          </div>
          <div>
            <label class="block text-xs font-medium mb-1">Тип</label>
            <select v-model="charForm.type" class="w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 text-sm">
              <option value="person">Человек</option>
              <option value="mascot">Маскот</option>
              <option value="avatar">Аватар</option>
            </select>
          </div>
        </div>
        <div>
          <label class="block text-xs font-medium mb-1">Описание для AI</label>
          <textarea v-model="charForm.description" rows="2" class="w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 text-sm" placeholder="Молодой мужчина, тёмные волосы, спортивное телосложение, улыбчивый..." />
          <p class="text-[11px] text-gray-400 mt-0.5">Опишите внешность — AI использует это при генерации</p>
        </div>
        <!-- Бизнесы (мультивыбор) -->
        <div>
          <label class="block text-xs font-medium mb-1.5">Привязка к бизнесам *</label>
          <div class="flex flex-wrap gap-1.5">
            <label v-for="biz in businessesStore.businesses" :key="biz.id"
              :class="[
                'flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium cursor-pointer transition-colors border',
                charForm.businessIds.includes(biz.id)
                  ? 'bg-brand-100 dark:bg-brand-900 text-brand-700 dark:text-brand-300 border-brand-300 dark:border-brand-700'
                  : 'bg-gray-100 dark:bg-gray-800 text-gray-500 border-gray-200 dark:border-gray-700 hover:border-brand-300',
              ]">
              <input type="checkbox" :value="biz.id" v-model="charForm.businessIds" class="hidden" />
              {{ biz.name }}
            </label>
          </div>
          <p class="text-[10px] text-gray-400 mt-1">Персонаж будет доступен для AI-генерации в выбранных бизнесах</p>
        </div>
        <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label class="block text-xs font-medium mb-1">Стиль</label>
            <input v-model="charForm.style" class="w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 text-sm" placeholder="realistic, cartoon, anime..." />
          </div>
          <div>
            <label class="block text-xs font-medium mb-1">Фото-референс</label>
            <div class="flex items-center gap-2">
              <label class="flex items-center gap-1.5 px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 text-sm cursor-pointer hover:border-brand-400 transition-colors">
                <ImageIcon :size="14" class="text-gray-400" />
                {{ charForm.referenceMediaId ? 'Заменить' : 'Загрузить' }}
                <input type="file" accept="image/*" @change="uploadCharPhoto" class="hidden" />
              </label>
              <span v-if="charForm.referenceMediaId" class="text-xs text-green-600">Загружено</span>
            </div>
          </div>
        </div>
        <div class="flex gap-2">
          <button @click="saveChar" :disabled="charSaving || !charForm.name.trim()"
            class="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-brand-600 hover:bg-brand-700 text-white text-sm font-medium disabled:opacity-50">
            <Loader2 v-if="charSaving" :size="14" class="animate-spin" /><Save v-else :size="14" />
            {{ editingCharId ? 'Сохранить' : 'Создать' }}
          </button>
          <button @click="showCharForm = false; editingCharId = null" class="px-4 py-2 rounded-lg text-sm text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-800">Отмена</button>
        </div>
      </div>

      <!-- Characters grid -->
      <div v-if="characters.length" class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
        <div v-for="char in characters" :key="char.id"
          class="relative p-4 rounded-xl bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 hover:border-brand-300 dark:hover:border-brand-700 transition-colors">
          <div class="flex items-start gap-3">
            <!-- Avatar -->
            <div class="w-12 h-12 rounded-xl bg-gray-200 dark:bg-gray-700 overflow-hidden shrink-0 flex items-center justify-center">
              <img v-if="char.referenceMedia?.thumbUrl || char.referenceMedia?.url"
                :src="char.referenceMedia.thumbUrl || char.referenceMedia.url"
                :alt="char.name"
                class="w-full h-full object-cover"
              />
              <UserCircle v-else :size="24" class="text-gray-400" />
            </div>
            <div class="flex-1 min-w-0">
              <div class="flex items-center gap-2">
                <h3 class="text-sm font-semibold truncate">{{ char.name }}</h3>
                <span :class="['px-1.5 py-0.5 rounded text-[10px] font-medium', charTypeColors[char.type] || charTypeColors.person]">
                  {{ charTypeLabels[char.type] || char.type }}
                </span>
              </div>
              <p v-if="char.description" class="text-xs text-gray-500 mt-0.5 line-clamp-2">{{ char.description }}</p>
              <div v-if="char.businessNames && char.businessNames.length > 1" class="flex flex-wrap gap-1 mt-1">
                <span v-for="bn in char.businessNames" :key="bn" class="px-1.5 py-0.5 rounded text-[9px] bg-gray-200 dark:bg-gray-700 text-gray-500">{{ bn }}</span>
              </div>
              <p v-if="char.style" class="text-[10px] text-gray-400 mt-0.5">Стиль: {{ char.style }}</p>
            </div>
          </div>
          <!-- Actions -->
          <div class="absolute top-2 right-2 flex gap-0.5">
            <button @click="openCharForm(char)" class="p-1 rounded hover:bg-gray-200 dark:hover:bg-gray-700">
              <Pencil :size="12" class="text-gray-400" />
            </button>
            <button @click="deleteChar(char.id)" class="p-1 rounded hover:bg-red-100 dark:hover:bg-red-900">
              <Trash2 :size="12" class="text-red-400" />
            </button>
          </div>
        </div>
      </div>
      <div v-else-if="!showCharForm" class="text-center py-8">
        <UserCircle :size="48" class="mx-auto text-gray-300 dark:text-gray-600 mb-3" />
        <p class="text-sm text-gray-400 mb-3">Создайте персонажа — AI будет генерировать контент с ним</p>
        <button @click="openCharForm()" class="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-brand-600 text-white text-sm font-medium">
          <Plus :size="14" /> Создать первого
        </button>
      </div>
    </div>
  </div>
</template>
