<script setup lang="ts">
import { ref, onMounted, computed, watch } from 'vue'
import { useRoute, useRouter, onBeforeRouteLeave } from 'vue-router'
import { http } from '@/api/client'
import { useBusinessesStore } from '@/stores/businesses'
import { useToast } from '@/composables/useToast'
import { statusColor, statusLabel } from '@/composables/useStatus'
import { formatDate } from '@/composables/useFormatters'
import { platformColor } from '@/composables/usePlatform'
import MediaUpload from '@/components/MediaUpload.vue'
import {
  ArrowLeft, Send, Save, Plus, Sparkles, Loader2, ExternalLink,
  AlertCircle, CheckCircle, XCircle, Image, Wand2, Info,
  Scissors, MessageSquare, RefreshCw, Type
} from 'lucide-vue-next'

interface MediaFile { id: string; url: string; thumbUrl: string | null; filename: string; mimeType: string; sizeBytes: number }
interface PlatformAccount { id: string; platform: string; accountName: string }
interface PostVersion {
  id: string; body: string; hashtags: string[]; status: string
  publishedAt: string | null; externalPostId: string | null; externalUrl: string | null
  platformAccount: PlatformAccount
  publishLogs: { status: string; errorMessage: string | null; attemptedAt: string }[]
}
interface Post {
  id: string; businessId: string; title: string | null; body: string; postType: string
  hashtags: string[]; status: string; createdBy: string; aiModel: string | null; createdAt: string
  versions: PostVersion[]; mediaFiles: MediaFile[]
}

const route = useRoute()
const router = useRouter()
const businesses = useBusinessesStore()
const toast = useToast()

const post = ref<Post | null>(null)
const loading = ref(true)
const saving = ref(false)
const publishing = ref<string | null>(null)
const adapting = ref(false)
const aiActionLoading = ref<string | null>(null)
const originalBody = ref('') // для защиты от потери изменений

// Platform tabs
const platforms = ref<PlatformAccount[]>([])
const activeTab = ref('')

// AI Image
const showAiImage = ref(false)
const aiImagePrompt = ref('')
const aiImageLoading = ref(false)
const aiImageRatio = ref<'1:1' | '16:9' | '9:16'>('1:1')

// Platform character limits
const PLATFORM_LIMITS: Record<string, number> = { VK: 4096, TELEGRAM: 4096, INSTAGRAM: 2200 }

// Stories text position
const storyTextPosition = ref<'top' | 'center' | 'bottom'>('bottom')

async function loadPost() {
  loading.value = true
  try {
    post.value = await http.get<Post>(`/posts/${route.params.id}`)
    if (post.value) {
      originalBody.value = post.value.body
      platforms.value = await http.get<PlatformAccount[]>(`/businesses/${post.value.businessId}/platforms`)
      if (post.value.versions.length) activeTab.value = post.value.versions[0].platformAccount.id
      else if (platforms.value.length) activeTab.value = platforms.value[0].id
      // Stories → redirect to StoryEditor
      if (post.value.postType === 'STORIES') {
        router.replace(`/stories/${post.value.id}`)
        return
      }
    }
  } catch (e) { toast.error('Ошибка загрузки поста') }
  finally { loading.value = false }
}

async function savePost() {
  if (!post.value) return
  saving.value = true
  try {
    await http.put(`/posts/${post.value.id}`, { title: post.value.title, body: post.value.body, postType: post.value.postType })
    originalBody.value = post.value.body
    toast.success('Сохранено')
  } catch (e: any) { toast.error('Ошибка сохранения: ' + (e.message || e)) }
  finally { saving.value = false }
}

async function publishVersion(versionId: string) {
  publishing.value = versionId
  try {
    const result = await http.post<{ success: boolean; externalUrl: string | null; error: string | null }>(`/post-versions/${versionId}/publish`, {})
    if (result.success) {
      toast.success(`Опубликовано${result.externalUrl ? '' : ''}`)
    } else {
      toast.error('Ошибка: ' + result.error)
    }
    await loadPost()
  } catch (e: any) { toast.error('Ошибка: ' + (e.message || e)) }
  finally { publishing.value = null }
}

async function adaptToAllPlatforms() {
  if (!post.value || !platforms.value.length) return
  adapting.value = true
  try {
    await http.post('/ai/adapt', { postId: post.value.id, platformAccountIds: platforms.value.map(p => p.id) })
    toast.success('Версии адаптированы для всех платформ')
    await loadPost()
  } catch (e: any) { toast.error('Ошибка адаптации: ' + (e.message || e)) }
  finally { adapting.value = false }
}

async function aiAction(action: string, label: string) {
  if (!post.value || !post.value.body.trim()) { toast.info('Сначала введите текст'); return }
  aiActionLoading.value = action
  try {
    const prompts: Record<string, string> = {
      improve: `Улучши этот текст для поста в соцсети. Сделай его живее, добавь эмоции. Сохрани смысл. Верни только текст:`,
      shorten: `Сократи этот текст до 2-3 предложений для Stories. Сохрани главную мысль. Только текст:`,
      cta: `Добавь призыв к действию (CTA) в конец этого текста. Естественно, без навязчивости. Верни весь текст с CTA:`,
      rephrase: `Перефразируй этот текст другими словами. Сохрани смысл и длину. Только текст:`,
    }
    const result = await http.post<{ post: { body: string } }>('/ai/generate-post', {
      businessId: post.value.businessId,
      topic: prompts[action] + '\n\n' + post.value.body,
    })
    post.value.body = result.post.body
    toast.success(label)
  } catch (e: any) { toast.error('Ошибка AI: ' + (e.message || e)) }
  finally { aiActionLoading.value = null }
}

async function generateAiImage() {
  if (!post.value || !aiImagePrompt.value.trim()) return
  aiImageLoading.value = true
  try {
    const result = await http.post<{ mediaFile: MediaFile }>('/ai/generate-image', {
      businessId: post.value.businessId, postId: post.value.id,
      prompt: aiImagePrompt.value, aspectRatio: aiImageRatio.value,
    })
    post.value.mediaFiles.push(result.mediaFile)
    showAiImage.value = false
    aiImagePrompt.value = ''
    toast.success('Картинка сгенерирована')
  } catch (e: any) { toast.error('Ошибка: ' + (e.message || e)) }
  finally { aiImageLoading.value = false }
}

function onMediaUploaded(file: MediaFile) {
  if (post.value) {
    post.value.mediaFiles.push(file)
    http.post(`/media/${file.id}/attach`, { postId: post.value.id }).catch(() => {})
    toast.success('Файл загружен')
  }
}

function onMediaRemoved(id: string) {
  if (post.value) { post.value.mediaFiles = post.value.mediaFiles.filter(f => f.id !== id); toast.info('Файл удалён') }
}

async function createVersionForTab() {
  if (!post.value || !activeTab.value) return
  try {
    await http.post(`/posts/${post.value.id}/versions`, {
      platformAccountId: activeTab.value, body: post.value.body, hashtags: post.value.hashtags,
    })
    toast.success('Версия создана')
    await loadPost()
  } catch (e: any) { toast.error('Ошибка: ' + (e.message || e)) }
}

const activeVersion = computed(() => post.value?.versions.find(v => v.platformAccount.id === activeTab.value))
const activePlatform = computed(() => platforms.value.find(p => p.id === activeTab.value))
const isStories = computed(() => post.value?.postType === 'STORIES')
const hasUnsavedChanges = computed(() => post.value && post.value.body !== originalBody.value)
const readyCount = computed(() => post.value?.versions.filter(v => ['PUBLISHED', 'APPROVED'].includes(v.status)).length || 0)

function charCountColor(len: number, limit: number) {
  if (len > limit) return 'text-red-500'
  if (len > limit * 0.8) return 'text-yellow-500'
  return 'text-green-500'
}

function statusDot(platform: PlatformAccount) {
  const v = post.value?.versions.find(ver => ver.platformAccount.id === platform.id)
  if (!v) return 'bg-gray-300 dark:bg-gray-600'
  if (v.status === 'PUBLISHED') return 'bg-green-500'
  if (v.status === 'FAILED') return 'bg-red-500'
  if (v.status === 'SCHEDULED') return 'bg-amber-500'
  return 'bg-blue-400'
}

onBeforeRouteLeave(() => {
  if (hasUnsavedChanges.value) return confirm('Есть несохранённые изменения. Уйти?')
})

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
      <!-- LEFT PANEL (3/5) -->
      <div class="lg:col-span-3 space-y-4">

        <!-- Header -->
        <div class="bg-white dark:bg-gray-900 rounded-xl p-6 border border-gray-200 dark:border-gray-800">
          <div class="flex items-center justify-between mb-4">
            <div class="flex items-center gap-2 flex-wrap">
              <span class="text-sm font-bold text-gray-400">Пост</span>
              <span :class="['px-2 py-0.5 rounded-full text-xs font-medium', statusColor(post.status)]">{{ statusLabel(post.status) }}</span>
              <span v-if="post.createdBy === 'ai'" class="px-2 py-0.5 rounded-full text-xs font-medium bg-purple-100 text-purple-700 dark:bg-purple-900 dark:text-purple-300">AI</span>
              <span class="text-xs text-gray-400">{{ readyCount }}/{{ platforms.length }} платформ</span>
            </div>
            <span class="text-xs text-gray-400">{{ formatDate(post.createdAt) }}</span>
          </div>

          <!-- Title -->
          <div class="mb-3">
            <label class="block text-sm font-medium mb-1">Заголовок</label>
            <input v-model="post.title" placeholder="Заголовок (необязательно)"
              class="w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 focus:ring-2 focus:ring-brand-500 text-sm" />
          </div>

          <!-- Body -->
          <div class="mb-2">
            <div class="flex items-center gap-2 mb-1">
              <label class="text-sm font-medium">{{ isStories ? 'Текст для наложения на фото' : 'Мастер-текст' }}</label>
              <span class="text-[10px] text-gray-400 flex items-center gap-0.5" :title="isStories ? 'Текст будет наложен на фото при публикации Stories' : 'Основной текст. AI адаптирует его для каждой платформы.'">
                <Info :size="12" /> {{ isStories ? 'Наложится на фото' : 'AI адаптирует для платформ' }}
              </span>
            </div>
            <textarea v-model="post.body" :rows="isStories ? 3 : 8"
              :placeholder="isStories ? 'Короткий текст для истории...' : 'Текст вашего поста...'"
              class="w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 focus:ring-2 focus:ring-brand-500 text-sm leading-relaxed" />
          </div>

          <!-- Char counters -->
          <div class="flex items-center gap-3 mb-3 text-[11px]">
            <span v-for="(limit, platform) in PLATFORM_LIMITS" :key="platform" :class="charCountColor(post.body.length, limit)">
              {{ post.body.length }}/{{ limit }} {{ platform }}
            </span>
            <span v-if="hasUnsavedChanges" class="text-amber-500 ml-auto">Не сохранено</span>
          </div>

          <!-- AI quick actions -->
          <div class="flex items-center gap-2 flex-wrap mb-3">
            <button @click="aiAction('improve', 'Текст улучшен')" :disabled="!!aiActionLoading"
              class="flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-[11px] font-medium bg-purple-50 dark:bg-purple-950 text-purple-700 dark:text-purple-300 hover:bg-purple-100 dark:hover:bg-purple-900 disabled:opacity-50">
              <Loader2 v-if="aiActionLoading === 'improve'" :size="12" class="animate-spin" /><Sparkles v-else :size="12" /> Улучшить
            </button>
            <button @click="aiAction('shorten', 'Текст сокращён')" :disabled="!!aiActionLoading"
              class="flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-[11px] font-medium bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-gray-700 disabled:opacity-50">
              <Loader2 v-if="aiActionLoading === 'shorten'" :size="12" class="animate-spin" /><Scissors v-else :size="12" /> Сократить
            </button>
            <button @click="aiAction('cta', 'CTA добавлен')" :disabled="!!aiActionLoading"
              class="flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-[11px] font-medium bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-gray-700 disabled:opacity-50">
              <Loader2 v-if="aiActionLoading === 'cta'" :size="12" class="animate-spin" /><MessageSquare v-else :size="12" /> + CTA
            </button>
            <button @click="aiAction('rephrase', 'Текст перефразирован')" :disabled="!!aiActionLoading"
              class="flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-[11px] font-medium bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-gray-700 disabled:opacity-50">
              <Loader2 v-if="aiActionLoading === 'rephrase'" :size="12" class="animate-spin" /><RefreshCw v-else :size="12" /> Перефразировать
            </button>
          </div>

          <!-- Action buttons -->
          <div class="flex items-center gap-2">
            <button @click="savePost" :disabled="saving"
              class="flex items-center gap-2 px-4 py-2 rounded-lg bg-brand-600 hover:bg-brand-700 text-white text-sm font-medium disabled:opacity-50">
              <Loader2 v-if="saving" :size="16" class="animate-spin" /><Save v-else :size="16" /> Сохранить
            </button>
            <button v-if="!isStories" @click="adaptToAllPlatforms" :disabled="adapting || !platforms.length"
              class="flex items-center gap-2 px-4 py-2 rounded-lg bg-purple-600 hover:bg-purple-700 text-white text-sm font-medium disabled:opacity-50">
              <Loader2 v-if="adapting" :size="16" class="animate-spin" /><Wand2 v-else :size="16" /> AI адаптировать
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
              class="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-purple-100 dark:bg-purple-900 text-purple-700 dark:text-purple-300 text-xs font-medium hover:bg-purple-200 dark:hover:bg-purple-800">
              <Sparkles :size="14" /> AI Картинка
            </button>
          </div>

          <!-- Stories hint -->
          <div v-if="isStories" class="flex items-start gap-2 p-3 rounded-lg bg-orange-50 dark:bg-orange-950 border border-orange-200 dark:border-orange-800 mb-3 text-xs text-orange-700 dark:text-orange-300">
            <Info :size="14" class="shrink-0 mt-0.5" />
            <div>
              <strong>Stories:</strong> вертикальное фото/видео 1080x1920 (9:16). Видео до 15 сек.
              Текст будет наложен поверх фото при публикации.
              <div class="flex gap-2 mt-2">
                <span class="text-[10px]">Позиция текста:</span>
                <button v-for="pos in (['top','center','bottom'] as const)" :key="pos" @click="storyTextPosition = pos"
                  :class="['px-2 py-0.5 rounded text-[10px]', storyTextPosition === pos ? 'bg-orange-200 dark:bg-orange-800 font-bold' : 'bg-orange-100 dark:bg-orange-900']">
                  {{ {top:'Вверху',center:'Центр',bottom:'Внизу'}[pos] }}
                </button>
              </div>
            </div>
          </div>

          <MediaUpload :business-id="post.businessId" :post-id="post.id" :files="post.mediaFiles" @uploaded="onMediaUploaded" @removed="onMediaRemoved" />
        </div>
      </div>

      <!-- RIGHT PANEL (2/5): Platform versions -->
      <div class="lg:col-span-2">
        <div class="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 overflow-hidden lg:sticky lg:top-6">
          <!-- Platform tabs with status dots -->
          <div v-if="platforms.length" class="flex border-b border-gray-200 dark:border-gray-800 overflow-x-auto">
            <button v-for="p in platforms" :key="p.id" @click="activeTab = p.id"
              :class="['flex-1 min-w-0 px-3 py-3 text-sm font-medium border-b-2 transition-colors whitespace-nowrap flex items-center justify-center gap-1.5',
                activeTab === p.id ? 'border-brand-500 text-brand-600 dark:text-brand-400' : 'border-transparent text-gray-500 hover:text-gray-700']">
              <span :class="['w-2 h-2 rounded-full shrink-0', statusDot(p)]"></span>
              <span :class="platformColor(p.platform)">{{ p.platform }}</span>
            </button>
          </div>

          <div class="p-4" v-if="activePlatform">
            <div class="text-xs text-gray-400 mb-3">{{ activePlatform.accountName }}</div>

            <!-- Version exists -->
            <div v-if="activeVersion">
              <div class="flex items-center gap-2 mb-2">
                <span :class="['px-2 py-0.5 rounded-full text-xs font-medium', statusColor(activeVersion.status)]">{{ statusLabel(activeVersion.status) }}</span>
              </div>

              <div class="p-3 rounded-lg bg-gray-50 dark:bg-gray-800 text-sm mb-3 max-h-64 overflow-y-auto whitespace-pre-wrap leading-relaxed">{{ activeVersion.body }}</div>

              <div v-if="activeVersion.hashtags.length" class="flex flex-wrap gap-1 mb-3">
                <span v-for="h in activeVersion.hashtags" :key="h" class="text-xs px-1.5 py-0.5 rounded bg-brand-50 dark:bg-brand-950 text-brand-600 dark:text-brand-400">#{{ h }}</span>
              </div>

              <!-- Media preview -->
              <div v-if="post.mediaFiles.length" class="grid grid-cols-3 gap-1 mb-3">
                <div v-for="f in post.mediaFiles.slice(0, 6)" :key="f.id" class="aspect-square rounded overflow-hidden bg-gray-100 dark:bg-gray-800">
                  <img v-if="f.mimeType.startsWith('image/')" :src="f.thumbUrl || f.url" class="w-full h-full object-cover" />
                </div>
              </div>

              <a v-if="activeVersion.externalUrl" :href="activeVersion.externalUrl" target="_blank" class="flex items-center gap-1 text-xs text-green-600 hover:underline mb-3">
                <ExternalLink :size="12" /> Открыть
              </a>

              <!-- Error card (prominent!) -->
              <div v-if="activeVersion.publishLogs?.[0]?.status === 'FAILED'" class="p-3 rounded-lg bg-red-50 dark:bg-red-950 border border-red-200 dark:border-red-800 mb-3">
                <div class="flex items-start gap-2">
                  <AlertCircle :size="16" class="text-red-500 shrink-0 mt-0.5" />
                  <div>
                    <div class="text-sm font-medium text-red-700 dark:text-red-300">Ошибка публикации</div>
                    <div class="text-xs text-red-600 dark:text-red-400 mt-1">{{ activeVersion.publishLogs[0].errorMessage }}</div>
                    <div class="text-[10px] text-red-400 mt-1">{{ formatDate(activeVersion.publishLogs[0].attemptedAt) }}</div>
                  </div>
                </div>
              </div>

              <!-- Published success -->
              <div v-if="activeVersion.status === 'PUBLISHED'" class="flex items-center gap-1.5 text-xs text-green-600 dark:text-green-400 mb-3">
                <CheckCircle :size="14" />
                Опубликовано {{ activeVersion.publishedAt ? formatDate(activeVersion.publishedAt) : '' }}
              </div>

              <!-- Publish button -->
              <button v-if="activeVersion.status !== 'PUBLISHED'" @click="publishVersion(activeVersion.id)" :disabled="publishing === activeVersion.id"
                class="w-full flex items-center justify-center gap-2 px-3 py-2.5 rounded-lg bg-green-600 hover:bg-green-700 text-white text-sm font-medium disabled:opacity-50">
                <Loader2 v-if="publishing === activeVersion.id" :size="16" class="animate-spin" /><Send v-else :size="16" />
                {{ publishing === activeVersion.id ? 'Публикация...' : activeVersion.status === 'FAILED' ? 'Повторить' : isStories ? 'Опубликовать историю' : 'Опубликовать' }}
              </button>
            </div>

            <!-- No version — prominent CTA -->
            <div v-else class="text-center py-6">
              <div class="w-12 h-12 mx-auto rounded-full bg-gray-100 dark:bg-gray-800 flex items-center justify-center mb-3">
                <Plus :size="24" class="text-gray-400" />
              </div>
              <p class="text-sm text-gray-400 mb-1">Нет версии для {{ activePlatform.platform }}</p>
              <p class="text-[10px] text-gray-400 mb-4">Или нажмите "AI адаптировать" для всех платформ</p>
              <button @click="createVersionForTab"
                class="w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg bg-brand-600 hover:bg-brand-700 text-white text-sm font-medium">
                <Plus :size="16" /> Создать версию
              </button>
            </div>
          </div>

          <div v-else class="p-6 text-center text-sm text-gray-400">
            Нет подключённых каналов.<br>
            <router-link to="/settings" class="text-brand-500 hover:underline">Настроить →</router-link>
          </div>
        </div>
      </div>
    </div>

    <!-- AI Image Modal -->
    <div v-if="showAiImage" class="fixed inset-0 z-50 flex items-center justify-center bg-black/50" @click.self="showAiImage = false">
      <div class="bg-white dark:bg-gray-900 rounded-2xl p-6 w-full max-w-md shadow-xl">
        <h2 class="text-lg font-bold mb-4 flex items-center gap-2"><Sparkles :size="20" class="text-purple-500" /> AI Картинка</h2>
        <div class="space-y-3">
          <div>
            <label class="block text-sm font-medium mb-1">Описание</label>
            <textarea v-model="aiImagePrompt" rows="3" placeholder="SUP-доска на закате в заливе Выборга..."
              class="w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 focus:ring-2 focus:ring-purple-500 text-sm" />
          </div>
          <div>
            <label class="block text-sm font-medium mb-1">Формат</label>
            <div class="flex gap-2">
              <button v-for="r in (['1:1', '16:9', '9:16'] as const)" :key="r" @click="aiImageRatio = r"
                :class="['px-3 py-1.5 rounded-lg text-xs font-medium border-2', aiImageRatio === r ? 'border-purple-500 bg-purple-50 dark:bg-purple-950 text-purple-700 dark:text-purple-300' : 'border-gray-200 dark:border-gray-700 text-gray-500']">
                {{ r === '1:1' ? 'Квадрат' : r === '16:9' ? 'Обложка' : 'Stories' }}
              </button>
            </div>
          </div>
        </div>
        <div class="flex justify-end gap-2 mt-5">
          <button @click="showAiImage = false" class="px-4 py-2 rounded-lg text-sm text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800">Отмена</button>
          <button @click="generateAiImage" :disabled="aiImageLoading || !aiImagePrompt.trim()"
            class="flex items-center gap-2 px-4 py-2 rounded-lg bg-purple-600 hover:bg-purple-700 text-white text-sm font-medium disabled:opacity-50">
            <Loader2 v-if="aiImageLoading" :size="16" class="animate-spin" /><Sparkles v-else :size="16" />
            {{ aiImageLoading ? 'Генерация...' : 'Сгенерировать' }}
          </button>
        </div>
      </div>
    </div>
  </div>
</template>
