<script setup lang="ts">
import { ref, computed, watch } from 'vue'
import { useRouter } from 'vue-router'
import { http } from '@/api/client'
import { useToast } from '@/composables/useToast'
import { useBusinessesStore } from '@/stores/businesses'
import { useCreateModalStore } from '@/stores/createModal'
import { FileText, Image, Video, Clapperboard, Film, Sparkles, Loader2, X } from 'lucide-vue-next'

const router = useRouter()
const toast = useToast()
const businesses = useBusinessesStore()
const createModal = useCreateModalStore()

const TYPES = [
  { value: 'TEXT', label: 'Пост', desc: 'Текст + медиа', icon: FileText, canvas: false },
  { value: 'PHOTO', label: 'Фото', desc: 'Картинка + подпись', icon: Image, canvas: false },
  { value: 'VIDEO', label: 'Видео', desc: 'Видеоролик', icon: Video, canvas: false },
  { value: 'REELS', label: 'Reels', desc: 'Верт. видео 9:16', icon: Clapperboard, canvas: false },
  { value: 'CLIPS', label: 'Клипы', desc: 'Верт. видео ВК', icon: Film, canvas: false },
  { value: 'STORIES', label: 'Сторис', desc: 'Канвас с текстом', icon: Sparkles, canvas: true },
]

const businessId = ref<string>('')
const creating = ref<string | null>(null)

const businessList = computed(() => businesses.businesses)

// При открытии — выставить проект (prefill → текущий → первый)
watch(() => createModal.isOpen, (open) => {
  if (open) {
    businessId.value = createModal.prefill.businessId || businesses.currentBusiness?.id || ''
    // Если в prefill задан тип — создаём сразу
    if (createModal.prefill.type) create(createModal.prefill.type)
  }
})

async function create(type: string) {
  if (!businessId.value) { toast.error('Выберите проект'); return }
  if (creating.value) return
  creating.value = type
  try {
    const body = createModal.prefill.body?.trim() ? createModal.prefill.body! : ' '
    const post = await http.post<{ id: string }>('/posts', {
      businessId: businessId.value,
      title: createModal.prefill.title || '',
      body,
      postType: type,
    })
    createModal.close()
    router.push(type === 'STORIES' ? `/stories/${post.id}` : `/posts/${post.id}`)
  } catch (e: any) {
    toast.error(e.message || 'Ошибка создания')
  } finally {
    creating.value = null
  }
}
</script>

<template>
  <Teleport to="body">
    <Transition name="modal">
      <div v-if="createModal.isOpen" class="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" @click.self="createModal.close()">
        <div class="bg-white dark:bg-gray-900 rounded-2xl p-5 sm:p-6 w-full max-w-lg shadow-xl">
          <div class="flex items-center justify-between mb-4">
            <h2 class="text-lg font-bold">Создать контент</h2>
            <button @click="createModal.close()" class="p-1.5 rounded-lg text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800"><X :size="20" /></button>
          </div>

          <!-- Проект (если их несколько) -->
          <div v-if="businessList.length > 1" class="mb-4">
            <label class="block text-xs font-medium text-gray-500 mb-1">Проект</label>
            <select v-model="businessId"
              class="w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 text-sm focus:ring-2 focus:ring-brand-500">
              <option v-for="b in businessList" :key="b.id" :value="b.id">{{ b.name }}</option>
            </select>
          </div>
          <div v-else-if="businessList.length === 0" class="mb-4 text-sm text-red-500">
            Нет доступных проектов.
          </div>

          <!-- Типы контента -->
          <div class="grid grid-cols-2 sm:grid-cols-3 gap-2.5">
            <button v-for="t in TYPES" :key="t.value" @click="create(t.value)" :disabled="!!creating || !businessId"
              class="flex flex-col items-center text-center gap-1.5 p-4 rounded-xl border-2 border-gray-100 dark:border-gray-800 hover:border-brand-400 dark:hover:border-brand-600 hover:bg-brand-50/50 dark:hover:bg-brand-950/30 transition-colors disabled:opacity-50 disabled:cursor-not-allowed">
              <Loader2 v-if="creating === t.value" :size="22" class="animate-spin text-brand-500" />
              <component v-else :is="t.icon" :size="22" :class="t.canvas ? 'text-fuchsia-500' : 'text-brand-500'" />
              <span class="text-sm font-semibold">{{ t.label }}</span>
              <span class="text-[10px] text-gray-400 leading-tight">{{ t.desc }}</span>
            </button>
          </div>
          <p class="text-[11px] text-gray-400 mt-4">Сторис открывается в визуальном редакторе (канвас), остальное — в композере.</p>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
.modal-enter-active,
.modal-leave-active {
  transition: opacity 0.18s ease;
}
.modal-enter-from,
.modal-leave-to {
  opacity: 0;
}
</style>
