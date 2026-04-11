<script setup lang="ts">
import { useBusinessesStore } from '@/stores/businesses'

const businesses = useBusinessesStore()

const props = defineProps<{
  modelValue: string | null
}>()

const emit = defineEmits<{
  (e: 'update:modelValue', value: string): void
}>()

function select(id: string) {
  emit('update:modelValue', id)
  businesses.setCurrent(id)
}
</script>

<template>
  <div v-if="businesses.businesses.length > 1" class="mb-4 overflow-x-auto">
    <div class="flex items-center gap-1.5 flex-nowrap sm:flex-wrap">
      <button
        v-for="biz in businesses.businesses"
        :key="biz.id"
        @click="select(biz.id)"
        :class="[
          'px-3 py-1.5 rounded-full text-xs font-medium transition-colors whitespace-nowrap shrink-0',
          modelValue === biz.id
            ? 'bg-brand-600 text-white'
            : 'bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-gray-700',
        ]"
      >
        {{ biz.name }}
      </button>
    </div>
  </div>
</template>
