/**
 * useOverlaySpec — драйвер единого модуля запекания (Фаза B).
 * Реактивный OverlaySpec → debounced авто-бейк на бэкенде (satori) → bakedUrl = РЕАЛЬНЫЕ
 * запечённые пиксели («что вижу = что публикуется»). Дёргается из OverlayEditor.vue,
 * позже — из карточки дайджеста и StoryEditorView (интеграция — отдельная фаза).
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
}

const DEBOUNCE_MS = 500

export function useOverlaySpec() {
  const spec = ref<OverlaySpec>(defaultOverlaySpec(''))
  const bakedUrl = ref<string | null>(null)
  const bakedMediaFileId = ref<string | null>(null)
  const baking = ref(false)
  const error = ref<string | null>(null)

  const postId = ref<string | undefined>(undefined)
  let debounceTimer: ReturnType<typeof setTimeout> | null = null
  let ready = false // true после init() — до этого watcher молчит

  function clearDebounce() {
    if (debounceTimer) {
      clearTimeout(debounceTimer)
      debounceTimer = null
    }
  }

  /** Немедленное запекание текущего spec (напр. по drag-end). Отменяет отложенный вызов. */
  async function render() {
    clearDebounce()
    if (!spec.value.sourceMediaId) return
    baking.value = true
    error.value = null
    try {
      const res = await http.post<RenderOverlayResponse>('/media/render-overlay', {
        postId: postId.value,
        mediaId: spec.value.sourceMediaId,
        spec: spec.value,
      })
      bakedUrl.value = `${res.url}?v=${Date.now()}`
      bakedMediaFileId.value = res.mediaFileId
    } catch (e: any) {
      error.value = e?.message || 'Ошибка запекания'
    } finally {
      baking.value = false
    }
  }

  /** Алиас для явного немедленного бейка (используется UI, напр. по окончании drag). */
  function bakeNow() {
    return render()
  }

  watch(
    spec,
    () => {
      if (!ready) return
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
    spec.value = opts.spec ? { ...opts.spec } : defaultOverlaySpec(opts.sourceMediaId)
    bakedUrl.value = null
    bakedMediaFileId.value = null
    error.value = null
    ready = true
    await render()
  }

  return { spec, bakedUrl, bakedMediaFileId, baking, error, init, render, bakeNow }
}
