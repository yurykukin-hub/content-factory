<script setup lang="ts">
import { ref, onMounted, computed, watch, onUnmounted } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { http, TAB_ID } from '@/api/client'
import { useAuthStore } from '@/stores/auth'
import { useToast } from '@/composables/useToast'
import { formatDate } from '@/composables/useFormatters'
import { useRates } from '@/composables/useRates'
import {
  ArrowLeft, Upload, Sparkles, Loader2, Send, CheckCircle,
  ExternalLink, AlertCircle, Image, Images, Link, Trash2, Wand2,
  ChevronDown, Calendar, Clock, Video, X, Music, FileText
} from 'lucide-vue-next'
import ImageEditModal from '@/components/ai/ImageEditModal.vue'
import MediaPickerModal from '@/components/MediaPickerModal.vue'
import StoriesPreview from '@/components/posts/preview/StoriesPreview.vue'
import OverlayEditor from '@/components/overlay/OverlayEditor.vue'
import { platformColor, platformBgColor, platformLabel } from '@/composables/usePlatform'
import VsAgentChat from '@/components/video/VsAgentChat.vue'
import type { AgentMessage } from '@/components/video/VsAgentMessage.vue'
import { defaultOverlaySpec, type OverlaySpec } from '@/types/overlaySpec'

interface MediaFile { id: string; url: string; thumbUrl: string | null; filename: string; mimeType: string; sizeBytes: number; durationSec?: number | null; aiModel?: string | null; aiCostUsd?: number | null; altText?: string | null; tags?: string[]; sourceMediaId?: string | null }
interface PlatformAccount { id: string; platform: string; accountName: string; accountId: string }
interface PostVersion {
  id: string; status: string; externalUrl: string | null; publishedAt: string | null; scheduledAt: string | null
  platformAccount: PlatformAccount
  publishLogs: { status: string; errorMessage: string | null; attemptedAt: string }[]
}
interface Post {
  id: string; businessId: string; title: string | null; body: string; postType: string
  status: string; createdAt: string; versions: PostVersion[]; mediaFiles: MediaFile[]
  overlaySpec?: OverlaySpec | null
}
interface PublishResultItem {
  channelId: string; platform: string; accountName: string
  success: boolean; externalUrl: string | null; error: string | null
}

const route = useRoute()
const router = useRouter()
// Возврат «Назад» — туда, откуда пришли (лента / истории)
const backTo = computed(() => {
  switch (route.query.from) {
    case 'feed': case 'digest': return { path: '/feed', label: 'Назад в ленту' }
    default: return { path: '/feed', label: 'Назад в ленту' }
  }
})
const auth = useAuthStore()
const toast = useToast()
const isAdmin = computed(() => auth.user?.role === 'ADMIN')

const post = ref<Post | null>(null)
const loading = ref(true)
const publishing = ref(false)
const uploading = ref(false)
const scheduling = ref(false)
const scheduledAt = ref('')
const cancellingSchedule = ref(false)

// --- Единый модуль запекания (Фаза B): OverlayEditor владеет текстом/кадром/шрифтом/дизайном ---
// sourceMedia = ИСХОДНОЕ (raw) фото/видео. Публикуемое медиа поста = запечённый overlay (photo.value).
const sourceMedia = ref<MediaFile | null>(null)
const overlaySpecSeed = ref<OverlaySpec | null>(null) // initialSpec для OverlayEditor
const liveSpec = ref<OverlaySpec | null>(null)         // текущий spec из редактора (для переноса текста при смене медиа)
const overlayRef = ref<InstanceType<typeof OverlayEditor> | null>(null)
const bakedReady = ref(false) // был ли хоть один успешный бейк для текущего источника

const storyTitle = ref('') // внутреннее название поста (Post.title), не путать с заголовком-дизайном

// Title автосейв (debounce 1.5s)
let saveTimer: ReturnType<typeof setTimeout> | null = null
function autoSaveTitle() {
  if (!post.value || isPublished.value) return
  if (saveTimer) clearTimeout(saveTimer)
  saveTimer = setTimeout(async () => {
    try { await http.put(`/posts/${post.value!.id}`, { title: storyTitle.value || null }) } catch {}
  }, 1500)
}
watch(storyTitle, autoSaveTitle)

const linkType = ref('')
const linkUrl = ref('')
// Готовые ссылки бронирования: НаWоде ERP booking_links (вкл. «Бронь ВК Сторис») → fallback BrandProfile.links
interface BookingLinkOption { label: string; ref: string; url: string; scope: string[] }
const bookingLinks = ref<BookingLinkOption[]>([])

// Музыка для видео-сторис (трек из Звуковой студии вшивается в baked-видео через render-overlay)
interface MusicTrack { id: string; title: string }
const musicTracks = ref<MusicTrack[]>([])
const selectedMusicSessionId = ref<string | null>(null)

// Публикация: единый дропдаун «Опубликовать ▾» (как в PostEditor) + режим планирования
const publishMenuOpen = ref(false)
const scheduleMode = ref(false)
// Превью «как в соцсети» по каналам (таб VK / Instagram)
const previewPlatform = ref('VK')

// AI
const showAiImage = ref(false)
const aiPrompt = ref('')
const aiLoading = ref(false)
const aiEnhancing = ref(false)
const selectedCharacterId = ref<string | null>(null)
const showAiVideo = ref(false)
const videoPrompt = ref('')
const aiVideoLoading = ref(false)    // создание задачи (короткий)
const videoGenerating = ref(false)   // идёт генерация (до SSE completed)
const videoDuration = ref(5)
const videoAudio = ref(false)        // сторис обычно без звука (дешевле вдвое)
const videoSessionId = ref<string | null>(null)

// AI-агент для крафта видео-промпта (переиспользуем VsAgentChat из VideoStudio)
const chatMessages = ref<AgentMessage[]>([])
const agentLoading = ref(false)
const agentMode = ref<'simple' | 'advanced'>('simple')
const photoDescription = ref('')     // кэш описания фото (Gemini Vision) для «Оживить»
const animating = ref(false)

function openVideoModal() {
  showAiVideo.value = true
}

// Ценообразование Seedance 2 (KIE.ai): 41 credits/sec text, 25 img2video (720p), 1 credit = $0.005
const VIDEO_CREDITS_TEXT = 41
const VIDEO_CREDITS_IMG = 25
const VIDEO_CREDIT_PRICE = 0.005
const VIDEO_AUDIO_MULTIPLIER = 2.0
const { USD_RUB: USD_TO_RUB } = useRates()

// Исходное фото сториса АВТОМАТИЧЕСКИ = основа для оживления (img2video). Нет фото / видео → text2video.
const videoBaseImage = computed(() => (sourceMedia.value && !isVideoSource.value) ? sourceMedia.value : null)

const videoCostUsd = computed(() => {
  const creditsPerSec = videoBaseImage.value ? VIDEO_CREDITS_IMG : VIDEO_CREDITS_TEXT
  const base = creditsPerSec * videoDuration.value * VIDEO_CREDIT_PRICE
  return videoAudio.value ? base * VIDEO_AUDIO_MULTIPLIER : base
})
const videoCostRub = computed(() => Math.round(videoCostUsd.value * USD_TO_RUB.value))

// Приветствие AI-агента (контекст сториса)
const videoAgentContext = computed(() =>
  videoBaseImage.value
    ? 'Оживлю фото сториса в видео. Нажмите «Оживить» или опишите движение в чате.'
    : 'Опишите видео для сториса — помогу собрать промпт.')

// Characters for AI image generation
interface CharacterRef {
  id: string; name: string; type: string
  referenceMedia?: { url: string; thumbUrl: string | null } | null
}
const characters = ref<CharacterRef[]>([])

async function loadCharacters(businessId: string) {
  try {
    characters.value = await http.get<CharacterRef[]>(`/businesses/${businessId}/characters`)
  } catch { characters.value = [] }
}

// Image prompt templates — loaded from DB (per-business) + AI suggestions
const imageTemplates = ref<{ id: string; name: string; emoji: string; prompt: string }[]>([])
const aiSuggestions = ref<{ name: string; emoji: string; prompt: string }[]>([])
const suggestingTemplates = ref(false)

const showEditModal = ref(false)
const editingImage = ref(false) // background image generation in progress
const showMediaPicker = ref(false)

// --- Overlay source helpers ---
async function fetchMedia(id: string): Promise<MediaFile | null> {
  try { return await http.get<MediaFile>(`/media/${id}`) } catch { return null }
}
function detachMedia(id: string) {
  return http.post(`/media/${id}/attach`, { postId: null }).catch(() => {})
}
function isBakedMedia(m: MediaFile): boolean {
  return !!(m.tags?.includes('overlay') || m.tags?.includes('story-design') || (m.url && /\/design_/.test(m.url)))
}
function normalizeSeed(spec: OverlaySpec): OverlaySpec {
  return { ...defaultOverlaySpec(spec.sourceMediaId), ...spec, version: 1 }
}

// Определить raw-источник + initialSpec из загруженного поста (persisted overlaySpec / attached-медиа)
async function resolveOverlaySource() {
  if (!post.value) return
  const attached = post.value.mediaFiles?.[0] || null
  const spec = post.value.overlaySpec
  if (spec && spec.sourceMediaId) {
    overlaySpecSeed.value = normalizeSeed(spec)
    sourceMedia.value = await fetchMedia(spec.sourceMediaId) || attached
    bakedReady.value = true // уже запекали ранее
    return
  }
  if (!attached) { sourceMedia.value = null; overlaySpecSeed.value = null; return }
  // Нет spec: если привязан baked-дизайн — берём его исходник; иначе attached = raw
  if (isBakedMedia(attached) && attached.sourceMediaId) {
    sourceMedia.value = await fetchMedia(attached.sourceMediaId) || attached
  } else {
    sourceMedia.value = attached
  }
  // Сид из существующего текста поста, чтобы первый (пере)бейк не потерял его
  const seed = defaultOverlaySpec(sourceMedia.value.id)
  const heading = (post.value.title || post.value.body || '').trim()
  if (heading) seed.bottomText = heading.slice(0, 200)
  overlaySpecSeed.value = seed
}

// Установить НОВЫЙ raw-источник (загрузка/медиатека/AI-фото/AI-видео/AI-правка):
// сохранить текст/шрифт/шаблон, сбросить кадр, переинициализировать OverlayEditor.
function setNewSource(m: MediaFile) {
  const base = liveSpec.value ?? overlaySpecSeed.value ?? defaultOverlaySpec(m.id)
  overlaySpecSeed.value = { ...base, version: 1, sourceMediaId: m.id, photoPosition: '50% 50%' }
  bakedReady.value = false
  sourceMedia.value = m         // смена sourceMediaId → OverlayEditor re-init + авто-бейк
  if (post.value) post.value.mediaFiles = [m] // временно; onBaked заменит на baked
}

// OverlayEditor запёк overlay → это и есть публикуемое медиа поста. Оставляем в БД ТОЛЬКО baked.
async function onBaked(payload: { mediaFileId: string; url: string; spec: OverlaySpec }) {
  if (!post.value) return
  bakedReady.value = true
  const mf = await fetchMedia(payload.mediaFileId)
  const baked: MediaFile = mf || {
    id: payload.mediaFileId, url: payload.url, thumbUrl: payload.url, filename: 'Overlay',
    mimeType: payload.url.endsWith('.mp4') ? 'video/mp4' : 'image/png', sizeBytes: 0, tags: ['overlay'],
  }
  // Открепить всё прочее от поста (raw-источник / устаревший baked) — держим ровно baked-медиа
  for (const m of (post.value.mediaFiles || [])) {
    if (m.id !== baked.id) detachMedia(m.id)
  }
  post.value.mediaFiles = [baked]
}

// Background image edit (from ImageEditModal) — правим ИСХОДНОЕ фото, результат = новый raw-источник
async function onEditSubmitted(data: { prompt: string; model: string; mediaId: string }) {
  if (!post.value || !sourceMedia.value) return
  editingImage.value = true
  try {
    const result = await http.post<{ mediaFile: MediaFile }>('/ai/edit-image', {
      businessId: post.value.businessId,
      mediaId: data.mediaId,
      prompt: data.prompt,
      postId: post.value.id,
      model: data.model,
    })
    setNewSource(result.mediaFile)
    toast.success('Изображение отредактировано')
  } catch (e: any) { toast.error('Ошибка: ' + (e.message || e)) }
  finally { editingImage.value = false }
}

function onImageEdited(newFile: MediaFile) {
  setNewSource(newFile)
  showEditModal.value = false
}

// Channels (мультивыбор VK + Instagram)
const storyChannels = ref<PlatformAccount[]>([])
const selectedChannels = ref<string[]>([])
const publishResults = ref<PublishResultItem[]>([])

function toggleChannel(id: string) {
  const i = selectedChannels.value.indexOf(id)
  if (i >= 0) selectedChannels.value.splice(i, 1)
  else selectedChannels.value.push(id)
}

// photo = публикуемое медиа поста (после бейка = запечённый overlay)
const photo = computed(() => post.value?.mediaFiles?.[0] || null)
const isVideoSource = computed(() => sourceMedia.value?.mimeType?.startsWith('video/') || false)
const overlaySourceId = computed(() => sourceMedia.value?.id || '')
const sourcePhotoUrl = computed(() => sourceMedia.value?.url || null)

// Полная блокировка — только после реальной публикации
const isPublished = computed(() =>
  (post.value?.versions || []).some(v => v.status === 'PUBLISHED'))
// Запланировано (но ещё не опубликовано) — редактирование разрешено, нужно перепланировать
const isScheduled = computed(() =>
  !isPublished.value && (post.value?.versions || []).some(v => v.status === 'SCHEDULED'))

async function cancelSchedule(versionId: string) {
  if (!versionId || cancellingSchedule.value) return
  if (!confirm('Отменить запланированную публикацию?')) return
  cancellingSchedule.value = true
  try {
    await http.post(`/post-versions/${versionId}/schedule`, { scheduledAt: null })
    toast.success('Публикация отменена')
    const freshPost = await http.get<Post>(`/posts/${post.value!.id}`)
    if (freshPost) { post.value!.versions = freshPost.versions; post.value!.status = freshPost.status }
  } catch (e: any) { toast.error('Ошибка: ' + (e.message || e)) }
  finally { cancellingSchedule.value = false }
}

// --- Data loading ---
async function loadPost() {
  loading.value = true
  try {
    post.value = await http.get<Post>(`/posts/${route.params.id}`)
    if (post.value) {
      storyTitle.value = post.value.title || ''
      const platforms = await http.get<PlatformAccount[]>(`/businesses/${post.value.businessId}/platforms`)
      // Сторис поддерживают VK + Instagram (TG — нет сторис)
      storyChannels.value = platforms.filter(p => p.platform === 'VK' || p.platform === 'INSTAGRAM')
      selectedChannels.value = storyChannels.value.map(c => c.id) // по умолчанию все
      previewPlatform.value = storyChannels.value[0]?.platform || 'VK' // таб превью по умолчанию
      if (post.value.postType !== 'STORIES') { router.replace(`/posts/${post.value.id}`); return }
      await resolveOverlaySource()
    }
    // Load finished music tracks (Sound Studio) for video stories
    try {
      const ms = await http.get<any[]>(`/sessions?businessId=${post.value.businessId}&type=music&status=completed`)
      musicTracks.value = (ms || []).filter(s => s.audioUrl).map(s => ({ id: s.id, title: s.musicTitle || s.title || 'Трек' }))
    } catch { musicTracks.value = [] }
    // Load prompt templates from DB (global + per-business)
    try {
      imageTemplates.value = await http.get<any[]>(`/prompt-templates?type=image&businessId=${post.value.businessId}`)
    } catch { imageTemplates.value = [] }
    loadCharacters(post.value.businessId)
    // Готовые ссылки бронирования (НаWоде ERP → fallback BrandProfile.links) + авто-дефолт для VK
    try {
      bookingLinks.value = await http.get<BookingLinkOption[]>(`/businesses/${post.value.businessId}/booking-links`)
    } catch { bookingLinks.value = [] }
    applyDefaultBookingLink()
  } catch (e) { toast.error('Ошибка загрузки') }
  finally { loading.value = false }
}

// --- File upload ---
async function uploadPhoto(e: Event) {
  const input = e.target as HTMLInputElement
  if (!input.files?.length || !post.value) return
  uploading.value = true
  try {
    if (photo.value) await detachMedia(photo.value.id)
    const formData = new FormData()
    formData.append('file', input.files[0])
    formData.append('businessId', post.value.businessId)
    formData.append('postId', post.value.id)
    const res = await fetch('/api/media/upload', { method: 'POST', body: formData, credentials: 'include', headers: { 'X-Tab-ID': TAB_ID } })
    const mf = await res.json() as MediaFile
    setNewSource(mf)
    toast.success('Медиа загружено')
  } catch (e: any) { toast.error('Ошибка: ' + e.message) }
  finally { uploading.value = false; input.value = '' }
}

async function removePhoto() {
  if (!photo.value || !post.value) return
  if (!confirm('Открепить медиа от истории?')) return
  await detachMedia(photo.value.id)
  if (sourceMedia.value) await detachMedia(sourceMedia.value.id)
  post.value.mediaFiles = []
  sourceMedia.value = null
  overlaySpecSeed.value = null
  liveSpec.value = null
  bakedReady.value = false
  toast.info('Медиа откреплено')
}

async function pickFromLibrary(file: MediaFile) {
  if (!post.value) return
  uploading.value = true
  try {
    if (photo.value) await detachMedia(photo.value.id)
    await http.post(`/media/${file.id}/attach`, { postId: post.value.id })
    setNewSource(file)
    showMediaPicker.value = false
    toast.success('Медиа выбрано из медиатеки')
  } catch (e: any) {
    toast.error('Ошибка: ' + (e.message || e))
  } finally {
    uploading.value = false
  }
}

async function suggestTemplates() {
  if (!post.value) return
  suggestingTemplates.value = true
  try {
    const res = await http.post<{ suggestions: { name: string; emoji: string; prompt: string }[] }>('/ai/suggest-image-templates', {
      businessId: post.value.businessId,
      storyTitle: storyTitle.value || '',
      storyText: liveSpec.value?.bottomText || '',
    })
    aiSuggestions.value = res.suggestions || []
  } catch (e: any) { toast.error('Ошибка: ' + (e.message || e)) }
  finally { suggestingTemplates.value = false }
}

async function generateAiImage() {
  if (!post.value || !aiPrompt.value.trim()) return
  aiLoading.value = true
  try {
    if (photo.value) await detachMedia(photo.value.id)
    const result = await http.post<{ mediaFile: MediaFile }>('/ai/generate-image', {
      businessId: post.value.businessId, postId: post.value.id,
      prompt: aiPrompt.value, aspectRatio: '9:16',
      characterId: selectedCharacterId.value || undefined,
    })
    setNewSource(result.mediaFile)
    showAiImage.value = false
    aiPrompt.value = ''
    toast.success('Картинка сгенерирована')
  } catch (e: any) { toast.error('Ошибка: ' + e.message) }
  finally { aiLoading.value = false }
}

// --- AI Видео: оживление фото сториса + AI-агент ---

function parseAgentResponse(raw: string): { text: string; prompts: string[]; suggestions: string[] } {
  const prompts: string[] = []
  const suggestions: string[] = []
  let text = raw.replace(/<prompt>([\s\S]*?)<\/prompt>/g, (_, p) => { prompts.push(p.trim()); return '' })
  text = text.replace(/<suggestions>([\s\S]*?)<\/suggestions>/g, (_, s) => {
    suggestions.push(...s.split('|').map((x: string) => x.trim()).filter(Boolean)); return ''
  })
  return { text: text.trim(), prompts, suggestions }
}

async function sendAgentMessage(userText: string) {
  if (!post.value || agentLoading.value) return
  chatMessages.value.push({ role: 'user', content: userText, createdAt: new Date().toISOString() })
  agentLoading.value = true
  try {
    const context = {
      inputMode: videoBaseImage.value ? 'frames' : 'text',
      refImages: [] as { filename: string; altText: string | null }[],
      duration: videoDuration.value,
      aspectRatio: '9:16',
      resolution: '720p',
      generateAudio: videoAudio.value,
      currentPrompt: videoPrompt.value,
      storyText: liveSpec.value?.bottomText || undefined,
      photoDescription: photoDescription.value || undefined,
      animateMode: !!videoBaseImage.value,
    }
    const recent = chatMessages.value.slice(-20).map(m => ({ role: m.role, content: m.content }))
    const res = await http.post<{ content: string }>('/ai/agent-chat', {
      messages: recent, context, mode: agentMode.value, businessId: post.value.businessId,
    })
    const parsed = parseAgentResponse(res.content)
    chatMessages.value.push({ role: 'assistant', content: parsed.text, prompts: parsed.prompts, suggestions: parsed.suggestions, createdAt: new Date().toISOString() })
  } catch (e: any) { toast.error(e.message || 'Ошибка агента') }
  finally { agentLoading.value = false }
}

function onAgentUsePrompt(promptText: string) {
  videoPrompt.value = promptText
  toast.success('Промпт загружен из агента')
}

// «Оживить»: описать фото (Gemini Vision) → попросить агента собрать промпт движения
async function animatePhoto() {
  if (!videoBaseImage.value) { toast.error('В сторисе нет фото для оживления'); return }
  if (animating.value || agentLoading.value) return
  animating.value = true
  try {
    if (!photoDescription.value) {
      const d = await http.post<{ description: string }>('/ai/describe-image', {
        imageUrl: videoBaseImage.value.url, type: 'auto',
      })
      photoDescription.value = d.description || ''
    }
    await sendAgentMessage('Оживи это фото для сториса: добавь естественное движение (камера, вода, ветер, свет, лёгкое движение в кадре), сохрани композицию и субъект. Дай готовый промпт.')
  } catch (e: any) { toast.error('Ошибка: ' + (e.message || e)) }
  finally { animating.value = false }
}

async function generateAiVideo() {
  if (!post.value || !videoPrompt.value.trim()) return
  aiVideoLoading.value = true
  try {
    const firstFrameUrl = videoBaseImage.value?.url || undefined
    // 1. Создать GenerationSession type=video (video-poller ищет сессии с kieTaskId)
    const session = await http.post<{ id: string }>('/sessions', {
      businessId: post.value.businessId,
      type: 'video',
      prompt: videoPrompt.value,
      duration: videoDuration.value,
      generateAudio: videoAudio.value,
      aspectRatio: '9:16',
      resolution: '720p',
      inputMode: firstFrameUrl ? 'frames' : 'text',
      firstFrameUrl: firstFrameUrl || null,
    })
    videoSessionId.value = session.id
    try { sessionStorage.setItem('story-video-' + post.value.id, session.id) } catch {}

    // 2. Запустить генерацию (202, НЕ ждём mediaFile — придёт через SSE)
    await http.post('/ai/generate-video', {
      businessId: post.value.businessId,
      postId: post.value.id,
      sessionId: session.id,
      prompt: videoPrompt.value,
      duration: videoDuration.value,
      aspectRatio: '9:16',
      generateAudio: videoAudio.value,
      firstFrameUrl,
    })

    videoGenerating.value = true
    showAiVideo.value = false
    toast.info('Видео генерируется — 1-3 минуты. Можно подождать здесь.')
  } catch (e: any) { toast.error('Ошибка: ' + (e.message || e)) }
  finally { aiVideoLoading.value = false }
}

// Привязать готовое видео сессии к сторису (вызывается по SSE / при загрузке) → новый raw-источник
async function attachVideoFromSession(sessionId: string) {
  if (!post.value) return
  try {
    const s = await http.get<{ status: string; mediaFileId?: string | null; errorMessage?: string | null }>(`/sessions/${sessionId}`)
    if (s.status === 'completed' && s.mediaFileId) {
      if (photo.value && photo.value.id !== s.mediaFileId) await detachMedia(photo.value.id)
      await http.post(`/media/${s.mediaFileId}/attach`, { postId: post.value.id }).catch(() => {})
      const vid = await fetchMedia(s.mediaFileId)
      if (vid) setNewSource(vid)
      videoGenerating.value = false
      videoSessionId.value = null
      try { sessionStorage.removeItem('story-video-' + post.value.id) } catch {}
      toast.success('Видео готово и добавлено в сторис!')
    } else if (s.status === 'failed') {
      videoGenerating.value = false
      videoSessionId.value = null
      try { sessionStorage.removeItem('story-video-' + post.value.id) } catch {}
      toast.error('Не удалось сгенерировать видео: ' + (s.errorMessage || ''))
    }
  } catch {}
}

async function enhanceImagePrompt() {
  if (!post.value || !aiPrompt.value.trim()) return
  aiEnhancing.value = true
  try {
    const result = await http.post<{ enhancedPrompt: string }>('/ai/enhance-image-prompt', {
      prompt: aiPrompt.value,
      aspectRatio: '9:16',
      businessId: post.value.businessId,
    })
    aiPrompt.value = result.enhancedPrompt
    toast.success('Промпт улучшен')
  } catch (e: any) { toast.error('Ошибка: ' + (e.message || e)) }
  finally { aiEnhancing.value = false }
}

// --- Publish ---
const canPublishNow = computed(() => !!sourceMedia.value && selectedChannels.value.length > 0)

// Дропдаун «Опубликовать ▾»
function onPublishNow() {
  publishMenuOpen.value = false
  if (!post.value || !sourceMedia.value) { toast.error('Загрузите медиа'); return }
  if (!selectedChannels.value.length) { toast.error('Выберите хотя бы один канал'); return }
  confirmPublish()
}
function onChooseSchedule() {
  publishMenuOpen.value = false
  if (!sourceMedia.value) { toast.error('Загрузите медиа'); return }
  if (!selectedChannels.value.length) { toast.error('Выберите хотя бы один канал'); return }
  scheduleMode.value = true
}
async function onSaveDraft() {
  publishMenuOpen.value = false
  if (!post.value) return
  try {
    // Текст/дизайн вшиты в baked-медиа и persist в Post.overlaySpec (авто-бейком). Сохраняем название.
    if (overlayRef.value) await overlayRef.value.ensureBaked()
    await http.put(`/posts/${post.value.id}`, { title: storyTitle.value || null })
    toast.success('Черновик сохранён')
  } catch (e: any) { toast.error('Ошибка: ' + (e.message || e)) }
}

// Гарантировать, что публикуемое медиа = свежий baked-overlay, и что к посту привязан ТОЛЬКО он.
// Возвращает id baked-медиа (или null при неудаче). Клиентского canvas-экспорта больше нет.
async function ensureBakedForPublish(): Promise<string | null> {
  if (!post.value || !sourceMedia.value) return null
  const bakedId = overlayRef.value ? await overlayRef.value.ensureBaked() : (photo.value?.id || null)
  if (!bakedId) return null
  // Публикатор постит post.mediaFiles → оставляем ровно baked (открепляем raw-источник, если он ещё привязан)
  if (sourceMedia.value.id !== bakedId) await detachMedia(sourceMedia.value.id)
  return bakedId
}

// Найти версию для канала или создать (обрабатывает unique-конфликт postId+platformAccountId)
async function ensureVersion(channelId: string): Promise<string> {
  const existing = (post.value!.versions || []).find(v => v.platformAccount.id === channelId)
  if (existing) return existing.id
  try {
    const v = await http.post<{ id: string }>(`/posts/${post.value!.id}/versions`, {
      platformAccountId: channelId, body: post.value!.body || ' ', hashtags: [],
    })
    return v.id
  } catch (e) {
    const fresh = await http.get<Post>(`/posts/${post.value!.id}`)
    const found = (fresh.versions || []).find(v => v.platformAccount.id === channelId)
    if (found) return found.id
    throw e
  }
}

// storiesOptions публикации: сервер НЕ бейкает (skipOverlay), ссылка-кнопка VK — нативная.
function storiesPublishOptions() {
  return { skipOverlay: true, linkText: linkType.value || undefined, linkUrl: linkUrl.value || undefined }
}

// Подтвердить и опубликовать в выбранные каналы (мультипостинг VK + IG). Постим УЖЕ запечённый overlay-медиа.
async function confirmPublish() {
  if (!post.value || !selectedChannels.value.length) return
  publishing.value = true
  publishResults.value = []
  try {
    const bakedId = await ensureBakedForPublish()
    if (!bakedId) { toast.error('Не удалось подготовить сторис'); return }
    await http.put(`/posts/${post.value.id}`, { title: storyTitle.value || null }).catch(() => {})

    // Цикл по каналам — частичный успех допустим (VK ок, IG упал — не падаем целиком)
    for (const channelId of selectedChannels.value) {
      const ch = storyChannels.value.find(c => c.id === channelId)
      const item: PublishResultItem = { channelId, platform: ch?.platform || '', accountName: ch?.accountName || '', success: false, externalUrl: null, error: null }
      try {
        const versionId = await ensureVersion(channelId)
        const res = await http.post<{ success: boolean; externalUrl: string | null; error: string | null }>(
          `/post-versions/${versionId}/publish`, { storiesOptions: storiesPublishOptions() })
        item.success = res.success; item.externalUrl = res.externalUrl; item.error = res.error
      } catch (e: any) { item.error = e.message || String(e) }
      publishResults.value.push(item)
    }

    const ok = publishResults.value.filter(r => r.success).length
    const fail = publishResults.value.length - ok
    if (fail === 0) toast.success(`Опубликовано во все каналы (${ok})`)
    else if (ok === 0) toast.error('Не удалось опубликовать ни в один канал')
    else toast.info(`Опубликовано: ${ok}, ошибок: ${fail}`)

    try {
      const freshPost = await http.get<Post>(`/posts/${post.value.id}`)
      if (freshPost) { post.value.versions = freshPost.versions; post.value.status = freshPost.status; post.value.mediaFiles = freshPost.mediaFiles }
    } catch {}
  } catch (e: any) { toast.error('Ошибка: ' + e.message) }
  finally { publishing.value = false }
}

async function schedulePublish() {
  if (!post.value || !scheduledAt.value || !selectedChannels.value.length) return
  scheduling.value = true
  publishResults.value = []
  try {
    const bakedId = await ensureBakedForPublish()
    if (!bakedId) { toast.error('Не удалось подготовить сторис'); return }
    await http.put(`/posts/${post.value.id}`, { title: storyTitle.value || null }).catch(() => {})

    const iso = new Date(scheduledAt.value).toISOString()
    for (const channelId of selectedChannels.value) {
      const ch = storyChannels.value.find(c => c.id === channelId)
      const item: PublishResultItem = { channelId, platform: ch?.platform || '', accountName: ch?.accountName || '', success: false, externalUrl: null, error: null }
      try {
        const versionId = await ensureVersion(channelId)
        await http.post(`/post-versions/${versionId}/schedule`, {
          scheduledAt: iso,
          storiesOptions: storiesPublishOptions(),
        })
        item.success = true
      } catch (e: any) { item.error = e.message || String(e) }
      publishResults.value.push(item)
    }

    const ok = publishResults.value.filter(r => r.success).length
    const fail = publishResults.value.length - ok
    if (fail === 0) toast.success(`Запланировано на ${new Date(scheduledAt.value).toLocaleString('ru')} (${ok})`)
    else if (ok === 0) toast.error('Не удалось запланировать')
    else toast.info(`Запланировано: ${ok}, ошибок: ${fail}`)

    scheduleMode.value = false
    scheduledAt.value = ''
    try {
      const freshPost = await http.get<Post>(`/posts/${post.value.id}`)
      if (freshPost) { post.value.versions = freshPost.versions; post.value.status = freshPost.status; post.value.mediaFiles = freshPost.mediaFiles }
    } catch {}
  } catch (e: any) { toast.error('Ошибка: ' + e.message) }
  finally { scheduling.value = false }
}

const LINK_TYPES = [
  { value: '', label: 'Без ссылки' },
  { value: 'learn_more', label: 'Подробнее' },
  { value: 'book', label: 'Забронировать' },
  { value: 'order', label: 'Заказать' },
  { value: 'buy', label: 'Купить' },
  { value: 'enroll', label: 'Записаться' },
  { value: 'open', label: 'Открыть' },
  { value: 'more', label: 'Ещё' },
  { value: 'signup', label: 'Зарегистрироваться' },
  { value: 'contact', label: 'Связаться' },
  { value: 'go_to', label: 'Перейти' },
  { value: 'write', label: 'Написать' },
  { value: 'read', label: 'Читать' },
  { value: 'watch', label: 'Смотреть' },
  { value: 'ticket', label: 'Билет' },
  { value: 'install', label: 'Установить' },
]

// Превью «как в соцсети»: выбранные каналы (VK/IG) + активный таб
const previewChannels = computed(() => storyChannels.value.filter(c => selectedChannels.value.includes(c.id)))
const activePreviewChannel = computed(() =>
  previewChannels.value.find(c => c.platform === previewPlatform.value)
  || previewChannels.value[0] || storyChannels.value[0] || null)
// Медиа для StoriesPreview: baked-видео → кадр-превью (webp), фото → PNG. Всё запечённое → baked=true.
const previewMediaFiles = computed(() => {
  if (!photo.value) return [] as { url: string; thumbUrl: string | null; mimeType: string }[]
  const isVid = photo.value.mimeType?.startsWith('video/')
  const url = isVid ? (photo.value.thumbUrl || photo.value.url) : photo.value.url
  return [{ url, thumbUrl: photo.value.thumbUrl ?? null, mimeType: photo.value.mimeType }]
})

// Авто-дефолт кнопки-ссылки по платформе/типу: VK-сторис → «Бронь ВК Сторис», иначе любая VK-бронь.
function applyDefaultBookingLink() {
  if (linkUrl.value || isPublished.value || !bookingLinks.value.length) return
  const story = bookingLinks.value.find(b => b.scope.includes('story') && b.scope.includes('vk'))
  const vk = bookingLinks.value.find(b => b.scope.includes('vk'))
  const pick = story || vk
  if (pick) { if (!linkType.value) linkType.value = 'book'; linkUrl.value = pick.url }
}

// --- SSE: реал-тайм статус видео-генерации (как в VideoStudio) ---
let sseSource: EventSource | null = null
let sseReconnectTimer: ReturnType<typeof setTimeout> | null = null

function connectSSE() {
  sseSource = new EventSource(`/api/sse?tabId=${TAB_ID}`)
  sseSource.onmessage = (e) => {
    if (e.data === 'ping' || e.data === 'connected') return
    try {
      const ev = JSON.parse(e.data)
      if (ev.type === 'session_updated' && ev.sessionId && ev.sessionId === videoSessionId.value) {
        if (ev.status === 'completed' || ev.status === 'failed') attachVideoFromSession(ev.sessionId)
      }
    } catch {}
  }
  sseSource.onerror = () => {
    sseSource?.close()
    sseReconnectTimer = setTimeout(connectSSE, 5000)
  }
}

// Восстановить незавершённую видео-генерацию после F5/навигации
async function restoreVideoSession() {
  if (!post.value) return
  try {
    const sid = sessionStorage.getItem('story-video-' + post.value.id)
    if (!sid) return
    const s = await http.get<{ status: string }>(`/sessions/${sid}`)
    if (s.status === 'generating') { videoSessionId.value = sid; videoGenerating.value = true }
    else if (s.status === 'completed') { videoSessionId.value = sid; await attachVideoFromSession(sid) }
    else sessionStorage.removeItem('story-video-' + post.value.id)
  } catch {}
}

onMounted(async () => {
  await loadPost()
  restoreVideoSession()
  connectSSE()
})
onUnmounted(() => {
  sseSource?.close()
  if (sseReconnectTimer) clearTimeout(sseReconnectTimer)
})
</script>

<template>
  <div>
    <button @click="router.push(backTo.path)" class="flex items-center gap-1 text-sm text-gray-500 hover:text-gray-700 dark:hover:text-gray-300 mb-4">
      <ArrowLeft :size="16" /> {{ backTo.label }}
    </button>

    <div v-if="loading" class="text-gray-500 py-8 text-center">Загрузка...</div>

    <div v-else-if="post" class="grid grid-cols-1 lg:grid-cols-12 gap-6">

      <!-- LEFT: Редактирование (7/12) -->
      <div class="lg:col-span-7 space-y-4">

        <!-- Published lock banner -->
        <div v-if="isPublished" class="p-3 rounded-xl bg-amber-50 dark:bg-amber-950 border border-amber-200 dark:border-amber-800 text-center">
          <p class="text-xs text-amber-700 dark:text-amber-300 font-medium">Редактирование заблокировано после публикации</p>
        </div>

        <!-- Scheduled banner — редактирование разрешено, но нужно перепланировать -->
        <div v-else-if="isScheduled" class="p-3 rounded-xl bg-blue-50 dark:bg-blue-950 border border-blue-200 dark:border-blue-800">
          <p class="text-xs text-blue-700 dark:text-blue-300 font-medium flex items-center gap-1.5">
            <Clock :size="14" /> Сторис запланирован
          </p>
          <p class="text-[10px] text-blue-500 dark:text-blue-400 mt-1">
            Можно отредактировать ниже. Чтобы изменения вступили в силу — снова нажмите «Опубликовать ▾» и перепланируйте (или отмените запланированную справа).
          </p>
        </div>

        <!-- Title -->
        <div :class="['bg-white dark:bg-gray-900 rounded-xl p-5 border border-gray-200 dark:border-gray-800', isPublished && 'opacity-60 pointer-events-none select-none']">
          <h3 class="font-semibold text-sm mb-2">Название</h3>
          <input v-model="storyTitle" placeholder="Название истории..."
            class="w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 focus:ring-2 focus:ring-brand-500 text-sm" />
        </div>

        <!-- Media -->
        <div :class="['bg-white dark:bg-gray-900 rounded-xl p-5 border border-gray-200 dark:border-gray-800', isPublished && 'opacity-60 pointer-events-none select-none']">
          <h3 class="font-semibold text-sm mb-3 flex items-center gap-2"><Image :size="16" /> Медиа</h3>
          <div v-if="photo" class="flex items-center gap-3 mb-3">
            <video v-if="photo.mimeType?.startsWith('video/')" :src="photo.url" class="w-12 h-12 rounded-lg object-cover" muted preload="metadata" />
            <img v-else :src="photo.thumbUrl || photo.url" class="w-12 h-12 rounded-lg object-cover" />
            <div class="flex-1 min-w-0">
              <div class="text-sm truncate">{{ photo.filename }}</div>
              <div class="text-[10px] text-gray-400">
                {{ (photo.sizeBytes / 1024).toFixed(0) }} KB
                <template v-if="photo.durationSec"> · {{ photo.durationSec }} сек</template>
              </div>
              <div v-if="photo.aiModel" class="flex items-center gap-1.5 mt-0.5">
                <span class="px-1.5 py-0.5 bg-purple-100 dark:bg-purple-900/50 text-purple-600 dark:text-purple-400 rounded text-[9px] font-medium">AI</span>
                <span class="text-[9px] text-gray-400">{{ photo.aiModel }}</span>
                <span v-if="photo.aiCostUsd" class="text-[9px] text-gray-400">${{ photo.aiCostUsd.toFixed(2) }}</span>
              </div>
            </div>
            <button @click="removePhoto" class="p-1.5 rounded text-gray-400 hover:text-red-500"><Trash2 :size="14" /></button>
          </div>
          <div class="flex flex-wrap gap-2">
            <label :class="['flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg border-2 border-dashed cursor-pointer text-xs font-medium',
              uploading ? 'opacity-50' : 'border-gray-300 dark:border-gray-700 text-gray-500 hover:border-brand-400']">
              <Loader2 v-if="uploading" :size="14" class="animate-spin" /><Upload v-else :size="14" />
              {{ sourceMedia ? 'Заменить' : 'Загрузить' }}
              <input type="file" accept="image/*,video/*" class="hidden" @change="uploadPhoto" :disabled="uploading" />
            </label>
            <button @click="showMediaPicker = true"
              class="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-blue-100 dark:bg-blue-900 text-blue-700 dark:text-blue-300 text-xs font-medium hover:bg-blue-200 dark:hover:bg-blue-800">
              <Images :size="14" /> Медиатека
            </button>
            <button @click="showAiImage = true"
              class="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-purple-100 dark:bg-purple-900 text-purple-700 dark:text-purple-300 text-xs font-medium hover:bg-purple-200">
              <Sparkles :size="14" /> AI Фото
            </button>
            <button v-if="isAdmin" @click="openVideoModal"
              class="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-emerald-100 dark:bg-emerald-900 text-emerald-700 dark:text-emerald-300 text-xs font-medium hover:bg-emerald-200 dark:hover:bg-emerald-800">
              <Video :size="14" /> AI Видео
            </button>
            <button v-if="sourceMedia && !isVideoSource" @click="showEditModal = true" title="Редактировать AI"
              class="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-purple-100 dark:bg-purple-900 text-purple-700 dark:text-purple-300 text-xs font-medium hover:bg-purple-200">
              <Wand2 :size="14" />
            </button>
          </div>
          <!-- Индикатор фоновой генерации -->
          <div v-if="editingImage || aiVideoLoading || videoGenerating" class="mt-3 flex items-center gap-2 text-xs text-gray-500">
            <Loader2 :size="14" class="animate-spin" :class="(aiVideoLoading || videoGenerating) ? 'text-emerald-500' : 'text-purple-500'" />
            {{ videoGenerating ? 'Видео генерируется (1-3 мин)...' : aiVideoLoading ? 'Запуск генерации видео...' : 'Генерация изображения...' }}
          </div>
        </div>

        <!-- Оформление сторис: единый OverlayEditor (текст/кадр/шрифт/шаблон/погода/CTA → satori-бейк) -->
        <div v-if="sourceMedia && !isPublished" class="bg-white dark:bg-gray-900 rounded-xl p-5 border border-gray-200 dark:border-gray-800">
          <h3 class="font-semibold text-sm mb-3 flex items-center gap-2"><Sparkles :size="16" class="text-fuchsia-500" /> Оформление сторис</h3>
          <OverlayEditor
            ref="overlayRef"
            :source-media-id="overlaySourceId"
            :business-id="post.businessId"
            :post-id="post.id"
            :initial-spec="overlaySpecSeed"
            :source-photo-url="sourcePhotoUrl"
            :is-video="isVideoSource"
            :music-session-id="selectedMusicSessionId"
            @baked="onBaked"
            @update:spec="liveSpec = $event"
          />
        </div>
        <div v-else-if="sourceMedia && isPublished" class="bg-fuchsia-50 dark:bg-fuchsia-950/30 border border-fuchsia-200 dark:border-fuchsia-800/50 rounded-xl p-4 flex items-center gap-2.5">
          <Sparkles :size="18" class="text-fuchsia-500 shrink-0" />
          <div>
            <p class="text-sm font-semibold text-fuchsia-800 dark:text-fuchsia-200">Сторис опубликована</p>
            <p class="text-xs text-fuchsia-600 dark:text-fuchsia-400">Дизайн вшит в опубликованное медиа — редактирование недоступно.</p>
          </div>
        </div>
        <div v-else class="bg-gray-50 dark:bg-gray-900/50 border border-dashed border-gray-300 dark:border-gray-700 rounded-xl p-6 text-center">
          <p class="text-sm text-gray-500">Загрузите фото или видео выше, чтобы оформить сторис.</p>
        </div>

        <!-- Музыка для видео-сторис (вшивается в baked-видео) -->
        <div v-if="isVideoSource && musicTracks.length" :class="['bg-white dark:bg-gray-900 rounded-xl p-5 border border-gray-200 dark:border-gray-800', isPublished && 'opacity-60 pointer-events-none select-none']">
          <h3 class="font-semibold text-sm mb-3 flex items-center gap-2"><Music :size="16" /> Музыка</h3>
          <select v-model="selectedMusicSessionId" class="w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 text-sm">
            <option :value="null">Без музыки</option>
            <option v-for="t in musicTracks" :key="t.id" :value="t.id">🎵 {{ t.title }}</option>
          </select>
          <p class="text-[10px] text-gray-400 mt-1.5">Трек из Звуковой студии вшивается в видео при запекании (VK/IG нативную музыку в сторис через API не добавляют).</p>
        </div>

        <!-- Link -->
        <div :class="['bg-white dark:bg-gray-900 rounded-xl p-5 border border-gray-200 dark:border-gray-800', isPublished && 'opacity-60 pointer-events-none select-none']">
          <h3 class="font-semibold text-sm mb-3 flex items-center gap-2"><Link :size="16" /> Кнопка-ссылка</h3>
          <select v-model="linkType" class="w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 text-sm mb-2">
            <option v-for="lt in LINK_TYPES" :key="lt.value" :value="lt.value">{{ lt.label }}</option>
          </select>
          <template v-if="linkType">
            <!-- Готовые ссылки из НаWоде ERP (booking_links) — авто-дефолт «Бронь ВК Сторис» -->
            <select v-if="bookingLinks.length" :value="linkUrl" @change="linkUrl = ($event.target as HTMLSelectElement).value"
              class="w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 text-sm mb-2">
              <option value="">— готовая ссылка (бронь) —</option>
              <option v-for="bl in bookingLinks" :key="bl.url" :value="bl.url">{{ bl.label }}</option>
            </select>
            <input v-model="linkUrl" placeholder="https://nawode.ru"
              class="w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 text-sm" />
            <p class="text-[10px] text-gray-400 mt-1.5">Для VK-сторис подставлена «Бронь ВК Сторис» — можно сменить из списка или вписать вручную. UTM добавится автоматически.</p>
          </template>
        </div>

      </div>

      <!-- RIGHT: Превью «как в соцсети» + публикация (5/12) -->
      <div class="lg:col-span-5 space-y-4 lg:sticky lg:top-4 lg:self-start">

        <!-- Превью по каналам (табы VK / Instagram) -->
        <div class="bg-white dark:bg-gray-900 rounded-xl p-5 border border-gray-200 dark:border-gray-800">
          <div class="flex items-center justify-between mb-3">
            <h3 class="font-semibold text-sm">Превью</h3>
            <div v-if="previewChannels.length" class="flex gap-1">
              <button v-for="ch in previewChannels" :key="ch.id" @click="previewPlatform = ch.platform"
                :class="['px-2.5 py-1 rounded-lg text-[11px] font-medium border transition-colors flex items-center gap-1',
                  previewPlatform === ch.platform
                    ? 'border-brand-500 bg-brand-50 dark:bg-brand-950 text-brand-700 dark:text-brand-300'
                    : 'border-gray-200 dark:border-gray-700 text-gray-500 hover:border-gray-300']">
                <span :class="['w-1.5 h-1.5 rounded-full', platformBgColor(ch.platform)]"></span>
                {{ platformLabel(ch.platform) }}
              </button>
            </div>
          </div>
          <StoriesPreview
            :account-name="activePreviewChannel?.accountName || ''"
            text=""
            :media-files="previewMediaFiles"
            :platform="activePreviewChannel?.platform || previewPlatform"
            :baked="true" />
          <p v-if="linkType" class="text-center text-[10px] text-gray-400 mt-2">
            Кнопка «{{ LINK_TYPES.find(l => l.value === linkType)?.label }}» — VK добавит нативно
          </p>
        </div>

        <!-- Публикация -->
        <div class="bg-white dark:bg-gray-900 rounded-xl p-5 border border-gray-200 dark:border-gray-800">
          <h3 class="font-semibold text-sm mb-3 flex items-center gap-2"><Send :size="16" /> Публикация</h3>
          <div v-if="storyChannels.length" class="mb-3">
            <div class="text-xs text-gray-500 mb-1.5">Каналы публикации (VK / Instagram)</div>
            <div class="flex flex-wrap gap-1.5">
              <button v-for="ch in storyChannels" :key="ch.id" @click="toggleChannel(ch.id)"
                :class="['flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium border transition-colors',
                  selectedChannels.includes(ch.id)
                    ? 'border-brand-500 bg-brand-50 dark:bg-brand-950 text-brand-700 dark:text-brand-300'
                    : 'border-gray-200 dark:border-gray-700 text-gray-500 hover:border-gray-300']">
                <span :class="['w-1.5 h-1.5 rounded-full', platformBgColor(ch.platform)]"></span>
                <span :class="platformColor(ch.platform)">{{ platformLabel(ch.platform) }}</span>
                {{ ch.accountName }}
              </button>
            </div>
          </div>
          <div v-else class="text-xs text-red-500 mb-3">Нет каналов VK/IG. <router-link :to="'/businesses/' + post.businessId + '?tab=channels'" class="text-brand-500 underline">Настроить каналы</router-link></div>

          <!-- Статусы по каналам (мультипостинг) -->
          <div v-for="v in (post.versions || [])" :key="v.id" class="mb-2">
            <div v-if="v.status === 'SCHEDULED'" class="p-3 rounded-lg bg-blue-50 dark:bg-blue-950 border border-blue-200 dark:border-blue-800">
              <div class="flex items-center justify-between">
                <div class="flex items-center gap-2">
                  <Clock :size="16" class="text-blue-600" />
                  <div>
                    <div class="text-sm font-medium text-blue-700 dark:text-blue-300">
                      <span :class="platformColor(v.platformAccount.platform)">{{ platformLabel(v.platformAccount.platform) }}</span> · Запланировано
                    </div>
                    <div v-if="v.scheduledAt" class="text-[10px] text-blue-500">{{ new Date(v.scheduledAt).toLocaleString('ru') }}</div>
                  </div>
                </div>
                <button @click="cancelSchedule(v.id)" :disabled="cancellingSchedule"
                  class="px-2.5 py-1 rounded-lg text-xs font-medium text-red-600 dark:text-red-400 border border-red-300 dark:border-red-700 hover:bg-red-50 dark:hover:bg-red-950 disabled:opacity-50">
                  {{ cancellingSchedule ? '...' : 'Отменить' }}
                </button>
              </div>
            </div>

            <div v-else-if="v.status === 'PUBLISHED'" class="p-3 rounded-lg bg-green-50 dark:bg-green-950 border border-green-200 dark:border-green-800">
              <div class="flex items-center gap-2">
                <CheckCircle :size="16" class="text-green-600" />
                <div>
                  <div class="text-sm font-medium text-green-700 dark:text-green-300">
                    <span :class="platformColor(v.platformAccount.platform)">{{ platformLabel(v.platformAccount.platform) }}</span> · Опубликовано
                  </div>
                  <div v-if="v.publishedAt" class="text-[10px] text-green-500">{{ formatDate(v.publishedAt) }}</div>
                  <a v-if="v.externalUrl" :href="v.externalUrl" target="_blank" class="text-xs text-green-600 hover:underline flex items-center gap-1 mt-1"><ExternalLink :size="12" /> Открыть</a>
                </div>
              </div>
            </div>

            <div v-else-if="v.publishLogs?.[0]?.status === 'FAILED'" class="p-3 rounded-lg bg-red-50 dark:bg-red-950 border border-red-200 dark:border-red-800">
              <div class="flex items-start gap-2">
                <AlertCircle :size="16" class="text-red-500 shrink-0 mt-0.5" />
                <div class="text-xs text-red-600">
                  <span :class="platformColor(v.platformAccount.platform)">{{ platformLabel(v.platformAccount.platform) }}</span>: {{ v.publishLogs[0].errorMessage }}
                </div>
              </div>
            </div>
          </div>

          <!-- Опубликовать ▾ (единый UX как в редакторе постов) -->
          <div v-if="!isPublished" class="relative">
            <div class="flex items-stretch gap-2">
              <button @click="onPublishNow" :disabled="publishing || !canPublishNow"
                class="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 rounded-l-lg bg-green-600 hover:bg-green-700 text-white text-sm font-medium disabled:opacity-50">
                <Loader2 v-if="publishing" :size="16" class="animate-spin" /><Send v-else :size="16" />
                {{ publishing ? 'Публикуем...' : `Опубликовать сейчас (${selectedChannels.length})` }}
              </button>
              <button @click="publishMenuOpen = !publishMenuOpen" :disabled="publishing"
                class="px-3 rounded-r-lg bg-green-700 hover:bg-green-800 text-white disabled:opacity-50 border-l border-green-500/40">
                <ChevronDown :size="16" />
              </button>
            </div>

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
            <div v-if="publishMenuOpen" class="fixed inset-0 z-10" @click="publishMenuOpen = false"></div>

            <!-- Режим планирования -->
            <div v-if="scheduleMode" class="mt-2 flex flex-col sm:flex-row gap-2 items-stretch sm:items-center p-3 rounded-lg bg-blue-50 dark:bg-blue-950 border border-blue-200 dark:border-blue-800">
              <span class="text-xs text-blue-700 dark:text-blue-300 flex items-center gap-1 shrink-0"><Calendar :size="14" /> Когда:</span>
              <input v-model="scheduledAt" type="datetime-local" :min="new Date().toISOString().slice(0,16)"
                class="flex-1 min-w-0 px-2 py-2 rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 text-xs" />
              <button @click="schedulePublish" :disabled="scheduling || !scheduledAt || !selectedChannels.length"
                class="flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-xs font-medium disabled:opacity-50 shrink-0">
                <Loader2 v-if="scheduling" :size="14" class="animate-spin" /><Clock v-else :size="14" /> Запланировать ({{ selectedChannels.length }})
              </button>
              <button @click="scheduleMode = false; scheduledAt = ''" class="p-2 rounded-lg text-gray-400 hover:bg-white dark:hover:bg-gray-800 shrink-0"><X :size="14" /></button>
            </div>
            <p class="text-[10px] text-gray-400 mt-2">Сторис уйдёт в выбранные каналы. Текст/дизайн вшиты в медиа; ссылка-кнопка — нативная в VK.</p>
          </div>
        </div>
      </div>
    </div>

    <!-- AI Image Modal -->
    <div v-if="showAiImage" class="fixed inset-0 z-50 flex items-center justify-center bg-black/50" @click.self="showAiImage = false">
      <div class="bg-white dark:bg-gray-900 rounded-2xl p-6 w-full max-w-md shadow-xl">
        <h2 class="text-lg font-bold mb-4 flex items-center gap-2"><Sparkles :size="20" class="text-purple-500" /> AI Картинка (9:16)</h2>
        <div class="space-y-3">
          <!-- Template pills (from DB) -->
          <div v-if="imageTemplates.length">
            <label class="block text-sm font-medium mb-1.5">Шаблоны</label>
            <div class="flex flex-wrap gap-1.5">
              <button v-for="t in imageTemplates" :key="t.id" @click="aiPrompt = t.prompt"
                class="px-2.5 py-1 rounded-full text-xs font-medium bg-purple-100 dark:bg-purple-900/50 text-purple-700 dark:text-purple-300 hover:bg-purple-200 dark:hover:bg-purple-800 transition-colors">
                {{ t.emoji }} {{ t.name }}
              </button>
            </div>
          </div>
          <!-- AI suggest button + results -->
          <div>
            <button @click="suggestTemplates" :disabled="suggestingTemplates"
              class="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium border border-purple-300 dark:border-purple-700 text-purple-600 dark:text-purple-400 hover:bg-purple-50 dark:hover:bg-purple-950 disabled:opacity-50 transition-colors">
              <Loader2 v-if="suggestingTemplates" :size="14" class="animate-spin" /><Wand2 v-else :size="14" />
              {{ suggestingTemplates ? 'Подбираю...' : '✨ Подобрать по контексту' }}
            </button>
            <div v-if="aiSuggestions.length" class="flex flex-wrap gap-1.5 mt-2">
              <button v-for="s in aiSuggestions" :key="s.name" @click="aiPrompt = s.prompt"
                class="px-2.5 py-1 rounded-full text-xs font-medium bg-emerald-100 dark:bg-emerald-900/50 text-emerald-700 dark:text-emerald-300 hover:bg-emerald-200 dark:hover:bg-emerald-800 transition-colors">
                {{ s.emoji }} {{ s.name }}
              </button>
            </div>
          </div>
          <!-- Character selector -->
          <div v-if="characters.length">
            <label class="block text-sm font-medium mb-1.5">Персонаж</label>
            <select v-model="selectedCharacterId"
              class="w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 text-sm">
              <option :value="null">Без персонажа</option>
              <option v-for="char in characters" :key="char.id" :value="char.id">
                {{ char.name }} ({{ char.type === 'person' ? 'человек' : char.type === 'mascot' ? 'маскот' : 'аватар' }})
              </option>
            </select>
          </div>
          <!-- Prompt textarea -->
          <textarea v-model="aiPrompt" rows="3" placeholder="Опишите изображение или выберите шаблон..."
            class="w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 focus:ring-2 focus:ring-purple-500 text-sm" />
          <!-- Enhance button -->
          <button @click="enhanceImagePrompt" :disabled="aiEnhancing || !aiPrompt.trim()"
            class="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium border border-purple-300 dark:border-purple-700 text-purple-600 dark:text-purple-400 hover:bg-purple-50 dark:hover:bg-purple-950 disabled:opacity-50 transition-colors">
            <Loader2 v-if="aiEnhancing" :size="14" class="animate-spin" /><Wand2 v-else :size="14" />
            {{ aiEnhancing ? 'Улучшаю...' : 'Улучшить промпт' }}
          </button>
          <div class="flex items-center gap-2 text-[10px] text-gray-400 mt-1">
            <span class="px-1.5 py-0.5 bg-purple-100 dark:bg-purple-900/50 text-purple-600 dark:text-purple-400 rounded font-medium">nano-banana-2</span>
            <span>~$0.06</span>
            <span>·</span>
            <span>~30 сек</span>
            <span>·</span>
            <span>промпт → EN авто</span>
          </div>
        </div>
        <div class="flex justify-end gap-2 mt-4">
          <button @click="showAiImage = false" class="px-4 py-2 rounded-lg text-sm text-gray-500">Отмена</button>
          <button @click="generateAiImage" :disabled="aiLoading || !aiPrompt.trim()"
            class="flex items-center gap-2 px-4 py-2 rounded-lg bg-purple-600 hover:bg-purple-700 text-white text-sm font-medium disabled:opacity-50">
            <Loader2 v-if="aiLoading" :size="16" class="animate-spin" /><Sparkles v-else :size="16" />
            {{ aiLoading ? 'Генерация...' : 'Сгенерировать' }}
          </button>
        </div>
      </div>
    </div>

    <!-- AI Video Modal (расширенный) -->
    <div v-if="showAiVideo" class="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" @click.self="showAiVideo = false">
      <div class="bg-white dark:bg-gray-900 rounded-2xl shadow-xl w-full max-w-4xl max-h-[90vh] overflow-hidden flex flex-col">
        <!-- Header -->
        <div class="flex items-center justify-between px-5 py-4 border-b border-gray-100 dark:border-gray-800">
          <h2 class="text-lg font-bold flex items-center gap-2">
            <Video :size="20" class="text-emerald-500" /> AI Видео для сториса
          </h2>
          <button @click="showAiVideo = false" class="p-1 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800"><X :size="18" class="text-gray-400" /></button>
        </div>

        <div class="flex-1 min-h-0 grid grid-cols-1 lg:grid-cols-2">
          <!-- Левая колонка: превью + Оживить + настройки + Generate -->
          <div class="p-5 overflow-y-auto border-b lg:border-b-0 lg:border-r border-gray-100 dark:border-gray-800 flex flex-col gap-4">
            <!-- Превью фото сториса -->
            <div class="flex flex-col items-center">
              <div v-if="videoBaseImage" class="relative bg-black rounded-2xl overflow-hidden" style="width: 150px; aspect-ratio: 9/16;">
                <img :src="videoBaseImage.thumbUrl || videoBaseImage.url" class="w-full h-full object-cover" />
              </div>
              <div v-else class="flex flex-col items-center justify-center rounded-2xl border-2 border-dashed border-gray-300 dark:border-gray-700 text-gray-400" style="width: 150px; aspect-ratio: 9/16;">
                <Video :size="28" /><span class="text-[10px] mt-1 px-2 text-center">Видео из текста</span>
              </div>
              <p class="text-[11px] text-gray-500 mt-2 text-center font-medium">
                {{ videoBaseImage ? 'Оживляем это фото' : 'Нет фото — видео из текста' }}
              </p>
            </div>

            <!-- Кнопка Оживить -->
            <button v-if="videoBaseImage" @click="animatePhoto" :disabled="animating || agentLoading"
              class="flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg bg-emerald-50 dark:bg-emerald-950 border border-emerald-300 dark:border-emerald-700 text-emerald-700 dark:text-emerald-300 text-sm font-medium hover:bg-emerald-100 dark:hover:bg-emerald-900 disabled:opacity-50">
              <Loader2 v-if="animating" :size="16" class="animate-spin" /><Sparkles v-else :size="16" />
              {{ animating ? 'Анализирую фото...' : 'Оживить — AI подберёт промпт' }}
            </button>

            <!-- Итоговый промпт -->
            <div>
              <label class="block text-xs font-medium text-gray-500 mb-1.5">Промпт видео</label>
              <textarea v-model="videoPrompt" rows="4" placeholder="Нажмите «Оживить» или попросите AI-агента справа собрать промпт..."
                class="w-full px-3 py-2.5 rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 focus:ring-2 focus:ring-emerald-500 text-sm resize-none" />
            </div>

            <!-- Длительность + звук -->
            <div class="grid grid-cols-2 gap-4">
              <div>
                <label class="block text-xs font-medium text-gray-500 mb-1.5">Длительность: {{ videoDuration }} сек</label>
                <input type="range" v-model.number="videoDuration" min="4" max="15" step="1"
                  class="w-full h-2 bg-gray-200 dark:bg-gray-700 rounded-lg appearance-none cursor-pointer accent-emerald-500" />
                <div class="flex justify-between text-[10px] text-gray-400 mt-0.5"><span>4с</span><span>15с</span></div>
              </div>
              <div>
                <label class="block text-xs font-medium text-gray-500 mb-1.5">Звук</label>
                <label class="flex items-center gap-2 cursor-pointer mt-1">
                  <div class="relative">
                    <input type="checkbox" v-model="videoAudio" class="sr-only peer" />
                    <div class="w-9 h-5 bg-gray-200 dark:bg-gray-700 rounded-full peer peer-checked:bg-emerald-500 transition-colors"></div>
                    <div class="absolute left-0.5 top-0.5 w-4 h-4 bg-white rounded-full transition-transform peer-checked:translate-x-4 shadow-sm"></div>
                  </div>
                  <span class="text-xs text-gray-600 dark:text-gray-400">{{ videoAudio ? 'Со звуком' : 'Без звука' }}</span>
                </label>
              </div>
            </div>

            <!-- Цена -->
            <div class="p-2.5 rounded-lg bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 flex items-center justify-between">
              <div class="flex items-center gap-1.5 text-[10px] text-gray-400 flex-wrap">
                <span class="px-1.5 py-0.5 bg-emerald-100 dark:bg-emerald-900/50 text-emerald-600 dark:text-emerald-400 rounded font-medium">seedance-2</span>
                <span>720p · 9:16</span><span>·</span><span>{{ videoBaseImage ? 'оживление' : 'из текста' }}</span>
              </div>
              <div class="text-right">
                <div class="text-sm font-bold text-emerald-600 dark:text-emerald-400">~{{ videoCostRub }} ₽</div>
                <div class="text-[9px] text-gray-400">${{ videoCostUsd.toFixed(2) }}</div>
              </div>
            </div>

            <!-- Generate -->
            <button @click="generateAiVideo" :disabled="aiVideoLoading || !videoPrompt.trim()"
              class="mt-auto flex items-center justify-center gap-2 px-5 py-3 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-bold disabled:opacity-50">
              <Loader2 v-if="aiVideoLoading" :size="16" class="animate-spin" /><Video v-else :size="16" />
              {{ aiVideoLoading ? 'Запуск...' : 'Сгенерировать видео' }}
            </button>
          </div>

          <!-- Правая колонка: AI-агент -->
          <div class="flex flex-col min-h-0">
            <VsAgentChat
              :messages="chatMessages"
              :loading="agentLoading"
              :mode="agentMode"
              :disabled="false"
              :context-summary="videoAgentContext"
              height-class="h-[50vh] lg:h-full"
              @send="sendAgentMessage"
              @use-prompt="onAgentUsePrompt"
              @update:mode="agentMode = $event" />
          </div>
        </div>
      </div>
    </div>

    <!-- AI Edit Modal — правим ИСХОДНОЕ фото (не baked) -->
    <ImageEditModal
      v-if="showEditModal && sourceMedia && post"
      :visible="showEditModal"
      :image-url="sourceMedia.url"
      :media-id="sourceMedia.id"
      :business-id="post.businessId"
      :post-id="post.id"
      @close="showEditModal = false"
      @edited="onImageEdited"
      @submitted="onEditSubmitted"
    />

    <!-- Media Picker Modal -->
    <MediaPickerModal
      v-if="post"
      :visible="showMediaPicker"
      :business-id="post.businessId"
      @close="showMediaPicker = false"
      @selected="pickFromLibrary"
    />
  </div>
</template>
