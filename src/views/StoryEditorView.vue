<script setup lang="ts">
import { ref, onMounted, computed, watch, nextTick, onUnmounted } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { http } from '@/api/client'
import { useAuthStore } from '@/stores/auth'
import { useBusinessesStore } from '@/stores/businesses'
import { useToast } from '@/composables/useToast'
import { formatDate } from '@/composables/useFormatters'
import {
  ArrowLeft, Upload, Sparkles, Loader2, Send, CheckCircle,
  ExternalLink, AlertCircle, Image, Images, Link, Trash2, ZoomIn, ZoomOut, Eye, Wand2, Eraser,
  ChevronLeft, ChevronRight, Calendar, Clock, Video
} from 'lucide-vue-next'
import ImageEditModal from '@/components/ai/ImageEditModal.vue'
import MediaPickerModal from '@/components/MediaPickerModal.vue'

interface MediaFile { id: string; url: string; thumbUrl: string | null; filename: string; mimeType: string; sizeBytes: number; durationSec?: number | null; aiModel?: string | null; aiCostUsd?: number | null; altText?: string | null }
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

const route = useRoute()
const router = useRouter()
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

async function cancelSchedule() {
  if (!version.value || cancellingSchedule.value) return
  if (!confirm('Отменить запланированную публикацию?')) return
  cancellingSchedule.value = true
  try {
    await http.post(`/post-versions/${version.value.id}/schedule`, {
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
  if (!post.value || isPublished.value) return
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
const savedLinks = ref<{ label: string; url: string }[]>([])

// Preview modal
const showPreview = ref(false)
const previewBlobUrl = ref('')
const previewBlob = ref<Blob | null>(null)
const previewSize = ref(0)
const previewExporting = ref(false)

// AI
const aiTextLoading = ref(false)
const showAiImage = ref(false)
const aiPrompt = ref('')
const aiLoading = ref(false)
const aiEnhancing = ref(false)
const selectedCharacterId = ref<string | null>(null)
const showAiVideo = ref(false)
const videoPrompt = ref('')
const aiVideoLoading = ref(false)
const videoDuration = ref(5)
const videoAudio = ref(true)
const videoEnhancing = ref(false)
const videoPromptHistory = ref<string[]>([])
const videoHistoryIndex = ref(-1)

function openVideoModal() {
  // Восстановить последний промпт из истории
  if (!videoPrompt.value && videoPromptHistory.value.length) {
    videoPrompt.value = videoPromptHistory.value[videoPromptHistory.value.length - 1]
    videoHistoryIndex.value = videoPromptHistory.value.length - 1
  }
  showAiVideo.value = true
}

// Ценообразование Seedance 2 (KIE.ai): 41 credits/sec (720p), 1 credit = $0.005
const VIDEO_CREDITS_PER_SEC = 41
const VIDEO_CREDIT_PRICE = 0.005
const VIDEO_AUDIO_MULTIPLIER = 2.0
const USD_TO_RUB = 95

const videoFirstFrame = ref<{ url: string; thumbUrl?: string | null; filename: string } | null>(null)
const videoLastFrame = ref<{ url: string; thumbUrl?: string | null; filename: string } | null>(null)
const videoRefImages = ref<{ url: string; thumbUrl?: string | null; filename: string }[]>([])
const videoInputMode = ref<'text' | 'frames' | 'references'>('text')

const videoCostUsd = computed(() => {
  const hasImages = videoInputMode.value !== 'text' && (videoFirstFrame.value || videoRefImages.value.length > 0)
  const creditsPerSec = hasImages ? 25 : VIDEO_CREDITS_PER_SEC // image-to-video дешевле
  const base = creditsPerSec * videoDuration.value * VIDEO_CREDIT_PRICE
  return videoAudio.value ? base * VIDEO_AUDIO_MULTIPLIER : base
})
const videoCostRub = computed(() => Math.round(videoCostUsd.value * USD_TO_RUB))

const VIDEO_TEMPLATES = [
  { label: 'SUP рассвет', prompt: 'SUP-борд на спокойной воде на рассвете, плавное отражение солнца, лёгкий туман' },
  { label: 'Динамика', prompt: 'Быстрое движение камеры вдоль набережной, энергичная атмосфера, солнечный день' },
  { label: 'Природа', prompt: 'Спокойный лесной пейзаж с озером, птицы, плавное панорамирование' },
  { label: 'Продукт', prompt: 'Крупный план продукта, медленное вращение на 360°, студийный свет' },
  { label: 'Ивент', prompt: 'Концертная площадка с цветным освещением, энергичная толпа, динамичные переходы' },
  { label: 'Атмосфера', prompt: 'Закат над городом, тёплые тона, медленный дрон-пролёт, кинематографично' },
]

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

const IMAGE_TEMPLATES = [
  { label: 'Продукт крупно', prompt: 'Крупный план продукта на чистом нейтральном фоне, студийное освещение' },
  { label: 'Атмосфера', prompt: 'Атмосферный пейзаж, закат над водой, отражения, тёплый свет' },
  { label: 'Lifestyle', prompt: 'Люди на активном отдыхе, естественные эмоции, динамичная композиция' },
  { label: 'Акция/Скидка', prompt: 'Яркий минималистичный фон, место для текста, промо-стиль' },
]

const removingBg = ref(false)
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

async function doRemoveBg() {
  if (!post.value || !photo.value || removingBg.value) return
  if (!confirm('Удалить фон с изображения?')) return
  removingBg.value = true
  try {
    const result = await http.post<{ mediaFile: MediaFile }>('/ai/remove-background', {
      businessId: post.value.businessId,
      mediaId: photo.value.id,
      postId: post.value.id,
    })
    post.value.mediaFiles = [result.mediaFile]
    loadImage(result.mediaFile.url)
    toast.success('Фон удалён')
  } catch (e: any) { toast.error('Ошибка: ' + (e.message || e)) }
  finally { removingBg.value = false }
}

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

// Channels
const vkChannels = ref<PlatformAccount[]>([])
const selectedChannel = ref('')

const photo = computed(() => post.value?.mediaFiles?.[0] || null)
const isVideoMedia = computed(() => photo.value?.mimeType?.startsWith('video/') || false)
const version = computed(() => post.value?.versions?.[0] || null)
const isPublished = computed(() => version.value?.status === 'PUBLISHED' || version.value?.status === 'SCHEDULED')

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

  // Draw text overlay (позиционируется относительно кнопки если есть)
  if (overlayText.value.trim()) {
    drawTextOverlay(ctx, overlayText.value, w, h, fSize, buttonTopY)
  }
}

// --- Export canvas at full resolution ---
async function exportCanvas(): Promise<Blob> {
  const canvas = document.createElement('canvas')
  canvas.width = exportWidth
  canvas.height = exportHeight
  const ctx = canvas.getContext('2d')!

  drawScene(ctx, exportWidth, exportHeight, fontSizeExport.value, true)

  return new Promise(resolve => canvas.toBlob(b => resolve(b!), 'image/jpeg', 0.92))
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
      vkChannels.value = platforms.filter(p => p.platform === 'VK')
      if (vkChannels.value.length) selectedChannel.value = vkChannels.value[0].id
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
    loadCharacters(post.value.businessId)
    try {
      const bp = await http.get<{ links?: { label: string; url: string }[] }>(`/businesses/${post.value.businessId}/brand-profile`)
      savedLinks.value = Array.isArray(bp?.links) ? bp.links.filter(l => l.url) : []
    } catch {}

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
    render()
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
    const res = await fetch('/api/media/upload', { method: 'POST', body: formData, credentials: 'include' })
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

async function generateAiVideo() {
  if (!post.value || !videoPrompt.value.trim()) return
  aiVideoLoading.value = true
  try {
    if (photo.value) await http.post(`/media/${photo.value.id}/attach`, { postId: null }).catch(() => {})
    const payload: any = {
      businessId: post.value.businessId, postId: post.value.id,
      prompt: videoPrompt.value, duration: videoDuration.value,
      aspectRatio: '9:16', generateAudio: videoAudio.value,
    }
    if (videoInputMode.value === 'frames') {
      payload.firstFrameUrl = videoFirstFrame.value?.url || null
      payload.lastFrameUrl = videoLastFrame.value?.url || null
    } else if (videoInputMode.value === 'references' && videoRefImages.value.length) {
      payload.referenceImageUrls = videoRefImages.value.map(r => r.url)
    }
    const result = await http.post<{ mediaFile: any }>('/ai/generate-video', payload)
    // Сохранить промпт в историю
    videoPromptHistory.value.push(videoPrompt.value)
    videoHistoryIndex.value = videoPromptHistory.value.length - 1
    // Сохранить в БД (fire and forget)
    http.post('/ai/generate-edit-prompt', {
      businessId: post.value.businessId, postId: post.value.id,
      template: videoPrompt.value, type: 'video',
    }).catch(() => {})

    post.value.mediaFiles = [result.mediaFile]
    showAiVideo.value = false
    toast.success(`Видео сгенерировано (${videoDuration.value} сек)`)
    await loadPost()
  } catch (e: any) { toast.error('Ошибка: ' + e.message) }
  finally { aiVideoLoading.value = false }
}

async function enhanceVideoPrompt() {
  if (!post.value || !videoPrompt.value.trim()) return
  videoEnhancing.value = true
  try {
    const result = await http.post<{ enhancedPrompt: string }>('/ai/enhance-video-prompt', {
      prompt: videoPrompt.value,
      duration: videoDuration.value,
      businessId: post.value.businessId,
    })
    videoPrompt.value = result.enhancedPrompt
    videoPromptHistory.value.push(result.enhancedPrompt)
    videoHistoryIndex.value = videoPromptHistory.value.length - 1
    toast.success('Промпт улучшен')
  } catch (e: any) { toast.error('Ошибка: ' + e.message) }
  finally { videoEnhancing.value = false }
}

async function addRefImage(event: Event) {
  const input = event.target as HTMLInputElement
  if (!input.files?.length || !post.value || videoRefImages.value.length >= 9) return
  const formData = new FormData()
  formData.append('file', input.files[0])
  formData.append('businessId', post.value.businessId)
  formData.append('tags', JSON.stringify(['video-reference']))
  try {
    const res = await fetch('/api/media/upload', { method: 'POST', credentials: 'include', body: formData })
    if (!res.ok) throw new Error('Upload failed')
    const media = await res.json()
    videoRefImages.value.push({ url: media.url, thumbUrl: media.thumbUrl, filename: media.filename })
    toast.success(`Референс @Image${videoRefImages.value.length} загружен`)
  } catch { toast.error('Ошибка загрузки') }
  input.value = ''
}

function removeRefImage(index: number) {
  videoRefImages.value.splice(index, 1)
}

async function pickFrame(event: Event, which: 'first' | 'last') {
  const input = event.target as HTMLInputElement
  if (!input.files?.length || !post.value) return
  const formData = new FormData()
  formData.append('file', input.files[0])
  formData.append('businessId', post.value.businessId)
  formData.append('tags', JSON.stringify(['video-frame']))
  try {
    const res = await fetch('/api/media/upload', { method: 'POST', credentials: 'include', body: formData })
    if (!res.ok) throw new Error('Upload failed')
    const media = await res.json()
    const frame = { url: media.url, thumbUrl: media.thumbUrl, filename: media.filename }
    if (which === 'first') videoFirstFrame.value = frame
    else videoLastFrame.value = frame
    toast.success(`${which === 'first' ? 'Первый' : 'Последний'} кадр загружен`)
  } catch { toast.error('Ошибка загрузки') }
  input.value = ''
}

function videoHistoryBack() {
  if (videoHistoryIndex.value <= 0) return
  videoHistoryIndex.value--
  videoPrompt.value = videoPromptHistory.value[videoHistoryIndex.value]
}

function videoHistoryForward() {
  if (videoHistoryIndex.value >= videoPromptHistory.value.length - 1) return
  videoHistoryIndex.value++
  videoPrompt.value = videoPromptHistory.value[videoHistoryIndex.value]
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
// ШАГ 1: Подготовить превью (экспорт canvas → модалка)
async function preparePreview() {
  if (!post.value || !photo.value) { toast.error('Загрузите фото'); return }
  if (!selectedChannel.value) { toast.error('Выберите VK канал'); return }
  previewExporting.value = true
  try {
    const blob = await exportCanvas()
    // Освободить старый URL
    if (previewBlobUrl.value) URL.revokeObjectURL(previewBlobUrl.value)
    previewBlob.value = blob
    previewBlobUrl.value = URL.createObjectURL(blob)
    previewSize.value = blob.size
    showPreview.value = true
  } catch (e: any) { toast.error('Ошибка рендеринга: ' + e.message) }
  finally { previewExporting.value = false }
}

// ШАГ 2: Подтвердить и опубликовать (upload + publish)
async function confirmPublish() {
  if (!post.value || !previewBlob.value) return
  publishing.value = true
  try {
    // 1. Загрузить рендер как ДОПОЛНИТЕЛЬНЫЙ файл (не удаляя оригинал!)
    const formData = new FormData()
    formData.append('file', previewBlob.value, 'story-rendered.jpg')
    formData.append('businessId', post.value.businessId)
    // НЕ привязываем к postId — это временный файл для публикации
    const uploadRes = await fetch('/api/media/upload', { method: 'POST', body: formData, credentials: 'include' })
    const renderedFile = await uploadRes.json() as MediaFile

    // 2. Сохранить пост
    await http.put(`/posts/${post.value.id}`, { body: overlayText.value, title: storyTitle.value || null })

    // 3. Создать версию если нет
    let versionId = version.value?.id
    if (!versionId) {
      const v = await http.post<{ id: string }>(`/posts/${post.value.id}/versions`, {
        platformAccountId: selectedChannel.value, body: overlayText.value, hashtags: [],
      })
      versionId = v.id
    }

    // 4. Отвязать оригинал от поста (НЕ удалять!)
    const originalFileIds = post.value.mediaFiles.map(m => m.id)
    for (const mfId of originalFileIds) {
      await http.post(`/media/${mfId}/attach`, { postId: null }).catch(() => {})
    }

    // 5. Привязать rendered к посту (publisher берёт mediaFiles поста)
    await http.post(`/media/${renderedFile.id}/attach`, { postId: post.value.id }).catch(() => {})

    // 6. Публикация
    const result = await http.post<{ success: boolean; externalUrl: string | null; error: string | null }>(
      `/post-versions/${versionId}/publish`, {
        storiesOptions: {
          skipOverlay: true,
          linkText: linkType.value || undefined,
          linkUrl: linkUrl.value || undefined,
        },
      }
    )

    // 7. Вернуть оригиналы обратно, удалить rendered
    await http.delete(`/media/${renderedFile.id}`).catch(() => {})
    for (const mfId of originalFileIds) {
      await http.post(`/media/${mfId}/attach`, { postId: post.value.id }).catch(() => {})
    }

    showPreview.value = false
    if (result.success) toast.success('История опубликована!')
    else toast.error('Ошибка: ' + result.error)

    // Canvas state сохраняется — НЕ перезагружаем
    // Просто обновим версию для отображения статуса
    try {
      const freshPost = await http.get<Post>(`/posts/${post.value.id}`)
      if (freshPost) {
        post.value.versions = freshPost.versions
        post.value.status = freshPost.status
      }
    } catch {}

    render()
  } catch (e: any) { toast.error('Ошибка: ' + e.message) }
  finally { publishing.value = false }
}

async function schedulePublish() {
  if (!post.value || !previewBlob.value || !scheduledAt.value) return
  scheduling.value = true
  try {
    // Шаги 1-5 идентичны confirmPublish
    const formData = new FormData()
    formData.append('file', previewBlob.value, 'story-rendered.jpg')
    formData.append('businessId', post.value.businessId)
    const uploadRes = await fetch('/api/media/upload', { method: 'POST', body: formData, credentials: 'include' })
    const renderedFile = await uploadRes.json() as MediaFile

    await http.put(`/posts/${post.value.id}`, { body: overlayText.value, title: storyTitle.value || null })

    let versionId = version.value?.id
    if (!versionId) {
      const v = await http.post<{ id: string }>(`/posts/${post.value.id}/versions`, {
        platformAccountId: selectedChannel.value, body: overlayText.value, hashtags: [],
      })
      versionId = v.id
    }

    const originalFileIds = post.value.mediaFiles.map(m => m.id)
    for (const mfId of originalFileIds) {
      await http.post(`/media/${mfId}/attach`, { postId: null }).catch(() => {})
    }
    await http.post(`/media/${renderedFile.id}/attach`, { postId: post.value.id }).catch(() => {})

    // 6. Запланировать (вместо publish)
    await http.post(`/post-versions/${versionId}/schedule`, {
      scheduledAt: new Date(scheduledAt.value).toISOString(),
    })

    // 7. Вернуть оригиналы
    await http.delete(`/media/${renderedFile.id}`).catch(() => {})
    for (const mfId of originalFileIds) {
      await http.post(`/media/${mfId}/attach`, { postId: post.value.id }).catch(() => {})
    }

    showPreview.value = false
    toast.success(`Запланировано на ${new Date(scheduledAt.value).toLocaleString('ru')}`)

    try {
      const freshPost = await http.get<Post>(`/posts/${post.value.id}`)
      if (freshPost) { post.value.versions = freshPost.versions; post.value.status = freshPost.status }
    } catch {}
    render()
  } catch (e: any) { toast.error('Ошибка: ' + e.message) }
  finally { scheduling.value = false }
}

function closePreview() {
  showPreview.value = false
}

// VK link_text → реальный текст кнопки в VK (проверено)
function applyTemplate(tpl: DbStoryTemplate) {
  if (tpl.overlayText) overlayText.value = tpl.overlayText
  if (tpl.textPosition) textPosition.value = tpl.textPosition as any
  if (tpl.textColor) textColor.value = tpl.textColor
  if (tpl.fontSize) fontSize.value = tpl.fontSize as any
  if (tpl.bgStyle) bgStyle.value = tpl.bgStyle as any
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

// Re-render on settings change
watch([overlayText, textPosition, textColor, fontSize, bgStyle, bgRadius, textAlign, linkType, linkUrl], () => nextTick(render))

onMounted(() => {
  loadPost()
  window.addEventListener('mouseup', onMouseUp)
  window.addEventListener('mousemove', onMouseMove)
})
onUnmounted(() => {
  window.removeEventListener('mouseup', onMouseUp)
  window.removeEventListener('mousemove', onMouseMove)
})
</script>

<template>
  <div>
    <button @click="router.push('/posts')" class="flex items-center gap-1 text-sm text-gray-500 hover:text-gray-700 dark:hover:text-gray-300 mb-4">
      <ArrowLeft :size="16" /> Назад к историям
    </button>

    <div v-if="loading" class="text-gray-500 py-8 text-center">Загрузка...</div>

    <div v-else-if="post" class="grid grid-cols-1 lg:grid-cols-5 gap-6">

      <!-- LEFT: Canvas Preview (3/5) -->
      <div class="lg:col-span-3 flex flex-col items-center">
        <h2 class="text-lg font-bold mb-3">Превью Stories</h2>

        <!-- Phone frame -->
        <div class="relative bg-black rounded-[2rem] p-2 shadow-2xl w-full max-w-[376px]">
          <div class="absolute top-0 left-1/2 -translate-x-1/2 w-24 h-5 bg-black rounded-b-xl z-10"></div>

          <!-- Video preview (вместо canvas для видео) -->
          <video
            v-if="isVideoMedia"
            :src="photo!.url"
            class="rounded-[1.5rem] w-full"
            style="aspect-ratio: 9/16; object-fit: cover; background: #000;"
            controls loop muted autoplay playsinline
          />

          <!-- Image canvas (для фото) -->
          <canvas
            v-else
            ref="canvasRef"
            :width="canvasWidth"
            :height="canvasHeight"
            :class="[
              'rounded-[1.5rem]',
              isPublished ? 'cursor-default' : 'cursor-grab active:cursor-grabbing',
              dragging && !isPublished && 'cursor-grabbing',
            ]"
            @mousedown="!isPublished && onMouseDown($event)"
            @wheel.prevent="!isPublished && onWheel($event)"
          />
          <!-- Overlay: generation in progress -->
          <div v-if="editingImage || aiVideoLoading" class="absolute inset-2 rounded-[1.5rem] bg-black/50 flex items-center justify-center">
            <div class="flex flex-col items-center gap-2 text-white">
              <Loader2 :size="28" class="animate-spin" :class="aiVideoLoading ? 'text-emerald-400' : 'text-purple-400'" />
              <span class="text-xs font-medium">{{ aiVideoLoading ? 'Генерация видео...' : 'Генерация изображения...' }}</span>
            </div>
          </div>
        </div>

        <!-- Zoom controls -->
        <div v-if="!isPublished" class="flex items-center gap-2 mt-3">
          <button @click="zoomOut" class="p-1.5 rounded-lg bg-gray-200 dark:bg-gray-800 text-gray-600 dark:text-gray-400 hover:bg-gray-300"><ZoomOut :size="16" /></button>
          <span class="text-xs text-gray-400 w-12 text-center">{{ Math.round(imgScale * 100) }}%</span>
          <button @click="zoomIn" class="p-1.5 rounded-lg bg-gray-200 dark:bg-gray-800 text-gray-600 dark:text-gray-400 hover:bg-gray-300"><ZoomIn :size="16" /></button>
          <button @click="resetView" class="px-2 py-1 rounded-lg text-[10px] text-gray-500 hover:bg-gray-200 dark:hover:bg-gray-800">Сброс</button>
        </div>
        <p v-if="!isPublished" class="text-[10px] text-gray-500 mt-1">Перетаскивайте фото мышкой. Колёсико = zoom.</p>
      </div>

      <!-- RIGHT: Settings (2/5) -->
      <div class="lg:col-span-2 space-y-4">

        <!-- Published lock banner -->
        <div v-if="isPublished" class="p-3 rounded-xl bg-amber-50 dark:bg-amber-950 border border-amber-200 dark:border-amber-800 text-center">
          <p class="text-xs text-amber-700 dark:text-amber-300 font-medium">Редактирование заблокировано после публикации</p>
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
            <button v-if="photo" @click="doRemoveBg" :disabled="removingBg" title="Убрать фон"
              class="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-purple-100 dark:bg-purple-900 text-purple-700 dark:text-purple-300 text-xs font-medium hover:bg-purple-200 disabled:opacity-50">
              <Loader2 v-if="removingBg" :size="14" class="animate-spin" /><Eraser v-else :size="14" />
            </button>
          </div>
        </div>

        <!-- Text + Templates -->
        <div :class="['bg-white dark:bg-gray-900 rounded-xl p-5 border border-gray-200 dark:border-gray-800', isPublished && 'opacity-60 pointer-events-none select-none']">
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

        <!-- Link -->
        <div :class="['bg-white dark:bg-gray-900 rounded-xl p-5 border border-gray-200 dark:border-gray-800', isPublished && 'opacity-60 pointer-events-none select-none']">
          <h3 class="font-semibold text-sm mb-3 flex items-center gap-2"><Link :size="16" /> Кнопка-ссылка</h3>
          <select v-model="linkType" class="w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 text-sm mb-2">
            <option v-for="lt in LINK_TYPES" :key="lt.value" :value="lt.value">{{ lt.label }}</option>
          </select>
          <input v-if="linkType" v-model="linkUrl" placeholder="https://nawode.ru"
            class="w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 text-sm" />
          <div v-if="linkType && savedLinks.length" class="flex flex-wrap gap-1 mt-1.5">
            <button v-for="sl in savedLinks" :key="sl.url" @click="linkUrl = sl.url"
              :class="['px-2 py-0.5 rounded-full text-[10px] font-medium transition-colors',
                linkUrl === sl.url
                  ? 'bg-brand-600 text-white'
                  : 'bg-gray-100 dark:bg-gray-800 text-gray-500 hover:bg-brand-50 dark:hover:bg-brand-950 hover:text-brand-600']">
              {{ sl.label || sl.url }}
            </button>
          </div>
        </div>

        <!-- Publish -->
        <div class="bg-white dark:bg-gray-900 rounded-xl p-5 border border-gray-200 dark:border-gray-800">
          <h3 class="font-semibold text-sm mb-3 flex items-center gap-2"><Send :size="16" /> Публикация</h3>
          <div v-if="vkChannels.length > 1" class="mb-3">
            <select v-model="selectedChannel" class="w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 text-sm">
              <option v-for="ch in vkChannels" :key="ch.id" :value="ch.id">{{ ch.accountName }}</option>
            </select>
          </div>
          <div v-else-if="vkChannels.length === 1" class="text-xs text-gray-400 mb-3">{{ vkChannels[0].accountName }}</div>
          <div v-else class="text-xs text-red-500 mb-3">Нет VK каналов. <router-link :to="'/businesses/' + post.businessId + '?tab=channels'" class="text-brand-500 underline">Настроить каналы</router-link></div>

          <div v-if="version?.status === 'SCHEDULED'" class="p-3 rounded-lg bg-blue-50 dark:bg-blue-950 border border-blue-200 dark:border-blue-800 mb-3">
            <div class="flex items-center justify-between">
              <div class="flex items-center gap-2">
                <Clock :size="16" class="text-blue-600" />
                <div>
                  <div class="text-sm font-medium text-blue-700 dark:text-blue-300">Запланировано</div>
                  <div v-if="version.scheduledAt" class="text-[10px] text-blue-500">{{ new Date(version.scheduledAt).toLocaleString('ru') }}</div>
                </div>
              </div>
              <button @click="cancelSchedule" :disabled="cancellingSchedule"
                class="px-2.5 py-1 rounded-lg text-xs font-medium text-red-600 dark:text-red-400 border border-red-300 dark:border-red-700 hover:bg-red-50 dark:hover:bg-red-950 disabled:opacity-50">
                {{ cancellingSchedule ? '...' : 'Отменить' }}
              </button>
            </div>
          </div>

          <div v-if="version?.status === 'PUBLISHED'" class="p-3 rounded-lg bg-green-50 dark:bg-green-950 border border-green-200 dark:border-green-800 mb-3">
            <div class="flex items-center gap-2">
              <CheckCircle :size="16" class="text-green-600" />
              <div>
                <div class="text-sm font-medium text-green-700 dark:text-green-300">Опубликовано</div>
                <div v-if="version.publishedAt" class="text-[10px] text-green-500">{{ formatDate(version.publishedAt) }}</div>
                <a v-if="version.externalUrl" :href="version.externalUrl" target="_blank" class="text-xs text-green-600 hover:underline flex items-center gap-1 mt-1"><ExternalLink :size="12" /> Открыть в VK</a>
              </div>
            </div>
          </div>

          <div v-if="version?.publishLogs?.[0]?.status === 'FAILED'" class="p-3 rounded-lg bg-red-50 dark:bg-red-950 border border-red-200 dark:border-red-800 mb-3">
            <div class="flex items-start gap-2">
              <AlertCircle :size="16" class="text-red-500 shrink-0 mt-0.5" />
              <div class="text-xs text-red-600">{{ version.publishLogs[0].errorMessage }}</div>
            </div>
          </div>

          <button v-if="!isPublished" @click="preparePreview" :disabled="publishing || previewExporting || !photo || !vkChannels.length"
            class="w-full flex items-center justify-center gap-2 px-4 py-3 rounded-lg bg-green-600 hover:bg-green-700 text-white font-medium disabled:opacity-50">
            <Loader2 v-if="previewExporting" :size="18" class="animate-spin" /><Eye v-else :size="18" />
            {{ previewExporting ? 'Рендеринг...' : 'Предпросмотр и публикация' }}
          </button>
        </div>
      </div>
    </div>

    <!-- Preview Modal -->
    <div v-if="showPreview" class="fixed inset-0 z-50 flex items-center justify-center bg-black/70" @click.self="closePreview">
      <div class="bg-white dark:bg-gray-900 rounded-2xl p-6 w-full max-w-lg shadow-xl">
        <h2 class="text-lg font-bold mb-4 text-center">Предпросмотр публикации</h2>

        <!-- Rendered media in phone frame + link button -->
        <div class="flex justify-center mb-4">
          <div class="relative bg-black rounded-[1.5rem] p-1.5 shadow-xl" style="width: 240px;">
            <video v-if="isVideoMedia" :src="photo!.url" class="rounded-[1.2rem] w-full" style="aspect-ratio: 9/16; object-fit: cover;" controls loop muted autoplay playsinline />
            <img v-else :src="previewBlobUrl" class="rounded-[1.2rem] w-full" style="aspect-ratio: 9/16; object-fit: cover;" />
            <!-- Кнопка будет добавлена ВК нативно -->
            <div v-if="linkType" class="absolute bottom-5 left-1/2 -translate-x-1/2 px-5 py-1.5 bg-white/90 rounded-full text-[10px] font-bold text-gray-700 shadow whitespace-nowrap">
              {{ LINK_TYPES.find(l => l.value === linkType)?.label }}
            </div>
          </div>
          <p v-if="linkType" class="text-[10px] text-gray-400 text-center mt-2">
            Кнопка будет добавлена ВКонтакте
          </p>
        </div>

        <!-- Metadata -->
        <div class="bg-gray-50 dark:bg-gray-800 rounded-xl p-4 mb-4 space-y-2 text-sm">
          <div class="flex justify-between">
            <span class="text-gray-500">Разрешение</span>
            <span class="font-medium">1080 × 1920</span>
          </div>
          <div class="flex justify-between">
            <span class="text-gray-500">Размер файла</span>
            <span class="font-medium">{{ (previewSize / 1024).toFixed(0) }} KB</span>
          </div>
          <div class="flex justify-between">
            <span class="text-gray-500">Канал</span>
            <span class="font-medium">{{ vkChannels.find(c => c.id === selectedChannel)?.accountName || '—' }}</span>
          </div>
          <div v-if="linkType" class="flex justify-between">
            <span class="text-gray-500">Кнопка</span>
            <span class="font-medium">{{ LINK_TYPES.find(l => l.value === linkType)?.label }} → {{ linkUrl || '—' }}</span>
          </div>
        </div>

        <!-- Schedule -->
        <div class="bg-gray-50 dark:bg-gray-800 rounded-xl p-4 mb-4">
          <label class="flex items-center gap-2 text-sm font-medium mb-2">
            <Calendar :size="14" /> Запланировать
          </label>
          <div class="flex gap-2">
            <input v-model="scheduledAt" type="datetime-local"
              :min="new Date().toISOString().slice(0, 16)"
              class="flex-1 px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 text-sm" />
            <button @click="schedulePublish" :disabled="scheduling || !scheduledAt"
              class="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium disabled:opacity-50">
              <Loader2 v-if="scheduling" :size="14" class="animate-spin" /><Clock v-else :size="14" />
              {{ scheduling ? '...' : 'Запланировать' }}
            </button>
          </div>
        </div>

        <!-- Actions -->
        <div class="flex gap-3">
          <button @click="closePreview"
            class="flex-1 px-4 py-3 rounded-lg border border-gray-300 dark:border-gray-700 text-sm font-medium text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800">
            ← Назад
          </button>
          <button @click="confirmPublish" :disabled="publishing"
            class="flex-1 flex items-center justify-center gap-2 px-4 py-3 rounded-lg bg-green-600 hover:bg-green-700 text-white font-medium disabled:opacity-50">
            <Loader2 v-if="publishing" :size="16" class="animate-spin" /><Send v-else :size="16" />
            {{ publishing ? 'Публикация...' : 'Опубликовать сейчас' }}
          </button>
        </div>
      </div>
    </div>

    <!-- AI Image Modal -->
    <div v-if="showAiImage" class="fixed inset-0 z-50 flex items-center justify-center bg-black/50" @click.self="showAiImage = false">
      <div class="bg-white dark:bg-gray-900 rounded-2xl p-6 w-full max-w-md shadow-xl">
        <h2 class="text-lg font-bold mb-4 flex items-center gap-2"><Sparkles :size="20" class="text-purple-500" /> AI Картинка (9:16)</h2>
        <div class="space-y-3">
          <!-- Template pills -->
          <div>
            <label class="block text-sm font-medium mb-1.5">Шаблоны</label>
            <div class="flex flex-wrap gap-1.5">
              <button v-for="t in IMAGE_TEMPLATES" :key="t.label" @click="aiPrompt = t.prompt"
                class="px-2.5 py-1 rounded-full text-xs font-medium bg-purple-100 dark:bg-purple-900/50 text-purple-700 dark:text-purple-300 hover:bg-purple-200 dark:hover:bg-purple-800 transition-colors">
                {{ t.label }}
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
          <textarea v-model="aiPrompt" rows="3" placeholder="SUP на закате, вертикальное фото..."
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
      <div class="bg-white dark:bg-gray-900 rounded-2xl p-6 w-full max-w-xl shadow-xl max-h-[90vh] overflow-y-auto">
        <h2 class="text-lg font-bold mb-4 flex items-center gap-2">
          <Video :size="20" class="text-emerald-500" /> AI Видео (9:16)
          <!-- History navigation -->
          <div v-if="videoPromptHistory.length > 0" class="flex items-center gap-0.5 ml-auto">
            <button @click="videoHistoryBack" :disabled="videoHistoryIndex <= 0"
              class="p-0.5 rounded hover:bg-gray-100 dark:hover:bg-gray-800 disabled:opacity-30">
              <ChevronLeft :size="14" />
            </button>
            <span class="text-[10px] text-gray-400 min-w-[24px] text-center">
              {{ videoHistoryIndex + 1 }}/{{ videoPromptHistory.length }}
            </span>
            <button @click="videoHistoryForward" :disabled="videoHistoryIndex >= videoPromptHistory.length - 1"
              class="p-0.5 rounded hover:bg-gray-100 dark:hover:bg-gray-800 disabled:opacity-30">
              <ChevronRight :size="14" />
            </button>
          </div>
        </h2>

        <div class="space-y-4">
          <!-- Template pills -->
          <div>
            <label class="block text-xs font-medium text-gray-500 mb-1.5">Шаблоны</label>
            <div class="flex flex-wrap gap-1.5">
              <button v-for="t in VIDEO_TEMPLATES" :key="t.label" @click="videoPrompt = t.prompt"
                class="px-2.5 py-1 rounded-full text-xs font-medium bg-emerald-100 dark:bg-emerald-900/50 text-emerald-700 dark:text-emerald-300 hover:bg-emerald-200 dark:hover:bg-emerald-800 transition-colors">
                {{ t.label }}
              </button>
            </div>
          </div>

          <!-- Входные изображения -->
          <div>
            <label class="block text-xs font-medium text-gray-500 mb-1.5">Исходные изображения <span class="font-normal text-gray-400">(дешевле на 40%)</span></label>
            <!-- Mode selector -->
            <div class="flex gap-1 mb-2">
              <button v-for="m in [{ id: 'text', label: 'Без фото' }, { id: 'frames', label: 'Кадры (1-2)' }, { id: 'references', label: 'Референсы (до 9)' }]" :key="m.id"
                @click="videoInputMode = m.id as any"
                :class="['px-2.5 py-1 rounded-lg text-[10px] font-medium border transition-colors',
                  videoInputMode === m.id
                    ? 'bg-emerald-100 dark:bg-emerald-900 text-emerald-700 dark:text-emerald-300 border-emerald-300 dark:border-emerald-700'
                    : 'bg-gray-100 dark:bg-gray-800 text-gray-500 border-gray-200 dark:border-gray-700 hover:border-emerald-300']">
                {{ m.label }}
              </button>
            </div>

            <!-- Frames mode: first + last -->
            <div v-if="videoInputMode === 'frames'" class="grid grid-cols-2 gap-2">
              <div>
                <div v-if="videoFirstFrame" class="flex items-center gap-2 p-2 rounded-lg bg-emerald-50 dark:bg-emerald-900/30 border border-emerald-200 dark:border-emerald-800">
                  <img :src="videoFirstFrame.thumbUrl || videoFirstFrame.url" class="w-10 h-10 rounded object-cover" />
                  <div class="flex-1 min-w-0"><div class="text-[10px] font-medium">Первый кадр</div></div>
                  <button @click="videoFirstFrame = null" class="p-0.5 text-gray-400 hover:text-red-500"><Trash2 :size="12" /></button>
                </div>
                <label v-else class="flex flex-col items-center gap-1 p-3 rounded-lg border-2 border-dashed border-gray-300 dark:border-gray-700 cursor-pointer hover:border-emerald-400">
                  <Image :size="16" class="text-gray-400" /><span class="text-[10px] text-gray-500">Первый кадр</span>
                  <input type="file" accept="image/*" class="hidden" @change="(e: Event) => pickFrame(e, 'first')" />
                </label>
              </div>
              <div>
                <div v-if="videoLastFrame" class="flex items-center gap-2 p-2 rounded-lg bg-emerald-50 dark:bg-emerald-900/30 border border-emerald-200 dark:border-emerald-800">
                  <img :src="videoLastFrame.thumbUrl || videoLastFrame.url" class="w-10 h-10 rounded object-cover" />
                  <div class="flex-1 min-w-0"><div class="text-[10px] font-medium">Последний кадр</div></div>
                  <button @click="videoLastFrame = null" class="p-0.5 text-gray-400 hover:text-red-500"><Trash2 :size="12" /></button>
                </div>
                <label v-else class="flex flex-col items-center gap-1 p-3 rounded-lg border-2 border-dashed border-gray-300 dark:border-gray-700 cursor-pointer hover:border-emerald-400">
                  <Image :size="16" class="text-gray-400" /><span class="text-[10px] text-gray-500">Последний кадр</span>
                  <input type="file" accept="image/*" class="hidden" @change="(e: Event) => pickFrame(e, 'last')" />
                </label>
              </div>
              <button v-if="photo && !isVideoMedia && !videoFirstFrame"
                @click="videoFirstFrame = { url: photo!.url, thumbUrl: photo!.thumbUrl, filename: photo!.filename }"
                class="col-span-2 text-[10px] text-emerald-600 dark:text-emerald-400 hover:underline text-left">
                Использовать текущее фото как первый кадр
              </button>
            </div>

            <!-- References mode: до 9 изображений -->
            <div v-if="videoInputMode === 'references'">
              <div class="flex flex-wrap gap-2 mb-2">
                <div v-for="(ref, idx) in videoRefImages" :key="idx"
                  class="relative group w-16 h-16 rounded-lg overflow-hidden border border-emerald-200 dark:border-emerald-800">
                  <img :src="ref.thumbUrl || ref.url" class="w-full h-full object-cover" />
                  <div class="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 flex items-center justify-center transition-opacity">
                    <button @click="removeRefImage(idx)" class="p-1 bg-red-500/80 rounded-full"><Trash2 :size="10" class="text-white" /></button>
                  </div>
                  <span class="absolute bottom-0.5 left-0.5 px-1 py-0.5 bg-black/60 text-white text-[8px] rounded font-mono">@Image{{ idx + 1 }}</span>
                </div>
                <label v-if="videoRefImages.length < 9"
                  class="w-16 h-16 rounded-lg border-2 border-dashed border-gray-300 dark:border-gray-700 flex flex-col items-center justify-center cursor-pointer hover:border-emerald-400 transition-colors">
                  <Plus :size="14" class="text-gray-400" />
                  <span class="text-[8px] text-gray-400">{{ videoRefImages.length }}/9</span>
                  <input type="file" accept="image/*" class="hidden" @change="addRefImage" />
                </label>
              </div>
              <p class="text-[9px] text-gray-400">В промпте ссылайтесь: <code class="text-emerald-500">@Image1</code>, <code class="text-emerald-500">@Image2</code> и т.д.</p>
            </div>
          </div>

          <!-- Prompt textarea -->
          <div>
            <textarea v-model="videoPrompt" rows="5" placeholder="Опишите видео: что в кадре, действие, движение камеры, освещение, настроение..."
              class="w-full px-3 py-2.5 rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 focus:ring-2 focus:ring-emerald-500 text-sm resize-none" />
            <!-- Enhance button -->
            <button @click="enhanceVideoPrompt" :disabled="videoEnhancing || !videoPrompt.trim()"
              class="mt-1.5 flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium border border-emerald-300 dark:border-emerald-700 text-emerald-600 dark:text-emerald-400 hover:bg-emerald-50 dark:hover:bg-emerald-950 disabled:opacity-50 transition-colors">
              <Loader2 v-if="videoEnhancing" :size="14" class="animate-spin" /><Wand2 v-else :size="14" />
              {{ videoEnhancing ? 'Улучшаю...' : 'Улучшить промпт (AI)' }}
            </button>
          </div>

          <!-- Duration slider + Audio toggle row -->
          <div class="grid grid-cols-2 gap-4">
            <div>
              <label class="block text-xs font-medium text-gray-500 mb-1.5">Длительность: {{ videoDuration }} сек</label>
              <input type="range" v-model.number="videoDuration" min="4" max="15" step="1"
                class="w-full h-2 bg-gray-200 dark:bg-gray-700 rounded-lg appearance-none cursor-pointer accent-emerald-500" />
              <div class="flex justify-between text-[10px] text-gray-400 mt-0.5">
                <span>4с</span>
                <span>15с</span>
              </div>
            </div>
            <div>
              <label class="block text-xs font-medium text-gray-500 mb-1.5">Звук</label>
              <label class="flex items-center gap-2 cursor-pointer">
                <div class="relative">
                  <input type="checkbox" v-model="videoAudio" class="sr-only peer" />
                  <div class="w-9 h-5 bg-gray-200 dark:bg-gray-700 rounded-full peer peer-checked:bg-emerald-500 transition-colors"></div>
                  <div class="absolute left-0.5 top-0.5 w-4 h-4 bg-white rounded-full transition-transform peer-checked:translate-x-4 shadow-sm"></div>
                </div>
                <span class="text-xs text-gray-600 dark:text-gray-400">
                  {{ videoAudio ? 'Генерировать звук' : 'Без звука' }}
                </span>
              </label>
            </div>
          </div>

          <!-- Character selector -->
          <div v-if="characters.length">
            <label class="block text-xs font-medium text-gray-500 mb-1.5">Персонаж</label>
            <select v-model="selectedCharacterId"
              class="w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 text-sm">
              <option :value="null">Без персонажа</option>
              <option v-for="char in characters" :key="char.id" :value="char.id">
                {{ char.name }} ({{ char.type === 'person' ? 'человек' : char.type === 'mascot' ? 'маскот' : 'аватар' }})
              </option>
            </select>
          </div>

          <div class="p-2.5 rounded-lg bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700">
            <div class="flex items-center justify-between">
              <div class="flex items-center gap-2 text-[10px] text-gray-400">
                <span class="px-1.5 py-0.5 bg-emerald-100 dark:bg-emerald-900/50 text-emerald-600 dark:text-emerald-400 rounded font-medium">seedance-2</span>
                <span>720p</span>
                <span>·</span>
                <span>{{ videoFirstFrame ? 'img→video' : 'text→video' }}</span>
                <span>·</span>
                <span>~1-3 мин</span>
              </div>
              <div class="text-right">
                <div class="text-sm font-bold text-emerald-600 dark:text-emerald-400">~{{ videoCostRub }} ₽</div>
                <div class="text-[9px] text-gray-400">${{ videoCostUsd.toFixed(2) }}</div>
              </div>
            </div>
          </div>
        </div>

        <div class="flex justify-end gap-2 mt-5">
          <button @click="showAiVideo = false" class="px-4 py-2.5 rounded-lg text-sm text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-800">Отмена</button>
          <button @click="generateAiVideo" :disabled="aiVideoLoading || !videoPrompt.trim()"
            class="flex items-center gap-2 px-5 py-2.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-medium disabled:opacity-50">
            <Loader2 v-if="aiVideoLoading" :size="16" class="animate-spin" /><Video v-else :size="16" />
            {{ aiVideoLoading ? 'Генерация...' : 'Сгенерировать' }}
          </button>
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
  </div>
</template>
