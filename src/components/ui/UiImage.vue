<script setup lang="ts">
import { ref, computed } from 'vue'
import { ImageOff } from 'lucide-vue-next'

interface Props {
  src?: string | null
  /** REQUIRED — enforced at the type level (no `?`), retrofits the ~38 <img> without alt in CF */
  alt: string
  /** CSS aspect-ratio, e.g. '1/1', '16/9', '4/3' */
  aspect?: string
  rounded?: boolean
}

const props = withDefaults(defineProps<Props>(), {
  rounded: true,
})

const failed = ref(false)
const hasSrc = computed(() => !!props.src && !failed.value)

function onError() {
  failed.value = true
}
</script>

<template>
  <div
    class="relative overflow-hidden bg-gray-100 dark:bg-gray-800"
    :class="rounded ? 'rounded-lg' : ''"
    :style="aspect ? { aspectRatio: aspect } : undefined"
  >
    <img
      v-if="hasSrc"
      :src="src!"
      :alt="alt"
      loading="lazy"
      class="h-full w-full object-cover"
      @error="onError"
    />
    <div v-else class="flex h-full min-h-[4rem] w-full items-center justify-center text-gray-300 dark:text-gray-600">
      <slot name="fallback">
        <ImageOff class="h-6 w-6" />
      </slot>
    </div>
  </div>
</template>
