<script setup lang="ts">
import { UserCircle } from 'lucide-vue-next'

interface CharacterRef {
  id: string
  name: string
  type: string
  referenceMedia?: { url: string; thumbUrl: string | null } | null
}

defineProps<{
  characters: CharacterRef[]
  modelValue: string | null
}>()

const emit = defineEmits<{
  'update:modelValue': [value: string | null]
}>()
</script>

<template>
  <div class="px-4 py-2 border-b border-gray-100 dark:border-gray-800">
    <div class="flex gap-3 overflow-x-auto pb-1 scrollbar-hide">
      <!-- "None" option -->
      <button @click="emit('update:modelValue', null)"
        class="flex flex-col items-center gap-1 shrink-0 group">
        <div :class="[
          'w-11 h-11 rounded-full border-2 flex items-center justify-center transition-all',
          modelValue === null
            ? 'border-emerald-500 bg-emerald-50 dark:bg-emerald-900/30'
            : 'border-gray-200 dark:border-gray-700 group-hover:border-gray-300 dark:group-hover:border-gray-600'
        ]">
          <UserCircle :size="18" :class="modelValue === null ? 'text-emerald-500' : 'text-gray-400'" />
        </div>
        <span class="text-[9px] text-gray-400 truncate max-w-[48px]">Без</span>
      </button>

      <!-- Characters -->
      <button v-for="c in characters" :key="c.id"
        @click="emit('update:modelValue', c.id)"
        class="flex flex-col items-center gap-1 shrink-0 group">
        <div :class="[
          'w-11 h-11 rounded-full border-2 overflow-hidden transition-all',
          modelValue === c.id
            ? 'border-emerald-500 ring-2 ring-emerald-500/30'
            : 'border-gray-200 dark:border-gray-700 group-hover:border-gray-300 dark:group-hover:border-gray-600'
        ]">
          <img v-if="c.referenceMedia"
            :src="c.referenceMedia.thumbUrl || c.referenceMedia.url"
            :alt="c.name"
            class="w-full h-full object-cover" />
          <div v-else class="w-full h-full flex items-center justify-center bg-gray-100 dark:bg-gray-800">
            <UserCircle :size="18" class="text-gray-400" />
          </div>
        </div>
        <span class="text-[9px] text-gray-400 truncate max-w-[48px]">{{ c.name }}</span>
      </button>
    </div>
  </div>
</template>
