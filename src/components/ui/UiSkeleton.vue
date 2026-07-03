<script setup lang="ts">
// Uses Tailwind's built-in animate-pulse (no custom shimmer keyframes needed —
// avoids touching global style.css; donor used a custom .skeleton-shimmer class).
interface Props {
  variant?: 'line' | 'circle' | 'card' | 'table'
  lines?: number
  width?: string
  height?: string
}

withDefaults(defineProps<Props>(), {
  variant: 'line',
  lines: 3,
})

const base = 'animate-pulse bg-gray-200 dark:bg-gray-700'
</script>

<template>
  <!-- Single line -->
  <div v-if="variant === 'line'" :class="[base, 'rounded']" :style="{ width: width || '100%', height: height || '16px' }" />

  <!-- Circle (avatar) -->
  <div v-else-if="variant === 'circle'" :class="[base, 'rounded-full']" :style="{ width: width || '40px', height: height || '40px' }" />

  <!-- Card (metric card skeleton) -->
  <div v-else-if="variant === 'card'" class="rounded-xl border border-gray-200 dark:border-gray-700 p-5 space-y-3">
    <div :class="[base, 'rounded h-3 w-24']" />
    <div :class="[base, 'rounded h-8 w-20']" />
    <div :class="[base, 'rounded h-3 w-32']" />
  </div>

  <!-- Table rows -->
  <div v-else-if="variant === 'table'" class="space-y-3">
    <div v-for="i in lines" :key="i" class="flex items-center gap-4">
      <div :class="[base, 'rounded h-4 flex-1']" />
      <div :class="[base, 'rounded h-4 w-20']" />
      <div :class="[base, 'rounded h-4 w-16']" />
      <div :class="[base, 'rounded h-4 w-24']" />
    </div>
  </div>
</template>
