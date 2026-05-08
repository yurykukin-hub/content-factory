<script setup lang="ts">
import { ref } from 'vue'
import { useBusinessesStore } from '@/stores/businesses'
import { ChevronDown } from 'lucide-vue-next'

const businesses = useBusinessesStore()
const open = ref(false)

function select(id: string) {
  businesses.setCurrent(id)
  open.value = false
}
</script>

<template>
  <div v-if="businesses.businesses.length > 1" class="relative">
    <button
      @click="open = !open"
      class="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-gray-200 dark:border-gray-700 hover:border-gray-300 dark:hover:border-gray-600 text-sm font-medium transition-colors bg-white dark:bg-gray-800"
    >
      <span class="truncate max-w-[120px] sm:max-w-[180px] text-gray-700 dark:text-gray-200">
        {{ businesses.currentBusiness?.name || 'Проект' }}
      </span>
      <ChevronDown :size="14" class="text-gray-400 shrink-0 transition-transform" :class="open && 'rotate-180'" />
    </button>

    <!-- Backdrop -->
    <div v-if="open" class="fixed inset-0 z-30" @click="open = false" />

    <!-- Dropdown -->
    <div v-if="open" class="absolute top-full left-0 mt-1 min-w-[200px] max-w-[280px] bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl shadow-lg z-40 py-1">
      <button
        v-for="biz in businesses.businesses"
        :key="biz.id"
        @click="select(biz.id)"
        class="w-full text-left px-3 py-2 text-sm transition-colors truncate"
        :class="biz.id === businesses.currentBusinessId
          ? 'text-brand-600 dark:text-brand-400 font-medium bg-brand-50 dark:bg-brand-900/20'
          : 'text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700'"
      >
        {{ biz.name }}
      </button>
    </div>
  </div>
</template>
