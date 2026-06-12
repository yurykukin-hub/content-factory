<script setup lang="ts">
/**
 * Единый редактор «дизайн-слоя» (Фаза 1): кладёт стилизованный текст поверх
 * существующего медиа (фото/видео) и запекает через POST /api/media/bake-design-layer.
 * Фон фиксирован (само медиа) — в отличие от сторис тут не двигаем фон, только дизайн.
 */
import { ref, computed, watch, onMounted, nextTick } from 'vue'
import { TAB_ID } from '@/api/client'
import { useToast } from '@/composables/useToast'
import {
  drawTextLayer, exportTextLayerPng, fontPxFor,
  type DesignTextOptions, type FontSize, type TextPosition, type TextAlign, type BgStyle,
} from '@/composables/useDesignLayerCanvas'
import { X, Loader2, Sparkles, AlignLeft, AlignCenter, AlignRight } from 'lucide-vue-next'

interface MediaFile { id: string; url: string; thumbUrl: string | null; filename: string; mimeType: string }

const props = defineProps<{ mediaFile: MediaFile; businessId: string }>()
const emit = defineEmits<{ (e: 'baked', mf: MediaFile): void; (e: 'close'): void }>()

const toast = useToast()
const isVideo = computed(() => props.mediaFile.mimeType.startsWith('video/'))

// --- Опции дизайна ---
const text = ref('')
const position = ref<TextPosition>('bottom')
const align = ref<TextAlign>('center')
const color = ref('#ffffff')
const bgStyle = ref<BgStyle>('dark')
const bgRadius = ref<'sharp' | 'round'>('round')
const fontSize = ref<FontSize>('M')
const baking = ref(false)

const COLORS = ['#ffffff', '#0f172a', '#d946ef', '#fde047', '#22d3ee', '#f97316']

const opts = computed<DesignTextOptions>(() => ({
  text: text.value, position: position.value, align: align.value,
  color: color.value, bgStyle: bgStyle.value, bgRadius: bgRadius.value,
}))

// --- Натуральные размеры медиа (определяют аспект превью + разрешение экспорта) ---
const natW = ref(1080)
const natH = ref(1920)
const mediaReady = ref(false)

const PREVIEW_MAX_W = 340
const PREVIEW_MAX_H = 460
const previewW = computed(() => {
  const aspect = natW.value / natH.value
  let w = PREVIEW_MAX_W
  let h = w / aspect
  if (h > PREVIEW_MAX_H) { h = PREVIEW_MAX_H; w = h * aspect }
  return Math.round(w)
})
const previewH = computed(() => Math.round(previewW.value / (natW.value / natH.value)))

const canvasRef = ref<HTMLCanvasElement | null>(null)

function renderPreview() {
  const canvas = canvasRef.value
  if (!canvas) return
  canvas.width = previewW.value
  canvas.height = previewH.value
  const ctx = canvas.getContext('2d')
  if (!ctx) return
  ctx.clearRect(0, 0, canvas.width, canvas.height)
  drawTextLayer(ctx, canvas.width, canvas.height, fontPxFor(fontSize.value, canvas.width), opts.value)
}

watch([opts, fontSize, previewW], () => nextTick(renderPreview), { deep: true })

function loadMediaDims() {
  mediaReady.value = false
  if (isVideo.value) {
    const v = document.createElement('video')
    v.onloadedmetadata = () => { natW.value = v.videoWidth || 1080; natH.value = v.videoHeight || 1920; mediaReady.value = true; nextTick(renderPreview) }
    v.onerror = () => { mediaReady.value = true; nextTick(renderPreview) }
    v.src = props.mediaFile.url
  } else {
    const img = new Image()
    img.onload = () => { natW.value = img.naturalWidth || 1080; natH.value = img.naturalHeight || 1920; mediaReady.value = true; nextTick(renderPreview) }
    img.onerror = () => { mediaReady.value = true; nextTick(renderPreview) }
    img.src = props.mediaFile.url
  }
}

onMounted(loadMediaDims)
watch(() => props.mediaFile.id, loadMediaDims)

async function bake() {
  if (!text.value.trim()) { toast.error('Добавьте текст'); return }
  baking.value = true
  try {
    const blob = await exportTextLayerPng(natW.value, natH.value, fontPxFor(fontSize.value, natW.value), opts.value)
    const fd = new FormData()
    fd.append('overlay', blob, 'overlay.png')
    fd.append('targetMediaFileId', props.mediaFile.id)
    fd.append('businessId', props.businessId)
    const res = await fetch('/api/media/bake-design-layer', {
      method: 'POST', body: fd, credentials: 'include', headers: { 'X-Tab-ID': TAB_ID },
    })
    if (!res.ok) {
      const err = await res.json().catch(() => ({})) as { error?: string }
      throw new Error(err.error || 'Не удалось запечь дизайн')
    }
    const mf = await res.json() as MediaFile
    toast.success('Дизайн запечён ✨')
    emit('baked', mf)
  } catch (e: any) {
    toast.error(e.message || 'Ошибка запекания')
  } finally {
    baking.value = false
  }
}

const POSITIONS: { v: TextPosition; label: string }[] = [
  { v: 'top', label: 'Сверху' }, { v: 'center', label: 'По центру' }, { v: 'bottom', label: 'Снизу' },
]
const FONT_SIZES: { v: FontSize; label: string }[] = [
  { v: 'S', label: 'S' }, { v: 'M', label: 'M' }, { v: 'L', label: 'L' },
]
</script>

<template>
  <Teleport to="body">
    <div class="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" @click.self="emit('close')">
      <div class="bg-white dark:bg-gray-900 rounded-2xl shadow-xl w-full max-w-3xl max-h-[92vh] overflow-hidden flex flex-col">
        <!-- Header -->
        <div class="flex items-center justify-between px-5 py-3 border-b border-gray-200 dark:border-gray-800">
          <h2 class="text-base font-bold flex items-center gap-2">
            <Sparkles :size="18" class="text-fuchsia-500" /> Дизайн-слой
          </h2>
          <button @click="emit('close')" class="p-1.5 rounded-lg text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800"><X :size="18" /></button>
        </div>

        <div class="flex flex-col sm:flex-row gap-5 p-5 overflow-y-auto">
          <!-- Превью -->
          <div class="shrink-0 mx-auto">
            <div class="relative rounded-xl overflow-hidden bg-gray-100 dark:bg-gray-800 ring-1 ring-gray-200 dark:ring-gray-700"
              :style="{ width: previewW + 'px', height: previewH + 'px' }">
              <video v-if="isVideo" :src="mediaFile.url" class="absolute inset-0 w-full h-full object-cover" muted loop autoplay playsinline />
              <img v-else :src="mediaFile.url" class="absolute inset-0 w-full h-full object-cover" />
              <canvas ref="canvasRef" class="absolute inset-0 w-full h-full pointer-events-none" />
            </div>
            <p class="text-[11px] text-gray-400 mt-1.5 text-center">{{ natW }}×{{ natH }} · {{ isVideo ? 'видео' : 'фото' }}</p>
          </div>

          <!-- Контролы -->
          <div class="flex-1 min-w-0 space-y-3">
            <div>
              <label class="block text-xs font-medium text-gray-500 mb-1">Текст</label>
              <textarea v-model="text" rows="3" placeholder="Текст поверх медиа..."
                class="w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 text-sm focus:ring-2 focus:ring-fuchsia-500/40 resize-y" />
            </div>

            <div class="grid grid-cols-2 gap-3">
              <!-- Позиция -->
              <div>
                <label class="block text-xs font-medium text-gray-500 mb-1">Позиция</label>
                <div class="flex gap-1">
                  <button v-for="p in POSITIONS" :key="p.v" @click="position = p.v"
                    :class="['flex-1 px-2 py-1.5 rounded-lg text-[11px] font-medium border', position === p.v ? 'border-fuchsia-500 bg-fuchsia-50 dark:bg-fuchsia-950 text-fuchsia-700 dark:text-fuchsia-300' : 'border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-400']">
                    {{ p.label }}
                  </button>
                </div>
              </div>
              <!-- Выравнивание -->
              <div>
                <label class="block text-xs font-medium text-gray-500 mb-1">Выравнивание</label>
                <div class="flex gap-1">
                  <button @click="align = 'left'" :class="['flex-1 py-1.5 rounded-lg border flex items-center justify-center', align === 'left' ? 'border-fuchsia-500 bg-fuchsia-50 dark:bg-fuchsia-950 text-fuchsia-600' : 'border-gray-200 dark:border-gray-700 text-gray-500']"><AlignLeft :size="14" /></button>
                  <button @click="align = 'center'" :class="['flex-1 py-1.5 rounded-lg border flex items-center justify-center', align === 'center' ? 'border-fuchsia-500 bg-fuchsia-50 dark:bg-fuchsia-950 text-fuchsia-600' : 'border-gray-200 dark:border-gray-700 text-gray-500']"><AlignCenter :size="14" /></button>
                  <button @click="align = 'right'" :class="['flex-1 py-1.5 rounded-lg border flex items-center justify-center', align === 'right' ? 'border-fuchsia-500 bg-fuchsia-50 dark:bg-fuchsia-950 text-fuchsia-600' : 'border-gray-200 dark:border-gray-700 text-gray-500']"><AlignRight :size="14" /></button>
                </div>
              </div>
            </div>

            <!-- Цвет текста -->
            <div>
              <label class="block text-xs font-medium text-gray-500 mb-1">Цвет текста</label>
              <div class="flex items-center gap-2">
                <button v-for="c in COLORS" :key="c" @click="color = c"
                  :class="['w-6 h-6 rounded-full ring-2 ring-offset-1 dark:ring-offset-gray-900', color === c ? 'ring-fuchsia-500' : 'ring-transparent']"
                  :style="{ backgroundColor: c }" />
                <input type="color" v-model="color" class="w-7 h-7 rounded cursor-pointer bg-transparent" />
              </div>
            </div>

            <div class="grid grid-cols-2 gap-3">
              <!-- Подложка -->
              <div>
                <label class="block text-xs font-medium text-gray-500 mb-1">Подложка</label>
                <div class="flex gap-1">
                  <button @click="bgStyle = 'none'" :class="['flex-1 px-2 py-1.5 rounded-lg text-[11px] border', bgStyle === 'none' ? 'border-fuchsia-500 bg-fuchsia-50 dark:bg-fuchsia-950 text-fuchsia-700' : 'border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-400']">Без</button>
                  <button @click="bgStyle = 'dark'" :class="['flex-1 px-2 py-1.5 rounded-lg text-[11px] border', bgStyle === 'dark' ? 'border-fuchsia-500 bg-fuchsia-50 dark:bg-fuchsia-950 text-fuchsia-700' : 'border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-400']">Тёмная</button>
                  <button @click="bgStyle = 'light'" :class="['flex-1 px-2 py-1.5 rounded-lg text-[11px] border', bgStyle === 'light' ? 'border-fuchsia-500 bg-fuchsia-50 dark:bg-fuchsia-950 text-fuchsia-700' : 'border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-400']">Светлая</button>
                </div>
              </div>
              <!-- Размер -->
              <div>
                <label class="block text-xs font-medium text-gray-500 mb-1">Размер</label>
                <div class="flex gap-1">
                  <button v-for="s in FONT_SIZES" :key="s.v" @click="fontSize = s.v"
                    :class="['flex-1 px-2 py-1.5 rounded-lg text-[11px] font-semibold border', fontSize === s.v ? 'border-fuchsia-500 bg-fuchsia-50 dark:bg-fuchsia-950 text-fuchsia-700' : 'border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-400']">
                    {{ s.label }}
                  </button>
                </div>
              </div>
            </div>

            <label v-if="bgStyle !== 'none'" class="flex items-center gap-2 text-xs text-gray-600 dark:text-gray-400 cursor-pointer">
              <input type="checkbox" :checked="bgRadius === 'round'" @change="bgRadius = (($event.target as HTMLInputElement).checked ? 'round' : 'sharp')" class="rounded" />
              Скруглённая подложка
            </label>
          </div>
        </div>

        <!-- Footer -->
        <div class="flex items-center justify-end gap-2 px-5 py-3 border-t border-gray-200 dark:border-gray-800">
          <button @click="emit('close')" class="px-3 py-2 rounded-lg text-sm text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800">Отмена</button>
          <button @click="bake" :disabled="baking || !text.trim()"
            class="px-4 py-2 rounded-lg text-sm font-semibold bg-fuchsia-600 hover:bg-fuchsia-700 text-white flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed">
            <Loader2 v-if="baking" :size="16" class="animate-spin" /><Sparkles v-else :size="16" />
            {{ baking ? 'Запекаю...' : 'Запечь дизайн' }}
          </button>
        </div>
      </div>
    </div>
  </Teleport>
</template>
