<script setup lang="ts">
import { ref, computed } from 'vue'
import { UserCircle, Plus } from 'lucide-vue-next'

export interface CharacterRef {
  id: string
  name: string
  type: string
  description?: string | null
  style?: string | null
  referenceMedia?: { url: string; thumbUrl: string | null } | null
  images?: Array<{ url: string; thumbUrl: string | null; isMain: boolean }> | null
}

const props = defineProps<{
  characters: CharacterRef[]
  modelValue: string | null
  colorScheme?: 'emerald' | 'fuchsia'
}>()

const emit = defineEmits<{
  'update:modelValue': [value: string | null]
  'createNew': []
}>()

const color = computed(() => props.colorScheme || 'emerald')

const hoveredId = ref<string | null>(null)
let hoverTimer: ReturnType<typeof setTimeout> | null = null

function onEnter(id: string) {
  hoverTimer = setTimeout(() => { hoveredId.value = id }, 400)
}
function onLeave() {
  if (hoverTimer) clearTimeout(hoverTimer)
  hoveredId.value = null
}

function getAvatar(c: CharacterRef) {
  // New: try images gallery first, then legacy referenceMedia
  const mainImage = c.images?.find(i => i.isMain)
  if (mainImage) return mainImage.thumbUrl || mainImage.url
  return c.referenceMedia?.thumbUrl || c.referenceMedia?.url || null
}

function getFullPhoto(c: CharacterRef) {
  const mainImage = c.images?.find(i => i.isMain)
  if (mainImage) return mainImage.url
  return c.referenceMedia?.url || null
}

const TYPE_LABELS: Record<string, string> = {
  person: 'Персона',
  mascot: 'Маскот',
  avatar: 'Аватар',
  object: 'Объект',
  location: 'Локация',
}
</script>

<template>
  <div class="px-4 py-2 border-b border-gray-100 dark:border-gray-800">
    <div class="flex gap-3 overflow-x-auto pb-1 scrollbar-hide">
      <!-- Create new -->
      <button @click="emit('createNew')"
        class="flex flex-col items-center gap-1 shrink-0 group">
        <div :class="[
          'w-11 h-11 rounded-full border-2 border-dashed flex items-center justify-center transition-all',
          color === 'fuchsia'
            ? 'border-gray-300 dark:border-gray-700 group-hover:border-fuchsia-400'
            : 'border-gray-300 dark:border-gray-700 group-hover:border-emerald-400'
        ]">
          <Plus :size="16" :class="[
            'transition-colors',
            color === 'fuchsia'
              ? 'text-gray-400 group-hover:text-fuchsia-500'
              : 'text-gray-400 group-hover:text-emerald-500'
          ]" />
        </div>
        <span class="text-[9px] text-gray-400">Создать</span>
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
              ? color === 'fuchsia'
                ? 'border-fuchsia-500 ring-2 ring-fuchsia-500/30'
                : 'border-emerald-500 ring-2 ring-emerald-500/30'
              : 'border-gray-200 dark:border-gray-700 group-hover:border-gray-300 dark:group-hover:border-gray-600'
          ]">
            <img v-if="getAvatar(c)"
              :src="getAvatar(c)!"
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
            <div class="absolute left-1/2 -translate-x-1/2 -bottom-1.5 w-3 h-3 bg-white dark:bg-gray-900 border-r border-b border-gray-200 dark:border-gray-700 rotate-45" />

            <!-- Photo -->
            <div v-if="getFullPhoto(c)" class="mb-2 rounded-lg overflow-hidden">
              <img :src="getFullPhoto(c)!" :alt="c.name"
                class="w-full h-28 object-cover" />
            </div>

            <!-- Image count badge -->
            <div v-if="c.images && c.images.length > 1" class="mb-1.5">
              <span class="text-[10px] px-1.5 py-0.5 rounded-full bg-gray-100 dark:bg-gray-800 text-gray-500">
                {{ c.images.length }} фото
              </span>
            </div>

            <!-- Info -->
            <div class="text-xs font-semibold mb-0.5">{{ c.name }}</div>
            <div v-if="c.type" :class="[
              'text-[10px] mb-1',
              color === 'fuchsia' ? 'text-fuchsia-600 dark:text-fuchsia-400' : 'text-emerald-600 dark:text-emerald-400'
            ]">
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
