<script setup lang="ts">
import { ref, onMounted, onBeforeUnmount, useId } from 'vue'

interface Props {
  text?: string
  position?: 'top' | 'bottom' | 'left' | 'right'
  /** ms before showing on hover/focus */
  delay?: number
  disabled?: boolean
}

const props = withDefaults(defineProps<Props>(), {
  position: 'top',
  delay: 400,
  disabled: false,
})

const tooltipId = `ui-tooltip-${useId()}`
const visible = ref(false)
const wrapperRef = ref<HTMLElement | null>(null)
let showTimer: ReturnType<typeof setTimeout> | null = null

function show() {
  if (props.disabled || !props.text) return
  showTimer = setTimeout(() => {
    visible.value = true
  }, props.delay)
}

function hide() {
  if (showTimer) {
    clearTimeout(showTimer)
    showTimer = null
  }
  visible.value = false
}

onMounted(() => {
  // Wire aria-describedby onto the actual trigger element (first child of the slot)
  // so screen readers announce the tooltip text when the trigger receives focus.
  const el = wrapperRef.value?.firstElementChild as HTMLElement | null
  el?.setAttribute('aria-describedby', tooltipId)
})

onBeforeUnmount(() => {
  if (showTimer) clearTimeout(showTimer)
})

const positionClasses: Record<string, string> = {
  top: 'bottom-full left-1/2 -translate-x-1/2 mb-2',
  bottom: 'top-full left-1/2 -translate-x-1/2 mt-2',
  left: 'right-full top-1/2 -translate-y-1/2 mr-2',
  right: 'left-full top-1/2 -translate-y-1/2 ml-2',
}
</script>

<template>
  <span
    ref="wrapperRef"
    class="relative inline-flex"
    @mouseenter="show"
    @mouseleave="hide"
    @focusin="show"
    @focusout="hide"
  >
    <slot />
    <Transition name="fade">
      <span
        v-if="visible && text"
        :id="tooltipId"
        role="tooltip"
        class="pointer-events-none absolute z-40 whitespace-nowrap rounded-md bg-gray-900 dark:bg-gray-700 px-2 py-1 text-xs font-medium text-white shadow-lg"
        :class="positionClasses[position]"
      >
        {{ text }}
      </span>
    </Transition>
  </span>
</template>
