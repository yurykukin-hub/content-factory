<script setup lang="ts">
import { ref, onMounted, computed } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { http } from '@/api/client'
import { useBusinessesStore } from '@/stores/businesses'
import MediaUpload from '@/components/MediaUpload.vue'
import {
  ArrowLeft, Send, Save, Plus, Sparkles, Loader2, ExternalLink,
  AlertCircle, CheckCircle, XCircle, Image, Wand2
} from 'lucide-vue-next'

interface MediaFile {
  id: string
  url: string
  thumbUrl: string | null
  filename: string
  mimeType: string
  sizeBytes: number
}

interface PlatformAccount {
  id: string
  platform: string
  accountName: string
}

interface PostVersion {
  id: string
  body: string
  hashtags: string[]
  status: string
  publishedAt: string | null
  externalPostId: string | null
  externalUrl: string | null
  platformAccount: PlatformAccount
  publishLogs: { status: string; errorMessage: string | null }[]
}

interface Post {
  id: string
  businessId: string
  title: string | null
  body: string
  postType: string
  hashtags: string[]
  status: string
  createdBy: string
  aiModel: string | null
  createdAt: string
  versions: PostVersion[]
  mediaFiles: MediaFile[]
}

const route = useRoute()
const router = useRouter()
const businesses = useBusinessesStore()

const post = ref<Post | null>(null)
const loading = ref(true)
const saving = ref(false)
const publishing = ref<string | null>(null)
const adapting = ref(false)

// Platform tabs
const platforms = ref<PlatformAccount[]>([])
const activeTab = ref<string>('') // platform account ID

// AI Image generation
const showAiImage = ref(false)
const aiImagePrompt = ref('')
const aiImageLoading = ref(false)
const aiImageRatio = ref<'1:1' | '16:9' | '9:16'>('1:1')

// New version form
const showVersionForm = ref(false)
const versionForm = ref({ platformAccountId: '', body: '', hashtagsStr: '' })
const creatingVersion = ref(false)

async function loadPost() {
  loading.value = true
  try {
    post.value = await http.get<Post>(`/posts/${route.params.id}`)
    if (post.value) {
      platforms.value = await http.get<PlatformAccount[]>(`/businesses/${post.value.businessId}/platforms`)
      // Set active tab to first version's platform, or first available platform
      if (post.value.versions.length) {
        activeTab.value = post.value.versions[0].platformAccount.id
      } else if (platforms.value.length) {
        activeTab.value = platforms.value[0].id
      }
    }
  } catch (e) {
    console.error('Load post error:', e)
  } finally {
    loading.value = false
  }
}

async function savePost() {
  if (!post.value) return
  saving.value = true
  try {
    await http.put(`/posts/${post.value.id}`, { title: post.value.title, body: post.value.body })
  } catch (e: any) {
    alert('Ошибка: ' + (e.message || e))
  } finally {
    saving.value = false
  }
}

async function publishVersion(versionId: string) {
  publishing.value = versionId
  try {
    const result = await http.post<{ success: boolean; error: string | null }>(`/post-versions/${versionId}/publish`, {})
    if (!result.success) alert('Ошибка: ' + result.error)
    await loadPost()
  } catch (e: any) {
    alert('Ошибка: ' + (e.message || e))
  } finally {
    publishing.value = null
  }
}

async function adaptToAllPlatforms() {
  if (!post.value || !platforms.value.length) return
  adapting.value = true
  try {
    await http.post('/ai/adapt', {
      postId: post.value.id,
      platformAccountIds: platforms.value.map(p => p.id),
    })
    await loadPost()
  } catch (e: any) {
    alert('Ошибка адаптации: ' + (e.message || e))
  } finally {
    adapting.value = false
  }
}

async function generateAiImage() {
  if (!post.value || !aiImagePrompt.value.trim()) return
  aiImageLoading.value = true
  try {
    const result = await http.post<{ mediaFile: MediaFile }>('/ai/generate-image', {
      businessId: post.value.businessId,
      postId: post.value.id,
      prompt: aiImagePrompt.value,
      aspectRatio: aiImageRatio.value,
    })
    post.value.mediaFiles.push(result.mediaFile)
    showAiImage.value = false
    aiImagePrompt.value = ''
  } catch (e: any) {
    alert('Ошибка генерации: ' + (e.message || e))
  } finally {
    aiImageLoading.value = false
  }
}

function onMediaUploaded(file: MediaFile) {
  if (post.value) {
    post.value.mediaFiles.push(file)
    // Attach to post
    http.post(`/media/${file.id}/attach`, { postId: post.value.id }).catch(() => {})
  }
}

function onMediaRemoved(id: string) {
  if (post.value) {
    post.value.mediaFiles = post.value.mediaFiles.filter(f => f.id !== id)
  }
}

// Get version for active tab
const activeVersion = computed(() => {
  if (!post.value || !activeTab.value) return null
  return post.value.versions.find(v => v.platformAccount.id === activeTab.value)
})

const activePlatform = computed(() => {
  return platforms.value.find(p => p.id === activeTab.value)
})

function statusColor(status: string) {
  const map: Record<string, string> = {
    DRAFT: 'bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300',
    APPROVED: 'bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300',
    SCHEDULED: 'bg-amber-100 text-amber-700 dark:bg-amber-900 dark:text-amber-300',
    PUBLISHED: 'bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-300',
    FAILED: 'bg-red-100 text-red-700 dark:bg-red-900 dark:text-red-300',
  }
  return map[status] || map.DRAFT
}

function statusLabel(s: string) {
  const map: Record<string, string> = { DRAFT: 'Черновик', PUBLISHED: 'Опубликован', FAILED: 'Ошибка', SCHEDULED: 'Запланирован', APPROVED: 'Одобрен' }
  return map[s] || s
}

function platformColor(p: string) {
  const map: Record<string, string> = { VK: 'text-blue-600', TELEGRAM: 'text-sky-500', INSTAGRAM: 'text-pink-500' }
  return map[p] || ''
}

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })
}

async function createVersionForTab() {
  if (!post.value || !activeTab.value) return
  creatingVersion.value = true
  try {
    await http.post(`/posts/${post.value.id}/versions`, {
      platformAccountId: activeTab.value,
      body: post.value.body,
      hashtags: post.value.hashtags,
    })
    await loadPost()
  } catch (e: any) {
    alert('Ошибка: ' + (e.message || e))
  } finally {
    creatingVersion.value = false
  }
}

onMounted(loadPost)
</script>

<template>
  <div>
    <button @click="router.push('/posts')" class="flex items-center gap-1 text-sm text-gray-500 hover:text-gray-700 dark:hover:text-gray-300 mb-4">
      <ArrowLeft :size="16" /> Назад к постам
    </button>

    <div v-if="loading" class="text-gray-500 py-8 text-center">Загрузка...</div>
    <div v-else-if="!post" class="text-center py-8">
      <AlertCircle :size="48" class="mx-auto text-gray-300 mb-3" />
      <p class="text-gray-500">Пост не найден</p>
    </div>

    <div v-else class="grid grid-cols-1 lg:grid-cols-5 gap-6">
      <!-- LEFT: Master text + Media (3/5) -->
      <div class="lg:col-span-3 space-y-4">
        <!-- Post editor card -->
        <div class="bg-white dark:bg-gray-900 rounded-xl p-6 border border-gray-200 dark:border-gray-800">
          <div class="flex items-center justify-between mb-4">
            <div class="flex items-center gap-2">
              <h1 class="text-xl font-bold">Редактор поста</h1>
              <span :class="['px-2 py-0.5 rounded-full text-xs font-medium', statusColor(post.status)]">{{ statusLabel(post.status) }}</span>
              <span v-if="post.createdBy === 'ai'" class="px-2 py-0.5 rounded-full text-xs font-medium bg-purple-100 text-purple-700 dark:bg-purple-900 dark:text-purple-300">AI</span>
            </div>
            <span class="text-xs text-gray-400">{{ formatDate(post.createdAt) }}</span>
          </div>

          <div class="mb-3">
            <label class="block text-sm font-medium mb-1">Заголовок</label>
            <input v-model="post.title" placeholder="Заголовок (необязательно)"
              class="w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 focus:ring-2 focus:ring-brand-500 text-sm" />
          </div>

          <div class="mb-4">
            <label class="block text-sm font-medium mb-1">Мастер-текст</label>
            <textarea v-model="post.body" rows="8"
              class="w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 focus:ring-2 focus:ring-brand-500 text-sm leading-relaxed" />
            <div class="text-xs text-gray-400 mt-1">{{ post.body.length }} символов</div>
          </div>

          <div class="flex items-center gap-2">
            <button @click="savePost" :disabled="saving"
              class="flex items-center gap-2 px-4 py-2 rounded-lg bg-brand-600 hover:bg-brand-700 text-white text-sm font-medium disabled:opacity-50">
              <Loader2 v-if="saving" :size="16" class="animate-spin" />
              <Save v-else :size="16" />
              Сохранить
            </button>
            <button @click="adaptToAllPlatforms" :disabled="adapting || !platforms.length"
              class="flex items-center gap-2 px-4 py-2 rounded-lg bg-purple-600 hover:bg-purple-700 text-white text-sm font-medium disabled:opacity-50"
              title="AI адаптирует текст для каждой подключённой платформы">
              <Loader2 v-if="adapting" :size="16" class="animate-spin" />
              <Wand2 v-else :size="16" />
              {{ adapting ? 'Адаптация...' : 'AI адаптировать' }}
            </button>
          </div>
        </div>

        <!-- Media section -->
        <div class="bg-white dark:bg-gray-900 rounded-xl p-6 border border-gray-200 dark:border-gray-800">
          <div class="flex items-center justify-between mb-3">
            <h2 class="font-semibold flex items-center gap-2">
              <Image :size="18" />
              Медиа ({{ post.mediaFiles.length }})
            </h2>
            <button @click="showAiImage = true"
              class="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-purple-100 dark:bg-purple-900 text-purple-700 dark:text-purple-300 text-xs font-medium hover:bg-purple-200 dark:hover:bg-purple-800 transition-colors">
              <Sparkles :size="14" />
              AI Картинка
            </button>
          </div>

          <MediaUpload
            :business-id="post.businessId"
            :post-id="post.id"
            :files="post.mediaFiles"
            @uploaded="onMediaUploaded"
            @removed="onMediaRemoved"
          />
        </div>
      </div>

      <!-- RIGHT: Platform versions (2/5) -->
      <div class="lg:col-span-2">
        <div class="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 overflow-hidden sticky top-6">
          <!-- Platform tabs -->
          <div class="flex border-b border-gray-200 dark:border-gray-800 overflow-x-auto">
            <button
              v-for="p in platforms"
              :key="p.id"
              @click="activeTab = p.id"
              :class="[
                'flex-1 min-w-0 px-3 py-3 text-sm font-medium border-b-2 transition-colors whitespace-nowrap',
                activeTab === p.id
                  ? 'border-brand-500 text-brand-600 dark:text-brand-400'
                  : 'border-transparent text-gray-500 hover:text-gray-700'
              ]"
            >
              <span :class="platformColor(p.platform)">{{ p.platform }}</span>
            </button>
          </div>

          <!-- Active tab content -->
          <div class="p-4" v-if="activePlatform">
            <div class="text-xs text-gray-400 mb-3">{{ activePlatform.accountName }}</div>

            <!-- Version exists -->
            <div v-if="activeVersion">
              <div class="flex items-center gap-2 mb-2">
                <span :class="['px-2 py-0.5 rounded-full text-xs font-medium', statusColor(activeVersion.status)]">
                  {{ statusLabel(activeVersion.status) }}
                </span>
              </div>

              <!-- Text preview -->
              <div class="p-3 rounded-lg bg-gray-50 dark:bg-gray-800 text-sm mb-3 max-h-48 overflow-y-auto whitespace-pre-wrap leading-relaxed">
                {{ activeVersion.body }}
              </div>

              <!-- Hashtags -->
              <div v-if="activeVersion.hashtags.length" class="flex flex-wrap gap-1 mb-3">
                <span v-for="h in activeVersion.hashtags" :key="h" class="text-xs text-brand-600 dark:text-brand-400">#{{ h }}</span>
              </div>

              <!-- Media preview -->
              <div v-if="post.mediaFiles.length" class="grid grid-cols-3 gap-1 mb-3">
                <div v-for="f in post.mediaFiles.slice(0, 6)" :key="f.id" class="aspect-square rounded overflow-hidden bg-gray-100 dark:bg-gray-800">
                  <img v-if="f.mimeType.startsWith('image/')" :src="f.thumbUrl || f.url" class="w-full h-full object-cover" />
                </div>
              </div>

              <!-- Published link -->
              <a v-if="activeVersion.externalUrl" :href="activeVersion.externalUrl" target="_blank"
                class="flex items-center gap-1 text-xs text-green-600 hover:underline mb-3">
                <ExternalLink :size="12" /> Открыть
              </a>

              <!-- Error -->
              <p v-if="activeVersion.publishLogs?.[0]?.status === 'FAILED'" class="text-xs text-red-500 mb-3">
                {{ activeVersion.publishLogs[0].errorMessage }}
              </p>

              <!-- Publish button -->
              <button v-if="activeVersion.status !== 'PUBLISHED'"
                @click="publishVersion(activeVersion.id)"
                :disabled="publishing === activeVersion.id"
                class="w-full flex items-center justify-center gap-2 px-3 py-2 rounded-lg bg-green-600 hover:bg-green-700 text-white text-sm font-medium disabled:opacity-50">
                <Loader2 v-if="publishing === activeVersion.id" :size="16" class="animate-spin" />
                <Send v-else :size="16" />
                {{ publishing === activeVersion.id ? 'Публикация...' : activeVersion.status === 'FAILED' ? 'Повторить' : 'Опубликовать' }}
              </button>

              <div v-if="activeVersion.status === 'PUBLISHED'" class="flex items-center gap-1.5 text-xs text-green-600 dark:text-green-400 mt-1">
                <CheckCircle :size="14" />
                Опубликовано {{ activeVersion.publishedAt ? formatDate(activeVersion.publishedAt) : '' }}
              </div>
            </div>

            <!-- No version yet -->
            <div v-else class="text-center py-6">
              <p class="text-sm text-gray-400 mb-3">Нет версии для {{ activePlatform.platform }}</p>
              <button @click="createVersionForTab" :disabled="creatingVersion"
                class="flex items-center justify-center gap-2 mx-auto px-4 py-2 rounded-lg bg-brand-600 hover:bg-brand-700 text-white text-sm font-medium disabled:opacity-50">
                <Loader2 v-if="creatingVersion" :size="16" class="animate-spin" />
                <Plus v-else :size="16" />
                Создать версию
              </button>
              <p class="text-[10px] text-gray-400 mt-2">Или нажмите "AI адаптировать" для всех платформ сразу</p>
            </div>
          </div>

          <div v-else class="p-6 text-center text-sm text-gray-400">
            Нет подключённых каналов.<br/>
            <router-link to="/settings" class="text-brand-500 hover:underline">Настроить →</router-link>
          </div>
        </div>
      </div>
    </div>

    <!-- AI Image Generation Modal -->
    <div v-if="showAiImage" class="fixed inset-0 z-50 flex items-center justify-center bg-black/50" @click.self="showAiImage = false">
      <div class="bg-white dark:bg-gray-900 rounded-2xl p-6 w-full max-w-md shadow-xl">
        <h2 class="text-lg font-bold mb-4 flex items-center gap-2">
          <Sparkles :size="20" class="text-purple-500" />
          AI Генерация картинки
        </h2>
        <div class="space-y-3">
          <div>
            <label class="block text-sm font-medium mb-1">Описание картинки</label>
            <textarea v-model="aiImagePrompt" rows="3"
              placeholder="Например: SUP-доска на закате в заливе Выборга, тёплые тона, фотореалистично"
              class="w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 focus:ring-2 focus:ring-purple-500 text-sm" />
          </div>
          <div>
            <label class="block text-sm font-medium mb-1">Формат</label>
            <div class="flex gap-2">
              <button v-for="r in (['1:1', '16:9', '9:16'] as const)" :key="r" @click="aiImageRatio = r"
                :class="['px-3 py-1.5 rounded-lg text-xs font-medium border-2 transition-all', aiImageRatio === r ? 'border-purple-500 bg-purple-50 dark:bg-purple-950 text-purple-700 dark:text-purple-300' : 'border-gray-200 dark:border-gray-700 text-gray-500']">
                {{ r === '1:1' ? 'Квадрат' : r === '16:9' ? 'Обложка' : 'Stories' }}
              </button>
            </div>
          </div>
        </div>
        <div class="flex justify-end gap-2 mt-5">
          <button @click="showAiImage = false" class="px-4 py-2 rounded-lg text-sm text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800">Отмена</button>
          <button @click="generateAiImage" :disabled="aiImageLoading || !aiImagePrompt.trim()"
            class="flex items-center gap-2 px-4 py-2 rounded-lg bg-purple-600 hover:bg-purple-700 text-white text-sm font-medium disabled:opacity-50">
            <Loader2 v-if="aiImageLoading" :size="16" class="animate-spin" />
            <Sparkles v-else :size="16" />
            {{ aiImageLoading ? 'Генерация...' : 'Сгенерировать' }}
          </button>
        </div>
      </div>
    </div>
  </div>
</template>
