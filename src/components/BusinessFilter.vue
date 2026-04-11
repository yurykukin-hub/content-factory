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
  <div v-if="businesses.businesses.length > 1" class="mb-4">
    <!-- Desktop: pill buttons -->
    <div class="hidden sm:flex items-center gap-1.5 flex-wrap">
      <button
        v-for="biz in businesses.businesses"
        :key="biz.id"
        @click="select(biz.id)"
        :class="[
          'px-3 py-1.5 rounded-full text-xs font-medium transition-colors',
          modelValue === biz.id
            ? 'bg-brand-600 text-white'
            : 'bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-gray-700',
        ]"
      >
        {{ biz.name }}
      </button>
    </div>

    <!-- Mobile: select dropdown -->
    <select
      :value="modelValue"
      @change="select(($event.target as HTMLSelectElement).value)"
      class="sm:hidden w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 text-sm focus:ring-2 focus:ring-brand-500"
    >
      <option v-for="biz in businesses.businesses" :key="biz.id" :value="biz.id">
        {{ biz.name }}
      </option>
    </select>
  </div>
</template>
