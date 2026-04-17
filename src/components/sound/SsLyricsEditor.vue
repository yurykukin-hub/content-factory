<script setup lang="ts">
/**
 * Lyrics editor with section markers and syntax highlighting overlay.
 * Buttons insert [Verse], [Chorus], etc. at cursor position.
 */
import { ref, computed } from 'vue'

const props = defineProps<{
  modelValue: string
  disabled?: boolean
}>()

const emit = defineEmits<{
  'update:modelValue': [value: string]
}>()

const textareaRef = ref<HTMLTextAreaElement | null>(null)

const SECTIONS = [
  { marker: '[Intro]', label: 'Intro', color: 'text-blue-500' },
  { marker: '[Verse]', label: 'Verse', color: 'text-emerald-500' },
  { marker: '[Pre-Chorus]', label: 'Pre-Ch', color: 'text-amber-500' },
  { marker: '[Chorus]', label: 'Chorus', color: 'text-fuchsia-500' },
  { marker: '[Bridge]', label: 'Bridge', color: 'text-purple-500' },
  { marker: '[Hook]', label: 'Hook', color: 'text-orange-500' },
  { marker: '[Outro]', label: 'Outro', color: 'text-cyan-500' },
]

function insertMarker(marker: string) {
  const ta = textareaRef.value
  if (!ta) return

  const start = ta.selectionStart
  const before = props.modelValue.slice(0, start)
  const after = props.modelValue.slice(start)

  // Insert marker on a new line
  const prefix = before.length > 0 && !before.endsWith('\n') ? '\n' : ''
  const newText = `${before}${prefix}${marker}\n${after}`
  emit('update:modelValue', newText)

  // Set cursor after marker
  const newPos = start + prefix.length + marker.length + 1
  requestAnimationFrame(() => {
    ta.focus()
    ta.setSelectionRange(newPos, newPos)
  })
}

const charCount = computed(() => props.modelValue.length)
const lineCount = computed(() => props.modelValue.split('\n').filter(l => l.trim()).length)

// Detect sections in text
const detectedSections = computed(() => {
  const found: string[] = []
  for (const s of SECTIONS) {
    if (props.modelValue.includes(s.marker)) found.push(s.label)
  }
  return found
})
</script>

<template>
  <div class="flex flex-col gap-2">
    <!-- Section marker buttons -->
    <div class="flex flex-wrap gap-1">
      <button v-for="s in SECTIONS" :key="s.marker"
        @click="insertMarker(s.marker)"
        :disabled="disabled"
        :class="[
          'px-2 py-0.5 rounded-full text-[10px] font-medium border transition-colors',
          modelValue.includes(s.marker)
            ? `bg-fuchsia-50 dark:bg-fuchsia-900/20 border-fuchsia-300 ${s.color}`
            : 'border-gray-200 dark:border-gray-700 text-gray-500 hover:border-fuchsia-300 hover:text-fuchsia-500'
        ]">
        {{ s.label }}
      </button>
    </div>

    <!-- Textarea -->
    <div class="relative">
      <textarea
        ref="textareaRef"
        :value="modelValue"
        @input="emit('update:modelValue', ($event.target as HTMLTextAreaElement).value)"
        :disabled="disabled"
        placeholder="[Verse]&#10;Walking through the rain&#10;Memories remain...&#10;&#10;[Chorus]&#10;Summer rain falls down..."
        class="w-full min-h-[200px] max-h-[400px] px-3 py-2 rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 text-sm font-mono leading-relaxed placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-fuchsia-500/40 resize-y disabled:opacity-50"
      />
    </div>

    <!-- Info row -->
    <div class="flex items-center justify-between text-[10px] text-gray-400">
      <div class="flex gap-2">
        <span>{{ lineCount }} строк</span>
        <span>{{ charCount }} символов</span>
      </div>
      <div v-if="detectedSections.length" class="flex gap-1">
        <span v-for="s in detectedSections" :key="s"
          class="px-1.5 py-0.5 rounded bg-fuchsia-50 dark:bg-fuchsia-900/20 text-fuchsia-500 text-[9px]">
          {{ s }}
        </span>
      </div>
    </div>
  </div>
</template>
