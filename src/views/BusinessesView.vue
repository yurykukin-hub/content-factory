<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { http } from '@/api/client'
import { useBusinessesStore, type Business } from '@/stores/businesses'
import { useAuthStore } from '@/stores/auth'
import { useToast } from '@/composables/useToast'
import { platformBgColor, platformLabel } from '@/composables/usePlatform'
import {
  Building2, Plus, Loader2, Film, ClipboardList, ChevronRight
} from 'lucide-vue-next'

interface FullBusiness extends Business {
  _count?: { posts: number; contentPlans: number }
}

const router = useRouter()
const businesses = useBusinessesStore()
const auth = useAuthStore()
const toast = useToast()
const isAdmin = computed(() => auth.user?.role === 'ADMIN')

// Create business form
const showCreateForm = ref(false)
const createForm = ref({ name: '', slug: '' })
const creating = ref(false)
const toggling = ref<string | null>(null)

async function createBusiness() {
  if (!createForm.value.name || !createForm.value.slug) return
  creating.value = true
  try {
    const biz = await http.post<FullBusiness>('/businesses', createForm.value)
    showCreateForm.value = false
    createForm.value = { name: '', slug: '' }
    await businesses.load()
    router.push(`/businesses/${biz.id}`)
  } catch (e: any) {
    toast.error(e.message || 'Произошла ошибка')
  } finally {
    creating.value = false
  }
}

async function toggleActive(biz: FullBusiness) {
  toggling.value = biz.id
  try {
    await http.put(`/businesses/${biz.id}`, { isActive: !biz.isActive })
    await businesses.load()
    toast.success(biz.isActive ? 'Бизнес выключен' : 'Бизнес включён')
  } catch (e: any) {
    toast.error(e.message || 'Ошибка')
  } finally {
    toggling.value = null
  }
}

onMounted(() => {
  if (!businesses.businesses.length) businesses.load()
})
</script>

<template>
  <div>
    <div class="flex items-center justify-between mb-6">
      <h1 class="text-xl md:text-2xl font-bold">Бизнесы</h1>
      <button
        v-if="isAdmin"
        @click="showCreateForm = true"
        class="flex items-center gap-2 px-4 py-2 rounded-lg bg-brand-600 hover:bg-brand-700 text-white text-sm font-medium"
      >
        <Plus :size="16" />
        Создать бизнес
      </button>
    </div>

    <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
      <div
        v-for="biz in (businesses.businesses as FullBusiness[])"
        :key="biz.id"
        @click="router.push('/businesses/' + biz.id)"
        :class="[
          'bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 p-5 cursor-pointer hover:border-brand-400 dark:hover:border-brand-600 hover:shadow-md transition-all group',
          !biz.isActive && 'opacity-50 grayscale',
        ]"
      >
        <div class="flex items-start justify-between mb-3">
          <div class="flex items-center gap-3">
            <div class="p-2 bg-brand-100 dark:bg-brand-900 rounded-lg">
              <Building2 :size="20" class="text-brand-600 dark:text-brand-400" />
            </div>
            <div>
              <h3 class="font-semibold group-hover:text-brand-600 dark:group-hover:text-brand-400 transition-colors">{{ biz.name }}</h3>
              <span class="text-xs text-gray-400">{{ biz.slug }}</span>
            </div>
          </div>
          <div class="flex items-center gap-2">
            <!-- Toggle (ADMIN only) -->
            <button
              v-if="isAdmin"
              @click.stop="toggleActive(biz)"
              :disabled="toggling === biz.id"
              :class="[
                'relative inline-flex h-5 w-9 shrink-0 rounded-full transition-colors focus:outline-none',
                biz.isActive ? 'bg-green-500' : 'bg-gray-300 dark:bg-gray-600',
              ]"
              :title="biz.isActive ? 'Выключить' : 'Включить'"
            >
              <span
                :class="[
                  'inline-block h-4 w-4 rounded-full bg-white shadow transform transition-transform mt-0.5',
                  biz.isActive ? 'translate-x-[18px]' : 'translate-x-0.5',
                ]"
              />
            </button>
            <ChevronRight :size="18" class="text-gray-300 group-hover:text-brand-500 transition-colors" />
          </div>
        </div>

        <!-- Platform badges -->
        <div v-if="biz.platformAccounts?.length" class="flex items-center gap-1 mb-3">
          <span
            v-for="pa in biz.platformAccounts"
            :key="pa.id"
            :class="['w-6 h-6 rounded text-[9px] font-bold text-white flex items-center justify-center', platformBgColor(pa.platform)]"
          >
            {{ platformLabel(pa.platform) }}
          </span>
        </div>

        <!-- Stats -->
        <div class="flex items-center gap-4 text-xs text-gray-400">
          <span class="flex items-center gap-1">
            <Film :size="12" />
            {{ biz._count?.posts || 0 }} историй
          </span>
          <span class="flex items-center gap-1">
            <ClipboardList :size="12" />
            {{ biz._count?.contentPlans || 0 }} планов
          </span>
        </div>
      </div>
    </div>

    <!-- Create business modal -->
    <Teleport to="body">
      <div v-if="showCreateForm" class="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" @click.self="showCreateForm = false">
        <div class="bg-white dark:bg-gray-900 rounded-2xl p-6 w-full max-w-md shadow-xl">
          <h2 class="text-lg font-bold mb-4">Создать бизнес</h2>
          <div class="space-y-3">
            <div>
              <label class="block text-sm font-medium mb-1">Название</label>
              <input
                v-model="createForm.name"
                placeholder="Kukin Brothers"
                class="w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 focus:ring-2 focus:ring-brand-500 text-sm"
              />
            </div>
            <div>
              <label class="block text-sm font-medium mb-1">Slug (латиница)</label>
              <input
                v-model="createForm.slug"
                placeholder="kukin-brothers"
                class="w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 focus:ring-2 focus:ring-brand-500 text-sm font-mono"
              />
            </div>
          </div>
          <div class="flex justify-end gap-2 mt-5">
            <button @click="showCreateForm = false" class="px-4 py-2 rounded-lg text-sm text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800">
              Отмена
            </button>
            <button
              @click="createBusiness"
              :disabled="creating || !createForm.name || !createForm.slug"
              class="flex items-center gap-2 px-4 py-2 rounded-lg bg-brand-600 hover:bg-brand-700 text-white text-sm font-medium disabled:opacity-50"
            >
              <Loader2 v-if="creating" :size="16" class="animate-spin" />
              <Plus v-else :size="16" />
              {{ creating ? 'Создание...' : 'Создать' }}
            </button>
          </div>
        </div>
      </div>
    </Teleport>
  </div>
</template>
