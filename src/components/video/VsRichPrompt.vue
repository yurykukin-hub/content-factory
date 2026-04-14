<script setup lang="ts">
import { ref, watch, nextTick, onMounted } from 'vue'

export interface BadgeData {
  badgeType: 'character' | 'image'
  id: string
  name: string
  thumbUrl: string | null
}

const props = defineProps<{
  modelValue: string
  placeholder?: string
}>()

const emit = defineEmits<{
  'update:modelValue': [value: string]
}>()

const editorRef = ref<HTMLDivElement | null>(null)
const isFocused = ref(false)
const isEmpty = ref(true)
let isInternalUpdate = false

// --- Badge HTML helpers ---

function badgeHtml(badge: BadgeData): string {
  const avatar = badge.thumbUrl
    ? `<img src="${badge.thumbUrl}" class="badge-avatar" />`
    : ''
  return `<span class="badge-chip" contenteditable="false" draggable="true" data-badge-id="${badge.id}" data-badge-type="${badge.badgeType}" data-badge-name="${badge.name}" data-badge-thumb="${badge.thumbUrl || ''}">${avatar}@${badge.name}</span>`
}

// --- Parse DOM → plain text ---

function extractText(el: HTMLElement): string {
  let text = ''
  for (const node of Array.from(el.childNodes)) {
    if (node.nodeType === Node.TEXT_NODE) {
      text += node.textContent || ''
    } else if (node.nodeType === Node.ELEMENT_NODE) {
      const element = node as HTMLElement
      if (element.classList?.contains('badge-chip')) {
        const name = element.dataset.badgeName || ''
        text += `@${name}`
      } else if (element.tagName === 'BR') {
        text += '\n'
      } else if (element.tagName === 'DIV' || element.tagName === 'P') {
        if (text && !text.endsWith('\n')) text += '\n'
        text += extractText(element)
      } else {
        text += extractText(element)
      }
    }
  }
  return text
}

// --- Event handlers ---

function onInput() {
  if (!editorRef.value) return
  const text = extractText(editorRef.value)
  isEmpty.value = !text.trim()
  isInternalUpdate = true
  emit('update:modelValue', text)
  nextTick(() => { isInternalUpdate = false })
}

function onPaste(e: ClipboardEvent) {
  e.preventDefault()
  const text = e.clipboardData?.getData('text/plain') || ''
  document.execCommand('insertText', false, text)
}

function onKeydown(e: KeyboardEvent) {
  // On backspace, check if we're adjacent to a badge to delete it
  if (e.key === 'Backspace') {
    const sel = window.getSelection()
    if (!sel || !sel.rangeCount) return
    const range = sel.getRangeAt(0)
    if (range.collapsed && range.startOffset === 0 && range.startContainer.nodeType === Node.TEXT_NODE) {
      const prev = range.startContainer.previousSibling as HTMLElement | null
      if (prev?.classList?.contains('badge-chip')) {
        e.preventDefault()
        prev.remove()
        onInput()
      }
    }
  }
}

// --- Drag and Drop ---

let draggedBadge: HTMLElement | null = null

function onDragStart(e: DragEvent) {
  const target = (e.target as HTMLElement).closest('.badge-chip') as HTMLElement | null
  if (!target) return
  draggedBadge = target
  e.dataTransfer?.setData('text/plain', target.dataset.badgeName || '')
  target.style.opacity = '0.4'
}

function onDragEnd(e: DragEvent) {
  const target = (e.target as HTMLElement).closest('.badge-chip') as HTMLElement | null
  if (target) target.style.opacity = '1'
  draggedBadge = null
}

function onDragOver(e: DragEvent) {
  e.preventDefault()
}

function onDrop(e: DragEvent) {
  e.preventDefault()
  if (!draggedBadge || !editorRef.value) return

  // Get drop position
  let range: Range | null = null
  if (document.caretRangeFromPoint) {
    range = document.caretRangeFromPoint(e.clientX, e.clientY)
  }

  // Remove badge from old position
  const clone = draggedBadge.cloneNode(true) as HTMLElement
  draggedBadge.remove()

  // Insert at new position
  if (range) {
    range.insertNode(clone)
    // Move cursor after badge
    const newRange = document.createRange()
    newRange.setStartAfter(clone)
    newRange.collapse(true)
    const sel = window.getSelection()
    sel?.removeAllRanges()
    sel?.addRange(newRange)
  } else {
    editorRef.value.appendChild(clone)
  }

  clone.style.opacity = '1'
  draggedBadge = null
  onInput()
}

// --- Insert badge (exposed to parent) ---

function insertBadge(badge: BadgeData) {
  if (!editorRef.value) return

  const html = badgeHtml(badge)
  const temp = document.createElement('div')
  temp.innerHTML = html
  const badgeNode = temp.firstChild as HTMLElement

  const sel = window.getSelection()
  // If editor is focused and has selection, insert at cursor
  if (isFocused.value && sel && sel.rangeCount > 0) {
    const range = sel.getRangeAt(0)
    // Check cursor is inside editor
    if (editorRef.value.contains(range.commonAncestorContainer)) {
      range.deleteContents()
      range.insertNode(badgeNode)
      // Move cursor after badge
      const newRange = document.createRange()
      newRange.setStartAfter(badgeNode)
      newRange.collapse(true)
      sel.removeAllRanges()
      sel.addRange(newRange)
      onInput()
      return
    }
  }

  // Fallback: append at end
  editorRef.value.appendChild(badgeNode)
  // Add space after for easier typing
  const space = document.createTextNode(' ')
  editorRef.value.appendChild(space)
  onInput()
}

// --- Set content from parent modelValue (initial + external changes) ---

function setContent(text: string) {
  if (!editorRef.value || isInternalUpdate) return
  // Only set if different from current
  const current = extractText(editorRef.value)
  if (current === text) return

  // Preserve badges if just text around them changed
  editorRef.value.textContent = text
  isEmpty.value = !text.trim()
}

watch(() => props.modelValue, (val) => {
  setContent(val)
})

onMounted(() => {
  if (props.modelValue) {
    setContent(props.modelValue)
  }
})

defineExpose({ insertBadge })
</script>

<template>
  <div class="relative">
    <div
      ref="editorRef"
      contenteditable="true"
      :class="[
        'rich-prompt w-full min-h-[120px] max-h-[240px] overflow-y-auto px-4 py-3 rounded-xl border text-sm outline-none transition-colors',
        isFocused
          ? 'border-emerald-500 ring-2 ring-emerald-500/20 bg-gray-50 dark:bg-gray-800'
          : 'border-gray-300 dark:border-gray-700 bg-gray-50 dark:bg-gray-800'
      ]"
      @input="onInput"
      @paste="onPaste"
      @keydown="onKeydown"
      @focus="isFocused = true"
      @blur="isFocused = false"
      @dragstart="onDragStart"
      @dragend="onDragEnd"
      @dragover="onDragOver"
      @drop="onDrop"
    />
    <!-- Placeholder -->
    <div v-if="isEmpty && !isFocused"
      class="absolute top-3 left-4 text-sm text-gray-400 pointer-events-none select-none">
      {{ placeholder || 'Опишите видео: объект, действие, камера, освещение, настроение...' }}
    </div>
  </div>
</template>

<style scoped>
.rich-prompt {
  white-space: pre-wrap;
  word-break: break-word;
  line-height: 1.6;
}

.rich-prompt:deep(.badge-chip) {
  display: inline-flex;
  align-items: center;
  gap: 3px;
  padding: 1px 8px 1px 4px;
  margin: 0 2px;
  border-radius: 9999px;
  background: rgb(16 185 129 / 0.15);
  border: 1px solid rgb(16 185 129 / 0.3);
  color: rgb(5 150 105);
  font-size: 12px;
  font-weight: 600;
  cursor: grab;
  user-select: none;
  vertical-align: middle;
  line-height: 1.4;
}

.dark .rich-prompt:deep(.badge-chip) {
  background: rgb(16 185 129 / 0.2);
  border-color: rgb(16 185 129 / 0.4);
  color: rgb(52 211 153);
}

.rich-prompt:deep(.badge-chip:hover) {
  background: rgb(16 185 129 / 0.25);
}

.rich-prompt:deep(.badge-chip:active) {
  cursor: grabbing;
}

.rich-prompt:deep(.badge-avatar) {
  width: 16px;
  height: 16px;
  border-radius: 50%;
  object-fit: cover;
  flex-shrink: 0;
}
</style>
