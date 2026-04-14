<script setup lang="ts">
import { ref } from 'vue'
import { UserCircle } from 'lucide-vue-next'

interface CharacterRef {
  id: string
  name: string
  type: string
  description?: string | null
  style?: string | null
  referenceMedia?: { url: string; thumbUrl: string | null } | null
}

defineProps<{
  characters: CharacterRef[]
  modelValue: string | null
}>()

const emit = defineEmits<{
  'update:modelValue': [value: string | null]
}>()

const hoveredId = ref<string | null>(null)
let hoverTimer: ReturnType<typeof setTimeout> | null = null

function onEnter(id: string) {
  hoverTimer = setTimeout(() => { hoveredId.value = id }, 400)
}
function onLeave() {
  if (hoverTimer) clearTimeout(hoverTimer)
  hoveredId.value = null
}

const TYPE_LABELS: Record<string, string> = {
  person: 'Персона',
  mascot: 'Маскот',
  avatar: 'Аватар',
}
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
      <div v-for="c in characters" :key="c.id" class="relative shrink-0">
        <button
          @click="emit('update:modelValue', c.id)"
          @mouseenter="onEnter(c.id)"
          @mouseleave="onLeave"
          class="flex flex-col items-center gap-1 group">
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

        <!-- Hover popup -->
        <Transition name="popup">
          <div v-if="hoveredId === c.id"
            class="absolute left-1/2 -translate-x-1/2 bottom-full mb-2 z-30 w-56 bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-xl shadow-xl p-3 pointer-events-none">
            <!-- Arrow -->
            <div class="absolute left-1/2 -translate-x-1/2 -bottom-1.5 w-3 h-3 bg-white dark:bg-gray-900 border-r border-b border-gray-200 dark:border-gray-700 rotate-45" />

            <!-- Photo -->
            <div v-if="c.referenceMedia" class="mb-2 rounded-lg overflow-hidden">
              <img :src="c.referenceMedia.url" :alt="c.name"
                class="w-full h-28 object-cover" />
            </div>

            <!-- Info -->
            <div class="text-xs font-semibold mb-0.5">{{ c.name }}</div>
            <div v-if="c.type" class="text-[10px] text-emerald-600 dark:text-emerald-400 mb-1">
              {{ TYPE_LABELS[c.type] || c.type }}
              <span v-if="c.style" class="text-gray-400"> · {{ c.style }}</span>
            </div>
            <p v-if="c.description" class="text-[10px] text-gray-500 dark:text-gray-400 line-clamp-3 leading-relaxed">
              {{ c.description }}
            </p>
          </div>
        </Transition>
      </div>
    </div>
  </div>
</template>

<style scoped>
.popup-enter-active { transition: opacity 0.15s ease, transform 0.15s ease; }
.popup-leave-active { transition: opacity 0.1s ease; }
.popup-enter-from { opacity: 0; transform: translateX(-50%) translateY(4px); }
.popup-leave-to { opacity: 0; }
</style>
