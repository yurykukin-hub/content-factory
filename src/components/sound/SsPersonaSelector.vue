<script setup lang="ts">
/**
 * Persona selector dropdown + "Create from track" flow.
 * Shows active personas, allows selecting one for generation.
 */
import { ref, onMounted, useTemplateRef } from 'vue'
import { ChevronDown, UserCircle, Plus, X } from 'lucide-vue-next'
import { http } from '@/api/client'

interface Persona {
  id: string
  name: string
  description: string
  gender: string | null
  sunoPersonaId: string | null
  isActive: boolean
}

const props = defineProps<{
  modelValue: string | null  // selected persona DB id
  disabled?: boolean
}>()

const emit = defineEmits<{
  'update:modelValue': [value: string | null]
  createFromTrack: []
}>()

const personas = ref<Persona[]>([])
const open = ref(false)
const loading = ref(false)
const triggerRef = ref<HTMLElement | null>(null)
const dropdownStyle = ref<Record<string, string>>({})

function updateDropdownPosition() {
  if (!triggerRef.value) return
  const rect = triggerRef.value.getBoundingClientRect()
  const spaceBelow = window.innerHeight - rect.bottom
  const openUp = spaceBelow < 250
  dropdownStyle.value = {
    position: 'fixed',
    left: `${rect.left}px`,
    width: '16rem',
    zIndex: '50',
    ...(openUp
      ? { bottom: `${window.innerHeight - rect.top + 4}px` }
      : { top: `${rect.bottom + 4}px` }),
  }
}

async function loadPersonas() {
  loading.value = true
  try {
    personas.value = await http.get<Persona[]>('/music/personas')
  } catch {}
  loading.value = false
}

onMounted(loadPersonas)

function select(id: string | null) {
  emit('update:modelValue', id)
  open.value = false
}

const selectedName = computed(() => {
  if (!props.modelValue) return null
  return personas.value.find(p => p.id === props.modelValue)?.name || 'Персона'
})

import { computed } from 'vue'
</script>

<template>
  <div class="relative" ref="triggerRef">
    <!-- Trigger -->
    <button @click="open = !open; if (!open) {} else updateDropdownPosition()" :disabled="disabled"
      :class="[
        'flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium border transition-colors',
        modelValue
          ? 'border-fuchsia-300 bg-fuchsia-50 dark:bg-fuchsia-900/20 text-fuchsia-600'
          : 'border-gray-200 dark:border-gray-700 text-gray-500 hover:border-fuchsia-300'
      ]">
      <UserCircle :size="13" />
      <span>{{ selectedName || 'Персона' }}</span>
      <ChevronDown :size="11" :class="['transition-transform', open ? 'rotate-180' : '']" />
      <!-- Clear button -->
      <button v-if="modelValue" @click.stop="select(null)"
        class="ml-1 p-0.5 rounded-full hover:bg-fuchsia-200 dark:hover:bg-fuchsia-800">
        <X :size="10" />
      </button>
    </button>

    <!-- Teleported dropdown (avoids overflow:hidden clipping) -->
    <Teleport to="body">
    <div v-if="open" class="fixed inset-0 z-40" @click="open = false" />
    <div v-if="open"
      :style="dropdownStyle"
      class="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-xl shadow-xl py-1 max-h-[50vh] overflow-y-auto">

      <!-- No persona option -->
      <button @click="select(null)"
        :class="['w-full text-left px-3 py-2 text-xs hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors',
          !modelValue ? 'text-fuchsia-600 font-medium' : 'text-gray-600 dark:text-gray-400']">
        Без персоны (стандартный голос)
      </button>

      <div v-if="personas.length" class="my-1 mx-3 border-t border-gray-100 dark:border-gray-800" />

      <!-- Persona list -->
      <button v-for="p in personas" :key="p.id"
        @click="select(p.id)"
        :class="['w-full text-left px-3 py-2 hover:bg-fuchsia-50 dark:hover:bg-fuchsia-900/20 transition-colors',
          modelValue === p.id ? 'bg-fuchsia-50 dark:bg-fuchsia-900/20' : '']">
        <div class="flex items-center gap-2">
          <UserCircle :size="14" :class="modelValue === p.id ? 'text-fuchsia-500' : 'text-gray-400'" />
          <div class="min-w-0">
            <div class="text-xs font-medium" :class="modelValue === p.id ? 'text-fuchsia-600' : 'text-gray-700 dark:text-gray-300'">
              {{ p.name }}
            </div>
            <div class="text-[9px] text-gray-400 truncate">
              {{ p.gender === 'f' ? 'Жен' : p.gender === 'm' ? 'Муж' : '' }}
              {{ p.description ? ' · ' + p.description.slice(0, 40) : '' }}
              {{ p.sunoPersonaId ? '' : ' · (нет voice ID)' }}
            </div>
          </div>
        </div>
      </button>

      <div class="my-1 mx-3 border-t border-gray-100 dark:border-gray-800" />

      <!-- Create from track -->
      <button @click="emit('createFromTrack'); open = false"
        class="w-full flex items-center gap-2 px-3 py-2 text-xs text-fuchsia-600 hover:bg-fuchsia-50 dark:hover:bg-fuchsia-900/20 transition-colors">
        <Plus :size="13" />
        Создать из трека (Voice Clone)
      </button>

      <div v-if="!personas.length && !loading" class="px-3 py-2 text-[10px] text-gray-400 text-center">
        Нет персон. Создайте из готового трека.
      </div>
    </div>
    </Teleport>
  </div>
</template>
