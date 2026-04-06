import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import { http } from '@/api/client'

export interface Business {
  id: string
  slug: string
  name: string
  description?: string
  isActive: boolean
  erpType?: string
  brandProfile?: BrandProfile
  platformAccounts?: PlatformAccount[]
  _count?: { posts: number; contentPlans: number }
}

export interface BrandProfile {
  id: string
  tone: string
  targetAudience: string
  brandVoice: string
  hashtags: string[]
  keyTopics: string[]
  doNotMention: string[]
  postsPerWeek: number
}

export interface PlatformAccount {
  id: string
  platform: 'VK' | 'TELEGRAM' | 'INSTAGRAM'
  accountName: string
  accountId: string
  isActive: boolean
}

export const useBusinessesStore = defineStore('businesses', () => {
  const businesses = ref<Business[]>([])
  const currentBusinessId = ref<string | null>(
    localStorage.getItem('cf_currentBusiness') || null
  )

  const currentBusiness = computed(() =>
    businesses.value.find((b) => b.id === currentBusinessId.value) || businesses.value[0] || null
  )

  async function load() {
    businesses.value = await http.get<Business[]>('/businesses')
    // Если текущий бизнес не найден, выбрать первый
    if (currentBusinessId.value && !businesses.value.find((b) => b.id === currentBusinessId.value)) {
      currentBusinessId.value = businesses.value[0]?.id || null
    }
  }

  function setCurrent(id: string) {
    currentBusinessId.value = id
    localStorage.setItem('cf_currentBusiness', id)
  }

  return { businesses, currentBusinessId, currentBusiness, load, setCurrent }
})
