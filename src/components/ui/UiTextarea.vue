<script setup lang="ts">
import { computed, useId, ref, nextTick } from 'vue'

interface Props {
  modelValue?: string
  label?: string
  placeholder?: string
  rows?: number
  error?: string
  hint?: string
  disabled?: boolean
  maxLength?: number
  /** Auto-grow height to fit content */
  autosize?: boolean
}

const props = withDefaults(defineProps<Props>(), {
  modelValue: '',
  rows: 4,
  placeholder: '',
  disabled: false,
  autosize: false,
})

const emit = defineEmits<{
  'update:modelValue': [value: string]
}>()

const uid = useId()
const textareaId = `ui-textarea-${uid}`
const errorId = `ui-textarea-error-${uid}`
const hintId = `ui-textarea-hint-${uid}`

const charCount = computed(() => props.modelValue?.length ?? 0)
const showCounter = computed(() => !!props.maxLength)
const describedBy = computed(() => {
  if (props.error) return errorId
  if (props.hint) return hintId
  return undefined
})

const textareaRef = ref<HTMLTextAreaElement | null>(null)

function resize() {
  if (!props.autosize || !textareaRef.value) return
  textareaRef.value.style.height = 'auto'
  textareaRef.value.style.height = `${textareaRef.value.scrollHeight}px`
}

function onInput(e: Event) {
  emit('update:modelValue', (e.target as HTMLTextAreaElement).value)
  if (props.autosize) nextTick(resize)
}
</script>

<template>
  <div>
    <div v-if="label || showCounter" class="flex items-center justify-between mb-1">
      <label v-if="label" :for="textareaId" class="block text-sm font-medium text-gray-700 dark:text-gray-300">{{ label }}</label>
      <span v-if="showCounter" class="text-xs text-gray-400 dark:text-gray-500 tabular-nums">
        {{ charCount }}<span v-if="maxLength"> / {{ maxLength }}</span>
      </span>
    </div>
    <textarea
      :id="textareaId"
      ref="textareaRef"
      :value="modelValue"
      :rows="rows"
      :placeholder="placeholder"
      :disabled="disabled"
      :maxlength="maxLength"
      :aria-invalid="!!error || undefined"
      :aria-describedby="describedBy"
      class="block w-full rounded-lg border px-3 py-2 text-sm transition-colors duration-150 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 placeholder-gray-400 dark:placeholder-gray-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/40 focus-visible:border-brand-500 disabled:opacity-50 disabled:cursor-not-allowed"
      :class="[error ? 'border-danger-300 dark:border-danger-500/50' : 'border-gray-300 dark:border-gray-600', autosize ? 'resize-none overflow-hidden' : 'resize-y']"
      @input="onInput"
    />
    <p v-if="error" :id="errorId" class="mt-1 text-xs text-danger-600 dark:text-danger-400">{{ error }}</p>
    <p v-else-if="hint" :id="hintId" class="mt-1 text-xs text-gray-400 dark:text-gray-500">{{ hint }}</p>
  </div>
</template>
