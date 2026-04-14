<script setup lang="ts">
import { ref, computed, watch } from 'vue'
import { http } from '@/api/client'
import { useToast } from '@/composables/useToast'
import { X, Upload, Plus, Trash2, Loader2, Sparkles } from 'lucide-vue-next'

defineProps<{
  visible: boolean
  businessId: string
}>()

const emit = defineEmits<{
  close: []
  created: []
}>()

const toast = useToast()

// Form state
const name = ref('')
const type = ref<'person' | 'mascot' | 'avatar' | 'object' | 'location'>('person')
const description = ref('')
const mainPhoto = ref<{ url: string; thumbUrl: string | null; filename: string } | null>(null)
const additionalPhotos = ref<{ url: string; thumbUrl: string | null; filename: string }[]>([])
const creating = ref(false)
const describing = ref(false)

const TYPE_OPTIONS = [
  { id: 'person', label: 'Персона' },
  { id: 'mascot', label: 'Маскот' },
  { id: 'avatar', label: 'Аватар' },
  { id: 'object', label: 'Объект' },
  { id: 'location', label: 'Локация' },
]

const canCreate = computed(() => name.value.trim() && mainPhoto.value)

function reset() {
  name.value = ''
  type.value = 'person'
  description.value = ''
  mainPhoto.value = null
  additionalPhotos.value = []
}

async function uploadPhoto(event: Event, target: 'main' | 'additional') {
  const input = event.target as HTMLInputElement
  if (!input.files?.length || !props.businessId) return
  const fd = new FormData()
  fd.append('file', input.files[0])
  fd.append('businessId', props.businessId)
  fd.append('tags', JSON.stringify(['reference']))
  try {
    const res = await fetch('/api/media/upload', { method: 'POST', credentials: 'include', body: fd })
    if (!res.ok) throw new Error()
    const m = await res.json()
    const photo = { url: m.url, thumbUrl: m.thumbUrl, filename: m.filename }
    if (target === 'main') {
      mainPhoto.value = photo
    } else if (additionalPhotos.value.length < 3) {
      additionalPhotos.value.push(photo)
    }
  } catch { toast.error('Ошибка загрузки') }
  input.value = ''
}

async function autoDescribe() {
  if (!mainPhoto.value) return
  describing.value = true
  try {
    const res = await http.post<{ description: string }>('/ai/describe-image', {
      imageUrl: mainPhoto.value.url,
      type: type.value,
    })
    description.value = res.description
    toast.success('Описание сгенерировано')
  } catch (e: any) { toast.error(e.message || 'Ошибка AI') }
  finally { describing.value = false }
}

async function create() {
  if (!canCreate.value || !mainPhoto.value || !props.businessId) return
  creating.value = true
  try {
    // Find MediaFile ID by URL (uploaded photos are already in MediaFile table)
    const allMedia = await http.get<any[]>(`/media/library/${props.businessId}`)
    const mediaFile = allMedia.find((m: any) => m.url === mainPhoto.value!.url)

    await http.post('/characters', {
      name: name.value.trim(),
      description: description.value.trim(),
      type: type.value,
      style: '',
      referenceMediaId: mediaFile?.id || null,
      additionalAngles: additionalPhotos.value.length ? additionalPhotos.value : null,
      businessIds: [props.businessId],
    })

    toast.success('Референс создан')
    reset()
    emit('created')
    emit('close')
  } catch (e: any) { toast.error(e.message || 'Ошибка создания') }
  finally { creating.value = false }
}

watch(() => mainPhoto.value, () => {
  // Автоматически заполнить имя из filename если пустое
  if (mainPhoto.value && !name.value) {
    const raw = mainPhoto.value.filename.replace(/\.[^.]+$/, '').replace(/[-_]/g, ' ')
    name.value = raw.charAt(0).toUpperCase() + raw.slice(1)
  }
})
</script>

<template>
  <Teleport to="body">
    <div v-if="visible" class="fixed inset-0 z-50 flex items-center justify-center bg-black/60" @click.self="emit('close')">
      <div class="bg-white dark:bg-gray-900 rounded-2xl shadow-2xl max-w-md w-full mx-4 overflow-hidden">

        <!-- Header -->
        <div class="flex items-center justify-between px-5 py-4 border-b border-gray-200 dark:border-gray-800">
          <h3 class="text-base font-bold">Создать референс</h3>
          <button @click="emit('close')" class="p-1 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 transition-colors">
            <X :size="18" />
          </button>
        </div>

        <!-- Body -->
        <div class="p-5 space-y-4 max-h-[70vh] overflow-y-auto">

          <!-- Photo section -->
          <div class="flex gap-3">
            <!-- Main photo -->
            <div class="shrink-0">
              <div v-if="mainPhoto" class="relative group w-28 h-28 rounded-xl overflow-hidden border-2 border-emerald-300 dark:border-emerald-700">
                <img :src="mainPhoto.thumbUrl || mainPhoto.url" class="w-full h-full object-cover" />
                <button @click="mainPhoto = null"
                  class="absolute top-1 right-1 w-5 h-5 bg-red-500/80 rounded-full flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
                  <X :size="10" class="text-white" />
                </button>
              </div>
              <label v-else
                class="w-28 h-28 rounded-xl border-2 border-dashed border-gray-300 dark:border-gray-700 flex flex-col items-center justify-center cursor-pointer hover:border-emerald-400 transition-colors">
                <Upload :size="22" class="text-gray-400 mb-1" />
                <span class="text-[10px] text-gray-400">Фото</span>
                <input type="file" accept="image/*" class="hidden" @change="(e) => uploadPhoto(e, 'main')" />
              </label>
            </div>

            <!-- Additional angles -->
            <div class="flex-1">
              <p class="text-[10px] text-gray-400 mb-2">Доп. ракурсы (до 3)</p>
              <div class="flex gap-2">
                <div v-for="(p, idx) in additionalPhotos" :key="idx"
                  class="relative group w-14 h-14 rounded-lg overflow-hidden border border-gray-200 dark:border-gray-700">
                  <img :src="p.thumbUrl || p.url" class="w-full h-full object-cover" />
                  <button @click="additionalPhotos.splice(idx, 1)"
                    class="absolute top-0.5 right-0.5 w-4 h-4 bg-red-500/80 rounded-full flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
                    <X :size="8" class="text-white" />
                  </button>
                </div>
                <label v-if="additionalPhotos.length < 3"
                  class="w-14 h-14 rounded-lg border-2 border-dashed border-gray-300 dark:border-gray-700 flex items-center justify-center cursor-pointer hover:border-emerald-400 transition-colors">
                  <Plus :size="14" class="text-gray-400" />
                  <input type="file" accept="image/*" class="hidden" @change="(e) => uploadPhoto(e, 'additional')" />
                </label>
              </div>
            </div>
          </div>

          <!-- Name -->
          <input v-model="name" placeholder="Введите имя"
            class="w-full px-3 py-2.5 rounded-xl border border-gray-300 dark:border-gray-700 bg-gray-50 dark:bg-gray-800 text-sm outline-none focus:border-emerald-400 transition-colors" />

          <!-- Type -->
          <div class="flex gap-1.5">
            <button v-for="t in TYPE_OPTIONS" :key="t.id"
              @click="type = t.id as any"
              :class="[
                'px-3 py-1.5 rounded-lg text-xs font-medium transition-all',
                type === t.id
                  ? 'bg-emerald-100 dark:bg-emerald-900/50 text-emerald-700 dark:text-emerald-300 border border-emerald-300 dark:border-emerald-700'
                  : 'bg-gray-100 dark:bg-gray-800 text-gray-500 border border-transparent hover:border-gray-300 dark:hover:border-gray-600'
              ]">
              {{ t.label }}
            </button>
          </div>

          <!-- Description -->
          <div class="relative">
            <textarea v-model="description" rows="3"
              placeholder="Опишите ключевые особенности: внешность, стиль, детали..."
              class="w-full px-3 py-2.5 rounded-xl border border-gray-300 dark:border-gray-700 bg-gray-50 dark:bg-gray-800 text-sm outline-none focus:border-emerald-400 resize-none transition-colors" />
            <!-- Auto button -->
            <button v-if="mainPhoto" @click="autoDescribe" :disabled="describing"
              class="absolute bottom-2 right-2 flex items-center gap-1 px-2.5 py-1 rounded-lg text-[10px] font-medium bg-gray-200 dark:bg-gray-700 text-gray-600 dark:text-gray-300 hover:bg-gray-300 dark:hover:bg-gray-600 disabled:opacity-50 transition-colors">
              <Loader2 v-if="describing" :size="10" class="animate-spin" />
              <Sparkles v-else :size="10" />
              Auto
            </button>
          </div>
        </div>

        <!-- Footer -->
        <div class="flex items-center justify-end gap-2 px-5 py-4 border-t border-gray-200 dark:border-gray-800">
          <button @click="emit('close')"
            class="px-4 py-2 rounded-lg text-sm font-medium text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors">
            Отмена
          </button>
          <button @click="create" :disabled="!canCreate || creating"
            :class="[
              'flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-medium transition-colors',
              canCreate
                ? 'bg-emerald-600 hover:bg-emerald-700 text-white'
                : 'bg-gray-200 dark:bg-gray-700 text-gray-400 cursor-not-allowed'
            ]">
            <Loader2 v-if="creating" :size="14" class="animate-spin" />
            Создать
          </button>
        </div>
      </div>
    </div>
  </Teleport>
</template>
