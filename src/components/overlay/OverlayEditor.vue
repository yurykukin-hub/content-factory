<script setup lang="ts">
/**
 * OverlayEditor — единый редактор запекания (Фаза B). WYSIWYG-контракт: превью =
 * РЕАЛЬНЫЙ запечённый satori-PNG (bakedUrl), не canvas-имитация. Единственное исключение —
 * во время drag кадра показываем оригинал (CSS object-position) для мгновенного отклика,
 * на drag-end перезапекаем.
 *
 * Самодостаточен и переиспользуем (карточка дайджеста / StoryEditorView — отдельная фаза,
 * этот компонент их пока НЕ трогает).
 */
import { ref, computed, watch, onUnmounted } from 'vue'
import { Move, HelpCircle } from 'lucide-vue-next'
import {
  UiButton, UiTextarea, UiInput, UiSelect, UiTabs, UiSwitch, UiTooltip, UiSpinner, UiCard,
} from '@/components/ui'
import { useOverlaySpec } from '@/composables/useOverlaySpec'
import type { OverlaySpec, OverlayFont, OverlayTemplate } from '@/types/overlaySpec'

const props = defineProps<{
  sourceMediaId: string
  businessId: string
  postId?: string
  initialSpec?: OverlaySpec | null
  sourcePhotoUrl?: string | null
}>()

const emit = defineEmits<{
  'update:spec': [spec: OverlaySpec]
  baked: [payload: { mediaFileId: string; url: string; spec: OverlaySpec }]
}>()

const { spec, bakedUrl, bakedMediaFileId, baking, error, init, bakeNow } = useOverlaySpec()

// Инициализация + ре-инициализация при смене исходного медиа/поста (переиспользуемость под будущую интеграцию)
watch(
  () => [props.sourceMediaId, props.postId] as const,
  ([mediaId, postId]) => {
    if (!mediaId) return
    init({ spec: props.initialSpec ?? undefined, sourceMediaId: mediaId, postId })
  },
  { immediate: true }
)

watch(spec, (v) => emit('update:spec', { ...v }), { deep: true })
watch(bakedMediaFileId, (id) => {
  if (id && bakedUrl.value) emit('baked', { mediaFileId: id, url: bakedUrl.value, spec: spec.value })
})

// --- Строго типизированные обёртки для v-model (UiSelect/UiTabs эмитят plain string) ---
const FONTS: OverlayFont[] = ['montserrat', 'cormorant']
const TEMPLATES: OverlayTemplate[] = ['story', 'clean', 'bold']

const fontOptions = [
  { label: 'Montserrat', value: 'montserrat' },
  { label: 'Cormorant', value: 'cormorant' },
]
const templateTabs = [
  { key: 'story', label: 'Сторис' },
  { key: 'clean', label: 'Минимал' },
  { key: 'bold', label: 'Крупный' },
]

const fontModel = computed<string>({
  get: () => spec.value.font,
  set: (v) => { spec.value.font = (FONTS as string[]).includes(v) ? (v as OverlayFont) : 'montserrat' },
})
const templateModel = computed<string>({
  get: () => spec.value.template,
  set: (v) => { spec.value.template = (TEMPLATES as string[]).includes(v) ? (v as OverlayTemplate) : 'story' },
})

const topText = computed<string>({
  get: () => spec.value.topText ?? '',
  set: (v) => { spec.value.topText = v || null },
})
const bottomText = computed<string>({
  get: () => spec.value.bottomText ?? '',
  set: (v) => { spec.value.bottomText = v || null },
})
const ctaText = computed<string>({
  get: () => spec.value.cta ?? '',
  set: (v) => { spec.value.cta = v || null },
})

const weatherShow = computed<boolean>({
  get: () => spec.value.weather?.show ?? false,
  set: (v) => {
    spec.value.weather = v
      ? { show: true, temp: spec.value.weather?.temp, desc: spec.value.weather?.desc }
      : null
  },
})
const weatherTemp = computed<string>({
  get: () => spec.value.weather?.temp ?? '',
  set: (v) => { spec.value.weather = { show: true, temp: v || undefined, desc: spec.value.weather?.desc } },
})
const weatherDesc = computed<string>({
  get: () => spec.value.weather?.desc ?? '',
  set: (v) => { spec.value.weather = { show: true, temp: spec.value.weather?.temp, desc: v || undefined } },
})

// --- Drag-to-crop: тащим фото по превью → spec.photoPosition (objectPosition), на drag-end — bakeNow() ---
const previewRef = ref<HTMLElement | null>(null)
const dragging = ref(false)
let dragStartX = 0, dragStartY = 0, startPosX = 50, startPosY = 50, boxW = 280, boxH = 497

function parsePosition(pos: string): { x: number; y: number } {
  const [xs, ys] = pos.split(/\s+/)
  const x = parseFloat(xs)
  const y = parseFloat(ys)
  return { x: Number.isFinite(x) ? x : 50, y: Number.isFinite(y) ? y : 50 }
}

function onDragStart(e: MouseEvent | TouchEvent) {
  if (!props.sourcePhotoUrl) return
  const pt = 'touches' in e ? e.touches[0] : (e as MouseEvent)
  const box = previewRef.value?.getBoundingClientRect()
  if (box) { boxW = box.width; boxH = box.height }
  const { x, y } = parsePosition(spec.value.photoPosition)
  startPosX = x
  startPosY = y
  dragStartX = pt.clientX
  dragStartY = pt.clientY
  dragging.value = true
  window.addEventListener('mousemove', onDragMove)
  window.addEventListener('touchmove', onDragMove, { passive: false })
  window.addEventListener('mouseup', onDragEnd)
  window.addEventListener('touchend', onDragEnd)
}
function onDragMove(e: MouseEvent | TouchEvent) {
  if (!dragging.value) return
  if (e.cancelable && 'touches' in e) e.preventDefault() // не скроллить страницу при перетаскивании
  const pt = 'touches' in e ? e.touches[0] : (e as MouseEvent)
  const clamp = (v: number) => Math.min(100, Math.max(0, v))
  // тащим фото → кадр (object-position) смещается в противоположную сторону — как в StoryDesignModal
  const nx = clamp(startPosX - ((pt.clientX - dragStartX) / boxW) * 100)
  const ny = clamp(startPosY - ((pt.clientY - dragStartY) / boxH) * 100)
  spec.value.photoPosition = `${Math.round(nx)}% ${Math.round(ny)}%`
}
function onDragEnd() {
  if (!dragging.value) return
  dragging.value = false
  window.removeEventListener('mousemove', onDragMove)
  window.removeEventListener('touchmove', onDragMove)
  window.removeEventListener('mouseup', onDragEnd)
  window.removeEventListener('touchend', onDragEnd)
  bakeNow()
}
onUnmounted(onDragEnd)
</script>

<template>
  <div class="grid grid-cols-1 lg:grid-cols-2 gap-6 items-start">
    <!-- LEFT: controls -->
    <div class="space-y-5">
      <UiCard>
        <div class="space-y-5">
          <div>
            <div class="flex items-center gap-1.5 mb-1">
              <label class="text-sm font-medium text-gray-700 dark:text-gray-300">Верх</label>
              <UiTooltip text="Текст сверху — например, погода или короткий акцент дня" position="right">
                <HelpCircle :size="14" class="text-gray-400 dark:text-gray-500 cursor-help" />
              </UiTooltip>
            </div>
            <UiTextarea v-model="topText" :rows="2" placeholder="Текст сверху…" />
          </div>

          <div>
            <div class="flex items-center gap-1.5 mb-1">
              <label class="text-sm font-medium text-gray-700 dark:text-gray-300">Низ</label>
              <UiTooltip text="Главный заголовок — крупный текст внизу сторис" position="right">
                <HelpCircle :size="14" class="text-gray-400 dark:text-gray-500 cursor-help" />
              </UiTooltip>
            </div>
            <UiTextarea v-model="bottomText" :rows="3" placeholder="Главный заголовок…" />
          </div>

          <div>
            <div class="flex items-center gap-1.5 mb-1">
              <label class="text-sm font-medium text-gray-700 dark:text-gray-300">Шрифт</label>
              <UiTooltip text="Семейство шрифта заголовков: Montserrat (чёткий) или Cormorant (элегантный)" position="right">
                <HelpCircle :size="14" class="text-gray-400 dark:text-gray-500 cursor-help" />
              </UiTooltip>
            </div>
            <UiSelect v-model="fontModel" :options="fontOptions" />
          </div>

          <div>
            <div class="flex items-center gap-1.5 mb-1">
              <label class="text-sm font-medium text-gray-700 dark:text-gray-300">Шаблон</label>
              <UiTooltip text="Раскладка: Сторис (полная композиция), Минимал (без плашек), Крупный (акцент на заголовке)" position="right">
                <HelpCircle :size="14" class="text-gray-400 dark:text-gray-500 cursor-help" />
              </UiTooltip>
            </div>
            <UiTabs v-model="templateModel" :tabs="templateTabs" variant="segmented" />
          </div>

          <div>
            <div class="flex items-center gap-2 mb-1">
              <UiSwitch v-model="weatherShow" label="Погода" />
              <UiTooltip text="Показать погодный виджет (температура + краткое описание) сверху" position="right">
                <HelpCircle :size="14" class="text-gray-400 dark:text-gray-500 cursor-help" />
              </UiTooltip>
            </div>
            <div v-if="weatherShow" class="grid grid-cols-2 gap-3 mt-2 pl-1">
              <UiInput v-model="weatherTemp" placeholder="+21°" />
              <UiInput v-model="weatherDesc" placeholder="тепло · штиль" />
            </div>
          </div>

          <div>
            <div class="flex items-center gap-1.5 mb-1">
              <label class="text-sm font-medium text-gray-700 dark:text-gray-300">CTA</label>
              <UiTooltip text="Призыв к действию, например «Записаться · nawode.ru»" position="right">
                <HelpCircle :size="14" class="text-gray-400 dark:text-gray-500 cursor-help" />
              </UiTooltip>
            </div>
            <UiInput v-model="ctaText" placeholder="Записаться · nawode.ru" />
          </div>

          <p v-if="error" class="text-xs text-danger-600 dark:text-danger-400">{{ error }}</p>
        </div>
      </UiCard>
    </div>

    <!-- RIGHT: WYSIWYG preview (9:16) -->
    <div class="lg:sticky lg:top-4">
      <div
        ref="previewRef"
        class="relative w-full max-w-[300px] mx-auto aspect-[9/16] rounded-2xl overflow-hidden bg-gray-900 shadow-lg select-none touch-none"
        :class="sourcePhotoUrl ? (dragging ? 'cursor-grabbing' : 'cursor-grab') : ''"
        @mousedown="onDragStart"
        @touchstart="onDragStart"
      >
        <!-- Во время drag: оригинал + живой object-position (мгновенный отклик) -->
        <img
          v-if="dragging && sourcePhotoUrl"
          :src="sourcePhotoUrl"
          draggable="false"
          alt="Оригинал — перетаскивание кадра"
          class="absolute inset-0 w-full h-full object-cover pointer-events-none"
          :style="{ objectPosition: spec.photoPosition }"
        />
        <!-- Вне drag: РЕАЛЬНЫЙ запечённый результат (WYSIWYG = то, что опубликуется) -->
        <img
          v-else-if="bakedUrl"
          :src="bakedUrl"
          alt="Превью сторис"
          class="absolute inset-0 w-full h-full object-cover pointer-events-none"
        />
        <img
          v-else-if="sourcePhotoUrl"
          :src="sourcePhotoUrl"
          draggable="false"
          alt="Оригинал"
          class="absolute inset-0 w-full h-full object-cover pointer-events-none"
          :style="{ objectPosition: spec.photoPosition }"
        />
        <div v-else class="absolute inset-0 flex items-center justify-center text-white/40 text-sm">
          нет фото
        </div>

        <div v-if="baking" class="absolute inset-0 flex items-center justify-center bg-black/30">
          <UiSpinner size="lg" label="Запекаю…" class="text-white" />
        </div>

        <div
          v-if="!dragging && sourcePhotoUrl"
          class="absolute top-2 right-2 flex items-center gap-1 px-2 py-1 rounded-md bg-black/40 text-white/90 text-[11px] pointer-events-none"
        >
          <Move :size="12" /> перетащите кадр
        </div>
      </div>
      <p class="text-[11px] text-gray-400 dark:text-gray-500 text-center mt-2">
        Превью = реальный запечённый результат. Перетащите фото, чтобы поймать кадр.
      </p>
      <div class="flex justify-center mt-3">
        <UiTooltip text="Перезапечь превью немедленно, не дожидаясь автосохранения" position="top">
          <UiButton size="sm" variant="secondary" :loading="baking" @click="bakeNow">Запечь сейчас</UiButton>
        </UiTooltip>
      </div>
    </div>
  </div>
</template>
