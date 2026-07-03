<script setup lang="ts">
/**
 * OverlayLabView — dev-стенд для сквозной Playwright-проверки OverlayEditor/useOverlaySpec
 * (Фаза B, фронт единого модуля запекания). НЕ встроен в основную навигацию.
 * Query: ?mediaId=&businessId= (обязательны), опц. &postId=&photoUrl= (пропустить фетч медиа).
 */
import { ref, onMounted, computed } from 'vue'
import { useRoute } from 'vue-router'
import { http } from '@/api/client'
import OverlayEditor from '@/components/overlay/OverlayEditor.vue'
import { UiCard, UiSpinner } from '@/components/ui'
import type { OverlaySpec } from '@/types/overlaySpec'

interface MediaFileLite { id: string; url: string }

const route = useRoute()
const mediaId = computed(() => String(route.query.mediaId || ''))
const businessId = computed(() => String(route.query.businessId || ''))
const postId = computed(() => (route.query.postId ? String(route.query.postId) : undefined))
const queryPhotoUrl = computed(() => (route.query.photoUrl ? String(route.query.photoUrl) : ''))

const loading = ref(false)
const loadError = ref<string | null>(null)
const sourcePhotoUrl = ref<string | null>(null)

async function loadSourcePhoto() {
  if (queryPhotoUrl.value) {
    sourcePhotoUrl.value = queryPhotoUrl.value
    return
  }
  if (!mediaId.value) return
  loading.value = true
  loadError.value = null
  try {
    const media = await http.get<MediaFileLite>(`/media/${mediaId.value}`)
    sourcePhotoUrl.value = media.url
  } catch (e: any) {
    loadError.value = e?.message || 'Не удалось загрузить исходное фото'
  } finally {
    loading.value = false
  }
}

onMounted(loadSourcePhoto)

function onSpecUpdate(spec: OverlaySpec) {
  console.log('[overlay-lab] spec updated', spec)
}
function onBaked(payload: { mediaFileId: string; url: string; spec: OverlaySpec }) {
  console.log('[overlay-lab] baked', payload)
}
</script>

<template>
  <div class="max-w-5xl mx-auto p-4 sm:p-6 space-y-4">
    <div>
      <h1 class="text-lg font-semibold text-gray-900 dark:text-gray-100">Overlay Lab</h1>
      <p class="text-xs text-gray-400 dark:text-gray-500">
        Dev-стенд для сквозной проверки запекания. Параметры строки:
        <code>?mediaId=&businessId=</code> (+опц. <code>&postId=</code>, <code>&photoUrl=</code>).
      </p>
    </div>

    <UiCard v-if="!mediaId || !businessId">
      <p class="text-sm text-gray-500 dark:text-gray-400">
        Укажите <code>?mediaId=&lt;id&gt;&amp;businessId=&lt;id&gt;</code> в адресной строке.
      </p>
    </UiCard>

    <UiCard v-else-if="loading">
      <div class="flex items-center gap-2 text-sm text-gray-500 dark:text-gray-400">
        <UiSpinner size="sm" /> Загружаю исходное фото…
      </div>
    </UiCard>

    <UiCard v-else-if="loadError">
      <p class="text-sm text-danger-600 dark:text-danger-400">{{ loadError }}</p>
    </UiCard>

    <OverlayEditor
      v-else
      :source-media-id="mediaId"
      :business-id="businessId"
      :post-id="postId"
      :source-photo-url="sourcePhotoUrl"
      @update:spec="onSpecUpdate"
      @baked="onBaked"
    />
  </div>
</template>
