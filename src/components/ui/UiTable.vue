<script setup lang="ts">
import { useBreakpoint } from '@/composables/useBreakpoint'
import UiSkeleton from './UiSkeleton.vue'
import UiEmptyState from './UiEmptyState.vue'
import type { TableColumn } from './types'

interface Props {
  columns: TableColumn[]
  rows: any[]
  loading?: boolean
  /** sr-only <caption> — describes the table for screen readers */
  caption?: string
  emptyTitle?: string
  emptyDescription?: string
  clickable?: boolean
  skeletonRows?: number
}

withDefaults(defineProps<Props>(), {
  loading: false,
  emptyTitle: 'Нет данных',
  emptyDescription: '',
  clickable: false,
  skeletonRows: 5,
})

defineEmits<{
  'row-click': [row: any, index: number]
}>()

const { isMobile } = useBreakpoint()

const alignClass: Record<string, string> = {
  left: 'text-left',
  center: 'text-center',
  right: 'text-right',
}
</script>

<template>
  <!-- Loading state -->
  <div v-if="loading" class="p-4">
    <UiSkeleton variant="table" :lines="skeletonRows" />
  </div>

  <!-- Empty state -->
  <UiEmptyState
    v-else-if="rows.length === 0"
    :title="emptyTitle"
    :description="emptyDescription"
  >
    <template v-if="$slots.empty" #action>
      <slot name="empty" />
    </template>
    <template #icon>
      <svg class="w-10 h-10" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.5">
        <path stroke-linecap="round" stroke-linejoin="round" d="M20 13V6a2 2 0 00-2-2H6a2 2 0 00-2 2v7m16 0v5a2 2 0 01-2 2H6a2 2 0 01-2-2v-5m16 0h-2.586a1 1 0 00-.707.293l-2.414 2.414a1 1 0 01-.707.293h-3.172a1 1 0 01-.707-.293l-2.414-2.414A1 1 0 006.586 13H4" />
      </svg>
    </template>
  </UiEmptyState>

  <!-- Mobile: Card layout -->
  <div v-else-if="isMobile" class="divide-y divide-gray-100 dark:divide-gray-700/60">
    <div
      v-for="(row, idx) in rows"
      :key="idx"
      class="p-4 space-y-2"
      :class="clickable ? 'active:bg-gray-50 dark:active:bg-gray-700/50 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-brand-500' : ''"
      :role="clickable ? 'button' : undefined"
      :tabindex="clickable ? 0 : undefined"
      @click="clickable && $emit('row-click', row, idx)"
      @keydown.enter="clickable && $emit('row-click', row, idx)"
    >
      <!-- Mobile row: render each column as label:value pair -->
      <template v-for="col in columns.filter(c => !c.srOnly)" :key="col.key">
        <div class="flex items-start justify-between gap-2">
          <span class="text-xs font-medium text-gray-500 dark:text-gray-400 shrink-0 min-w-[5rem]">{{ col.label }}</span>
          <span class="text-sm text-gray-900 dark:text-gray-100 text-right">
            <slot :name="`cell-${col.key}`" :row="row" :value="row[col.key]">
              {{ row[col.key] ?? '—' }}
            </slot>
          </span>
        </div>
      </template>
      <!-- Row actions slot (mobile) -->
      <div v-if="$slots['row-actions']" class="flex items-center gap-2 pt-2 border-t border-gray-100 dark:border-gray-700/60">
        <slot name="row-actions" :row="row" :index="idx" />
      </div>
    </div>
  </div>

  <!-- Desktop: Classic table -->
  <div v-else class="overflow-x-auto">
    <table class="w-full text-sm">
      <caption v-if="caption" class="sr-only">{{ caption }}</caption>
      <thead>
        <tr class="border-b border-gray-100 dark:border-gray-700/60">
          <th
            v-for="col in columns"
            :key="col.key"
            scope="col"
            class="px-4 py-3 text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider"
            :class="[alignClass[col.align || 'left'], col.srOnly ? 'sr-only' : '']"
          >
            {{ col.label }}
          </th>
        </tr>
      </thead>
      <tbody class="divide-y divide-gray-50 dark:divide-gray-700/40">
        <tr
          v-for="(row, idx) in rows"
          :key="idx"
          class="transition-colors duration-100 group"
          :class="clickable ? 'hover:bg-gray-50 dark:hover:bg-gray-700/30 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-brand-500' : ''"
          :tabindex="clickable ? 0 : undefined"
          @click="clickable && $emit('row-click', row, idx)"
          @keydown.enter="clickable && $emit('row-click', row, idx)"
        >
          <td
            v-for="col in columns"
            :key="col.key"
            class="px-4 py-3 text-gray-700 dark:text-gray-300"
            :class="alignClass[col.align || 'left']"
          >
            <slot :name="`cell-${col.key}`" :row="row" :value="row[col.key]">
              {{ row[col.key] ?? '—' }}
            </slot>
          </td>
        </tr>
      </tbody>
    </table>
  </div>
</template>
