<script setup lang="ts">
/**
 * AI Agent chat for Sound Studio.
 * Pattern from VsAgentChat.vue, adapted for music context.
 */
import { ref, computed, watch, nextTick } from 'vue'
import { SendHorizontal, ChevronDown, Loader2, Bot, Sparkles, Music } from 'lucide-vue-next'

export interface AgentMessage {
  role: 'user' | 'assistant'
  content: string
  prompts?: string[]
  lyrics?: string[]
  styles?: string[]
  suggestions?: string[]
  createdAt: string
}

const props = defineProps<{
  messages: AgentMessage[]
  loading: boolean
  mode: 'simple' | 'advanced'
  disabled: boolean
  contextSummary: string
}>()

const emit = defineEmits<{
  send: [message: string]
  usePrompt: [prompt: string]
  useLyrics: [lyrics: string]
  useStyle: [style: string]
  'update:mode': [mode: 'simple' | 'advanced']
}>()

const inputText = ref('')
const messagesContainer = ref<HTMLDivElement | null>(null)
const showModeMenu = ref(false)
const expandedBlocks = ref<Set<string>>(new Set())

function toggleBlock(key: string) {
  if (expandedBlocks.value.has(key)) expandedBlocks.value.delete(key)
  else expandedBlocks.value.add(key)
}
function isExpanded(key: string): boolean {
  return expandedBlocks.value.has(key)
}

const modeLabel = computed(() => props.mode === 'simple' ? 'Простой' : 'Продвинутый')

const lastSuggestions = computed(() => {
  for (let i = props.messages.length - 1; i >= 0; i--) {
    if (props.messages[i].suggestions?.length) return props.messages[i].suggestions!
  }
  return []
})

function sendMessage(text?: string) {
  const msg = (text || inputText.value).trim()
  if (!msg || props.loading || props.disabled) return
  emit('send', msg)
  inputText.value = ''
}

function onKeydown(e: KeyboardEvent) {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault()
    sendMessage()
  }
}

watch(() => props.messages.length, () => {
  nextTick(() => {
    if (messagesContainer.value) messagesContainer.value.scrollTop = messagesContainer.value.scrollHeight
  })
})

watch(() => props.loading, () => {
  nextTick(() => {
    if (messagesContainer.value) messagesContainer.value.scrollTop = messagesContainer.value.scrollHeight
  })
})

/** Simple XSS-safe escape */
function escapeHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

/** Render markdown-like bold, italic, newlines */
function renderContent(text: string): string {
  let html = escapeHtml(text)
  html = html.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
  html = html.replace(/\*(.*?)\*/g, '<em>$1</em>')
  html = html.replace(/\n/g, '<br>')
  return html
}
</script>

<template>
  <div class="flex flex-col flex-1 min-h-0">
    <!-- Header -->
    <div class="flex items-center justify-between px-4 py-2 border-b border-gray-100 dark:border-gray-800">
      <div class="flex items-center gap-2">
        <Music :size="13" class="text-fuchsia-500" />
        <span class="text-[11px] font-medium text-gray-500">AI-агент звуковой студии</span>
      </div>
      <div class="relative">
        <button @click="showModeMenu = !showModeMenu"
          class="flex items-center gap-1 px-2 py-1 rounded-md text-[11px] font-medium text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-800">
          {{ modeLabel }}
          <ChevronDown :size="11" :class="['transition-transform', showModeMenu ? 'rotate-180' : '']" />
        </button>
        <div v-if="showModeMenu" class="fixed inset-0 z-10" @click="showModeMenu = false" />
        <div v-if="showModeMenu"
          class="absolute right-0 top-full mt-1 w-44 bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-xl shadow-xl z-20 py-1">
          <button @click="emit('update:mode', 'simple'); showModeMenu = false"
            :class="[mode === 'simple' ? 'text-fuchsia-600 font-medium' : 'text-gray-600']"
            class="w-full text-left px-3 py-2 text-xs hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors">
            Простой
            <span class="block text-[10px] text-gray-400 mt-0.5">Автопилот, 1 трек сразу</span>
          </button>
          <button @click="emit('update:mode', 'advanced'); showModeMenu = false"
            :class="[mode === 'advanced' ? 'text-fuchsia-600 font-medium' : 'text-gray-600']"
            class="w-full text-left px-3 py-2 text-xs hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors">
            Продвинутый
            <span class="block text-[10px] text-gray-400 mt-0.5">Продюсерский, варианты, детали</span>
          </button>
        </div>
      </div>
    </div>

    <!-- Messages -->
    <div ref="messagesContainer" class="flex-1 overflow-y-auto px-2 py-2 space-y-2 lg:px-4 lg:py-3 lg:space-y-3">
      <!-- Welcome message -->
      <div v-if="!messages.length && !loading" class="flex gap-2 mb-3">
        <div class="shrink-0 w-7 h-7 rounded-full bg-fuchsia-100 dark:bg-fuchsia-900/30 flex items-center justify-center mt-1">
          <Bot :size="14" class="text-fuchsia-600" />
        </div>
        <div class="bg-gray-100 dark:bg-gray-800 px-3 py-2 rounded-2xl rounded-bl-md text-sm text-gray-700 dark:text-gray-300 leading-relaxed">
          <p>{{ contextSummary }}</p>
          <p class="mt-1.5 text-gray-500">Опиши, какую музыку хочешь создать</p>
        </div>
      </div>

      <!-- Chat messages -->
      <div v-for="(msg, idx) in messages" :key="idx" class="flex gap-2"
        :class="msg.role === 'user' ? 'justify-end' : ''">
        <!-- Bot avatar -->
        <div v-if="msg.role === 'assistant'"
          class="shrink-0 w-7 h-7 rounded-full bg-fuchsia-100 dark:bg-fuchsia-900/30 flex items-center justify-center mt-1">
          <Sparkles :size="12" class="text-fuchsia-500" />
        </div>

        <div :class="[
          'max-w-[92%] lg:max-w-[85%] px-2.5 py-1.5 lg:px-3 lg:py-2 rounded-2xl text-sm leading-relaxed',
          msg.role === 'user'
            ? 'bg-fuchsia-500 text-white rounded-br-md'
            : 'bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-300 rounded-bl-md'
        ]">
          <div v-html="renderContent(msg.content)" />

          <!-- Extracted prompts -->
          <div v-if="msg.prompts?.length" class="mt-2 space-y-1">
            <div v-for="(p, pi) in msg.prompts" :key="pi"
              class="bg-white/20 dark:bg-black/20 rounded-lg px-2 py-1.5 text-xs">
              <p class="opacity-80">{{ isExpanded(`p-${idx}-${pi}`) ? p : p.slice(0, 150) }}{{ !isExpanded(`p-${idx}-${pi}`) && p.length > 150 ? '...' : '' }}</p>
              <div class="flex items-center gap-2 mt-1">
                <button @click="emit('usePrompt', p)"
                  class="text-[10px] font-medium underline opacity-80 hover:opacity-100">
                  Использовать промпт
                </button>
                <button v-if="p.length > 150" @click="toggleBlock(`p-${idx}-${pi}`)"
                  class="text-[10px] font-medium opacity-60 hover:opacity-100">
                  {{ isExpanded(`p-${idx}-${pi}`) ? 'Свернуть' : 'Показать всё' }}
                </button>
              </div>
            </div>
          </div>

          <!-- Extracted lyrics -->
          <div v-if="msg.lyrics?.length" class="mt-2 space-y-1">
            <div v-for="(l, li) in msg.lyrics" :key="li"
              class="bg-white/20 dark:bg-black/20 rounded-lg px-2 py-1.5 text-xs font-mono whitespace-pre-line">
              <p class="opacity-80">{{ isExpanded(`l-${idx}-${li}`) ? l : l.slice(0, 300) }}{{ !isExpanded(`l-${idx}-${li}`) && l.length > 300 ? '...' : '' }}</p>
              <div class="flex items-center gap-2 mt-1">
                <button @click="emit('useLyrics', l)"
                  class="text-[10px] font-medium underline opacity-80 hover:opacity-100">
                  Использовать текст
                </button>
                <button v-if="l.length > 300" @click="toggleBlock(`l-${idx}-${li}`)"
                  class="text-[10px] font-medium opacity-60 hover:opacity-100">
                  {{ isExpanded(`l-${idx}-${li}`) ? 'Свернуть' : 'Показать всё' }}
                </button>
              </div>
            </div>
          </div>

          <!-- Extracted styles -->
          <div v-if="msg.styles?.length" class="mt-2 space-y-1">
            <div v-for="(s, si) in msg.styles" :key="si"
              class="bg-white/20 dark:bg-black/20 rounded-lg px-2 py-1 text-xs">
              <p class="opacity-80">{{ s }}</p>
              <button @click="emit('useStyle', s)"
                class="mt-1 text-[10px] font-medium underline opacity-80 hover:opacity-100">
                Применить стиль
              </button>
            </div>
          </div>
        </div>
      </div>

      <!-- Typing indicator -->
      <div v-if="loading" class="flex gap-2">
        <div class="shrink-0 w-7 h-7 rounded-full bg-fuchsia-100 dark:bg-fuchsia-900/30 flex items-center justify-center mt-1">
          <Loader2 :size="14" class="text-fuchsia-500 animate-spin" />
        </div>
        <div class="bg-gray-100 dark:bg-gray-800 px-4 py-3 rounded-2xl rounded-bl-md">
          <div class="flex gap-1">
            <span class="w-1.5 h-1.5 rounded-full bg-gray-400 animate-bounce" style="animation-delay: 0ms" />
            <span class="w-1.5 h-1.5 rounded-full bg-gray-400 animate-bounce" style="animation-delay: 150ms" />
            <span class="w-1.5 h-1.5 rounded-full bg-gray-400 animate-bounce" style="animation-delay: 300ms" />
          </div>
        </div>
      </div>
    </div>

    <!-- Quick replies -->
    <div v-if="lastSuggestions.length && !loading" class="px-2 pb-1.5 lg:px-4 lg:pb-2">
      <div class="flex flex-wrap gap-1.5">
        <button v-for="s in lastSuggestions" :key="s"
          @click="sendMessage(s)" :disabled="disabled"
          class="px-2.5 py-1 rounded-full text-[11px] font-medium bg-fuchsia-50 dark:bg-fuchsia-900/20 text-fuchsia-600 border border-fuchsia-200 dark:border-fuchsia-800 hover:bg-fuchsia-100 disabled:opacity-50 transition-colors">
          {{ s }}
        </button>
      </div>
    </div>

    <!-- Input -->
    <div class="px-2 pb-2 lg:px-4 lg:pb-3">
      <div class="flex gap-2 items-end">
        <textarea v-model="inputText" @keydown="onKeydown"
          :placeholder="mode === 'simple' ? 'Опиши музыку в двух словах...' : 'Подробно опиши, какой трек хочешь...'"
          :disabled="disabled || loading"
          rows="1"
          class="flex-1 resize-none px-3 py-2 rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 text-sm placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-fuchsia-500/40 disabled:opacity-50"
          style="min-height: 38px; max-height: 120px;"
          @input="(e: Event) => {
            const t = e.target as HTMLTextAreaElement
            t.style.height = 'auto'
            t.style.height = Math.min(t.scrollHeight, 120) + 'px'
          }" />
        <button @click="sendMessage()"
          :disabled="!inputText.trim() || loading || disabled"
          class="shrink-0 w-9 h-9 rounded-xl bg-fuchsia-500 hover:bg-fuchsia-600 disabled:bg-gray-300 text-white flex items-center justify-center transition-colors">
          <SendHorizontal :size="16" />
        </button>
      </div>
    </div>
  </div>
</template>
