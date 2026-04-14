<script setup lang="ts">
import { ref, onMounted, watch } from 'vue'
import { http } from '@/api/client'
import { useBusinessesStore } from '@/stores/businesses'
import { useRouter } from 'vue-router'
import { useToast } from '@/composables/useToast'
import { statusColor, statusLabel } from '@/composables/useStatus'
import { formatDate } from '@/composables/useFormatters'
import { platformColor } from '@/composables/usePlatform'
import { Film, Plus, Send, Trash2, Loader2, ChevronDown } from 'lucide-vue-next'
import BusinessFilter from '@/components/BusinessFilter.vue'
import { useSectionAccess } from '@/composables/useSectionAccess'

const { canEdit: canEditPosts } = useSectionAccess()

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
  business?: { name: string }
  mediaFiles?: { thumbUrl: string | null; url: string }[]
  _count: { mediaFiles: number }
}

const businesses = useBusinessesStore()
const router = useRouter()
const toast = useToast()

const posts = ref<Post[]>([])
const loading = ref(true)
const createLoading = ref(false)
const statusFilter = ref('')

// Quick publish
const publishingId = ref<string | null>(null)
const publishDropdownId = ref<string | null>(null)

// Confirm delete
const deleteConfirmId = ref<string | null>(null)

async function loadPosts() {
  if (!businesses.currentBusiness) return
  loading.value = true
  try {
    let url = `/businesses/${businesses.currentBusiness.id}/posts?postType=STORIES`
    if (statusFilter.value) url += `&status=${statusFilter.value}`
    posts.value = await http.get<Post[]>(url)
  } catch (e) {
    toast.error('Ошибка загрузки')
  } finally {
    loading.value = false
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
  } catch (e: any) {
    toast.error(e.message || 'Произошла ошибка')
  } finally {
    createLoading.value = false
  }
}

async function quickPublish(versionId: string, postId: string) {
  publishingId.value = postId
  publishDropdownId.value = null
  try {
    await http.post(`/post-versions/${versionId}/publish`, {})
    toast.success('Опубликовано!')
    await loadPosts()
  } catch (e: any) {
    toast.error(e.message || 'Ошибка публикации')
  } finally {
    publishingId.value = null
  }
}

async function deletePost(id: string) {
  deleteConfirmId.value = null
  try {
    await http.delete(`/posts/${id}`)
    posts.value = posts.value.filter(p => p.id !== id)
    toast.success('Удалено')
  } catch (e: any) {
    toast.error(e.message || 'Произошла ошибка')
  }
}

function getThumb(post: Post): string | null {
  if (post.mediaFiles && post.mediaFiles.length > 0) {
    return post.mediaFiles[0].thumbUrl || post.mediaFiles[0].url
  }
  return null
}

onMounted(loadPosts)
watch(() => businesses.currentBusiness?.id, loadPosts)
watch(statusFilter, loadPosts)
</script>

<template>
  <div>
    <!-- Header -->
    <div class="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-5">
      <h1 class="text-xl md:text-2xl font-bold">Stories</h1>
      <button v-if="canEditPosts('posts')"
        @click="createStories"
        :disabled="createLoading"
        class="flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg bg-brand-600 hover:bg-brand-700 text-white text-sm font-medium transition-colors disabled:opacity-50 shrink-0"
      >
        <Loader2 v-if="createLoading" :size="16" class="animate-spin" />
        <Plus v-else :size="16" />
        Создать историю
      </button>
    </div>

    <!-- Business filter -->
    <BusinessFilter
      :model-value="businesses.currentBusinessId!"
      @update:model-value="(id: string) => { businesses.setCurrent(id); loadPosts() }"
    />

    <!-- Status filter -->
    <div class="mb-4">
      <select
        v-model="statusFilter"
        class="w-full sm:w-auto px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 text-sm focus:ring-2 focus:ring-brand-500"
      >
        <option value="">Все статусы</option>
        <option value="DRAFT">Черновики</option>
        <option value="APPROVED">Одобренные</option>
        <option value="SCHEDULED">Запланированные</option>
        <option value="PUBLISHED">Опубликованные</option>
        <option value="FAILED">С ошибками</option>
      </select>
    </div>

    <!-- Skeleton loader -->
    <div v-if="loading" class="space-y-3">
      <div v-for="i in 4" :key="i" class="bg-white dark:bg-gray-900 rounded-xl p-4 border border-gray-200 dark:border-gray-800 animate-pulse">
        <div class="flex gap-3">
          <div class="w-16 h-16 md:w-20 md:h-20 bg-gray-200 dark:bg-gray-700 rounded-lg shrink-0"></div>
          <div class="flex-1 space-y-2">
            <div class="h-4 bg-gray-200 dark:bg-gray-700 rounded w-1/3"></div>
            <div class="h-3 bg-gray-200 dark:bg-gray-700 rounded w-2/3"></div>
            <div class="h-3 bg-gray-200 dark:bg-gray-700 rounded w-1/4"></div>
          </div>
        </div>
      </div>
    </div>

    <!-- Empty state -->
    <div v-else-if="posts.length === 0" class="bg-white dark:bg-gray-900 rounded-xl p-8 border border-gray-200 dark:border-gray-800 text-center">
      <Film :size="48" class="mx-auto text-gray-300 dark:text-gray-600 mb-3" />
      <p class="text-gray-500 mb-4">Нет историй. Создайте первую!</p>
      <button
        @click="createStories"
        :disabled="createLoading"
        class="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-brand-600 hover:bg-brand-700 text-white text-sm font-medium transition-colors disabled:opacity-50"
      >
        <Plus :size="16" />
        Создать первую историю
      </button>
    </div>

    <!-- Stories list -->
    <div v-else class="space-y-3">
      <div
        v-for="post in posts"
        :key="post.id"
        class="bg-white dark:bg-gray-900 rounded-xl p-4 border border-gray-200 dark:border-gray-800 hover:border-brand-300 dark:hover:border-brand-700 transition-colors cursor-pointer min-h-[100px]"
        @click="router.push(`/stories/${post.id}`)"
      >
        <div class="flex gap-3">
          <!-- Thumbnail -->
          <div class="w-16 h-16 md:w-20 md:h-20 bg-gray-100 dark:bg-gray-800 rounded-lg shrink-0 overflow-hidden flex items-center justify-center">
            <img
              v-if="getThumb(post)"
              :src="getThumb(post)!"
              class="w-full h-full object-cover"
              loading="lazy"
            />
            <Film v-else :size="24" class="text-gray-300 dark:text-gray-600" />
          </div>

          <!-- Content -->
          <div class="flex-1 min-w-0">
            <div class="flex items-center gap-2 mb-1 flex-wrap">
              <h3 class="font-semibold text-sm md:text-base truncate">{{ post.title || 'Без заголовка' }}</h3>
              <span :class="['px-2 py-0.5 rounded-full text-[10px] md:text-xs font-medium shrink-0', statusColor(post.status)]">
                {{ statusLabel(post.status) }}
              </span>
            </div>

            <!-- Body preview -->
            <p class="text-xs md:text-sm text-gray-500 dark:text-gray-400 line-clamp-1 mb-2">{{ post.body?.trim() || '—' }}</p>

            <!-- Meta row -->
            <div class="flex items-center gap-2 md:gap-3 flex-wrap text-[10px] md:text-xs text-gray-400">
              <span v-if="post.business" class="px-1.5 py-0.5 rounded bg-gray-100 dark:bg-gray-800 font-medium text-gray-500 dark:text-gray-400">
                {{ post.business.name }}
              </span>
              <span>{{ formatDate(post.createdAt) }}</span>
              <span v-if="post.versions.length">
                <template v-for="v in post.versions" :key="v.id">
                  <span :class="['ml-0.5 px-1.5 py-0.5 rounded font-medium', platformColor(v.platformAccount.platform)]">
                    {{ v.platformAccount.platform }}
                  </span>
                </template>
              </span>
            </div>
          </div>

          <!-- Actions -->
          <div class="flex flex-col items-end gap-1 shrink-0" @click.stop>
            <!-- Quick publish -->
            <div v-if="post.versions.some(v => v.status === 'DRAFT' || v.status === 'APPROVED')" class="relative">
              <button
                @click="publishDropdownId = publishDropdownId === post.id ? null : post.id"
                :disabled="publishingId === post.id"
                class="flex items-center gap-1 px-2 py-1.5 rounded-lg text-xs font-medium bg-green-50 text-green-700 hover:bg-green-100 dark:bg-green-950 dark:text-green-300 dark:hover:bg-green-900 transition-colors disabled:opacity-50"
              >
                <Loader2 v-if="publishingId === post.id" :size="14" class="animate-spin" />
                <Send v-else :size="14" />
                <ChevronDown :size="10" />
              </button>
              <div v-if="publishDropdownId === post.id" class="absolute right-0 top-full mt-1 bg-white dark:bg-gray-800 rounded-lg shadow-lg border border-gray-200 dark:border-gray-700 py-1 z-10 min-w-[140px]">
                <button
                  v-for="v in post.versions.filter(v => v.status === 'DRAFT' || v.status === 'APPROVED')"
                  :key="v.id"
                  @click="quickPublish(v.id, post.id)"
                  class="w-full flex items-center gap-2 px-3 py-2 text-sm hover:bg-gray-50 dark:hover:bg-gray-700 text-left"
                >
                  <span :class="['font-medium', platformColor(v.platformAccount.platform)]">{{ v.platformAccount.platform }}</span>
                  <span class="text-xs text-gray-400 truncate">{{ v.platformAccount.accountName }}</span>
                </button>
              </div>
            </div>

            <!-- Delete -->
            <button
              @click="deleteConfirmId = post.id"
              class="p-1.5 rounded-lg text-gray-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-950 transition-colors"
            >
              <Trash2 :size="14" />
            </button>
          </div>
        </div>
      </div>
    </div>

    <!-- Delete confirmation modal -->
    <Teleport to="body">
      <div
        v-if="deleteConfirmId"
        class="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
        @click.self="deleteConfirmId = null"
      >
        <div class="bg-white dark:bg-gray-900 rounded-2xl p-5 w-full max-w-sm shadow-xl">
          <h3 class="text-base font-bold mb-2">Удалить историю?</h3>
          <p class="text-sm text-gray-500 mb-4">Это действие нельзя отменить. История и все её версии будут удалены.</p>
          <div class="flex gap-2">
            <button
              @click="deleteConfirmId = null"
              class="flex-1 px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-700 text-sm font-medium text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800"
            >
              Отмена
            </button>
            <button
              @click="deletePost(deleteConfirmId!)"
              class="flex-1 px-3 py-2 rounded-lg bg-red-600 hover:bg-red-700 text-white text-sm font-medium"
            >
              Удалить
            </button>
          </div>
        </div>
      </div>
    </Teleport>
  </div>
</template>

<style scoped>
.line-clamp-1 {
  display: -webkit-box;
  -webkit-line-clamp: 1;
  -webkit-box-orient: vertical;
  overflow: hidden;
}
</style>
