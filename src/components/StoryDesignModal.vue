<script setup lang="ts">
// Модалка корректировки кадра дизайн-сторис: ползунок вертикального фокуса фото +
// живое CSS-превью (object-position совпадает с satori objectPosition) → перезапекание satori.
// Решает проблему «фото обрезано неудачно, объект не виден».
import { ref, watch, computed } from 'vue'
import { http } from '@/api/client'
import { useToast } from '@/composables/useToast'
import { X, Loader2, Sparkles } from 'lucide-vue-next'

interface MediaFile { id: string; url: string; tags?: string[]; sourceMediaId?: string | null }
interface SavedDesign { id: string; url: string; thumbUrl: string | null; tags: string[] }

const props = defineProps<{
  visible: boolean
  businessId: string
  mediaId: string           // текущее media (baked-дизайн или исходное фото)
  title?: string
  temp?: string | null
  weather?: string | null
  cta?: string | null
}>()

const emit = defineEmits<{ close: []; done: [design: SavedDesign] }>()

const toast = useToast()
const loading = ref(false)
const baking = ref(false)
const sourceUrl = ref<string | null>(null)
const posY = ref(50)
const titleEdit = ref('')

const objectPosition = computed(() => `50% ${posY.value}%`)

// Загрузить ИСХОДНОЕ фото (для baked — из sourceMediaId, иначе само medias)
async function loadSource() {
  loading.value = true
  sourceUrl.value = null
  try {
    const m = await http.get<MediaFile>(`/media/${props.mediaId}`)
    if (m.tags?.includes('story-design') && m.sourceMediaId) {
      const orig = await http.get<MediaFile>(`/media/${m.sourceMediaId}`).catch(() => null)
      sourceUrl.value = orig?.url || m.url
    } else {
      sourceUrl.value = m.url
    }
  } catch {
    sourceUrl.value = null
    toast.error('Не удалось загрузить фото')
  } finally {
    loading.value = false
  }
}

// immediate: модалка монтируется через v-if с visible=true сразу → без immediate watch не сработает
watch(() => props.visible, (v) => {
  if (v) { posY.value = 50; titleEdit.value = props.title || ''; loadSource() }
}, { immediate: true })

async function bake() {
  if (baking.value || !sourceUrl.value) return
  baking.value = true
  try {
    const design = await http.post<SavedDesign>('/media/render-design', {
      mediaFileId: props.mediaId,
      businessId: props.businessId,
      title: titleEdit.value,
      temp: props.temp,
      weather: props.weather,
      cta: props.cta || 'Записаться · nawode.ru',
      photoPosition: objectPosition.value,
    })
    toast.success('Кадр обновлён')
    emit('done', design)
    emit('close')
  } catch (e: any) {
    toast.error('Ошибка: ' + (e.message || e))
  } finally {
    baking.value = false
  }
}
</script>

<template>
  <Teleport to="body">
    <div v-if="visible" class="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/60 p-0 sm:p-4"
      @click.self="!baking && emit('close')">
      <div class="w-full sm:max-w-md bg-white dark:bg-gray-900 rounded-t-2xl sm:rounded-2xl shadow-2xl max-h-[94vh] overflow-y-auto">
        <div class="flex items-center justify-between p-4 border-b border-gray-200 dark:border-gray-800">
          <h3 class="font-semibold flex items-center gap-2"><Sparkles :size="18" class="text-fuchsia-500" /> Кадр сторис</h3>
          <button @click="emit('close')" class="p-1 text-gray-400 hover:text-gray-600"><X :size="18" /></button>
        </div>

        <div class="p-4 space-y-4">
          <!-- Живое превью 9:16 (object-position = то, что запечёт satori) -->
          <div class="flex justify-center">
            <div class="relative overflow-hidden rounded-xl bg-gray-900 shadow-md" style="width: 200px; aspect-ratio: 9/16;">
              <div v-if="loading" class="absolute inset-0 flex items-center justify-center"><Loader2 :size="24" class="animate-spin text-white/70" /></div>
              <template v-else-if="sourceUrl">
                <img :src="sourceUrl" class="absolute inset-0 w-full h-full object-cover" :style="{ objectPosition }" />
                <div class="absolute inset-x-0 top-0 h-1/4 bg-gradient-to-b from-black/50 to-transparent"></div>
                <div class="absolute inset-x-0 bottom-0 h-1/2 bg-gradient-to-t from-black/80 to-transparent"></div>
                <div v-if="temp || weather" class="absolute top-2 left-2 text-white">
                  <div v-if="temp" class="text-2xl font-bold leading-none" style="font-family: Georgia, serif">{{ temp }}</div>
                  <div v-if="weather" class="text-[8px] mt-0.5">{{ weather }}</div>
                </div>
                <div class="absolute bottom-3 left-2 right-2">
                  <p class="text-white text-[11px] font-bold leading-tight line-clamp-3">{{ titleEdit }}</p>
                  <span v-if="cta" class="inline-block mt-1.5 px-2 py-0.5 rounded bg-[#217D8C] text-white text-[7px] font-bold">{{ cta || 'Записаться · nawode.ru' }}</span>
                </div>
              </template>
              <div v-else class="absolute inset-0 flex items-center justify-center text-white/50 text-xs">нет фото</div>
            </div>
          </div>

          <!-- Ползунок вертикального фокуса -->
          <div>
            <label class="text-xs text-gray-500 flex items-center justify-between mb-1">
              <span>Положение кадра (по вертикали)</span><span class="text-gray-400">{{ posY }}%</span>
            </label>
            <input type="range" min="0" max="100" step="1" v-model.number="posY" class="w-full accent-fuchsia-500" :disabled="loading || baking" />
            <div class="flex justify-between text-[10px] text-gray-400"><span>↑ показать верх</span><span>центр</span><span>низ ↓</span></div>
          </div>

          <!-- Заголовок -->
          <div>
            <label class="text-xs text-gray-500 mb-1 block">Заголовок</label>
            <textarea v-model="titleEdit" rows="2"
              class="w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 text-sm focus:ring-2 focus:ring-fuchsia-500" />
          </div>
        </div>

        <div class="flex gap-2 p-4 pt-0">
          <button @click="emit('close')" :disabled="baking"
            class="flex-1 px-4 py-3 rounded-xl border border-gray-200 dark:border-gray-700 text-sm font-medium text-gray-600 dark:text-gray-400 disabled:opacity-50">
            Отмена
          </button>
          <button @click="bake" :disabled="baking || loading || !sourceUrl"
            class="flex-1 flex items-center justify-center gap-2 px-4 py-3 rounded-xl bg-fuchsia-600 hover:bg-fuchsia-700 text-white text-sm font-semibold disabled:opacity-50 transition-colors touch-manipulation">
            <Loader2 v-if="baking" :size="16" class="animate-spin" /><Sparkles v-else :size="16" />
            {{ baking ? 'Запекаю…' : 'Применить' }}
          </button>
        </div>
      </div>
    </div>
  </Teleport>
</template>
