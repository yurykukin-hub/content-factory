<script setup lang="ts">
import { ref, onMounted, computed, watch, nextTick, onUnmounted } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { http } from '@/api/client'
import { useBusinessesStore } from '@/stores/businesses'
import { useToast } from '@/composables/useToast'
import { formatDate } from '@/composables/useFormatters'
import {
  ArrowLeft, Upload, Sparkles, Loader2, Send, CheckCircle,
  ExternalLink, AlertCircle, Image, Link, Trash2, ZoomIn, ZoomOut, Eye
} from 'lucide-vue-next'

interface MediaFile { id: string; url: string; thumbUrl: string | null; filename: string; mimeType: string; sizeBytes: number }
interface PlatformAccount { id: string; platform: string; accountName: string; accountId: string }
interface PostVersion {
  id: string; status: string; externalUrl: string | null; publishedAt: string | null
  platformAccount: PlatformAccount
  publishLogs: { status: string; errorMessage: string | null; attemptedAt: string }[]
}
interface Post {
  id: string; businessId: string; title: string | null; body: string; postType: string
  status: string; createdAt: string; versions: PostVersion[]; mediaFiles: MediaFile[]
}

const route = useRoute()
const router = useRouter()
const businesses = useBusinessesStore()
const toast = useToast()

const post = ref<Post | null>(null)
const loading = ref(true)
const publishing = ref(false)
const uploading = ref(false)

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

const TEXT_COLORS = ['#ffffff', '#000000', '#ef4444', '#f97316', '#eab308', '#22c55e', '#3b82f6', '#8b5cf6', '#ec4899', '#d946ef']
const linkType = ref('')
const linkUrl = ref('')

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

// Channels
const vkChannels = ref<PlatformAccount[]>([])
const selectedChannel = ref('')

const photo = computed(() => post.value?.mediaFiles?.[0] || null)
const version = computed(() => post.value?.versions?.[0] || null)

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
function drawScene(ctx: CanvasRenderingContext2D, w: number, h: number, fSize: number) {
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

  // Draw link button (in both preview AND export — consistent positioning)
  let buttonTopY = h // нижняя граница по умолчанию (нет кнопки)
  if (linkType.value) {
    const scale = w / 360 // масштаб относительно preview
    const btnW = Math.round(200 * scale)
    const btnH = Math.round(32 * scale)
    const btnX = (w - btnW) / 2
    const btnY = h - Math.round(40 * scale)
    buttonTopY = btnY - Math.round(12 * scale) // верхний край кнопки + gap

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

  drawScene(ctx, exportWidth, exportHeight, fontSizeExport.value)

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
    if (photo.value) await http.delete(`/media/${photo.value.id}`).catch(() => {})
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
  await http.delete(`/media/${photo.value.id}`).catch(() => {})
  post.value.mediaFiles = []
  imgEl.value = null
  render()
  toast.info('Фото удалено')
}

async function generateAiImage() {
  if (!post.value || !aiPrompt.value.trim()) return
  aiLoading.value = true
  try {
    if (photo.value) await http.delete(`/media/${photo.value.id}`).catch(() => {})
    const result = await http.post<{ mediaFile: MediaFile }>('/ai/generate-image', {
      businessId: post.value.businessId, postId: post.value.id,
      prompt: aiPrompt.value, aspectRatio: '9:16',
    })
    post.value.mediaFiles = [result.mediaFile]
    loadImage(result.mediaFile.url)
    showAiImage.value = false
    aiPrompt.value = ''
    toast.success('Картинка сгенерирована')
  } catch (e: any) { toast.error('Ошибка: ' + e.message) }
  finally { aiLoading.value = false }
}

async function generateOverlayText() {
  if (!post.value) return
  aiTextLoading.value = true
  try {
    const result = await http.post<{ post: { body: string } }>('/ai/generate-post', {
      businessId: post.value.businessId,
      topic: `Напиши ОЧЕНЬ короткий текст для Stories (2-3 предложения, до 80 символов). Тема: ${storyTitle.value || 'SUP прокат'}. Максимально кратко и цепляюще. Без хештегов.`,
    })
    overlayText.value = result.post.body
    toast.success('Текст сгенерирован')
  } catch (e: any) { toast.error('Ошибка: ' + e.message) }
  finally { aiTextLoading.value = false }
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

function closePreview() {
  showPreview.value = false
}

// VK link_text → реальный текст кнопки в VK (проверено)
// Story templates
interface StoryTemplate {
  name: string
  emoji: string
  overlayText: string
  textPosition: 'top' | 'center' | 'bottom'
  textColor: string
  fontSize: 'S' | 'M' | 'L'
  bgStyle: 'dark' | 'light' | 'none'
  linkType: string
}

const STORY_TEMPLATES: StoryTemplate[] = [
  {
    name: 'SUP рассвет', emoji: '🌅',
    overlayText: 'Рассвет на воде — лучшее начало дня',
    textPosition: 'bottom', textColor: '#ffffff', fontSize: 'L', bgStyle: 'dark', linkType: 'book',
  },
  {
    name: 'Прогноз дня', emoji: '☀️',
    overlayText: 'Сегодня идеальная погода для SUP!',
    textPosition: 'top', textColor: '#ffffff', fontSize: 'M', bgStyle: 'light', linkType: 'book',
  },
  {
    name: 'Акция', emoji: '🔥',
    overlayText: 'Скидка 20% на утренний прокат!',
    textPosition: 'center', textColor: '#ffffff', fontSize: 'L', bgStyle: 'dark', linkType: 'order',
  },
  {
    name: 'Факт о SUP', emoji: '💡',
    overlayText: 'SUP — один из самых быстрорастущих видов спорта в мире',
    textPosition: 'bottom', textColor: '#ffffff', fontSize: 'M', bgStyle: 'dark', linkType: '',
  },
  {
    name: 'Отзыв', emoji: '⭐',
    overlayText: '«Лучший отдых за последний год!»',
    textPosition: 'center', textColor: '#ffffff', fontSize: 'L', bgStyle: 'dark', linkType: 'learn_more',
  },
]

function applyTemplate(tpl: StoryTemplate) {
  overlayText.value = tpl.overlayText
  textPosition.value = tpl.textPosition
  textColor.value = tpl.textColor
  fontSize.value = tpl.fontSize
  bgStyle.value = tpl.bgStyle
  linkType.value = tpl.linkType
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
      <ArrowLeft :size="16" /> Назад к постам
    </button>

    <div v-if="loading" class="text-gray-500 py-8 text-center">Загрузка...</div>

    <div v-else-if="post" class="grid grid-cols-1 lg:grid-cols-5 gap-6">

      <!-- LEFT: Canvas Preview (3/5) -->
      <div class="lg:col-span-3 flex flex-col items-center">
        <h2 class="text-lg font-bold mb-3">Превью Stories</h2>

        <!-- Phone frame -->
        <div class="relative bg-black rounded-[2rem] p-2 shadow-2xl" style="width: 376px;">
          <div class="absolute top-0 left-1/2 -translate-x-1/2 w-24 h-5 bg-black rounded-b-xl z-10"></div>

          <canvas
            ref="canvasRef"
            :width="canvasWidth"
            :height="canvasHeight"
            class="rounded-[1.5rem] cursor-grab active:cursor-grabbing"
            :class="{ 'cursor-grabbing': dragging }"
            @mousedown="onMouseDown"
            @wheel.prevent="onWheel"
          />
        </div>

        <!-- Zoom controls -->
        <div class="flex items-center gap-2 mt-3">
          <button @click="zoomOut" class="p-1.5 rounded-lg bg-gray-200 dark:bg-gray-800 text-gray-600 dark:text-gray-400 hover:bg-gray-300"><ZoomOut :size="16" /></button>
          <span class="text-xs text-gray-400 w-12 text-center">{{ Math.round(imgScale * 100) }}%</span>
          <button @click="zoomIn" class="p-1.5 rounded-lg bg-gray-200 dark:bg-gray-800 text-gray-600 dark:text-gray-400 hover:bg-gray-300"><ZoomIn :size="16" /></button>
          <button @click="resetView" class="px-2 py-1 rounded-lg text-[10px] text-gray-500 hover:bg-gray-200 dark:hover:bg-gray-800">Сброс</button>
        </div>
        <p class="text-[10px] text-gray-500 mt-1">Перетаскивайте фото мышкой. Колёсико = zoom.</p>
      </div>

      <!-- RIGHT: Settings (2/5) -->
      <div class="lg:col-span-2 space-y-4">

        <!-- Title -->
        <div class="bg-white dark:bg-gray-900 rounded-xl p-5 border border-gray-200 dark:border-gray-800">
          <h3 class="font-semibold text-sm mb-2">Название</h3>
          <input v-model="storyTitle" placeholder="Название истории..."
            class="w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 focus:ring-2 focus:ring-brand-500 text-sm" />
        </div>

        <!-- Photo -->
        <div class="bg-white dark:bg-gray-900 rounded-xl p-5 border border-gray-200 dark:border-gray-800">
          <!-- Templates -->
          <div class="mb-4">
            <h3 class="font-semibold text-sm mb-2">Шаблоны</h3>
            <div class="flex flex-wrap gap-1.5">
              <button v-for="tpl in STORY_TEMPLATES" :key="tpl.name" @click="applyTemplate(tpl)"
                class="flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-gray-100 dark:bg-gray-800 text-xs font-medium hover:bg-brand-50 dark:hover:bg-brand-950 hover:text-brand-700 dark:hover:text-brand-300 transition-colors">
                <span>{{ tpl.emoji }}</span>
                {{ tpl.name }}
              </button>
            </div>
          </div>

          <h3 class="font-semibold text-sm mb-3 flex items-center gap-2"><Image :size="16" /> Фото</h3>
          <div v-if="photo" class="flex items-center gap-3 mb-3">
            <img :src="photo.thumbUrl || photo.url" class="w-12 h-12 rounded-lg object-cover" />
            <div class="flex-1 min-w-0">
              <div class="text-sm truncate">{{ photo.filename }}</div>
              <div class="text-[10px] text-gray-400">{{ (photo.sizeBytes / 1024).toFixed(0) }} KB</div>
            </div>
            <button @click="removePhoto" class="p-1.5 rounded text-gray-400 hover:text-red-500"><Trash2 :size="14" /></button>
          </div>
          <div class="flex gap-2">
            <label :class="['flex-1 flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg border-2 border-dashed cursor-pointer text-xs font-medium',
              uploading ? 'opacity-50' : 'border-gray-300 dark:border-gray-700 text-gray-500 hover:border-brand-400']">
              <Loader2 v-if="uploading" :size="14" class="animate-spin" /><Upload v-else :size="14" />
              {{ photo ? 'Заменить' : 'Загрузить' }}
              <input type="file" accept="image/*,video/*" class="hidden" @change="uploadPhoto" :disabled="uploading" />
            </label>
            <button @click="showAiImage = true"
              class="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-purple-100 dark:bg-purple-900 text-purple-700 dark:text-purple-300 text-xs font-medium hover:bg-purple-200">
              <Sparkles :size="14" /> AI
            </button>
          </div>
        </div>

        <!-- Text -->
        <div class="bg-white dark:bg-gray-900 rounded-xl p-5 border border-gray-200 dark:border-gray-800">
          <div class="flex items-center justify-between mb-3">
            <h3 class="font-semibold text-sm">Текст на фото</h3>
            <button @click="generateOverlayText" :disabled="aiTextLoading"
              class="flex items-center gap-1 px-2.5 py-1 rounded-lg bg-purple-100 dark:bg-purple-900 text-purple-700 dark:text-purple-300 text-[11px] font-medium hover:bg-purple-200 disabled:opacity-50">
              <Loader2 v-if="aiTextLoading" :size="12" class="animate-spin" /><Sparkles v-else :size="12" /> AI текст
            </button>
          </div>
          <textarea v-model="overlayText" rows="4" placeholder="Короткий текст поверх фото..."
            class="w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 focus:ring-2 focus:ring-brand-500 text-sm" />

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
        <div class="bg-white dark:bg-gray-900 rounded-xl p-5 border border-gray-200 dark:border-gray-800">
          <h3 class="font-semibold text-sm mb-3 flex items-center gap-2"><Link :size="16" /> Кнопка-ссылка</h3>
          <select v-model="linkType" class="w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 text-sm mb-2">
            <option v-for="lt in LINK_TYPES" :key="lt.value" :value="lt.value">{{ lt.label }}</option>
          </select>
          <input v-if="linkType" v-model="linkUrl" placeholder="https://nawode.ru"
            class="w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 text-sm" />
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
          <div v-else class="text-xs text-red-500 mb-3">Нет VK каналов. <router-link to="/settings" class="text-brand-500 underline">Настроить</router-link></div>

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

          <button @click="preparePreview" :disabled="publishing || previewExporting || !photo || !vkChannels.length"
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

        <!-- Rendered image in phone frame + link button -->
        <div class="flex justify-center mb-4">
          <div class="relative bg-black rounded-[1.5rem] p-1.5 shadow-xl" style="width: 240px;">
            <img :src="previewBlobUrl" class="rounded-[1.2rem] w-full" style="aspect-ratio: 9/16; object-fit: cover;" />
            <!-- Кнопка уже внутри JPEG (drawScene рисует её) -->
          </div>
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

        <!-- Actions -->
        <div class="flex gap-3">
          <button @click="closePreview"
            class="flex-1 px-4 py-3 rounded-lg border border-gray-300 dark:border-gray-700 text-sm font-medium text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800">
            ← Назад к редактору
          </button>
          <button @click="confirmPublish" :disabled="publishing"
            class="flex-1 flex items-center justify-center gap-2 px-4 py-3 rounded-lg bg-green-600 hover:bg-green-700 text-white font-medium disabled:opacity-50">
            <Loader2 v-if="publishing" :size="16" class="animate-spin" /><Send v-else :size="16" />
            {{ publishing ? 'Публикация...' : 'Подтвердить' }}
          </button>
        </div>
      </div>
    </div>

    <!-- AI Image Modal -->
    <div v-if="showAiImage" class="fixed inset-0 z-50 flex items-center justify-center bg-black/50" @click.self="showAiImage = false">
      <div class="bg-white dark:bg-gray-900 rounded-2xl p-6 w-full max-w-md shadow-xl">
        <h2 class="text-lg font-bold mb-4 flex items-center gap-2"><Sparkles :size="20" class="text-purple-500" /> AI Картинка (9:16)</h2>
        <textarea v-model="aiPrompt" rows="3" placeholder="SUP на закате, вертикальное фото..."
          class="w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 text-sm mb-4" />
        <div class="flex justify-end gap-2">
          <button @click="showAiImage = false" class="px-4 py-2 rounded-lg text-sm text-gray-500">Отмена</button>
          <button @click="generateAiImage" :disabled="aiLoading || !aiPrompt.trim()"
            class="flex items-center gap-2 px-4 py-2 rounded-lg bg-purple-600 hover:bg-purple-700 text-white text-sm font-medium disabled:opacity-50">
            <Loader2 v-if="aiLoading" :size="16" class="animate-spin" /><Sparkles v-else :size="16" />
            {{ aiLoading ? 'Генерация...' : 'Сгенерировать' }}
          </button>
        </div>
      </div>
    </div>
  </div>
</template>
