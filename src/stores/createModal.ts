import { defineStore } from 'pinia'
import { ref } from 'vue'

/** Предзаполнение при создании контента (например, из идеи или дайджеста) */
export interface CreatePrefill {
  businessId?: string
  title?: string
  body?: string
  type?: string // PostType — если задан, можно сразу создать без выбора
}

/**
 * Единая точка входа создания контента.
 * Любой view/сайдбар вызывает open(); модалка смонтирована один раз в App.vue.
 */
export const useCreateModalStore = defineStore('createModal', () => {
  const isOpen = ref(false)
  const prefill = ref<CreatePrefill>({})

  function open(p: CreatePrefill = {}) {
    prefill.value = p
    isOpen.value = true
  }
  function close() {
    isOpen.value = false
    prefill.value = {}
  }

  return { isOpen, prefill, open, close }
})
