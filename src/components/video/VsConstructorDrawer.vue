<script setup lang="ts">
import { PenTool, X } from 'lucide-vue-next'
import PromptConstructor from './PromptConstructor.vue'
import type { RefImage } from './PromptConstructor.vue'

defineProps<{
  visible: boolean
  modelValue: string
  referenceImages: RefImage[]
}>()

const emit = defineEmits<{
  'update:visible': [value: boolean]
  'update:modelValue': [value: string]
}>()
</script>

<template>
  <Teleport to="body">
    <!-- Backdrop -->
    <Transition name="drawer-backdrop">
      <div v-if="visible"
        class="fixed inset-0 z-40 bg-black/50"
        @click="emit('update:visible', false)" />
    </Transition>

    <!-- Drawer panel -->
    <Transition name="drawer-slide">
      <aside v-if="visible"
        class="fixed inset-y-0 right-0 z-50 w-full sm:w-96 lg:w-[420px] bg-white dark:bg-gray-900 shadow-2xl flex flex-col">
        <!-- Header -->
        <div class="h-14 flex items-center justify-between px-4 border-b border-gray-200 dark:border-gray-800 shrink-0">
          <h3 class="text-sm font-bold flex items-center gap-2">
            <PenTool :size="16" class="text-emerald-500" />
            Конструктор промпта
          </h3>
          <button @click="emit('update:visible', false)"
            class="p-1.5 rounded-lg text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors">
            <X :size="18" />
          </button>
        </div>

        <!-- Body -->
        <div class="flex-1 overflow-y-auto p-4">
          <PromptConstructor
            :model-value="modelValue"
            @update:model-value="emit('update:modelValue', $event)"
            :reference-images="referenceImages" />
        </div>
      </aside>
    </Transition>
  </Teleport>
</template>

<style scoped>
.drawer-backdrop-enter-active,
.drawer-backdrop-leave-active { transition: opacity 0.25s ease; }
.drawer-backdrop-enter-from,
.drawer-backdrop-leave-to { opacity: 0; }

.drawer-slide-enter-active,
.drawer-slide-leave-active { transition: transform 0.25s ease; }
.drawer-slide-enter-from,
.drawer-slide-leave-to { transform: translateX(100%); }
</style>
