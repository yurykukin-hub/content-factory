<script setup lang="ts">
import { ref, onMounted, computed } from 'vue'
import { useRoute, useRouter, onBeforeRouteLeave } from 'vue-router'
import { http } from '@/api/client'
import { useToast } from '@/composables/useToast'
import { statusColor, statusLabel } from '@/composables/useStatus'
import { formatDate } from '@/composables/useFormatters'
import { platformColor, platformLabel } from '@/composables/usePlatform'
import {
  platformLimit, charCountColor, formatNeedsVideo, formatNeedsImage, formatHint as fmtHint,
} from '@/composables/usePlatformLimits'
import { platformNote } from '@/composables/usePlatformRegistry'
import MediaUpload from '@/components/MediaUpload.vue'
import MediaPickerModal from '@/components/MediaPickerModal.vue'
import PostPreview from '@/components/posts/preview/PostPreview.vue'
import {
  ArrowLeft, Send, Save, Sparkles, Loader2, ExternalLink,
  AlertCircle, Image, Images, Wand2, Info,
  Scissors, MessageSquare, RefreshCw, Clock, ChevronDown, Calendar,
  FileText, Settings2, X,
} from 'lucide-vue-next'

interface MediaFile { id: string; url: string; thumbUrl: string | null; filename: string; mimeType: string; sizeBytes: number }
interface PlatformAccount { id: string; platform: string; accountName: string }
interface PostVersion {
  id: string; body: string; hashtags: string[]; status: string
  scheduledAt?: string | null
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
const toast = useToast()

const post = ref<Post | null>(null)
const loading = ref(true)
const saving = ref(false)
const scheduling = ref<string | null>(null)
const adapting = ref(false)
const adaptingOne = ref<string | null>(null)
const aiActionLoading = ref<string | null>(null)
const originalBody = ref('') // защита от потери изменений

const platforms = ref<PlatformAccount[]>([])

// Каналы + единая публикация (Фаза 1/2)
const selectedChannels = ref<string[]>([])
const publishingAll = ref(false)
const scheduleAtAll = ref('')

// Публикация: дропдаун + режим планирования (Фаза 2)
const publishMenuOpen = ref(false)
const scheduleMode = ref(false)
const expandedChannelId = ref<string | null>(null)

// Phase 4: per-channel оверрайды (черновик правки на канал) + per-channel publish
interface OverrideDraft { body: string; saving: boolean; dirty: boolean }
const overrideDrafts = ref<Record<string, OverrideDraft>>({})
const publishingOne = ref<string | null>(null)
let overrideTimer: ReturnType<typeof setTimeout> | null = null

// Лёгкое обновление версий без сброса выбора/раскрытия (вместо полного loadPost)
async function refreshVersions() {
  if (!post.value) return
  try {
    const fresh = await http.get<Post>(`/posts/${post.value.id}`)
    post.value.versions = fresh.versions
    post.value.status = fresh.status
    post.value.mediaFiles = fresh.mediaFiles
  } catch { /* ignore */ }
}

function toggleChannel(id: string) {
  const i = selectedChannels.value.indexOf(id)
  if (i >= 0) selectedChannels.value.splice(i, 1)
  else selectedChannels.value.push(id)
}

// Найти версию канала или создать её с мастер-текстом (ленивый оверрайд)
async function ensureVersionFor(channelId: string): Promise<string> {
  const existing = post.value!.versions.find(v => v.platformAccount.id === channelId)
  if (existing) return existing.id
  const v = await http.post<{ id: string }>(`/posts/${post.value!.id}/versions`, {
    platformAccountId: channelId, body: post.value!.body, hashtags: post.value!.hashtags,
  })
  return v.id
}

async function publishToSelected() {
  if (!post.value || !selectedChannels.value.length) return
  if (expandedChannelId.value) await flushOverride(expandedChannelId.value)
  publishingAll.value = true
  try {
    let ok = 0, fail = 0
    for (const channelId of selectedChannels.value) {
      try {
        const versionId = await ensureVersionFor(channelId)
        const res = await http.post<{ success: boolean }>(`/post-versions/${versionId}/publish`, {})
        res.success ? ok++ : fail++
      } catch { fail++ }
    }
    if (fail === 0) toast.success(`Опубликовано во все каналы (${ok})`)
    else if (ok === 0) toast.error('Не удалось опубликовать')
    else toast.info(`Опубликовано: ${ok}, ошибок: ${fail}`)
    await refreshVersions()
  } finally { publishingAll.value = false }
}

async function scheduleToSelected() {
  if (!post.value || !scheduleAtAll.value || !selectedChannels.value.length) return
  if (expandedChannelId.value) await flushOverride(expandedChannelId.value)
  publishingAll.value = true
  try {
    const iso = new Date(scheduleAtAll.value).toISOString()
    let ok = 0, fail = 0
    for (const channelId of selectedChannels.value) {
      try { const versionId = await ensureVersionFor(channelId); await http.post(`/post-versions/${versionId}/schedule`, { scheduledAt: iso }); ok++ }
      catch { fail++ }
    }
    if (fail === 0) toast.success(`Запланировано на ${new Date(scheduleAtAll.value).toLocaleString('ru')} (${ok})`)
    else toast.info(`Запланировано: ${ok}, ошибок: ${fail}`)
    scheduleAtAll.value = ''
    scheduleMode.value = false
    await refreshVersions()
  } finally { publishingAll.value = false }
}

// Per-channel публикация (повтор/только один канал). Создаёт версию при необходимости.
async function publishOneChannel(channelId: string) {
  if (!post.value) return
  // сначала сохраним черновик правки этого канала, если есть
  await flushOverride(channelId)
  publishingOne.value = channelId
  try {
    const versionId = await ensureVersionFor(channelId)
    const result = await http.post<{ success: boolean; error: string | null }>(`/post-versions/${versionId}/publish`, {})
    if (result.success) toast.success('Опубликовано в канал')
    else toast.error('Ошибка: ' + result.error)
    await refreshVersions()
  } catch (e: any) { toast.error('Ошибка: ' + (e.message || e)) }
  finally { publishingOne.value = null }
}

async function cancelScheduleVersion(versionId: string) {
  scheduling.value = versionId
  try {
    await http.post(`/post-versions/${versionId}/schedule`, { scheduledAt: null })
    toast.info('Планирование отменено')
    await refreshVersions()
  } catch (e: any) { toast.error('Ошибка: ' + (e.message || e)) }
  finally { scheduling.value = null }
}

// Media library picker
const showMediaPicker = ref(false)
async function pickFromLibrary(file: MediaFile) {
  if (!post.value) return
  try {
    await http.post(`/media/${file.id}/attach`, { postId: post.value.id })
    if (!post.value.mediaFiles.some(f => f.id === file.id)) post.value.mediaFiles.push(file)
    showMediaPicker.value = false
    toast.success('Файл добавлен из медиатеки')
  } catch (e: any) { toast.error('Ошибка: ' + (e.message || e)) }
}

// AI Image
const showAiImage = ref(false)
const aiImagePrompt = ref('')
const aiImageLoading = ref(false)
const aiImageRatio = ref<'1:1' | '16:9' | '9:16'>('1:1')
const aiEnhancing = ref(false)

const imageTemplates = ref<{ id: string; name: string; emoji: string; prompt: string }[]>([])
const aiImageSuggestions = ref<{ name: string; emoji: string; prompt: string }[]>([])
const suggestingImageTemplates = ref(false)

async function loadPost() {
  loading.value = true
  try {
    post.value = await http.get<Post>(`/posts/${route.params.id}`)
    if (post.value) {
      // Stories → визуальный редактор (отдельная поверхность)
      if (post.value.postType === 'STORIES') {
        router.replace(`/stories/${post.value.id}`)
        return
      }
      originalBody.value = post.value.body
      platforms.value = await http.get<PlatformAccount[]>(`/businesses/${post.value.businessId}/platforms`)
      selectedChannels.value = platforms.value.map(p => p.id) // по умолчанию — все каналы
      try {
        imageTemplates.value = await http.get<any[]>(`/prompt-templates?type=image&businessId=${post.value.businessId}`)
      } catch { imageTemplates.value = [] }
    }
  } catch (e) { toast.error('Ошибка загрузки поста') }
  finally { loading.value = false }
}

async function suggestImageTemplates() {
  if (!post.value) return
  suggestingImageTemplates.value = true
  try {
    const res = await http.post<{ suggestions: any[] }>('/ai/suggest-image-templates', {
      businessId: post.value.businessId,
      storyTitle: post.value.title || '',
      storyText: post.value.body || '',
    })
    aiImageSuggestions.value = res.suggestions || []
  } catch (e: any) { toast.error('Ошибка: ' + (e.message || e)) }
  finally { suggestingImageTemplates.value = false }
}

async function savePost(silent = false): Promise<boolean> {
  if (!post.value) return false
  saving.value = true
  try {
    await http.put(`/posts/${post.value.id}`, { title: post.value.title, body: post.value.body, postType: post.value.postType })
    originalBody.value = post.value.body
    if (!silent) toast.success('Сохранено')
    return true
  } catch (e: any) { toast.error('Ошибка сохранения: ' + (e.message || e)); return false }
  finally { saving.value = false }
}

// Автосейв мастер-текста (debounce) — защита от потери набранного
let masterTimer: ReturnType<typeof setTimeout> | null = null
function onMasterInput() {
  if (masterTimer) clearTimeout(masterTimer)
  masterTimer = setTimeout(() => {
    if (hasUnsavedChanges.value) savePost(true)
  }, 1500)
}

// Смена типа. Сторис — отдельная поверхность (канвас): сохраняем тип и уходим в визуальный редактор.
async function onTypeChange() {
  if (!post.value) return
  if (post.value.postType === 'STORIES') {
    await savePost()
    toast.info('Сторис открывается в визуальном редакторе')
    router.push(`/stories/${post.value.id}`)
    return
  }
  await savePost()
}

async function adaptToAllPlatforms() {
  if (!post.value || !platforms.value.length) return
  adapting.value = true
  try {
    await http.post('/ai/adapt', { postId: post.value.id, platformAccountIds: platforms.value.map(p => p.id) })
    toast.success('Версии адаптированы для всех платформ')
    await refreshVersions()
  } catch (e: any) { toast.error('Ошибка адаптации: ' + (e.message || e)) }
  finally { adapting.value = false }
}

async function adaptOnePlatform(channelId: string) {
  if (!post.value) return
  adaptingOne.value = channelId
  try {
    await http.post('/ai/adapt', { postId: post.value.id, platformAccountIds: [channelId] })
    toast.success('Адаптировано под канал')
    await refreshVersions()
    expandedChannelId.value = channelId
    // подтянуть адаптированный текст в черновик правки
    const v = versionFor(channelId)
    overrideDrafts.value[channelId] = { body: v ? v.body : (post.value.body || ''), saving: false, dirty: false }
  } catch (e: any) { toast.error('Ошибка адаптации: ' + (e.message || e)) }
  finally { adaptingOne.value = null }
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

async function enhanceImagePrompt() {
  if (!post.value || !aiImagePrompt.value.trim()) return
  aiEnhancing.value = true
  try {
    const result = await http.post<{ enhancedPrompt: string }>('/ai/enhance-image-prompt', {
      prompt: aiImagePrompt.value,
      aspectRatio: aiImageRatio.value,
      businessId: post.value.businessId,
    })
    aiImagePrompt.value = result.enhancedPrompt
    toast.success('Промпт улучшен')
  } catch (e: any) { toast.error('Ошибка: ' + (e.message || e)) }
  finally { aiEnhancing.value = false }
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

function onMediaReorder(orderedIds: string[]) {
  if (!post.value) return
  // Оптимистично переставляем локально, затем сохраняем sortOrder (порядок = индекс) на бэке
  const map = new Map(post.value.mediaFiles.map(f => [f.id, f]))
  post.value.mediaFiles = orderedIds.map(id => map.get(id)).filter((f): f is MediaFile => !!f)
  http.post(`/posts/${post.value.id}/media/reorder`, {
    items: orderedIds.map((id, i) => ({ id, sortOrder: i })),
  }).catch(() => toast.error('Не удалось сохранить порядок фото'))
}

// ---- Производные данные ----
const isStories = computed(() => post.value?.postType === 'STORIES')
const hasUnsavedChanges = computed(() => post.value && post.value.body !== originalBody.value)
const readyCount = computed(() => post.value?.versions.filter(v => ['PUBLISHED', 'APPROVED'].includes(v.status)).length || 0)

const POST_TYPES = [
  { value: 'TEXT', label: 'Пост' },
  { value: 'PHOTO', label: 'Фото-пост' },
  { value: 'VIDEO', label: 'Видео' },
  { value: 'REELS', label: 'Reels (IG)' },
  { value: 'CLIPS', label: 'Клипы (VK)' },
  { value: 'STORIES', label: 'Сторис (канвас)' },
]
const needsVideo = computed(() => formatNeedsVideo(post.value?.postType || ''))
const needsImage = computed(() => formatNeedsImage(post.value?.postType || ''))
const hasVideo = computed(() => (post.value?.mediaFiles || []).some(f => f.mimeType.startsWith('video/')))
const hasImage = computed(() => (post.value?.mediaFiles || []).some(f => f.mimeType.startsWith('image/')))
const formatHintText = computed(() => fmtHint(post.value?.postType || ''))

// Выбранные каналы-объекты
const selectedChannelObjs = computed(() => platforms.value.filter(p => selectedChannels.value.includes(p.id)))

function versionFor(channelId: string): PostVersion | undefined {
  return post.value?.versions.find(v => v.platformAccount.id === channelId)
}
// Текст, который реально уйдёт в канал: живой черновик правки → оверрайд-версия → мастер-текст
function effectiveText(channelId: string): string {
  const d = overrideDrafts.value[channelId]
  if (d) return d.body
  const v = versionFor(channelId)
  return v ? v.body : (post.value?.body || '')
}
function effectiveHashtags(channelId: string): string[] {
  const v = versionFor(channelId)
  return v ? v.hashtags : (post.value?.hashtags || [])
}
function channelLen(channelId: string): number {
  return effectiveText(channelId).length
}

// ---- Per-channel оверрайды (master/override, Phase 4) ----
async function toggleExpand(channelId: string) {
  if (overrideTimer) { clearTimeout(overrideTimer); overrideTimer = null }
  if (expandedChannelId.value === channelId) {
    await flushOverride(channelId)          // дождаться сохранения ПЕРЕД удалением черновика
    delete overrideDrafts.value[channelId]
    expandedChannelId.value = null
    return
  }
  const prev = expandedChannelId.value
  if (prev) {
    await flushOverride(prev)
    delete overrideDrafts.value[prev]
  }
  expandedChannelId.value = channelId
  const v = versionFor(channelId)
  overrideDrafts.value[channelId] = { body: v ? v.body : (post.value?.body || ''), saving: false, dirty: false }
}

function onOverrideInput(channelId: string) {
  const d = overrideDrafts.value[channelId]
  if (!d) return
  d.dirty = true
  if (overrideTimer) clearTimeout(overrideTimer)
  overrideTimer = setTimeout(() => saveOverride(channelId), 1200)
}

async function saveOverride(channelId: string) {
  const d = overrideDrafts.value[channelId]
  if (!d || !d.dirty || !d.body.trim() || !post.value) return
  if (overrideTimer) { clearTimeout(overrideTimer); overrideTimer = null }
  d.saving = true
  try {
    const v = versionFor(channelId)
    if (v) {
      await http.put(`/post-versions/${v.id}`, { body: d.body })
    } else {
      await http.post(`/posts/${post.value.id}/versions`, {
        platformAccountId: channelId, body: d.body, hashtags: post.value.hashtags,
      })
    }
    await refreshVersions()
    d.dirty = false   // помечаем чистым только после успешного сохранения + рефреша
  } catch (e: any) { toast.error('Ошибка сохранения версии: ' + (e.message || e)) }
  finally { d.saving = false }
}

async function flushOverride(channelId: string) {
  const d = overrideDrafts.value[channelId]
  if (d && d.dirty && d.body.trim()) await saveOverride(channelId)
}

async function resetOverride(channelId: string) {
  const v = versionFor(channelId)
  if (!v) return
  try {
    await http.delete(`/post-versions/${v.id}`)
    await refreshVersions()
    if (expandedChannelId.value === channelId) {
      overrideDrafts.value[channelId] = { body: post.value?.body || '', saving: false, dirty: false }
    }
    toast.info('Сброшено к мастер-тексту')
  } catch (e: any) { toast.error('Ошибка: ' + (e.message || e)) }
}
function channelOverLimit(channel: PlatformAccount): boolean {
  return channelLen(channel.id) > platformLimit(channel.platform)
}

function statusDot(channelId: string): string {
  const v = versionFor(channelId)
  if (!v) return 'bg-gray-300 dark:bg-gray-600'
  if (v.status === 'PUBLISHED') return 'bg-green-500'
  if (v.status === 'FAILED') return 'bg-red-500'
  if (v.status === 'SCHEDULED') return 'bg-amber-500'
  return 'bg-blue-400'
}

// Валидация перед публикацией
const overLimitChannels = computed(() => selectedChannelObjs.value.filter(channelOverLimit))
const formatWarnings = computed<string[]>(() => {
  const w: string[] = []
  if (needsVideo.value && !hasVideo.value) w.push('Для этого формата нужен видеофайл — привяжите видео.')
  if (needsImage.value && !hasImage.value) w.push('Фото-пост без изображения — добавьте картинку.')
  return w
})
const canPublishNow = computed(() => selectedChannels.value.length > 0 && overLimitChannels.value.length === 0)

// ---- Действия дропдауна публикации ----
function onPublishNow() {
  publishMenuOpen.value = false
  if (!canPublishNow.value) { toast.info('Проверьте каналы: превышен лимит символов'); return }
  publishToSelected()
}
function onChooseSchedule() {
  publishMenuOpen.value = false
  scheduleMode.value = true
}
function onSaveDraft() {
  publishMenuOpen.value = false
  savePost()
}

onBeforeRouteLeave(async () => {
  if (expandedChannelId.value) await flushOverride(expandedChannelId.value)
  if (masterTimer) { clearTimeout(masterTimer); masterTimer = null }
  // Автосохраняем при уходе; спрашиваем только если сохранение упало
  if (hasUnsavedChanges.value) {
    const ok = await savePost(true)
    if (!ok) return confirm('Не удалось сохранить изменения. Уйти без сохранения?')
  }
})

onMounted(loadPost)
</script>

<template>
  <div class="max-w-3xl mx-auto">
    <button @click="router.push('/posts')" class="flex items-center gap-1 text-sm text-gray-500 hover:text-gray-700 dark:hover:text-gray-300 mb-4">
      <ArrowLeft :size="16" /> Назад к контенту
    </button>

    <div v-if="loading" class="text-gray-500 py-8 text-center">Загрузка...</div>
    <div v-else-if="!post" class="text-center py-8">
      <AlertCircle :size="48" class="mx-auto text-gray-300 mb-3" />
      <p class="text-gray-500">Пост не найден</p>
    </div>

    <div v-else-if="!isStories" class="space-y-4">
      <!-- 1. COMPOSE -->
      <div class="bg-white dark:bg-gray-900 rounded-xl p-5 sm:p-6 border border-gray-200 dark:border-gray-800">
        <div class="flex items-center justify-between mb-4">
          <div class="flex items-center gap-2 flex-wrap">
            <span :class="['px-2 py-0.5 rounded-full text-xs font-medium', statusColor(post.status)]">{{ statusLabel(post.status) }}</span>
            <span v-if="post.createdBy === 'ai'" class="px-2 py-0.5 rounded-full text-xs font-medium bg-purple-100 text-purple-700 dark:bg-purple-900 dark:text-purple-300">AI</span>
            <span v-if="readyCount" class="text-xs text-gray-400">{{ readyCount }}/{{ platforms.length }} готово</span>
          </div>
          <span class="text-xs text-gray-400">{{ formatDate(post.createdAt) }}</span>
        </div>

        <!-- Тип -->
        <div class="mb-3">
          <label class="block text-sm font-medium mb-1">Тип контента</label>
          <select v-model="post.postType" @change="onTypeChange"
            class="w-full sm:w-auto px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 text-sm focus:ring-2 focus:ring-brand-500">
            <option v-for="t in POST_TYPES" :key="t.value" :value="t.value">{{ t.label }}</option>
          </select>
          <p v-if="formatHintText" class="text-[11px] text-gray-400 mt-1">{{ formatHintText }}</p>
        </div>

        <!-- Заголовок -->
        <div class="mb-3">
          <label class="block text-sm font-medium mb-1">Заголовок</label>
          <input v-model="post.title" @input="onMasterInput" placeholder="Заголовок (необязательно)"
            class="w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 focus:ring-2 focus:ring-brand-500 text-sm" />
        </div>

        <!-- Мастер-текст -->
        <div class="mb-2">
          <div class="flex items-center gap-2 mb-1">
            <label class="text-sm font-medium">Мастер-текст</label>
            <span class="text-[10px] text-gray-400 flex items-center gap-0.5" title="Основной текст. Уйдёт во все выбранные каналы. AI может адаптировать под каждую сеть.">
              <Info :size="12" /> уйдёт во все каналы
            </span>
            <span v-if="hasUnsavedChanges" class="text-amber-500 text-[11px] ml-auto">Не сохранено</span>
          </div>
          <textarea v-model="post.body" @input="onMasterInput" rows="8" placeholder="Текст вашего поста..."
            class="w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 focus:ring-2 focus:ring-brand-500 text-sm leading-relaxed" />
        </div>

        <!-- AI быстрые действия -->
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
          <button @click="savePost()" :disabled="saving"
            class="flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-[11px] font-medium border border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800 disabled:opacity-50 ml-auto">
            <Loader2 v-if="saving" :size="12" class="animate-spin" /><Save v-else :size="12" /> Сохранить
          </button>
        </div>
      </div>

      <!-- 2. МЕДИА -->
      <div class="bg-white dark:bg-gray-900 rounded-xl p-5 sm:p-6 border border-gray-200 dark:border-gray-800">
        <div class="flex items-center justify-between mb-3">
          <h2 class="font-semibold flex items-center gap-2"><Image :size="18" /> Медиа ({{ post.mediaFiles.length }})</h2>
          <div class="flex items-center gap-2">
            <button @click="showMediaPicker = true"
              class="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-300 text-xs font-medium hover:bg-gray-200 dark:hover:bg-gray-700">
              <Images :size="14" /> Из медиатеки
            </button>
            <button @click="showAiImage = true"
              class="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-purple-100 dark:bg-purple-900 text-purple-700 dark:text-purple-300 text-xs font-medium hover:bg-purple-200 dark:hover:bg-purple-800">
              <Sparkles :size="14" /> AI Картинка
            </button>
          </div>
        </div>
        <div v-if="formatWarnings.length" class="mb-3 space-y-1">
          <p v-for="w in formatWarnings" :key="w" class="text-[11px] text-amber-600 dark:text-amber-400 flex items-center gap-1">
            <AlertCircle :size="12" /> {{ w }}
          </p>
        </div>
        <MediaUpload :business-id="post.businessId" :post-id="post.id" :files="post.mediaFiles" @uploaded="onMediaUploaded" @removed="onMediaRemoved" @reorder="onMediaReorder" />
      </div>

      <!-- 3. КАНАЛЫ И ПУБЛИКАЦИЯ -->
      <div class="bg-white dark:bg-gray-900 rounded-xl p-5 sm:p-6 border border-gray-200 dark:border-gray-800">
        <div class="flex items-center justify-between mb-3">
          <h2 class="font-semibold flex items-center gap-2"><Send :size="18" /> Каналы и публикация</h2>
          <button v-if="platforms.length" @click="adaptToAllPlatforms" :disabled="adapting"
            class="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[11px] font-medium bg-purple-50 dark:bg-purple-950 text-purple-600 dark:text-purple-300 hover:bg-purple-100 dark:hover:bg-purple-900 disabled:opacity-50">
            <Loader2 v-if="adapting" :size="13" class="animate-spin" /><Wand2 v-else :size="13" /> Адаптировать все
          </button>
        </div>

        <div v-if="platforms.length">
          <div class="text-xs text-gray-500 mb-1.5">Куда публикуем</div>
          <!-- Чипы каналов -->
          <div class="flex flex-wrap gap-1.5 mb-3">
            <button v-for="ch in platforms" :key="ch.id" @click="toggleChannel(ch.id)"
              :class="['flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium border transition-colors',
                selectedChannels.includes(ch.id)
                  ? 'border-brand-500 bg-brand-50 dark:bg-brand-950 text-brand-700 dark:text-brand-300'
                  : 'border-gray-200 dark:border-gray-700 text-gray-500 hover:border-gray-300']">
              <span :class="['w-2 h-2 rounded-full shrink-0', statusDot(ch.id)]"></span>
              <span :class="platformColor(ch.platform)">{{ platformLabel(ch.platform) }}</span>
              {{ ch.accountName }}
            </button>
          </div>

          <!-- Per-channel: счётчик + статус + раскрытие настройки -->
          <div v-if="selectedChannelObjs.length" class="space-y-1.5 mb-3">
            <div v-for="ch in selectedChannelObjs" :key="ch.id"
              class="rounded-lg border border-gray-100 dark:border-gray-800 overflow-hidden">
              <div class="flex items-center gap-2 px-3 py-2 text-xs">
                <span :class="['w-2 h-2 rounded-full shrink-0', statusDot(ch.id)]"></span>
                <span :class="['font-medium', platformColor(ch.platform)]">{{ platformLabel(ch.platform) }}</span>
                <span class="text-gray-400 truncate hidden sm:inline">{{ ch.accountName }}</span>
                <span v-if="versionFor(ch.id)" class="text-[10px] text-purple-500 shrink-0">правка</span>
                <span :class="['ml-auto tabular-nums shrink-0', charCountColor(channelLen(ch.id), platformLimit(ch.platform))]">
                  {{ channelLen(ch.id) }}/{{ platformLimit(ch.platform) }}
                </span>
                <button @click="toggleExpand(ch.id)"
                  :class="['flex items-center gap-1 px-1.5 py-1 rounded text-[11px] shrink-0', expandedChannelId === ch.id ? 'text-brand-600 dark:text-brand-400 bg-brand-50 dark:bg-brand-950' : 'text-gray-400 hover:text-gray-600 dark:hover:text-gray-300']"
                  title="Превью и настройка под канал">
                  <Settings2 :size="14" /> <span class="hidden sm:inline">Настроить</span>
                </button>
              </div>

              <!-- Раскрытая настройка канала: превью «как в ленте» + редактируемый оверрайд (Phase 4) -->
              <div v-if="expandedChannelId === ch.id" class="px-3 pb-3 pt-2 border-t border-gray-100 dark:border-gray-800 bg-gray-50/50 dark:bg-gray-800/30">
                <!-- Превью на канал -->
                <div class="text-[10px] uppercase tracking-wide text-gray-400 mb-1.5">Превью · {{ platformLabel(ch.platform) }}</div>
                <PostPreview class="mb-3" :platform="ch.platform" :account-name="ch.accountName"
                  :text="effectiveText(ch.id)" :hashtags="effectiveHashtags(ch.id)" :media-files="post.mediaFiles" :post-type="post.postType" />

                <!-- Статус: опубликовано / ошибка / запланировано -->
                <div v-if="versionFor(ch.id)?.publishLogs?.[0]?.status === 'FAILED'" class="p-2 rounded-lg bg-red-50 dark:bg-red-950 border border-red-200 dark:border-red-800 mb-2 text-xs text-red-600 dark:text-red-400 flex items-start gap-1.5">
                  <AlertCircle :size="13" class="shrink-0 mt-0.5" /> {{ versionFor(ch.id)!.publishLogs[0].errorMessage }}
                </div>
                <a v-if="versionFor(ch.id)?.externalUrl" :href="versionFor(ch.id)!.externalUrl!" target="_blank" class="flex items-center gap-1 text-xs text-green-600 hover:underline mb-2">
                  <ExternalLink :size="12" /> Открыть пост
                </a>
                <div v-if="versionFor(ch.id)?.status === 'SCHEDULED'" class="flex items-center justify-between gap-2 mb-2 text-xs text-amber-600 dark:text-amber-400">
                  <span class="flex items-center gap-1"><Clock :size="12" /> Запланировано{{ versionFor(ch.id)!.scheduledAt ? ': ' + formatDate(versionFor(ch.id)!.scheduledAt!) : '' }}</span>
                  <button @click="cancelScheduleVersion(versionFor(ch.id)!.id)" :disabled="scheduling === versionFor(ch.id)!.id"
                    class="px-2 py-0.5 rounded text-[11px] text-red-600 dark:text-red-400 border border-red-300 dark:border-red-700 hover:bg-red-50 dark:hover:bg-red-950 disabled:opacity-50">Отменить</button>
                </div>

                <!-- Редактируемый текст под канал (оверрайд) -->
                <div class="flex items-center gap-1.5 mb-1">
                  <label class="text-[11px] text-gray-500">Текст для {{ platformLabel(ch.platform) }}</label>
                  <span v-if="versionFor(ch.id)" class="text-[10px] text-purple-500">оверрайд</span>
                  <span v-else class="text-[10px] text-gray-400">наследует мастер</span>
                </div>
                <textarea v-if="overrideDrafts[ch.id]" v-model="overrideDrafts[ch.id].body" @input="onOverrideInput(ch.id)" rows="4"
                  :disabled="['PUBLISHED','SCHEDULED'].includes(versionFor(ch.id)?.status || '')"
                  :placeholder="['PUBLISHED','SCHEDULED'].includes(versionFor(ch.id)?.status || '') ? 'Отмените план/публикацию, чтобы редактировать' : ''"
                  class="w-full px-2.5 py-2 rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 text-sm leading-relaxed disabled:opacity-60" />
                <div class="flex items-center gap-2 mt-1 text-[11px]">
                  <span :class="['tabular-nums', charCountColor(channelLen(ch.id), platformLimit(ch.platform))]">{{ channelLen(ch.id) }}/{{ platformLimit(ch.platform) }}</span>
                  <span v-if="overrideDrafts[ch.id]?.saving" class="text-gray-400 flex items-center gap-1"><Loader2 :size="11" class="animate-spin" /> сохр.</span>
                  <span class="text-gray-400 ml-auto text-right">{{ platformNote(ch.platform) }}</span>
                </div>

                <!-- Действия канала -->
                <div class="flex items-center gap-2 mt-2 flex-wrap">
                  <button @click="adaptOnePlatform(ch.id)" :disabled="adaptingOne === ch.id"
                    class="flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-[11px] font-medium bg-purple-50 dark:bg-purple-950 text-purple-600 dark:text-purple-300 hover:bg-purple-100 dark:hover:bg-purple-900 disabled:opacity-50">
                    <Loader2 v-if="adaptingOne === ch.id" :size="12" class="animate-spin" /><Wand2 v-else :size="12" /> Адаптировать AI
                  </button>
                  <button v-if="versionFor(ch.id)" @click="resetOverride(ch.id)"
                    class="flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-[11px] font-medium border border-gray-200 dark:border-gray-700 text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800">
                    <RefreshCw :size="12" /> Сбросить к мастеру
                  </button>
                  <button v-if="!['PUBLISHED','SCHEDULED'].includes(versionFor(ch.id)?.status || '')"
                    @click="publishOneChannel(ch.id)" :disabled="publishingOne === ch.id || channelOverLimit(ch)"
                    class="flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-[11px] font-medium bg-green-50 dark:bg-green-950 text-green-700 dark:text-green-300 hover:bg-green-100 dark:hover:bg-green-900 disabled:opacity-50">
                    <Loader2 v-if="publishingOne === ch.id" :size="12" class="animate-spin" /><Send v-else :size="12" />
                    {{ versionFor(ch.id)?.status === 'FAILED' ? 'Повторить' : 'Только сюда' }}
                  </button>
                </div>
              </div>
            </div>
          </div>

          <!-- Валидация: превышение лимита -->
          <div v-if="overLimitChannels.length" class="mb-3 p-2.5 rounded-lg bg-red-50 dark:bg-red-950 border border-red-200 dark:border-red-800 text-xs text-red-600 dark:text-red-400 flex items-start gap-1.5">
            <AlertCircle :size="14" class="shrink-0 mt-0.5" />
            <span>Превышен лимит символов:
              {{ overLimitChannels.map(c => platformLabel(c.platform) + ' (' + channelLen(c.id) + '/' + platformLimit(c.platform) + ')').join(', ') }}.
              Сократите текст или адаптируйте под канал.</span>
          </div>

          <!-- Опубликовать ▾ -->
          <div class="relative">
            <div class="flex items-stretch gap-2">
              <button @click="onPublishNow" :disabled="publishingAll || !canPublishNow"
                class="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 rounded-l-lg bg-green-600 hover:bg-green-700 text-white text-sm font-medium disabled:opacity-50">
                <Loader2 v-if="publishingAll" :size="16" class="animate-spin" /><Send v-else :size="16" />
                {{ publishingAll ? 'Публикуем...' : `Опубликовать сейчас (${selectedChannels.length})` }}
              </button>
              <button @click="publishMenuOpen = !publishMenuOpen" :disabled="publishingAll"
                class="px-3 rounded-r-lg bg-green-700 hover:bg-green-800 text-white disabled:opacity-50 border-l border-green-500/40">
                <ChevronDown :size="16" />
              </button>
            </div>

            <!-- Меню -->
            <div v-if="publishMenuOpen" class="absolute right-0 bottom-full mb-1 z-20 w-56 bg-white dark:bg-gray-800 rounded-lg shadow-xl border border-gray-200 dark:border-gray-700 py-1">
              <button @click="onPublishNow" :disabled="!canPublishNow"
                class="w-full flex items-center gap-2 px-3 py-2 text-sm hover:bg-gray-50 dark:hover:bg-gray-700 text-left disabled:opacity-40">
                <Send :size="15" class="text-green-600" /> Опубликовать сейчас
              </button>
              <button @click="onChooseSchedule"
                class="w-full flex items-center gap-2 px-3 py-2 text-sm hover:bg-gray-50 dark:hover:bg-gray-700 text-left">
                <Calendar :size="15" class="text-blue-600" /> Запланировать…
              </button>
              <button @click="onSaveDraft"
                class="w-full flex items-center gap-2 px-3 py-2 text-sm hover:bg-gray-50 dark:hover:bg-gray-700 text-left">
                <FileText :size="15" class="text-gray-500" /> Сохранить черновик
              </button>
            </div>
            <!-- Backdrop для закрытия меню -->
            <div v-if="publishMenuOpen" class="fixed inset-0 z-10" @click="publishMenuOpen = false"></div>
          </div>

          <!-- Режим планирования -->
          <div v-if="scheduleMode" class="mt-2 flex flex-col sm:flex-row gap-2 items-stretch sm:items-center p-3 rounded-lg bg-blue-50 dark:bg-blue-950 border border-blue-200 dark:border-blue-800">
            <span class="text-xs text-blue-700 dark:text-blue-300 flex items-center gap-1 shrink-0"><Calendar :size="14" /> Когда:</span>
            <input v-model="scheduleAtAll" type="datetime-local" :min="new Date().toISOString().slice(0,16)"
              class="flex-1 min-w-0 px-2 py-2 rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 text-xs" />
            <button @click="scheduleToSelected" :disabled="publishingAll || !scheduleAtAll || !selectedChannels.length"
              class="flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-xs font-medium disabled:opacity-50 shrink-0">
              <Loader2 v-if="publishingAll" :size="14" class="animate-spin" /><Clock v-else :size="14" /> Запланировать ({{ selectedChannels.length }})
            </button>
            <button @click="scheduleMode = false; scheduleAtAll = ''" class="p-2 rounded-lg text-gray-400 hover:bg-white dark:hover:bg-gray-800 shrink-0"><X :size="14" /></button>
          </div>

          <p class="text-[10px] text-gray-400 mt-2">Мастер-текст уйдёт во все выбранные каналы. «Настроить» (⚙) — адаптация и публикация по конкретному каналу. Ссылки на сайт бренда авто-помечаются UTM по каналу.</p>
        </div>
        <div v-else class="text-center py-6 px-4 rounded-lg border border-dashed border-gray-200 dark:border-gray-700">
          <Send :size="28" class="mx-auto text-gray-300 dark:text-gray-600 mb-2" />
          <p class="text-sm text-gray-500 mb-2.5">Нет подключённых каналов для публикации</p>
          <router-link to="/settings" class="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-brand-50 dark:bg-brand-950 text-brand-600 dark:text-brand-300 text-xs font-medium hover:bg-brand-100 dark:hover:bg-brand-900 transition-colors">
            <Settings2 :size="14" /> Подключить каналы
          </router-link>
        </div>
      </div>
    </div>

    <!-- Media library picker -->
    <MediaPickerModal
      v-if="post"
      :visible="showMediaPicker"
      :business-id="post.businessId"
      @close="showMediaPicker = false"
      @selected="pickFromLibrary"
    />

    <!-- AI Image Modal -->
    <div v-if="showAiImage" class="fixed inset-0 z-50 flex items-center justify-center bg-black/50" @click.self="showAiImage = false">
      <div class="bg-white dark:bg-gray-900 rounded-2xl p-6 w-full max-w-md shadow-xl">
        <h2 class="text-lg font-bold mb-4 flex items-center gap-2"><Sparkles :size="20" class="text-purple-500" /> AI Картинка</h2>
        <div class="space-y-3">
          <div v-if="imageTemplates.length">
            <label class="block text-sm font-medium mb-1.5">Шаблоны</label>
            <div class="flex flex-wrap gap-1.5">
              <button v-for="t in imageTemplates" :key="t.id" @click="aiImagePrompt = t.prompt"
                class="px-2.5 py-1 rounded-full text-xs font-medium bg-purple-100 dark:bg-purple-900/50 text-purple-700 dark:text-purple-300 hover:bg-purple-200 dark:hover:bg-purple-800 transition-colors">
                {{ t.emoji }} {{ t.name }}
              </button>
            </div>
          </div>
          <div>
            <button @click="suggestImageTemplates" :disabled="suggestingImageTemplates"
              class="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium border border-purple-300 dark:border-purple-700 text-purple-600 dark:text-purple-400 hover:bg-purple-50 dark:hover:bg-purple-950 disabled:opacity-50 transition-colors">
              <Loader2 v-if="suggestingImageTemplates" :size="14" class="animate-spin" /><Wand2 v-else :size="14" />
              {{ suggestingImageTemplates ? 'Подбираю...' : '✨ Подобрать по контексту' }}
            </button>
            <div v-if="aiImageSuggestions.length" class="flex flex-wrap gap-1.5 mt-2">
              <button v-for="s in aiImageSuggestions" :key="s.name" @click="aiImagePrompt = s.prompt"
                class="px-2.5 py-1 rounded-full text-xs font-medium bg-emerald-100 dark:bg-emerald-900/50 text-emerald-700 dark:text-emerald-300 hover:bg-emerald-200 dark:hover:bg-emerald-800 transition-colors">
                {{ s.emoji }} {{ s.name }}
              </button>
            </div>
          </div>
          <div>
            <label class="block text-sm font-medium mb-1">Описание</label>
            <textarea v-model="aiImagePrompt" rows="3" placeholder="Опишите изображение или выберите шаблон..."
              class="w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 focus:ring-2 focus:ring-purple-500 text-sm" />
          </div>
          <button @click="enhanceImagePrompt" :disabled="aiEnhancing || !aiImagePrompt.trim()"
            class="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium border border-purple-300 dark:border-purple-700 text-purple-600 dark:text-purple-400 hover:bg-purple-50 dark:hover:bg-purple-950 disabled:opacity-50 transition-colors">
            <Loader2 v-if="aiEnhancing" :size="14" class="animate-spin" /><Wand2 v-else :size="14" />
            {{ aiEnhancing ? 'Улучшаю...' : 'Улучшить промпт' }}
          </button>
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
