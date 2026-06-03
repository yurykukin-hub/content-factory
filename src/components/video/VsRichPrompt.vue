<script setup lang="ts">
import { ref, computed, watch, nextTick, onMounted } from 'vue'

export interface BadgeData {
  badgeType: 'character' | 'image'
  id: string
  name: string
  thumbUrl: string | null
}

export interface CharacterSuggestion {
  id: string
  name: string
  thumbUrl: string | null
}

const props = defineProps<{
  modelValue: string
  placeholder?: string
  characters?: CharacterSuggestion[]
}>()

const emit = defineEmits<{
  'update:modelValue': [value: string]
}>()

const editorRef = ref<HTMLDivElement | null>(null)
const isFocused = ref(false)
const isEmpty = ref(true)
let isInternalUpdate = false

// --- @ Autocomplete state ---
const showAutocomplete = ref(false)
const autocompleteQuery = ref('')
const autocompletePos = ref({ top: 0, left: 0 })
const autocompleteIndex = ref(0)
let autocompleteRange: Range | null = null

const filteredSuggestions = computed(() => {
  if (!props.characters?.length || !showAutocomplete.value) return []
  const q = autocompleteQuery.value.toLowerCase()
  return props.characters.filter(c => c.name.toLowerCase().includes(q)).slice(0, 6)
})

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
        // Only add newline for BR if it's not inside an empty div (Chrome adds <div><br></div>)
        const parent = element.parentElement
        if (!parent || parent === el || parent.childNodes.length > 1) {
          text += '\n'
        }
      } else if (element.tagName === 'DIV' || element.tagName === 'P') {
        // Chrome wraps lines in divs — add newline before (not after)
        if (text && !text.endsWith('\n')) text += '\n'
        const inner = extractText(element)
        text += inner
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

  // Check for @ autocomplete trigger
  checkAutocomplete()
}

function checkAutocomplete() {
  if (!props.characters?.length) { showAutocomplete.value = false; return }

  const sel = window.getSelection()
  if (!sel || !sel.rangeCount || !sel.isCollapsed) { showAutocomplete.value = false; return }

  const range = sel.getRangeAt(0)
  const container = range.startContainer
  if (container.nodeType !== Node.TEXT_NODE) { showAutocomplete.value = false; return }

  const textBefore = container.textContent?.slice(0, range.startOffset) || ''

  // Find last @ in text before cursor (not preceded by word char)
  const atMatch = textBefore.match(/(^|[^a-zA-Z\u0400-\u04FF])@([a-zA-Z\u0400-\u04FF]*)$/)
  if (!atMatch) { showAutocomplete.value = false; return }

  autocompleteQuery.value = atMatch[2]
  autocompleteRange = range.cloneRange()
  autocompleteIndex.value = 0

  // Position dropdown below cursor
  const rect = range.getBoundingClientRect()
  const editorRect = editorRef.value?.getBoundingClientRect()
  if (editorRect) {
    autocompletePos.value = {
      top: rect.bottom - editorRect.top + 4,
      left: rect.left - editorRect.left,
    }
  }

  showAutocomplete.value = filteredSuggestions.value.length > 0
}

function selectSuggestion(char: CharacterSuggestion) {
  if (!editorRef.value || !autocompleteRange) return

  // Find the @ trigger in text and remove @query
  const sel = window.getSelection()
  if (!sel) return

  const container = autocompleteRange.startContainer
  if (container.nodeType !== Node.TEXT_NODE) return

  const text = container.textContent || ''
  const cursorPos = autocompleteRange.startOffset

  // Find the @ position
  const beforeCursor = text.slice(0, cursorPos)
  const atIdx = beforeCursor.lastIndexOf('@')
  if (atIdx < 0) return

  // Create range covering @query
  const deleteRange = document.createRange()
  deleteRange.setStart(container, atIdx)
  deleteRange.setEnd(container, cursorPos)
  deleteRange.deleteContents()

  // Insert badge
  const badge: BadgeData = { badgeType: 'character', id: char.id, name: char.name, thumbUrl: char.thumbUrl }
  const html = badgeHtml(badge)
  const temp = document.createElement('div')
  temp.innerHTML = html
  const badgeNode = temp.firstChild as HTMLElement

  deleteRange.insertNode(badgeNode)

  // Move cursor after badge
  const newRange = document.createRange()
  newRange.setStartAfter(badgeNode)
  newRange.collapse(true)
  sel.removeAllRanges()
  sel.addRange(newRange)

  // Add space after
  const space = document.createTextNode(' ')
  badgeNode.after(space)
  newRange.setStartAfter(space)
  sel.removeAllRanges()
  sel.addRange(newRange)

  showAutocomplete.value = false
  onInput()
}

function onPaste(e: ClipboardEvent) {
  e.preventDefault()
  const text = e.clipboardData?.getData('text/plain') || ''
  document.execCommand('insertText', false, text)
}

function onKeydown(e: KeyboardEvent) {
  // Autocomplete navigation
  if (showAutocomplete.value && filteredSuggestions.value.length > 0) {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      autocompleteIndex.value = (autocompleteIndex.value + 1) % filteredSuggestions.value.length
      return
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault()
      autocompleteIndex.value = (autocompleteIndex.value - 1 + filteredSuggestions.value.length) % filteredSuggestions.value.length
      return
    }
    if (e.key === 'Enter' || e.key === 'Tab') {
      e.preventDefault()
      selectSuggestion(filteredSuggestions.value[autocompleteIndex.value])
      return
    }
    if (e.key === 'Escape') {
      e.preventDefault()
      showAutocomplete.value = false
      return
    }
  }

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

// --- Drag and Drop (Desktop) ---

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

// --- Touch Drag (Mobile) ---

let touchBadge: HTMLElement | null = null
let touchClone: HTMLElement | null = null
let touchStarted = false

function onTouchStart(e: TouchEvent) {
  const target = (e.target as HTMLElement).closest('.badge-chip') as HTMLElement | null
  if (!target || !editorRef.value) return

  // Long-press detection: wait 200ms to distinguish from scroll
  touchBadge = target
  touchStarted = false

  const startX = e.touches[0].clientX
  const startY = e.touches[0].clientY

  const timer = setTimeout(() => {
    if (!touchBadge) return
    touchStarted = true
    touchBadge.style.opacity = '0.3'

    // Create floating clone
    touchClone = touchBadge.cloneNode(true) as HTMLElement
    touchClone.style.cssText = `
      position: fixed; z-index: 9999; pointer-events: none;
      opacity: 0.9; transform: scale(1.1);
      left: ${startX - 30}px; top: ${startY - 15}px;
    `
    document.body.appendChild(touchClone)
  }, 200)

  // If finger moves significantly before 200ms — it's a scroll, cancel
  const cancelHandler = (ev: TouchEvent) => {
    const dx = Math.abs(ev.touches[0].clientX - startX)
    const dy = Math.abs(ev.touches[0].clientY - startY)
    if (!touchStarted && (dx > 10 || dy > 10)) {
      clearTimeout(timer)
      touchBadge = null
    }
  }
  target.addEventListener('touchmove', cancelHandler, { once: true, passive: true })
}

function onTouchMove(e: TouchEvent) {
  if (!touchStarted || !touchClone) return
  e.preventDefault()
  const touch = e.touches[0]
  touchClone.style.left = `${touch.clientX - 30}px`
  touchClone.style.top = `${touch.clientY - 15}px`
}

function onTouchEnd(e: TouchEvent) {
  if (!touchStarted || !touchBadge || !editorRef.value) {
    touchBadge = null
    return
  }

  const touch = e.changedTouches[0]

  // Remove floating clone
  if (touchClone) {
    touchClone.remove()
    touchClone = null
  }

  // Get drop position
  let range: Range | null = null
  if (document.caretRangeFromPoint) {
    range = document.caretRangeFromPoint(touch.clientX, touch.clientY)
  }

  // Clone badge, remove original
  const badgeCopy = touchBadge.cloneNode(true) as HTMLElement
  touchBadge.remove()

  // Insert at drop position
  if (range && editorRef.value.contains(range.startContainer)) {
    range.insertNode(badgeCopy)
    const newRange = document.createRange()
    newRange.setStartAfter(badgeCopy)
    newRange.collapse(true)
    const sel = window.getSelection()
    sel?.removeAllRanges()
    sel?.addRange(newRange)
  } else {
    editorRef.value.appendChild(badgeCopy)
  }

  badgeCopy.style.opacity = '1'
  touchBadge = null
  touchStarted = false
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

// Set content with @ImageN replaced by badge chips inline
function setContentWithBadges(text: string, badges: BadgeData[]) {
  if (!editorRef.value) return
  isInternalUpdate = true

  // Build a map of tag → badge HTML
  const badgeMap = new Map<string, string>()
  for (const b of badges) {
    badgeMap.set(`@${b.name}`, badgeHtml(b))
  }

  // Split text by @Name patterns (supports @Image1..N and @CharacterName) and rebuild as HTML
  // Build regex from all badge names
  const badgeNames = Array.from(badgeMap.keys()).map(k => k.slice(1)) // remove @
  // Also always match @Image\d+
  const escaped = badgeNames.map(n => n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
  const pattern = escaped.length > 0
    ? new RegExp(`@(?:${escaped.join('|')}|Image\\d+)`, 'g')
    : /@Image\d+/g

  let html = ''
  let lastIndex = 0
  let match: RegExpExecArray | null

  while ((match = pattern.exec(text)) !== null) {
    // Escape text before the match
    const before = text.slice(lastIndex, match.index)
    html += escapeHtml(before)

    const tag = match[0]
    const badge = badgeMap.get(tag)
    if (badge) {
      html += badge
    } else {
      html += escapeHtml(tag)
    }
    lastIndex = match.index + match[0].length
  }
  // Remaining text after last match
  html += escapeHtml(text.slice(lastIndex))

  editorRef.value.innerHTML = html
  isEmpty.value = !text.trim()

  // Emit the plain text (with @ImageN as text)
  const extracted = extractText(editorRef.value)
  emit('update:modelValue', extracted)

  nextTick(() => { isInternalUpdate = false })
}

function escapeHtml(str: string): string {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\n/g, '<br>')
}

watch(() => props.modelValue, (val) => {
  setContent(val)
})

onMounted(() => {
  if (props.modelValue) {
    setContent(props.modelValue)
  }
  // touchmove needs {passive: false} to allow preventDefault during badge drag
  editorRef.value?.addEventListener('touchmove', onTouchMove, { passive: false })
})

defineExpose({ insertBadge, setContentWithBadges })
</script>

<template>
  <div class="relative">
    <div
      ref="editorRef"
      contenteditable="true"
      :class="[
        'rich-prompt w-full min-h-[180px] max-h-[400px] overflow-y-auto px-4 py-3 rounded-xl border text-sm outline-none transition-colors resize-y',
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
      @touchstart="onTouchStart"
      @touchend="onTouchEnd"
    />
    <!-- Placeholder -->
    <div v-if="isEmpty && !isFocused"
      class="absolute top-3 left-4 text-sm text-gray-400 pointer-events-none select-none">
      {{ placeholder || 'Опишите видео: объект, действие, камера, освещение, настроение...' }}
    </div>

    <!-- @ Autocomplete dropdown -->
    <div v-if="showAutocomplete && filteredSuggestions.length > 0"
      :style="{ top: autocompletePos.top + 'px', left: autocompletePos.left + 'px' }"
      class="absolute z-50 w-52 bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-xl shadow-xl py-1 max-h-48 overflow-y-auto">
      <button
        v-for="(char, idx) in filteredSuggestions" :key="char.id"
        @mousedown.prevent="selectSuggestion(char)"
        :class="[
          'w-full flex items-center gap-2 px-3 py-2 text-left text-sm transition-colors',
          idx === autocompleteIndex
            ? 'bg-emerald-50 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-300'
            : 'hover:bg-gray-50 dark:hover:bg-gray-800'
        ]">
        <img v-if="char.thumbUrl" :src="char.thumbUrl" :alt="char.name"
          class="w-6 h-6 rounded-full object-cover shrink-0" />
        <div v-else class="w-6 h-6 rounded-full bg-gray-200 dark:bg-gray-700 shrink-0 flex items-center justify-center">
          <span class="text-[9px] text-gray-500">{{ char.name[0] }}</span>
        </div>
        <span class="truncate font-medium">{{ char.name }}</span>
      </button>
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
