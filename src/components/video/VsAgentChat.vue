<script setup lang="ts">
import { ref, nextTick, watch, computed } from 'vue'
import { SendHorizontal, ChevronDown, Loader2, Bot, Sparkles, Mic, Square } from 'lucide-vue-next'
import VsAgentMessage from './VsAgentMessage.vue'
import type { AgentMessage } from './VsAgentMessage.vue'
import { useVoiceInput } from '../../composables/useVoiceInput'
import { useRates } from '../../composables/useRates'
import { useToast } from '../../composables/useToast'

const props = defineProps<{
  messages: AgentMessage[]
  loading: boolean
  mode: 'simple' | 'advanced'
  disabled: boolean
  /** Context summary for local welcome message */
  contextSummary: string
}>()

const emit = defineEmits<{
  send: [message: string]
  usePrompt: [prompt: string]
  'update:mode': [mode: 'simple' | 'advanced']
}>()

const inputText = ref('')
const messagesContainer = ref<HTMLDivElement | null>(null)
const showModeMenu = ref(false)
const textareaRef = ref<HTMLTextAreaElement | null>(null)

const { recording, transcribing, elapsedSeconds, isSupported, toggleRecording, error: voiceError } = useVoiceInput()
const { voiceInputEnabled } = useRates()
const toast = useToast()

const showMic = computed(() => voiceInputEnabled.value && isSupported.value)

async function onMicClick() {
  try {
    const text = await toggleRecording()
    if (typeof text === 'string' && text) {
      inputText.value = inputText.value ? inputText.value + ' ' + text : text
      // Auto-grow textarea
      nextTick(() => {
        if (textareaRef.value) {
          textareaRef.value.style.height = 'auto'
          textareaRef.value.style.height = Math.min(textareaRef.value.scrollHeight, 120) + 'px'
        }
      })
    }
    // Show toast for short recording
    if (voiceError.value) {
      toast.info(voiceError.value)
    }
  } catch (err: any) {
    toast.error(err.message || 'Ошибка голосового ввода')
  }
}

const modeLabel = computed(() => props.mode === 'simple' ? 'Простой' : 'Продвинутый')

// Last suggestions from agent
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

// Auto-scroll on new messages
watch(() => props.messages.length, () => {
  nextTick(() => {
    if (messagesContainer.value) {
      messagesContainer.value.scrollTop = messagesContainer.value.scrollHeight
    }
  })
})

// Also scroll when loading state changes (typing indicator appears)
watch(() => props.loading, () => {
  nextTick(() => {
    if (messagesContainer.value) {
      messagesContainer.value.scrollTop = messagesContainer.value.scrollHeight
    }
  })
})
</script>

<template>
  <div class="flex flex-col h-[360px]">
    <!-- Header: mode toggle -->
    <div class="flex items-center justify-between px-4 py-2 border-b border-gray-100 dark:border-gray-800">
      <div class="flex items-center gap-2">
        <Sparkles :size="13" class="text-emerald-500" />
        <span class="text-[11px] font-medium text-gray-500 dark:text-gray-400">AI-агент видеостудии</span>
      </div>
      <!-- Mode dropdown -->
      <div class="relative">
        <button @click="showModeMenu = !showModeMenu"
          class="flex items-center gap-1 px-2 py-1 rounded-md text-[11px] font-medium text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors">
          {{ modeLabel }}
          <ChevronDown :size="11" :class="['transition-transform', showModeMenu ? 'rotate-180' : '']" />
        </button>
        <div v-if="showModeMenu" class="fixed inset-0 z-10" @click="showModeMenu = false" />
        <div v-if="showModeMenu"
          class="absolute right-0 top-full mt-1 w-44 bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-xl shadow-xl z-20 py-1 overflow-hidden">
          <button @click="emit('update:mode', 'simple'); showModeMenu = false"
            :class="['w-full text-left px-3 py-2 text-xs hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors',
              mode === 'simple' ? 'text-emerald-600 dark:text-emerald-400 font-medium' : 'text-gray-600 dark:text-gray-400']">
            Простой
            <span class="block text-[10px] text-gray-400 mt-0.5">Автопилот, 1 промпт сразу</span>
          </button>
          <button @click="emit('update:mode', 'advanced'); showModeMenu = false"
            :class="['w-full text-left px-3 py-2 text-xs hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors',
              mode === 'advanced' ? 'text-emerald-600 dark:text-emerald-400 font-medium' : 'text-gray-600 dark:text-gray-400']">
            Продвинутый
            <span class="block text-[10px] text-gray-400 mt-0.5">Детали, варианты, объяснения</span>
          </button>
        </div>
      </div>
    </div>

    <!-- Messages area -->
    <div ref="messagesContainer" class="flex-1 overflow-y-auto px-4 py-3 space-y-1">
      <!-- Local welcome message (not from API) -->
      <div v-if="!messages.length && !loading" class="flex gap-2 mb-3">
        <div class="shrink-0 w-7 h-7 rounded-full bg-emerald-100 dark:bg-emerald-900/50 flex items-center justify-center mt-1">
          <Bot :size="14" class="text-emerald-600 dark:text-emerald-400" />
        </div>
        <div class="bg-gray-100 dark:bg-gray-800 px-3 py-2 rounded-2xl rounded-bl-md text-sm text-gray-700 dark:text-gray-300 leading-relaxed">
          <p>{{ contextSummary }}</p>
          <p class="mt-1.5 text-gray-500 dark:text-gray-400">Опиши, какое видео хочешь создать</p>
        </div>
      </div>

      <!-- Chat messages -->
      <VsAgentMessage
        v-for="(msg, idx) in messages"
        :key="idx"
        :message="msg"
        @use-prompt="emit('usePrompt', $event)" />

      <!-- Typing indicator -->
      <div v-if="loading" class="flex gap-2 mb-3">
        <div class="shrink-0 w-7 h-7 rounded-full bg-emerald-100 dark:bg-emerald-900/50 flex items-center justify-center mt-1">
          <Loader2 :size="14" class="text-emerald-500 animate-spin" />
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
    <div v-if="lastSuggestions.length && !loading" class="px-4 pb-2">
      <div class="flex flex-wrap gap-1.5">
        <button v-for="s in lastSuggestions" :key="s"
          @click="sendMessage(s)"
          :disabled="disabled"
          class="px-2.5 py-1 rounded-full text-[11px] font-medium bg-emerald-50 dark:bg-emerald-950/40 text-emerald-600 dark:text-emerald-400 border border-emerald-200 dark:border-emerald-800 hover:bg-emerald-100 dark:hover:bg-emerald-900/50 transition-colors disabled:opacity-50">
          {{ s }}
        </button>
      </div>
    </div>

    <!-- Input area -->
    <div class="px-4 pb-3">
      <div class="flex gap-2 items-end">
        <textarea
          ref="textareaRef"
          v-model="inputText"
          @keydown="onKeydown"
          :placeholder="mode === 'simple' ? 'Опиши видео в двух словах...' : 'Подробно опиши, что хочешь увидеть...'"
          :disabled="disabled || loading || recording"
          rows="1"
          :class="['flex-1 resize-none px-3 py-2 rounded-xl border bg-white dark:bg-gray-900 text-sm text-gray-800 dark:text-gray-200 placeholder-gray-400 focus:outline-none focus:ring-2 disabled:opacity-50 transition-colors',
            recording ? 'border-red-300 dark:border-red-700 focus:ring-red-500/40 focus:border-red-400' : 'border-gray-200 dark:border-gray-700 focus:ring-emerald-500/40 focus:border-emerald-400']"
          style="min-height: 38px; max-height: 120px;"
          @input="(e: Event) => { const t = e.target as HTMLTextAreaElement; t.style.height = 'auto'; t.style.height = Math.min(t.scrollHeight, 120) + 'px' }" />
        <!-- Mic button -->
        <button v-if="showMic"
          @click="onMicClick"
          :disabled="loading || disabled || transcribing"
          :class="['shrink-0 w-9 h-9 rounded-xl flex items-center justify-center transition-all relative',
            recording ? 'bg-red-500 hover:bg-red-600 text-white animate-pulse' :
            transcribing ? 'bg-gray-200 dark:bg-gray-700 text-gray-400' :
            'bg-gray-100 dark:bg-gray-800 hover:bg-emerald-50 dark:hover:bg-emerald-950/40 text-gray-500 hover:text-emerald-600 dark:hover:text-emerald-400']">
          <Loader2 v-if="transcribing" :size="16" class="animate-spin" />
          <Square v-else-if="recording" :size="14" />
          <Mic v-else :size="16" />
          <!-- Elapsed timer badge -->
          <span v-if="recording"
            class="absolute -top-2 -right-1 px-1.5 py-0.5 rounded-full bg-red-600 text-white text-[9px] font-bold leading-none tabular-nums">
            {{ elapsedSeconds }}s
          </span>
        </button>
        <button @click="sendMessage()"
          :disabled="!inputText.trim() || loading || disabled || recording || transcribing"
          class="shrink-0 w-9 h-9 rounded-xl bg-emerald-500 hover:bg-emerald-600 disabled:bg-gray-300 dark:disabled:bg-gray-700 text-white flex items-center justify-center transition-colors">
          <SendHorizontal :size="16" />
        </button>
      </div>
    </div>
  </div>
</template>
