<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { http } from '@/api/client'
import { useBusinessesStore } from '@/stores/businesses'
import {
  ChevronDown, ChevronUp, Save, Loader2,
  Megaphone, Users, MessageSquare, Hash
} from 'lucide-vue-next'

const businesses = useBusinessesStore()
const expandedId = ref<string | null>(null)
const profileForms = ref<Record<string, any>>({})
const savingId = ref<string | null>(null)

function toggleExpand(bizId: string) {
  if (expandedId.value === bizId) {
    expandedId.value = null
  } else {
    expandedId.value = bizId
    const biz = businesses.businesses.find(b => b.id === bizId)
    if (biz) {
      profileForms.value[bizId] = {
        tone: biz.brandProfile?.tone || '',
        targetAudience: biz.brandProfile?.targetAudience || '',
        brandVoice: biz.brandProfile?.brandVoice || '',
        hashtags: (biz.brandProfile?.hashtags || []).join(', '),
        keyTopics: (biz.brandProfile?.keyTopics || []).join(', '),
        postsPerWeek: biz.brandProfile?.postsPerWeek || 3,
      }
    }
  }
}

async function saveProfile(bizId: string) {
  savingId.value = bizId
  try {
    const form = profileForms.value[bizId]
    await http.put(`/businesses/${bizId}/brand-profile`, {
      ...form,
      hashtags: form.hashtags.split(',').map((h: string) => h.trim()).filter(Boolean),
      keyTopics: form.keyTopics.split(',').map((t: string) => t.trim()).filter(Boolean),
    })
    await businesses.load()
  } catch (e: any) {
    alert('Ошибка: ' + (e.message || e))
  } finally {
    savingId.value = null
  }
}

onMounted(() => {
  if (!businesses.businesses.length) businesses.load()
})
</script>

<template>
  <div class="space-y-3">
    <p class="text-sm text-gray-500 mb-4">
      Бренд-профиль определяет тон и стиль AI-генерации для каждого бизнеса.
    </p>

    <div
      v-for="biz in businesses.businesses"
      :key="biz.id"
      class="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 overflow-hidden"
    >
      <div
        class="flex items-center justify-between p-5 cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-800/50 transition-colors"
        @click="toggleExpand(biz.id)"
      >
        <h3 class="font-semibold">{{ biz.name }}</h3>
        <ChevronUp v-if="expandedId === biz.id" :size="20" class="text-gray-400" />
        <ChevronDown v-else :size="20" class="text-gray-400" />
      </div>

      <div v-if="expandedId === biz.id && profileForms[biz.id]" class="p-5 pt-0 space-y-3">
        <div class="grid grid-cols-1 md:grid-cols-2 gap-3">
          <div>
            <label class="flex items-center gap-1.5 text-sm font-medium mb-1">
              <Megaphone :size="14" class="text-gray-400" /> Тон коммуникации
            </label>
            <input v-model="profileForms[biz.id].tone" placeholder="дружелюбный, профессиональный"
              class="w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 focus:ring-2 focus:ring-brand-500 text-sm" />
          </div>
          <div>
            <label class="flex items-center gap-1.5 text-sm font-medium mb-1">
              <Users :size="14" class="text-gray-400" /> Целевая аудитория
            </label>
            <input v-model="profileForms[biz.id].targetAudience" placeholder="молодые люди 20-35"
              class="w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 focus:ring-2 focus:ring-brand-500 text-sm" />
          </div>
        </div>

        <div>
          <label class="flex items-center gap-1.5 text-sm font-medium mb-1">
            <MessageSquare :size="14" class="text-gray-400" /> Стиль бренда
          </label>
          <textarea v-model="profileForms[biz.id].brandVoice" rows="2" placeholder="Живой, с юмором, без канцеляризмов..."
            class="w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 focus:ring-2 focus:ring-brand-500 text-sm" />
        </div>

        <div class="grid grid-cols-1 md:grid-cols-2 gap-3">
          <div>
            <label class="flex items-center gap-1.5 text-sm font-medium mb-1">
              <Hash :size="14" class="text-gray-400" /> Постоянные хештеги
            </label>
            <input v-model="profileForms[biz.id].hashtags" placeholder="SUP, Выборг, НаWоде"
              class="w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 focus:ring-2 focus:ring-brand-500 text-sm" />
          </div>
          <div>
            <label class="text-sm font-medium mb-1 block">Ключевые темы</label>
            <input v-model="profileForms[biz.id].keyTopics" placeholder="SUP туры, прокат досок"
              class="w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 focus:ring-2 focus:ring-brand-500 text-sm" />
          </div>
        </div>

        <div class="flex items-center justify-between pt-2">
          <div class="flex items-center gap-2">
            <label class="text-sm font-medium">Постов/неделю:</label>
            <input v-model.number="profileForms[biz.id].postsPerWeek" type="number" min="1" max="14"
              class="w-20 px-2 py-1.5 rounded border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 text-sm text-center" />
          </div>
          <button
            @click="saveProfile(biz.id)"
            :disabled="savingId === biz.id"
            class="flex items-center gap-2 px-4 py-2 rounded-lg bg-brand-600 hover:bg-brand-700 text-white text-sm font-medium disabled:opacity-50"
          >
            <Loader2 v-if="savingId === biz.id" :size="16" class="animate-spin" />
            <Save v-else :size="16" />
            Сохранить
          </button>
        </div>
      </div>
    </div>
  </div>
</template>
