<script setup lang="ts">
import { ref, onMounted, watch } from 'vue'
import { http } from '@/api/client'
import { useBusinessesStore } from '@/stores/businesses'
import { useRouter } from 'vue-router'
import { useToast } from '@/composables/useToast'
import { statusColor, statusLabel } from '@/composables/useStatus'
import { formatDate } from '@/composables/useFormatters'
import { FileText, Sparkles, Plus, Send, Clock, AlertCircle, Eye, Trash2, Loader2 } from 'lucide-vue-next'

interface PostVersion {
  id: string
  status: string
  platformAccount: { platform: string; accountName: string }
}

interface Post {
  id: string
  title: string | null
  body: string
  postType: string
  status: string
  createdBy: string
  aiModel: string | null
  createdAt: string
  versions: PostVersion[]
  _count: { mediaFiles: number }
}

const businesses = useBusinessesStore()
const router = useRouter()
const toast = useToast()

const posts = ref<Post[]>([])
const loading = ref(true)
const statusFilter = ref('')

// AI modal
const showAiModal = ref(false)
const aiTopic = ref('')
const aiLoading = ref(false)

// Manual create modal
const showCreateModal = ref(false)
const newPost = ref({ title: '', body: '', postType: 'TEXT' })
const createLoading = ref(false)

async function loadPosts() {
  if (!businesses.currentBusiness) return
  loading.value = true
  try {
    const url = `/businesses/${businesses.currentBusiness.id}/posts${statusFilter.value ? '?status=' + statusFilter.value : ''}`
    posts.value = await http.get<Post[]>(url)
  } catch (e) {
    toast.error('Ошибка загрузки постов')
  } finally {
    loading.value = false
  }
}

async function generatePost() {
  if (!businesses.currentBusiness || !aiTopic.value.trim()) return
  aiLoading.value = true
  try {
    const result = await http.post<{ post: Post }>('/ai/generate-post', {
      businessId: businesses.currentBusiness.id,
      topic: aiTopic.value,
    })
    showAiModal.value = false
    aiTopic.value = ''
    router.push(`/posts/${result.post.id}`)
  } catch (e: any) {
    toast.error('Ошибка AI: ' + (e.message || ''))
  } finally {
    aiLoading.value = false
  }
}

async function createPost() {
  if (!businesses.currentBusiness) return
  createLoading.value = true
  try {
    const post = await http.post<Post>('/posts', {
      businessId: businesses.currentBusiness.id,
      title: '',
      body: ' ',
      postType: 'TEXT',
    })
    router.push(`/posts/${post.id}`)
  } catch (e: any) {
    toast.error(e.message || 'Произошла ошибка')
  } finally {
    createLoading.value = false
  }
}

async function createStories() {
  if (!businesses.currentBusiness) return
  createLoading.value = true
  try {
    const post = await http.post<Post>('/posts', {
      businessId: businesses.currentBusiness.id,
      title: '', body: ' ', postType: 'STORIES',
    })
    router.push(`/stories/${post.id}`)
  } catch (e: any) { toast.error(e.message || 'Произошла ошибка') }
  finally { createLoading.value = false }
}

async function deletePost(id: string) {
  if (!confirm('Удалить пост?')) return
  try {
    await http.delete(`/posts/${id}`)
    posts.value = posts.value.filter(p => p.id !== id)
  } catch (e: any) {
    toast.error(e.message || 'Произошла ошибка')
  }
}

onMounted(loadPosts)
watch(() => businesses.currentBusiness?.id, loadPosts)
watch(statusFilter, loadPosts)
</script>

<template>
  <div>
    <!-- Header -->
    <div class="flex items-center justify-between mb-6">
      <h1 class="text-2xl font-bold">Посты</h1>
      <div class="flex items-center gap-2">
        <button
          @click="showAiModal = true"
          class="flex items-center gap-2 px-4 py-2 rounded-lg bg-purple-600 hover:bg-purple-700 text-white text-sm font-medium transition-colors"
        >
          <Sparkles :size="16" />
          AI генерация
        </button>
        <button
          @click="createPost"
          :disabled="createLoading"
          class="flex items-center gap-2 px-4 py-2 rounded-lg bg-brand-600 hover:bg-brand-700 text-white text-sm font-medium transition-colors disabled:opacity-50"
        >
          <Loader2 v-if="createLoading" :size="16" class="animate-spin" />
          <Plus v-else :size="16" />
          Создать пост
        </button>
        <button
          @click="createStories"
          :disabled="createLoading"
          class="flex items-center gap-2 px-4 py-2 rounded-lg bg-orange-500 hover:bg-orange-600 text-white text-sm font-medium transition-colors disabled:opacity-50"
        >
          <Plus :size="16" />
          Stories
        </button>
      </div>
    </div>

    <!-- Filters -->
    <div class="mb-4">
      <select
        v-model="statusFilter"
        class="px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 text-sm focus:ring-2 focus:ring-brand-500"
      >
        <option value="">Все статусы</option>
        <option value="DRAFT">Черновики</option>
        <option value="APPROVED">Одобренные</option>
        <option value="SCHEDULED">Запланированные</option>
        <option value="PUBLISHED">Опубликованные</option>
        <option value="FAILED">С ошибками</option>
      </select>
    </div>

    <!-- Loading -->
    <div v-if="loading" class="text-gray-500 py-8 text-center">Загрузка...</div>

    <!-- Empty -->
    <div v-else-if="posts.length === 0" class="bg-white dark:bg-gray-900 rounded-xl p-8 border border-gray-200 dark:border-gray-800 text-center">
      <FileText :size="48" class="mx-auto text-gray-300 dark:text-gray-600 mb-3" />
      <p class="text-gray-500 mb-4">Нет постов. Создайте первый пост или используйте AI-генерацию!</p>
      <button @click="showAiModal = true" class="px-4 py-2 rounded-lg bg-purple-600 hover:bg-purple-700 text-white text-sm font-medium transition-colors">
        <Sparkles :size="16" class="inline mr-1" /> Сгенерировать пост
      </button>
    </div>

    <!-- Post list -->
    <div v-else class="space-y-3">
      <div
        v-for="post in posts"
        :key="post.id"
        class="bg-white dark:bg-gray-900 rounded-xl p-5 border border-gray-200 dark:border-gray-800 hover:border-brand-300 dark:hover:border-brand-700 transition-colors cursor-pointer"
        @click="router.push(post.postType === 'STORIES' ? `/stories/${post.id}` : `/posts/${post.id}`)"
      >
        <div class="flex items-start justify-between gap-4">
          <div class="flex-1 min-w-0">
            <!-- Title + status -->
            <div class="flex items-center gap-2 mb-2">
              <h3 class="font-semibold truncate">{{ post.title || 'Без заголовка' }}</h3>
              <span :class="['px-2 py-0.5 rounded-full text-xs font-medium shrink-0', statusColor(post.status)]">
                {{ statusLabel(post.status) }}
              </span>
              <span v-if="post.createdBy === 'ai'" class="px-2 py-0.5 rounded-full text-xs font-medium bg-purple-100 text-purple-700 dark:bg-purple-900 dark:text-purple-300 shrink-0">
                AI
              </span>
            </div>

            <!-- Body preview -->
            <p class="text-sm text-gray-500 dark:text-gray-400 line-clamp-2 mb-3">{{ post.body }}</p>

            <!-- Meta -->
            <div class="flex items-center gap-4 text-xs text-gray-400">
              <span>{{ formatDate(post.createdAt) }}</span>
              <span v-if="post.versions.length">
                {{ post.versions.length }} {{ post.versions.length === 1 ? 'версия' : 'версий' }}
                <template v-for="v in post.versions" :key="v.id">
                  <span class="ml-1 px-1.5 py-0.5 rounded bg-gray-100 dark:bg-gray-800 text-[10px]">{{ v.platformAccount.platform }}</span>
                </template>
              </span>
            </div>
          </div>

          <!-- Actions -->
          <button
            @click.stop="deletePost(post.id)"
            class="p-2 rounded-lg text-gray-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-950 transition-colors shrink-0"
          >
            <Trash2 :size="16" />
          </button>
        </div>
      </div>
    </div>

    <!-- AI Modal -->
    <div v-if="showAiModal" class="fixed inset-0 z-50 flex items-center justify-center bg-black/50" @click.self="showAiModal = false">
      <div class="bg-white dark:bg-gray-900 rounded-2xl p-6 w-full max-w-md shadow-xl">
        <h2 class="text-lg font-bold mb-4 flex items-center gap-2">
          <Sparkles :size="20" class="text-purple-500" />
          AI генерация поста
        </h2>
        <div class="mb-4">
          <label class="block text-sm font-medium mb-1.5">Тема поста</label>
          <textarea
            v-model="aiTopic"
            rows="3"
            placeholder="Например: Открытие SUP-сезона 2026 в Выборге"
            class="w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 focus:ring-2 focus:ring-purple-500 focus:border-purple-500 text-sm"
          />
        </div>
        <p class="text-xs text-gray-400 mb-4">AI (Claude Sonnet) сгенерирует текст поста на основе бренд-профиля бизнеса "{{ businesses.currentBusiness?.name }}"</p>
        <div class="flex justify-end gap-2">
          <button @click="showAiModal = false" class="px-4 py-2 rounded-lg text-sm text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800">
            Отмена
          </button>
          <button
            @click="generatePost"
            :disabled="aiLoading || !aiTopic.trim()"
            class="flex items-center gap-2 px-4 py-2 rounded-lg bg-purple-600 hover:bg-purple-700 text-white text-sm font-medium transition-colors disabled:opacity-50"
          >
            <Loader2 v-if="aiLoading" :size="16" class="animate-spin" />
            <Sparkles v-else :size="16" />
            {{ aiLoading ? 'Генерация...' : 'Сгенерировать' }}
          </button>
        </div>
      </div>
    </div>

    <!-- Create Modal -->
    <div v-if="showCreateModal" class="fixed inset-0 z-50 flex items-center justify-center bg-black/50" @click.self="showCreateModal = false">
      <div class="bg-white dark:bg-gray-900 rounded-2xl p-6 w-full max-w-md shadow-xl">
        <h2 class="text-lg font-bold mb-4 flex items-center gap-2">
          <Plus :size="20" class="text-brand-500" />
          Новый пост
        </h2>
        <div class="space-y-3">
          <!-- Post type selector -->
          <div>
            <label class="block text-sm font-medium mb-1.5">Тип</label>
            <div class="flex gap-2">
              <button v-for="t in [{v:'TEXT',l:'Пост'},{v:'STORIES',l:'Stories'}]" :key="t.v"
                @click="newPost.postType = t.v"
                :class="['flex-1 py-2 rounded-lg text-sm font-medium border-2 transition-all',
                  newPost.postType === t.v ? 'border-brand-500 bg-brand-50 dark:bg-brand-950 text-brand-700 dark:text-brand-300' : 'border-gray-200 dark:border-gray-700 text-gray-500']">
                {{ t.l }}
              </button>
            </div>
            <p v-if="newPost.postType === 'STORIES'" class="text-xs text-gray-400 mt-1">Загрузите вертикальное фото/видео (9:16, 1080x1920) в редакторе</p>
          </div>
          <div>
            <label class="block text-sm font-medium mb-1.5">Заголовок (необязательно)</label>
            <input
              v-model="newPost.title"
              placeholder="Заголовок поста"
              class="w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 focus:ring-2 focus:ring-brand-500 text-sm"
            />
          </div>
          <div>
            <label class="block text-sm font-medium mb-1.5">{{ newPost.postType === 'STORIES' ? 'Описание (необязательно)' : 'Текст поста' }}</label>
            <textarea
              v-model="newPost.body"
              :rows="newPost.postType === 'STORIES' ? 2 : 5"
              :placeholder="newPost.postType === 'STORIES' ? 'Краткое описание для истории...' : 'Текст вашего поста...'"
              class="w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 focus:ring-2 focus:ring-brand-500 text-sm"
            />
          </div>
        </div>
        <div class="flex justify-end gap-2 mt-4">
          <button @click="showCreateModal = false" class="px-4 py-2 rounded-lg text-sm text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800">
            Отмена
          </button>
          <button
            @click="createPost"
            :disabled="createLoading || !newPost.body.trim()"
            class="flex items-center gap-2 px-4 py-2 rounded-lg bg-brand-600 hover:bg-brand-700 text-white text-sm font-medium disabled:opacity-50"
          >
            <Loader2 v-if="createLoading" :size="16" class="animate-spin" />
            Создать
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.line-clamp-2 {
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}
</style>
