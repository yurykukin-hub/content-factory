<script setup lang="ts">
import { Bot, Copy, ArrowRight, Check } from 'lucide-vue-next'
import { ref, computed } from 'vue'

export interface AgentMessage {
  role: 'user' | 'assistant'
  content: string
  prompts?: string[]
  suggestions?: string[]
  createdAt: string
}

const props = defineProps<{
  message: AgentMessage
}>()

const emit = defineEmits<{
  usePrompt: [prompt: string]
}>()

const copiedIdx = ref<number | null>(null)

function copyPrompt(text: string, idx: number) {
  navigator.clipboard.writeText(text)
  copiedIdx.value = idx
  setTimeout(() => { copiedIdx.value = null }, 2000)
}

/** Escape HTML to prevent XSS via v-html */
function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;')
}

/** Simple markdown → HTML (bold, italic, lists, code, line breaks). HTML is escaped first. */
function renderMarkdown(text: string): string {
  return escapeHtml(text)
    // Code blocks (``` ... ```)
    .replace(/```(\w*)\n?([\s\S]*?)```/g, '<pre class="bg-gray-100 dark:bg-gray-800 rounded-lg p-2 my-1 text-xs overflow-x-auto"><code>$2</code></pre>')
    // Inline code
    .replace(/`([^`]+)`/g, '<code class="px-1 py-0.5 bg-gray-100 dark:bg-gray-800 rounded text-xs">$1</code>')
    // Bold
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    // Italic
    .replace(/\*(.+?)\*/g, '<em>$1</em>')
    // Unordered lists
    .replace(/^[-*] (.+)$/gm, '<li class="ml-4 list-disc">$1</li>')
    // Ordered lists
    .replace(/^\d+\. (.+)$/gm, '<li class="ml-4 list-decimal">$1</li>')
    // Line breaks
    .replace(/\n/g, '<br>')
}

const formattedContent = computed(() => renderMarkdown(props.message.content))
const timeStr = computed(() => {
  try {
    return new Date(props.message.createdAt).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })
  } catch { return '' }
})
</script>

<template>
  <div :class="['flex gap-2 mb-3', message.role === 'user' ? 'justify-end' : 'justify-start']">
    <!-- Bot avatar -->
    <div v-if="message.role === 'assistant'"
      class="shrink-0 w-7 h-7 rounded-full bg-emerald-100 dark:bg-emerald-900/50 flex items-center justify-center mt-1">
      <Bot :size="14" class="text-emerald-600 dark:text-emerald-400" />
    </div>

    <div :class="['max-w-[85%] space-y-2', message.role === 'user' ? 'items-end' : 'items-start']">
      <!-- Message bubble -->
      <div :class="[
        'px-3 py-2 rounded-2xl text-sm leading-relaxed',
        message.role === 'user'
          ? 'bg-emerald-500 dark:bg-emerald-600 text-white rounded-br-md'
          : 'bg-gray-100 dark:bg-gray-800 text-gray-800 dark:text-gray-200 rounded-bl-md',
      ]">
        <div v-if="message.role === 'assistant'" v-html="formattedContent" class="prose-sm break-words" />
        <div v-else class="break-words whitespace-pre-wrap">{{ message.content }}</div>
      </div>

      <!-- Prompt cards -->
      <div v-if="message.prompts?.length" class="space-y-2">
        <div v-for="(p, idx) in message.prompts" :key="idx"
          class="border-2 border-emerald-200 dark:border-emerald-800 rounded-xl overflow-hidden bg-white dark:bg-gray-900">
          <!-- Prompt text -->
          <div class="px-3 py-2 text-xs leading-relaxed font-mono text-gray-700 dark:text-gray-300 whitespace-pre-wrap max-h-[200px] overflow-y-auto">
            {{ p }}
          </div>
          <!-- Actions -->
          <div class="flex items-center gap-2 px-3 py-1.5 bg-emerald-50 dark:bg-emerald-950/30 border-t border-emerald-100 dark:border-emerald-900">
            <button @click="emit('usePrompt', p)"
              class="flex items-center gap-1 px-2.5 py-1 rounded-lg text-[11px] font-medium bg-emerald-500 text-white hover:bg-emerald-600 transition-colors">
              <ArrowRight :size="11" />
              Использовать
            </button>
            <button @click="copyPrompt(p, idx)"
              class="flex items-center gap-1 px-2 py-1 rounded-lg text-[11px] font-medium text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors">
              <Check v-if="copiedIdx === idx" :size="11" class="text-emerald-500" />
              <Copy v-else :size="11" />
              {{ copiedIdx === idx ? 'Скопировано' : 'Скопировать' }}
            </button>
          </div>
        </div>
      </div>

      <!-- Timestamp -->
      <div v-if="timeStr" :class="['text-[9px] text-gray-400 px-1', message.role === 'user' ? 'text-right' : 'text-left']">
        {{ timeStr }}
      </div>
    </div>
  </div>
</template>
