<script setup lang="ts">
import { ref, onMounted, computed, watch, nextTick, onUnmounted } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { http, TAB_ID } from '@/api/client'
import { useAuthStore } from '@/stores/auth'
import { useBusinessesStore } from '@/stores/businesses'
import { useToast } from '@/composables/useToast'
import { formatDate } from '@/composables/useFormatters'
import { useRates } from '@/composables/useRates'
import {
  ArrowLeft, Upload, Sparkles, Loader2, Send, CheckCircle,
  ExternalLink, AlertCircle, Image, Images, Link, Trash2, ZoomIn, ZoomOut, Wand2,
  ChevronLeft, ChevronRight, ChevronDown, Calendar, Clock, Video, X, Music, FileText
} from 'lucide-vue-next'
import ImageEditModal from '@/components/ai/ImageEditModal.vue'
import MediaPickerModal from '@/components/MediaPickerModal.vue'
import StoryDesignModal from '@/components/StoryDesignModal.vue'
import StoriesPreview from '@/components/posts/preview/StoriesPreview.vue'
import { platformColor, platformBgColor, platformLabel } from '@/composables/usePlatform'
import VsAgentChat from '@/components/video/VsAgentChat.vue'
import type { AgentMessage } from '@/components/video/VsAgentMessage.vue'

interface MediaFile { id: string; url: string; thumbUrl: string | null; filename: string; mimeType: string; sizeBytes: number; durationSec?: number | null; aiModel?: string | null; aiCostUsd?: number | null; altText?: string | null; tags?: string[] }
interface PlatformAccount { id: string; platform: string; accountName: string; accountId: string }
interface PostVersion {
  id: string; status: string; externalUrl: string | null; publishedAt: string | null; scheduledAt: string | null
  platformAccount: PlatformAccount
  publishLogs: { status: string; errorMessage: string | null; attemptedAt: string }[]
}
interface Post {
  id: string; businessId: string; title: string | null; body: string; postType: string
  status: string; createdAt: string; versions: PostVersion[]; mediaFiles: MediaFile[]
}
interface PublishResultItem {
  channelId: string; platform: string; accountName: string
  success: boolean; externalUrl: string | null; error: string | null
}

const route = useRoute()
const router = useRouter()
// Возврат «Назад» — туда, откуда пришли (дайджест / истории)
const backTo = computed(() => {
  switch (route.query.from) {
    case 'digest': return { path: '/digest', label: 'Назад в дайджест' }
    default: return { path: '/posts', label: 'Назад к историям' }
  }
})
const auth = useAuthStore()
const businesses = useBusinessesStore()
const toast = useToast()
const isAdmin = computed(() => auth.user?.role === 'ADMIN')

const post = ref<Post | null>(null)
const loading = ref(true)
const publishing = ref(false)
const uploading = ref(false)
const scheduling = ref(false)
const scheduledAt = ref('')
const cancellingSchedule = ref(false)

async function cancelSchedule(versionId: string) {
  if (!versionId || cancellingSchedule.value) return
  if (!confirm('Отменить запланированную публикацию?')) return
  cancellingSchedule.value = true
  try {
    await http.post(`/post-versions/${versionId}/schedule`, {
      scheduledAt: null,
    })
    toast.success('Публикация отменена')
    const freshPost = await http.get<Post>(`/posts/${post.value!.id}`)
    if (freshPost) { post.value!.versions = freshPost.versions; post.value!.status = freshPost.status }
  } catch (e: any) { toast.error('Ошибка: ' + (e.message || e)) }
  finally { cancellingSchedule.value = false }
}

// Canvas
const canvasRef = ref<HTMLCanvasElement | null>(null)
const overlayCanvasRef = ref<HTMLCanvasElement | null>(null) // прозрачный слой текста поверх видео (WYSIWYG)
const canvasWidth = 360  // Preview size
const canvasHeight = 640
const exportWidth = 1080 // Final export size
const exportHeight = 1920

// Image state
const originalPhotoUrl = ref<string | null>(null) // URL оригинала (не rendered)
const imgEl = ref<HTMLImageElement | null>(null)
const imgOffset = ref({ x: 0, y: 0 })
const imgScale = ref(1)
const dragging = ref(false)
const dragStart = ref({ x: 0, y: 0 })

// Story settings
const storyTitle = ref('')
const overlayText = ref('')
const textPosition = ref<'top' | 'center' | 'bottom'>('bottom')
const textColor = ref('#ffffff')
const fontSize = ref<'S' | 'M' | 'L'>('M')
const bgStyle = ref<'dark' | 'light' | 'none'>('dark')
const bgRadius = ref<'round' | 'square'>('round')
const textAlign = ref<'left' | 'center' | 'right'>('center')

// Auto-save title + text (debounce 1.5s)
let saveTimer: ReturnType<typeof setTimeout> | null = null
function autoSave() {
  if (!post.value || isPublished.value || isBakedStory.value) return // baked: текст вшит, body не трогаем
  if (saveTimer) clearTimeout(saveTimer)
  saveTimer = setTimeout(async () => {
    try {
      await http.put(`/posts/${post.value!.id}`, {
        body: overlayText.value,
        title: storyTitle.value || null,
      })
    } catch {}
  }, 1500)
}
watch([overlayText, storyTitle], autoSave)

const TEXT_COLORS = ['#ffffff', '#000000', '#ef4444', '#f97316', '#eab308', '#22c55e', '#3b82f6', '#8b5cf6', '#ec4899', '#d946ef']
const linkType = ref('')
const linkUrl = ref('')
// Готовые ссылки бронирования: НаWоде ERP booking_links (вкл. «Бронь ВК Сторис») → fallback BrandProfile.links
interface BookingLinkOption { label: string; ref: string; url: string; scope: string[] }
const bookingLinks = ref<BookingLinkOption[]>([])

// A4: музыка для видео-сторис (трек из Звуковой студии вшивается в видео при публикации)
interface MusicTrack { id: string; title: string }
const musicTracks = ref<MusicTrack[]>([])
const selectedMusicSessionId = ref<string | null>(null)

// Публикация: единый дропдаун «Опубликовать ▾» (как в PostEditor) + режим планирования
const publishMenuOpen = ref(false)
const scheduleMode = ref(false)
// Превью «как в соцсети» по каналам (таб VK / Instagram)
const previewPlatform = ref('VK')

// AI
const aiTextLoading = ref(false)
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

// Фото сториса АВТОМАТИЧЕСКИ = основа для оживления (img2video). Нет фото → text2video.
const videoBaseImage = computed(() => (photo.value && !isVideoMedia.value) ? photo.value : null)

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

// Text history (versions)
const textHistory = ref<{ title: string; body: string }[]>([])
const textHistoryIndex = ref(-1)
const generatingText = ref(false)

// Story templates from DB (loaded in loadPost)
interface DbStoryTemplate {
  id: string; name: string; emoji: string; overlayText: string
  textPosition: string; textColor: string; fontSize: string; bgStyle: string; linkType: string
  textAlign?: string; bgRadius?: string
}
const storyTemplates = ref<DbStoryTemplate[]>([])

const textHistoryLabel = computed(() => {
  if (textHistory.value.length === 0) return ''
  return `${textHistoryIndex.value + 1}/${textHistory.value.length}`
})

function textGoBack() {
  if (textHistoryIndex.value <= 0) return
  textHistoryIndex.value--
  applyTextVersion()
}

function textGoForward() {
  if (textHistoryIndex.value >= textHistory.value.length - 1) return
  textHistoryIndex.value++
  applyTextVersion()
}

function applyTextVersion() {
  const v = textHistory.value[textHistoryIndex.value]
  if (!v) return
  overlayText.value = v.body
  storyTitle.value = v.title
}

// Background image edit (from ImageEditModal)
async function onEditSubmitted(data: { prompt: string; model: string; mediaId: string }) {
  if (!post.value || !photo.value) return
  editingImage.value = true
  try {
    const result = await http.post<{ mediaFile: MediaFile }>('/ai/edit-image', {
      businessId: post.value.businessId,
      mediaId: data.mediaId,
      prompt: data.prompt,
      postId: post.value.id,
      model: data.model,
    })
    post.value.mediaFiles = [result.mediaFile]
    loadImage(result.mediaFile.url)
    toast.success('Изображение отредактировано')
  } catch (e: any) { toast.error('Ошибка: ' + (e.message || e)) }
  finally { editingImage.value = false }
}
const showMediaPicker = ref(false)

function onImageEdited(newFile: MediaFile) {
  if (!post.value) return
  post.value.mediaFiles = [newFile]
  loadImage(newFile.url)
  showEditModal.value = false
}

// Kept for reference but replaced by onEditSubmitted above
function _onImageEditedLegacy(newFile: MediaFile) {
  if (!post.value) return
  post.value.mediaFiles = [newFile]
  loadImage(newFile.url)
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

const photo = computed(() => post.value?.mediaFiles?.[0] || null)
const isVideoMedia = computed(() => photo.value?.mimeType?.startsWith('video/') || false)
// Baked-сторис: дизайн (текст/погода/CTA/лого) УЖЕ вшит в картинку через satori (дайджест).
// Тег 'story-design' или url с 'design_'. Для таких НЕ рисуем текст-оверлей поверх (иначе дубль).
const isBakedStory = computed(() => {
  const m = photo.value
  if (!m) return false
  return !!m.tags?.includes('story-design') || /\/design_/.test(m.url || '')
})

// Корректировка кадра дизайн-сторис (модалка с ползунком позиции → перезапекание)
const designModalOpen = ref(false)
async function onStoryDesignDone(design: { id: string; url: string; thumbUrl: string | null; tags: string[] }) {
  if (!post.value) return
  const oldId = photo.value?.id
  try {
    if (oldId && oldId !== design.id) await http.post(`/media/${oldId}/attach`, { postId: null }).catch(() => {})
    await http.post(`/media/${design.id}/attach`, { postId: post.value.id })
    post.value.mediaFiles = [{ id: design.id, url: design.url, thumbUrl: design.thumbUrl, filename: 'Сторис-дизайн', mimeType: 'image/png', sizeBytes: 0, tags: design.tags }]
    originalPhotoUrl.value = null
    loadImage(design.url)
  } catch (e: any) { toast.error('Ошибка: ' + (e.message || e)) }
}
// Полная блокировка — только после реальной публикации
const isPublished = computed(() =>
  (post.value?.versions || []).some(v => v.status === 'PUBLISHED'))
// Запланировано (но ещё не опубликовано) — редактирование разрешено, нужно перепланировать
const isScheduled = computed(() =>
  !isPublished.value && (post.value?.versions || []).some(v => v.status === 'SCHEDULED'))

const fontSizePx = computed(() => ({ S: 14, M: 18, L: 24 }[fontSize.value]))
const fontSizeExport = computed(() => ({ S: 42, M: 54, L: 72 }[fontSize.value]))

// --- Canvas rendering ---
function render() {
  const canvas = canvasRef.value
  if (!canvas) return
  const ctx = canvas.getContext('2d')
  if (!ctx) return
  drawScene(ctx, canvasWidth, canvasHeight, fontSizePx.value)
}

function drawTextOverlay(ctx: CanvasRenderingContext2D, text: string, w: number, h: number, fSize: number, buttonTopY?: number) {
  const align = textAlign.value
  ctx.font = `bold ${fSize}px 'Segoe UI Emoji', 'Noto Color Emoji', sans-serif`
  ctx.textAlign = align

  // Word wrap
  const padding = 20
  const maxW = w - padding * 2 - 20
  const words = text.split(' ')
  const lines: string[] = []
  let line = ''
  for (const word of words) {
    const test = line ? line + ' ' + word : word
    if (ctx.measureText(test).width > maxW && line) {
      lines.push(line)
      line = word
    } else {
      line = test
    }
  }
  if (line) lines.push(line)

  const lineH = fSize * 1.3
  const blockH = lines.length * lineH + 24

  let y: number
  if (textPosition.value === 'top') {
    y = Math.round(h * 0.06) + 30
  } else if (textPosition.value === 'center') {
    y = (h - blockH) / 2
  } else {
    // Внизу: если есть кнопка → над кнопкой, иначе → от нижнего края
    const bottomEdge = buttonTopY !== undefined ? buttonTopY : h
    y = bottomEdge - blockH - 10
  }

  // Background
  if (bgStyle.value !== 'none') {
    ctx.fillStyle = bgStyle.value === 'dark' ? 'rgba(0,0,0,0.5)' : 'rgba(255,255,255,0.7)'
    const scale = w / 360
    const radius = bgRadius.value === 'round' ? Math.round(12 * scale) : 0
    ctx.beginPath()
    ctx.roundRect(padding, y, w - padding * 2, blockH, radius)
    ctx.fill()
  }

  // Text x position based on alignment
  let textX: number
  if (align === 'left') textX = padding + 12
  else if (align === 'right') textX = w - padding - 12
  else textX = w / 2

  // Text
  ctx.fillStyle = textColor.value
  ctx.shadowColor = 'rgba(0,0,0,0.5)'
  ctx.shadowBlur = bgStyle.value === 'none' ? 6 : 3
  lines.forEach((ln, i) => {
    ctx.fillText(ln, textX, y + 14 + (i + 0.8) * lineH)
  })
  ctx.shadowBlur = 0
}

// --- Unified draw function for both preview and export ---
// isExport = true → НЕ рисуем кнопку-ссылку (VK рисует свою нативную)
function drawScene(ctx: CanvasRenderingContext2D, w: number, h: number, fSize: number, isExport = false) {
  ctx.clearRect(0, 0, w, h)
  const grad = ctx.createLinearGradient(0, 0, 0, h)
  grad.addColorStop(0, '#1a1a2e')
  grad.addColorStop(0.5, '#16213e')
  grad.addColorStop(1, '#0f3460')
  ctx.fillStyle = grad
  ctx.fillRect(0, 0, w, h)

  // Draw image
  if (imgEl.value && imgEl.value.complete && imgEl.value.naturalWidth) {
    const img = imgEl.value
    const imgAspect = img.naturalWidth / img.naturalHeight
    const canvasAspect = w / h

    let drawW: number, drawH: number
    if (imgAspect > canvasAspect) {
      drawH = h * imgScale.value
      drawW = drawH * imgAspect
    } else {
      drawW = w * imgScale.value
      drawH = drawW / imgAspect
    }

    // Scale offset from preview coordinates to target coordinates
    const ratio = w / canvasWidth
    const x = (w - drawW) / 2 + imgOffset.value.x * ratio
    const y = (h - drawH) / 2 + imgOffset.value.y * ratio
    ctx.drawImage(img, x, y, drawW, drawH)
  }

  // Draw link button — только в превью, НЕ в экспорте (VK рисует свою нативную кнопку)
  let buttonTopY = h // нижняя граница по умолчанию (нет кнопки)
  if (linkType.value) {
    const scale = w / 360 // масштаб относительно preview
    const btnW = Math.round(200 * scale)
    const btnH = Math.round(32 * scale)
    const btnX = (w - btnW) / 2
    const btnY = h - Math.round(40 * scale)
    buttonTopY = btnY - Math.round(12 * scale) // верхний край кнопки + gap

    // Рисуем визуальную кнопку только в превью (в экспорт не печатаем)
    if (!isExport) {
      ctx.fillStyle = 'rgba(255,255,255,0.9)'
      ctx.beginPath()
      ctx.roundRect(btnX, btnY, btnW, btnH, Math.round(12 * scale))
      ctx.fill()
      ctx.fillStyle = '#333'
      ctx.font = `bold ${Math.round(12 * scale)}px sans-serif`
      ctx.textAlign = 'center'
      const btnText = LINK_TYPES.find(l => l.value === linkType.value)?.label || linkType.value
      ctx.fillText(btnText, w / 2, btnY + Math.round(21 * scale))
    }
  }

  // Draw text overlay (позиционируется относительно кнопки если есть).
  // Для baked-сторис текст УЖЕ вшит в картинку (satori) → не рисуем поверх, иначе дубль.
  if (!isBakedStory.value && overlayText.value.trim()) {
    drawTextOverlay(ctx, overlayText.value, w, h, fSize, buttonTopY)
  }
}

// --- Export canvas at full resolution ---
async function exportCanvas(): Promise<Blob> {
  const canvas = document.createElement('canvas')
  canvas.width = exportWidth
  canvas.height = exportHeight
  const ctx = canvas.getContext('2d')!

  await document.fonts.ready // дождаться шрифтов → корректный перенос строк
  drawScene(ctx, exportWidth, exportHeight, fontSizeExport.value, true)

  return new Promise((resolve, reject) =>
    canvas.toBlob(b => b ? resolve(b) : reject(new Error('не удалось сформировать изображение')), 'image/jpeg', 0.92))
}

// --- Overlay layer (для видео-сторис): ТОЛЬКО текст на прозрачном фоне ---
// Видео движется под неподвижным текстом → рисуем лишь текст-оверлей (без градиента и без видео-кадра).
function drawOverlayLayer(ctx: CanvasRenderingContext2D, w: number, h: number, fSize: number) {
  ctx.clearRect(0, 0, w, h)
  // buttonTopY как в drawScene — чтобы текст в позиции "bottom" встал над местом будущей VK-кнопки
  let buttonTopY = h
  if (linkType.value) {
    const scale = w / 360
    buttonTopY = (h - Math.round(40 * scale)) - Math.round(12 * scale)
  }
  if (!isBakedStory.value && overlayText.value.trim()) {
    drawTextOverlay(ctx, overlayText.value, w, h, fSize, buttonTopY)
  }
}

// Живой WYSIWYG-слой текста поверх <video> в редакторе
function renderOverlayPreview() {
  const canvas = overlayCanvasRef.value
  if (!canvas) return
  const ctx = canvas.getContext('2d')
  if (!ctx) return
  drawOverlayLayer(ctx, canvasWidth, canvasHeight, fontSizePx.value)
}

// Прозрачный PNG 1080×1920 — слой текста для наложения на видео через ffmpeg (backend)
async function exportOverlayPng(): Promise<Blob> {
  const canvas = document.createElement('canvas')
  canvas.width = exportWidth
  canvas.height = exportHeight
  const ctx = canvas.getContext('2d')!
  await document.fonts.ready // дождаться шрифтов → корректный перенос строк
  drawOverlayLayer(ctx, exportWidth, exportHeight, fontSizeExport.value)
  return new Promise((resolve, reject) =>
    canvas.toBlob(b => b ? resolve(b) : reject(new Error('не удалось сформировать слой текста')), 'image/png')) // PNG = сохраняем alpha
}

// --- Drag & drop ---
function onMouseDown(e: MouseEvent) {
  if (!imgEl.value) return
  dragging.value = true
  dragStart.value = { x: e.clientX - imgOffset.value.x, y: e.clientY - imgOffset.value.y }
}

function onMouseMove(e: MouseEvent) {
  if (!dragging.value) return
  imgOffset.value = { x: e.clientX - dragStart.value.x, y: e.clientY - dragStart.value.y }
  render()
}

function onMouseUp() { dragging.value = false; saveCanvasState() }

function onWheel(e: WheelEvent) {
  e.preventDefault()
  const delta = e.deltaY > 0 ? -0.05 : 0.05
  imgScale.value = Math.max(0.5, Math.min(3, imgScale.value + delta))
  render()
  saveCanvasState()
}

function zoomIn() { imgScale.value = Math.min(3, imgScale.value + 0.1); render(); saveCanvasState() }
function zoomOut() { imgScale.value = Math.max(0.5, imgScale.value - 0.1); render(); saveCanvasState() }
function resetView() { imgOffset.value = { x: 0, y: 0 }; imgScale.value = 1; render(); saveCanvasState() }

// --- Data loading ---
async function loadPost() {
  loading.value = true
  try {
    post.value = await http.get<Post>(`/posts/${route.params.id}`)
    if (post.value) {
      overlayText.value = post.value.body || ''
      storyTitle.value = post.value.title || ''
      const platforms = await http.get<PlatformAccount[]>(`/businesses/${post.value.businessId}/platforms`)
      // Сторис поддерживают VK + Instagram (TG — нет сторис)
      storyChannels.value = platforms.filter(p => p.platform === 'VK' || p.platform === 'INSTAGRAM')
      selectedChannels.value = storyChannels.value.map(c => c.id) // по умолчанию все
      previewPlatform.value = storyChannels.value[0]?.platform || 'VK' // таб превью по умолчанию
      if (post.value.postType !== 'STORIES') { router.replace(`/posts/${post.value.id}`); return }
      // Load image — если тот же URL что был, сохранить offset/scale
      if (photo.value) {
        if (originalPhotoUrl.value === photo.value.url && imgEl.value) {
          // Фото то же — не сбрасывать позицию
          nextTick(render)
        } else {
          loadImage(photo.value.url)
        }
      }
    }
    // Load story templates + brand links + characters from DB
    try {
      storyTemplates.value = await http.get<DbStoryTemplate[]>(`/businesses/${post.value.businessId}/story-templates`)
    } catch {}
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

    // Load text history from aiPromptHistory
    try {
      const res = await http.get<{ history: any[] }>(`/ai/prompt-history/${post.value.id}`)
      const texts = (res.history || []).filter((h: any) => h.type === 'text')
      if (texts.length) {
        textHistory.value = texts.map((h: any) => ({ title: h.title, body: h.body }))
        textHistoryIndex.value = texts.length - 1
      }
    } catch {}
  } catch (e) { toast.error('Ошибка загрузки') }
  finally { loading.value = false }
}

function loadImage(url: string, isOriginal = true) {
  const img = new window.Image()
  img.crossOrigin = 'anonymous'
  img.onload = () => {
    imgEl.value = img
    if (isOriginal) {
      // Восстановить сохранённый state если тот же URL
      const storyId = route.params.id as string
      const saved = sessionStorage.getItem(`story-canvas-${storyId}`)
      if (saved && originalPhotoUrl.value === url) {
        try {
          const s = JSON.parse(saved)
          imgOffset.value = s.offset || { x: 0, y: 0 }
          imgScale.value = s.scale || 1
        } catch {}
      } else {
        imgOffset.value = { x: 0, y: 0 }
        imgScale.value = 1
      }
      originalPhotoUrl.value = url
    }
    nextTick(render)
  }
  img.onerror = () => {
    toast.error('Не удалось загрузить изображение')
  }
  img.src = url
}

// Сохранять canvas state при уходе со страницы
function saveCanvasState() {
  const storyId = route.params.id as string
  sessionStorage.setItem(`story-canvas-${storyId}`, JSON.stringify({
    offset: imgOffset.value,
    scale: imgScale.value,
  }))
}

// --- File upload ---
async function uploadPhoto(e: Event) {
  const input = e.target as HTMLInputElement
  if (!input.files?.length || !post.value) return
  uploading.value = true
  try {
    if (photo.value) await http.post(`/media/${photo.value.id}/attach`, { postId: null }).catch(() => {})
    const formData = new FormData()
    formData.append('file', input.files[0])
    formData.append('businessId', post.value.businessId)
    formData.append('postId', post.value.id)
    const res = await fetch('/api/media/upload', { method: 'POST', body: formData, credentials: 'include', headers: { 'X-Tab-ID': TAB_ID } })
    const mf = await res.json() as MediaFile
    post.value.mediaFiles = [mf]
    loadImage(mf.url)
    toast.success('Фото загружено')
  } catch (e: any) { toast.error('Ошибка: ' + e.message) }
  finally { uploading.value = false; input.value = '' }
}

async function removePhoto() {
  if (!photo.value || !post.value) return
  if (!confirm('Открепить фото от истории?')) return
  await http.post(`/media/${photo.value.id}/attach`, { postId: null }).catch(() => {})
  post.value.mediaFiles = []
  imgEl.value = null
  render()
  toast.info('Фото откреплено')
}

async function pickFromLibrary(file: MediaFile) {
  if (!post.value) return
  uploading.value = true
  try {
    // Отвязать текущее фото (не удаляем — оно остаётся в медиатеке)
    if (photo.value) {
      await http.post(`/media/${photo.value.id}/attach`, { postId: null }).catch(() => {})
    }
    // Привязать выбранное фото к посту
    await http.post(`/media/${file.id}/attach`, { postId: post.value.id })
    post.value.mediaFiles = [file]
    loadImage(file.url)
    showMediaPicker.value = false
    toast.success('Фото выбрано из медиатеки')
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
      storyText: overlayText.value || '',
    })
    aiSuggestions.value = res.suggestions || []
  } catch (e: any) { toast.error('Ошибка: ' + (e.message || e)) }
  finally { suggestingTemplates.value = false }
}

async function generateAiImage() {
  if (!post.value || !aiPrompt.value.trim()) return
  aiLoading.value = true
  try {
    if (photo.value) await http.post(`/media/${photo.value.id}/attach`, { postId: null }).catch(() => {})
    const result = await http.post<{ mediaFile: MediaFile }>('/ai/generate-image', {
      businessId: post.value.businessId, postId: post.value.id,
      prompt: aiPrompt.value, aspectRatio: '9:16',
      characterId: selectedCharacterId.value || undefined,
    })
    post.value.mediaFiles = [result.mediaFile]
    loadImage(result.mediaFile.url)
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
      storyText: overlayText.value || undefined,
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

// Привязать готовое видео сессии к сторису (вызывается по SSE / при загрузке)
async function attachVideoFromSession(sessionId: string) {
  if (!post.value) return
  try {
    const s = await http.get<{ status: string; mediaFileId?: string | null; errorMessage?: string | null }>(`/sessions/${sessionId}`)
    if (s.status === 'completed' && s.mediaFileId) {
      if (photo.value) await http.post(`/media/${photo.value.id}/attach`, { postId: null }).catch(() => {})
      await http.post(`/media/${s.mediaFileId}/attach`, { postId: post.value.id }).catch(() => {})
      const fresh = await http.get<Post>(`/posts/${post.value.id}`)
      if (fresh) post.value.mediaFiles = fresh.mediaFiles
      videoGenerating.value = false
      videoSessionId.value = null
      try { sessionStorage.removeItem('story-video-' + post.value.id) } catch {}
      nextTick(renderOverlayPreview)
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

async function generateStoryText(topic?: string) {
  if (!post.value) return
  generatingText.value = true
  try {
    const result = await http.post<{ title: string; body: string }>('/ai/generate-story-text', {
      businessId: post.value.businessId,
      postId: post.value.id,
      topic: topic || storyTitle.value || undefined,
    })
    overlayText.value = result.body
    storyTitle.value = result.title
    textHistory.value.push({ title: result.title, body: result.body })
    textHistoryIndex.value = textHistory.value.length - 1
    toast.success('Текст и заголовок сгенерированы')
  } catch (e: any) { toast.error('Ошибка: ' + (e.message || e)) }
  finally { generatingText.value = false }
}

// Legacy wrapper
async function generateOverlayText() {
  await generateStoryText()
}

// --- Publish ---
const canPublishNow = computed(() => !!photo.value && selectedChannels.value.length > 0)

// Дропдаун «Опубликовать ▾»: рендер canvas/видео и публикация/планирование происходят прямо
// внутри confirmPublish/schedulePublish (без отдельной модалки-превью — оно постоянно видно справа).
function onPublishNow() {
  publishMenuOpen.value = false
  if (!post.value || !photo.value) { toast.error('Загрузите медиа'); return }
  if (!selectedChannels.value.length) { toast.error('Выберите хотя бы один канал'); return }
  confirmPublish()
}
function onChooseSchedule() {
  publishMenuOpen.value = false
  if (!photo.value) { toast.error('Загрузите медиа'); return }
  if (!selectedChannels.value.length) { toast.error('Выберите хотя бы один канал'); return }
  scheduleMode.value = true
}
async function onSaveDraft() {
  publishMenuOpen.value = false
  if (!post.value) return
  try {
    // baked: текст вшит в картинку — body не трогаем
    await http.put(`/posts/${post.value.id}`, isBakedStory.value
      ? { title: storyTitle.value || null }
      : { body: overlayText.value, title: storyTitle.value || null })
    toast.success('Черновик сохранён')
  } catch (e: any) { toast.error('Ошибка: ' + (e.message || e)) }
}

// Загрузить готовую сторис-картинку в медиатеку (тег story, НЕ удаляем — видна в истории + превью поста)
async function uploadRendered(): Promise<MediaFile> {
  const blob = await exportCanvas() // рендерим canvas→JPEG прямо при публикации (без промежуточной модалки)
  const dateStr = new Date().toISOString().slice(0, 10)
  const safeTitle = (storyTitle.value || 'story').replace(/[^\wа-яё\- ]/gi, '').slice(0, 40).trim() || 'story'
  const formData = new FormData()
  formData.append('file', blob, `story-${safeTitle}-${dateStr}.jpg`)
  formData.append('businessId', post.value!.businessId)
  const res = await fetch('/api/media/upload', { method: 'POST', body: formData, credentials: 'include', headers: { 'X-Tab-ID': TAB_ID } })
  const mf = await res.json() as MediaFile
  await http.put(`/media/${mf.id}/tags`, { tags: ['story'] }).catch(() => {})
  return mf
}

// Видео-сторис: наложить текст-слой на видео через backend (ffmpeg) → новый baked-видео MediaFile
async function renderVideoForPublish(): Promise<MediaFile> {
  const overlayBlob = await exportOverlayPng() // текст-слой рендерим прямо при публикации
  const fd = new FormData()
  fd.append('overlay', overlayBlob, 'overlay.png')
  fd.append('videoMediaFileId', photo.value!.id)
  fd.append('businessId', post.value!.businessId)
  if (selectedMusicSessionId.value) fd.append('musicSessionId', selectedMusicSessionId.value)
  const res = await fetch('/api/media/overlay-video', {
    method: 'POST', body: fd, credentials: 'include', headers: { 'X-Tab-ID': TAB_ID },
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({})) as { error?: string }
    throw new Error(err.error || 'Не удалось наложить текст на видео')
  }
  return await res.json() as MediaFile
}

// Найти версию для канала или создать (обрабатывает unique-конфликт postId+platformAccountId)
async function ensureVersion(channelId: string): Promise<string> {
  const existing = (post.value!.versions || []).find(v => v.platformAccount.id === channelId)
  if (existing) return existing.id
  try {
    const v = await http.post<{ id: string }>(`/posts/${post.value!.id}/versions`, {
      platformAccountId: channelId, body: overlayText.value || ' ', hashtags: [],
    })
    return v.id
  } catch (e) {
    const fresh = await http.get<Post>(`/posts/${post.value!.id}`)
    const found = (fresh.versions || []).find(v => v.platformAccount.id === channelId)
    if (found) return found.id
    throw e
  }
}

// ШАГ 2: Подтвердить и опубликовать в выбранные каналы (мультипостинг VK + IG)
async function confirmPublish() {
  if (!post.value || !selectedChannels.value.length) return
  publishing.value = true
  publishResults.value = []
  try {
    // Baked: публикуем готовую картинку как есть (уже привязана к посту, текст вшит).
    // Видео: наложить текст на видео (ffmpeg). Фото: загрузить плоский JPEG из canvas.
    if (!isBakedStory.value) {
      const renderedFile = isVideoMedia.value ? await renderVideoForPublish() : await uploadRendered()
      await http.put(`/posts/${post.value.id}`, { body: overlayText.value, title: storyTitle.value || null })
      // Отвязать оригиналы, привязать rendered к посту (publisher берёт mediaFiles поста)
      const originalFileIds = post.value.mediaFiles.map(m => m.id)
      for (const mfId of originalFileIds) await http.post(`/media/${mfId}/attach`, { postId: null }).catch(() => {})
      await http.post(`/media/${renderedFile.id}/attach`, { postId: post.value.id }).catch(() => {})
    }

    // Цикл по каналам — частичный успех допустим (VK ок, IG упал — не падаем целиком)
    for (const channelId of selectedChannels.value) {
      const ch = storyChannels.value.find(c => c.id === channelId)
      const item: PublishResultItem = { channelId, platform: ch?.platform || '', accountName: ch?.accountName || '', success: false, externalUrl: null, error: null }
      try {
        const versionId = await ensureVersion(channelId)
        const res = await http.post<{ success: boolean; externalUrl: string | null; error: string | null }>(
          `/post-versions/${versionId}/publish`, {
            storiesOptions: { skipOverlay: true, linkText: linkType.value || undefined, linkUrl: linkUrl.value || undefined, musicSessionId: selectedMusicSessionId.value || undefined },
          })
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
    render()
  } catch (e: any) { toast.error('Ошибка: ' + e.message) }
  finally { publishing.value = false }
}

async function schedulePublish() {
  if (!post.value || !scheduledAt.value || !selectedChannels.value.length) return
  scheduling.value = true
  publishResults.value = []
  try {
    // Baked: запланировать готовую картинку как есть. Видео: ffmpeg overlay. Фото: canvas JPEG.
    if (!isBakedStory.value) {
      const renderedFile = isVideoMedia.value ? await renderVideoForPublish() : await uploadRendered()
      await http.put(`/posts/${post.value.id}`, { body: overlayText.value, title: storyTitle.value || null })
      const originalFileIds = post.value.mediaFiles.map(m => m.id)
      for (const mfId of originalFileIds) await http.post(`/media/${mfId}/attach`, { postId: null }).catch(() => {})
      await http.post(`/media/${renderedFile.id}/attach`, { postId: post.value.id }).catch(() => {})
    }

    const iso = new Date(scheduledAt.value).toISOString()
    for (const channelId of selectedChannels.value) {
      const ch = storyChannels.value.find(c => c.id === channelId)
      const item: PublishResultItem = { channelId, platform: ch?.platform || '', accountName: ch?.accountName || '', success: false, externalUrl: null, error: null }
      try {
        const versionId = await ensureVersion(channelId)
        await http.post(`/post-versions/${versionId}/schedule`, {
          scheduledAt: iso,
          // Сохраняем кнопку ВК (и в будущем музыку), чтобы отложка не потеряла их
          storiesOptions: { skipOverlay: true, linkText: linkType.value || undefined, linkUrl: linkUrl.value || undefined, musicSessionId: selectedMusicSessionId.value || undefined },
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
    render()
  } catch (e: any) { toast.error('Ошибка: ' + e.message) }
  finally { scheduling.value = false }
}

// VK link_text → реальный текст кнопки в VK (проверено)
function applyTemplate(tpl: DbStoryTemplate) {
  if (tpl.overlayText) overlayText.value = tpl.overlayText
  if (tpl.textPosition) textPosition.value = tpl.textPosition as any
  if (tpl.textColor) textColor.value = tpl.textColor
  if (tpl.fontSize) fontSize.value = tpl.fontSize as any
  if (tpl.bgStyle) bgStyle.value = tpl.bgStyle as any
  if (tpl.textAlign) textAlign.value = tpl.textAlign as any
  if (tpl.bgRadius) bgRadius.value = tpl.bgRadius as any
  if (tpl.linkType !== undefined) linkType.value = tpl.linkType
  render()
  toast.info(`Шаблон "${tpl.name}" применён`)
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
// Медиа для StoriesPreview: видео → кадр-превью (webp), фото → оригинал
const previewMediaFiles = computed(() => {
  if (!photo.value) return [] as { url: string; thumbUrl: string | null; mimeType: string }[]
  const url = isVideoMedia.value ? (photo.value.thumbUrl || photo.value.url) : photo.value.url
  return [{ url, thumbUrl: photo.value.thumbUrl ?? null, mimeType: photo.value.mimeType }]
})

// Авто-дефолт кнопки-ссылки по платформе/типу: VK-сторис → «Бронь ВК Сторис», иначе любая VK-бронь.
// Только если ссылка ещё не задана и сторис не опубликован — ручной выбор не перетираем.
function applyDefaultBookingLink() {
  if (linkUrl.value || isPublished.value || !bookingLinks.value.length) return
  const story = bookingLinks.value.find(b => b.scope.includes('story') && b.scope.includes('vk'))
  const vk = bookingLinks.value.find(b => b.scope.includes('vk'))
  const pick = story || vk
  if (pick) { if (!linkType.value) linkType.value = 'book'; linkUrl.value = pick.url }
}

// Re-render on settings change (canvas для фото + overlay-слой для видео)
watch([overlayText, textPosition, textColor, fontSize, bgStyle, bgRadius, textAlign, linkType, linkUrl],
  () => nextTick(() => { render(); renderOverlayPreview() }))

// Re-render when canvas appears in DOM (fixes race: image loaded while canvas was hidden by v-if="loading")
watch(canvasRef, (canvas) => {
  if (canvas && imgEl.value) nextTick(render)
})

// Re-render overlay-слой когда видео-canvas появляется в DOM (переключение фото→видео)
watch(overlayCanvasRef, (cv) => { if (cv) nextTick(renderOverlayPreview) })

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
  window.addEventListener('mouseup', onMouseUp)
  window.addEventListener('mousemove', onMouseMove)
})
onUnmounted(() => {
  sseSource?.close()
  if (sseReconnectTimer) clearTimeout(sseReconnectTimer)
  window.removeEventListener('mouseup', onMouseUp)
  window.removeEventListener('mousemove', onMouseMove)
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
            Можно отредактировать ниже. Чтобы изменения вступили в силу — снова нажмите «Предпросмотр и публикация» и перепланируйте (или отмените запланированную ниже).
          </p>
        </div>

        <!-- Title -->
        <div :class="['bg-white dark:bg-gray-900 rounded-xl p-5 border border-gray-200 dark:border-gray-800', isPublished && 'opacity-60 pointer-events-none select-none']">
          <h3 class="font-semibold text-sm mb-2">Название</h3>
          <input v-model="storyTitle" placeholder="Название истории..."
            class="w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 focus:ring-2 focus:ring-brand-500 text-sm" />
        </div>

        <!-- Photo -->
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
              {{ photo ? 'Заменить' : 'Загрузить' }}
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
            <button v-if="photo" @click="showEditModal = true" title="Редактировать AI"
              class="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-purple-100 dark:bg-purple-900 text-purple-700 dark:text-purple-300 text-xs font-medium hover:bg-purple-200">
              <Wand2 :size="14" />
            </button>
          </div>
        </div>

        <!-- Холст: перетаскивание/zoom фото + текст-оверлей (скрыт для baked — дизайн уже вшит) -->
        <div v-if="!isBakedStory" :class="['bg-white dark:bg-gray-900 rounded-xl p-5 border border-gray-200 dark:border-gray-800', isPublished && 'opacity-60 pointer-events-none select-none']">
          <h3 class="font-semibold text-sm mb-3 flex items-center gap-2"><Image :size="16" /> Холст</h3>
          <div class="flex flex-col items-center">
            <div class="relative bg-black rounded-[2rem] p-2 shadow-2xl w-full max-w-[320px]">
              <div class="absolute top-0 left-1/2 -translate-x-1/2 w-24 h-5 bg-black rounded-b-xl z-10"></div>
              <!-- Video preview + статичный текст-слой поверх (WYSIWYG для видео-сторис) -->
              <div v-if="isVideoMedia" class="relative rounded-[1.5rem] overflow-hidden w-full" style="aspect-ratio: 9/16;">
                <video :src="photo!.url" class="absolute inset-0 w-full h-full" style="object-fit: cover; background: #000;" controls loop muted autoplay playsinline />
                <canvas ref="overlayCanvasRef" :width="canvasWidth" :height="canvasHeight" class="absolute inset-0 w-full h-full pointer-events-none" />
              </div>
              <!-- Image canvas (для фото) -->
              <canvas v-else ref="canvasRef" :width="canvasWidth" :height="canvasHeight"
                :class="['rounded-[1.5rem]', isPublished ? 'cursor-default' : 'cursor-grab active:cursor-grabbing', dragging && !isPublished && 'cursor-grabbing']"
                @mousedown="!isPublished && onMouseDown($event)" @wheel.prevent="!isPublished && onWheel($event)" />
              <!-- Overlay: generation in progress -->
              <div v-if="editingImage || aiVideoLoading || videoGenerating" class="absolute inset-2 rounded-[1.5rem] bg-black/50 flex items-center justify-center">
                <div class="flex flex-col items-center gap-2 text-white">
                  <Loader2 :size="28" class="animate-spin" :class="(aiVideoLoading || videoGenerating) ? 'text-emerald-400' : 'text-purple-400'" />
                  <span class="text-xs font-medium text-center px-3">{{ videoGenerating ? 'Видео генерируется (1-3 мин)...' : aiVideoLoading ? 'Запуск генерации...' : 'Генерация изображения...' }}</span>
                </div>
              </div>
            </div>
            <div v-if="!isPublished" class="flex items-center gap-2 mt-3">
              <button @click="zoomOut" class="p-1.5 rounded-lg bg-gray-200 dark:bg-gray-800 text-gray-600 dark:text-gray-400 hover:bg-gray-300"><ZoomOut :size="16" /></button>
              <span class="text-xs text-gray-400 w-12 text-center">{{ Math.round(imgScale * 100) }}%</span>
              <button @click="zoomIn" class="p-1.5 rounded-lg bg-gray-200 dark:bg-gray-800 text-gray-600 dark:text-gray-400 hover:bg-gray-300"><ZoomIn :size="16" /></button>
              <button @click="resetView" class="px-2 py-1 rounded-lg text-[10px] text-gray-500 hover:bg-gray-200 dark:hover:bg-gray-800">Сброс</button>
            </div>
            <p v-if="!isPublished" class="text-[10px] text-gray-500 mt-1">Перетаскивайте фото мышкой. Колёсико = zoom.</p>
          </div>
        </div>

        <!-- Baked-сторис: дизайн уже вшит → статус-баннер + правка кадра -->
        <div v-if="isBakedStory" class="bg-fuchsia-50 dark:bg-fuchsia-950/30 border border-fuchsia-200 dark:border-fuchsia-800/50 rounded-xl p-4">
          <div class="flex items-center gap-2.5">
            <Sparkles :size="18" class="text-fuchsia-500 shrink-0" />
            <div>
              <p class="text-sm font-semibold text-fuchsia-800 dark:text-fuchsia-200">Готовая сторис</p>
              <p class="text-xs text-fuchsia-600 dark:text-fuchsia-400">Дизайн вшит — выберите каналы и публикуйте.</p>
            </div>
          </div>
          <button v-if="!isPublished" @click="designModalOpen = true"
            class="mt-3 w-full flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg bg-fuchsia-600 hover:bg-fuchsia-700 text-white text-xs font-medium transition-colors touch-manipulation">
            <Sparkles :size="14" /> Поправить кадр / заголовок
          </button>
        </div>

        <!-- Text + Templates (ручной текст-оверлей — только для НЕ-baked сторис) -->
        <div v-if="!isBakedStory" :class="['bg-white dark:bg-gray-900 rounded-xl p-5 border border-gray-200 dark:border-gray-800', isPublished && 'opacity-60 pointer-events-none select-none']">
          <!-- Templates from DB -->
          <div v-if="storyTemplates.length" class="mb-4">
            <div class="text-xs text-gray-400 mb-1.5">Шаблоны</div>
            <div class="flex flex-wrap gap-1.5">
              <button v-for="tpl in storyTemplates" :key="tpl.id" @click="applyTemplate(tpl)"
                class="flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-gray-100 dark:bg-gray-800 text-xs font-medium hover:bg-brand-50 dark:hover:bg-brand-950 hover:text-brand-700 dark:hover:text-brand-300 transition-colors">
                <span v-if="tpl.emoji">{{ tpl.emoji }}</span>
                {{ tpl.name }}
              </button>
            </div>
          </div>
          <div v-else class="mb-4">
            <p class="text-xs text-gray-400">Нет шаблонов. <router-link v-if="post" :to="'/businesses/' + post.businessId + '?tab=templates'" class="text-brand-500 hover:underline">Создать →</router-link></p>
          </div>

          <div class="flex items-center justify-between mb-2">
            <h3 class="font-semibold text-sm">Текст на фото</h3>
            <!-- Text history navigation -->
            <div v-if="textHistory.length > 0" class="flex items-center gap-0.5">
              <button @click="textGoBack" :disabled="textHistoryIndex <= 0"
                class="p-0.5 rounded hover:bg-gray-100 dark:hover:bg-gray-800 disabled:opacity-30">
                <ChevronLeft :size="14" class="text-gray-500" />
              </button>
              <span class="text-[10px] text-gray-400 min-w-[24px] text-center">{{ textHistoryLabel }}</span>
              <button @click="textGoForward" :disabled="textHistoryIndex >= textHistory.length - 1"
                class="p-0.5 rounded hover:bg-gray-100 dark:hover:bg-gray-800 disabled:opacity-30">
                <ChevronRight :size="14" class="text-gray-500" />
              </button>
            </div>
          </div>
          <textarea v-model="overlayText" rows="4" placeholder="Короткий текст поверх фото..."
            class="w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 focus:ring-2 focus:ring-brand-500 text-sm" />
          <!-- AI enhance button — под textarea -->
          <button @click="generateStoryText(overlayText || undefined)" :disabled="generatingText"
            class="mt-1.5 flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium border border-purple-300 dark:border-purple-700 text-purple-600 dark:text-purple-400 hover:bg-purple-50 dark:hover:bg-purple-950 disabled:opacity-50 transition-colors">
            <Loader2 v-if="generatingText" :size="14" class="animate-spin" /><Sparkles v-else :size="14" />
            {{ generatingText ? 'Генерация...' : 'AI текст + заголовок' }}
          </button>

          <div class="flex items-center gap-2 mt-3">
            <span class="text-xs text-gray-500">Позиция:</span>
            <div class="flex gap-1">
              <button v-for="pos in (['top','center','bottom'] as const)" :key="pos" @click="textPosition = pos"
                :class="['px-2.5 py-1 rounded text-[11px] font-medium', textPosition === pos ? 'bg-brand-600 text-white' : 'bg-gray-100 dark:bg-gray-800 text-gray-500']">
                {{ {top:'Вверху',center:'Центр',bottom:'Внизу'}[pos] }}
              </button>
            </div>
          </div>
          <!-- Color palette -->
          <div class="flex items-center gap-1.5 mt-2">
            <span class="text-xs text-gray-500 shrink-0">Цвет:</span>
            <button v-for="c in TEXT_COLORS" :key="c" @click="textColor = c"
              :class="['w-5 h-5 rounded-full border-2 transition-transform', textColor === c ? 'border-brand-500 scale-125' : 'border-gray-400/30']"
              :style="{ background: c }"></button>
          </div>

          <!-- Background style -->
          <div class="flex items-center gap-2 mt-2">
            <span class="text-xs text-gray-500">Подложка:</span>
            <button v-for="bg in (['dark','light','none'] as const)" :key="bg" @click="bgStyle = bg"
              :class="['px-2 py-1 rounded text-[10px] font-medium', bgStyle === bg ? 'bg-brand-600 text-white' : 'bg-gray-100 dark:bg-gray-800 text-gray-500']">
              {{ {dark:'Тёмная',light:'Светлая',none:'Без'}[bg] }}
            </button>
          </div>

          <!-- Border radius + alignment -->
          <div class="flex items-center gap-4 mt-2">
            <div class="flex items-center gap-1.5">
              <span class="text-xs text-gray-500">Углы:</span>
              <button @click="bgRadius = 'round'" :class="['px-2 py-1 rounded text-[10px] font-medium', bgRadius === 'round' ? 'bg-brand-600 text-white' : 'bg-gray-100 dark:bg-gray-800 text-gray-500']">⊞</button>
              <button @click="bgRadius = 'square'" :class="['px-2 py-1 rounded text-[10px] font-medium', bgRadius === 'square' ? 'bg-brand-600 text-white' : 'bg-gray-100 dark:bg-gray-800 text-gray-500']">▢</button>
            </div>
            <div class="flex items-center gap-1.5">
              <span class="text-xs text-gray-500">Текст:</span>
              <button v-for="a in (['left','center','right'] as const)" :key="a" @click="textAlign = a"
                :class="['px-2 py-1 rounded text-[10px] font-medium', textAlign === a ? 'bg-brand-600 text-white' : 'bg-gray-100 dark:bg-gray-800 text-gray-500']">
                {{ {left:'←',center:'≡',right:'→'}[a] }}
              </button>
            </div>
          </div>

          <!-- Font size -->
          <div class="flex items-center gap-2 mt-2">
            <span class="text-xs text-gray-500">Размер:</span>
            <button v-for="s in (['S','M','L'] as const)" :key="s" @click="fontSize = s"
              :class="['px-2.5 py-1 rounded text-[11px] font-medium', fontSize === s ? 'bg-brand-600 text-white' : 'bg-gray-100 dark:bg-gray-800 text-gray-500']">{{ s }}</button>
          </div>
        </div>

        <!-- A4: Музыка для видео-сторис (вшивается в видео) -->
        <div v-if="isVideoMedia && musicTracks.length" :class="['bg-white dark:bg-gray-900 rounded-xl p-5 border border-gray-200 dark:border-gray-800', isPublished && 'opacity-60 pointer-events-none select-none']">
          <h3 class="font-semibold text-sm mb-3 flex items-center gap-2"><Music :size="16" /> Музыка</h3>
          <select v-model="selectedMusicSessionId" class="w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 text-sm">
            <option :value="null">Без музыки</option>
            <option v-for="t in musicTracks" :key="t.id" :value="t.id">🎵 {{ t.title }}</option>
          </select>
          <p class="text-[10px] text-gray-400 mt-1.5">Трек из Звуковой студии вшивается в видео (VK/IG нативную музыку в сторис через API не добавляют).</p>
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
            :text="isBakedStory ? '' : overlayText"
            :media-files="previewMediaFiles"
            :platform="activePreviewChannel?.platform || previewPlatform"
            :baked="isBakedStory" />
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
            <p class="text-[10px] text-gray-400 mt-2">Сторис уйдёт в выбранные каналы. Текст вшивается в картинку; ссылка-кнопка — нативная в VK.</p>
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

    <!-- AI Edit Modal -->
    <ImageEditModal
      v-if="showEditModal && photo && post"
      :visible="showEditModal"
      :image-url="photo.url"
      :media-id="photo.id"
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

    <!-- Корректировка кадра дизайн-сторис -->
    <StoryDesignModal
      v-if="post && photo"
      :visible="designModalOpen"
      :business-id="post.businessId"
      :media-id="photo.id"
      :title="storyTitle || overlayText || post.title || ''"
      @done="onStoryDesignDone"
      @close="designModalOpen = false"
    />
  </div>
</template>
