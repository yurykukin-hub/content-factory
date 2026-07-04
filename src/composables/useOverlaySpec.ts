/**
 * useOverlaySpec — драйвер единого модуля запекания (Фаза B).
 * Реактивный OverlaySpec → debounced авто-бейк на бэкенде (satori) → bakedUrl = РЕАЛЬНЫЕ
 * запечённые пиксели («что вижу = что публикуется»). Дёргается из OverlayEditor.vue,
 * из карточки/ленты (FeedView) и из StoryEditorView (Фаза B2 — интеграция редактора сторис).
 */
import { ref, watch } from 'vue'
import { http } from '@/api/client'
import { defaultOverlaySpec, type OverlaySpec } from '@/types/overlaySpec'

interface RenderOverlayResponse {
  id: string
  url: string
  thumbUrl: string | null
  mediaFileId: string
  spec: OverlaySpec
}

export interface UseOverlaySpecInitOpts {
  spec?: OverlaySpec | null
  sourceMediaId: string
  postId?: string
  /** Видео + музыка из Sound Studio (вшивается в baked-видео через ffmpeg). Только для видео. */
  musicSessionId?: string | null
  /** Видео + аудио-медиа из медиатеки (парити с musicSessionId). Только для видео. */
  audioMediaFileId?: string | null
}

const DEBOUNCE_MS = 500

export function useOverlaySpec() {
  const spec = ref<OverlaySpec>(defaultOverlaySpec(''))
  const bakedUrl = ref<string | null>(null)
  const bakedMediaFileId = ref<string | null>(null)
  const baking = ref(false)
  const error = ref<string | null>(null)
  // Есть несохранённые изменения spec с момента последнего успешного бейка (для ensureBaked)
  const dirty = ref(false)
  // Музыка/аудио для видео-бейка (для фото игнорируется бэкендом)
  const musicSessionId = ref<string | null>(null)
  const audioMediaFileId = ref<string | null>(null)

  const postId = ref<string | undefined>(undefined)
  let debounceTimer: ReturnType<typeof setTimeout> | null = null
  let ready = false // true после init() — до этого watcher молчит
  let inflight: Promise<void> | null = null // текущий запрос бейка (для ensureBaked)

  function clearDebounce() {
    if (debounceTimer) {
      clearTimeout(debounceTimer)
      debounceTimer = null
    }
  }

  async function doRender() {
    clearDebounce()
    if (!spec.value.sourceMediaId) return
    baking.value = true
    error.value = null
    try {
      const res = await http.post<RenderOverlayResponse>('/media/render-overlay', {
        postId: postId.value,
        mediaId: spec.value.sourceMediaId,
        spec: spec.value,
        musicSessionId: musicSessionId.value || undefined,
        audioMediaFileId: audioMediaFileId.value || undefined,
      })
      bakedUrl.value = `${res.url}?v=${Date.now()}`
      bakedMediaFileId.value = res.mediaFileId
      dirty.value = false
    } catch (e: any) {
      error.value = e?.message || 'Ошибка запекания'
    } finally {
      baking.value = false
    }
  }

  /** Немедленное запекание текущего spec (напр. по drag-end). Отменяет отложенный вызов. */
  async function render() {
    inflight = doRender()
    try {
      await inflight
    } finally {
      inflight = null
    }
  }

  /** Алиас для явного немедленного бейка (используется UI, напр. по окончании drag). */
  function bakeNow() {
    return render()
  }

  /**
   * Гарантировать актуальный baked-медиа перед публикацией: дождаться текущего бейка,
   * запечь если есть несохранённые изменения (dirty) или бейка ещё не было. Возвращает id baked-медиа.
   */
  async function ensureBaked(): Promise<string | null> {
    if (inflight) await inflight
    if (dirty.value || !bakedMediaFileId.value) await render()
    return bakedMediaFileId.value
  }

  watch(
    spec,
    () => {
      if (!ready) return
      dirty.value = true
      clearDebounce()
      debounceTimer = setTimeout(() => { render() }, DEBOUNCE_MS)
    },
    { deep: true }
  )

  /** Инициализация: сид из существующего Post.overlaySpec или дефолт от sourceMediaId, + первый рендер. */
  async function init(opts: UseOverlaySpecInitOpts) {
    ready = false
    clearDebounce()
    postId.value = opts.postId
    musicSessionId.value = opts.musicSessionId ?? null
    audioMediaFileId.value = opts.audioMediaFileId ?? null
    spec.value = opts.spec ? { ...opts.spec } : defaultOverlaySpec(opts.sourceMediaId)
    bakedUrl.value = null
    bakedMediaFileId.value = null
    error.value = null
    dirty.value = false
    ready = true
    await render()
  }

  return {
    spec, bakedUrl, bakedMediaFileId, baking, error, dirty,
    musicSessionId, audioMediaFileId,
    init, render, bakeNow, ensureBaked,
  }
}
