<script setup lang="ts">
import { ref, onMounted, onUnmounted } from 'vue'

interface Props {
  align?: 'left' | 'right'
}

withDefaults(defineProps<Props>(), {
  align: 'right',
})

const open = ref(false)
const dropdownRef = ref<HTMLElement>()

function toggle() {
  open.value = !open.value
}
function close() {
  open.value = false
}

function onClickOutside(e: MouseEvent) {
  if (dropdownRef.value && !dropdownRef.value.contains(e.target as Node)) {
    close()
  }
}

function onKeydown(e: KeyboardEvent) {
  if (e.key === 'Escape' && open.value) {
    close()
  }
}

onMounted(() => {
  document.addEventListener('click', onClickOutside)
  document.addEventListener('keydown', onKeydown)
})
onUnmounted(() => {
  document.removeEventListener('click', onClickOutside)
  document.removeEventListener('keydown', onKeydown)
})

defineExpose({ close })
</script>

<template>
  <div ref="dropdownRef" class="relative inline-block">
    <div @click="toggle">
      <slot name="trigger" :open="open" />
    </div>
    <Transition name="fade">
      <div
        v-if="open"
        role="menu"
        class="absolute z-30 mt-1.5 w-48 rounded-xl bg-white dark:bg-gray-800 shadow-lg ring-1 ring-gray-200 dark:ring-gray-700 py-1 overflow-hidden"
        :class="align === 'right' ? 'right-0' : 'left-0'"
        @click="close"
      >
        <slot name="items" />
      </div>
    </Transition>
  </div>
</template>
