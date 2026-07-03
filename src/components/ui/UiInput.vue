<script setup lang="ts">
import { useId, computed } from 'vue'

interface Props {
  modelValue?: string | number
  label?: string
  type?: string
  placeholder?: string
  error?: string
  hint?: string
  disabled?: boolean
  required?: boolean
}

const props = withDefaults(defineProps<Props>(), {
  modelValue: '',
  type: 'text',
  placeholder: '',
  disabled: false,
  required: false,
})

defineEmits<{
  'update:modelValue': [value: string | number]
}>()

const uid = useId()
const inputId = `ui-input-${uid}`
const errorId = `ui-input-error-${uid}`
const hintId = `ui-input-hint-${uid}`

const describedBy = computed(() => {
  if (props.error) return errorId
  if (props.hint) return hintId
  return undefined
})
</script>

<template>
  <div>
    <label v-if="label" :for="inputId" class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
      {{ label }}
      <span v-if="required" class="text-danger-500 ml-0.5">*</span>
    </label>
    <div class="relative">
      <div v-if="$slots.prefix" class="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-gray-400 dark:text-gray-500">
        <slot name="prefix" />
      </div>
      <input
        :id="inputId"
        :value="modelValue"
        :type="type"
        :placeholder="placeholder"
        :disabled="disabled"
        :required="required"
        :aria-invalid="!!error || undefined"
        :aria-describedby="describedBy"
        class="block w-full rounded-lg border px-3 py-2 text-sm transition-colors duration-150 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 placeholder-gray-400 dark:placeholder-gray-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/40 focus-visible:border-brand-500 disabled:opacity-50 disabled:cursor-not-allowed"
        :class="[
          error
            ? 'border-danger-300 dark:border-danger-500/50'
            : 'border-gray-300 dark:border-gray-600',
          $slots.prefix ? 'pl-10' : '',
          $slots.suffix ? 'pr-10' : '',
        ]"
        @input="$emit('update:modelValue', ($event.target as HTMLInputElement).value)"
      />
      <div v-if="$slots.suffix" class="absolute inset-y-0 right-0 pr-3 flex items-center text-gray-400 dark:text-gray-500">
        <slot name="suffix" />
      </div>
    </div>
    <p v-if="error" :id="errorId" class="mt-1 text-xs text-danger-600 dark:text-danger-400">{{ error }}</p>
    <p v-else-if="hint" :id="hintId" class="mt-1 text-xs text-gray-400 dark:text-gray-500">{{ hint }}</p>
  </div>
</template>
