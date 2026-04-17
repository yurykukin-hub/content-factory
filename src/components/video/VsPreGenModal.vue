<script setup lang="ts">
import { computed } from 'vue'
import { X, Film, Camera, Palette, Volume2, Settings, Banknote } from 'lucide-vue-next'

const props = defineProps<{
  visible: boolean
  prompt: string
  duration: number
  resolution: string
  aspectRatio: string
  generateAudio: boolean
  costRub: number
}>()

const emit = defineEmits<{
  confirm: []
  cancel: []
}>()

interface PromptSection {
  icon: any
  label: string
  content: string
}

const parsedSections = computed((): PromptSection[] => {
  const text = props.prompt.trim()
  if (!text) return []

  const sections: PromptSection[] = []

  // Detect timeline markers [0s], [3s], [0-3s] etc.
  // Use separate regex without /g for test() to avoid lastIndex state bug
  const hasTimeline = /\[(\d+(?:-\d+)?s?)\]\s*/.test(text)

  if (hasTimeline) {
    // Split by timeline markers into scenes
    const scenes: string[] = []
    const parts = text.split(/\[(\d+(?:-\d+)?s?)\]\s*/)
    let currentScene = ''

    for (let i = 0; i < parts.length; i++) {
      if (/^\d+(?:-\d+)?s?$/.test(parts[i])) {
        if (currentScene.trim()) scenes.push(currentScene.trim())
        currentScene = `[${parts[i]}] `
      } else {
        currentScene += parts[i]
      }
    }
    if (currentScene.trim()) scenes.push(currentScene.trim())

    if (scenes.length > 0) {
      sections.push({
        icon: Film,
        label: `Сцены (${scenes.length})`,
        content: scenes.join('\n\n'),
      })
    }
  }

  // Extract camera-related content
  const cameraKeywords = /\b(dolly|tracking|pan|orbit|handheld|gimbal|aerial|drone|close-up|wide shot|medium shot|ECU|CU|MS|WS|EWS|OTS|low angle|high angle|bird's eye|dutch|push-in|pull-out|steadicam|tripod|anamorphic|\d+mm)\b/gi
  const cameraMatches = text.match(cameraKeywords)
  if (cameraMatches?.length) {
    sections.push({
      icon: Camera,
      label: 'Камера',
      content: [...new Set(cameraMatches.map(m => m.toLowerCase()))].join(', '),
    })
  }

  // Extract style/lighting content
  const styleKeywords = /\b(cinematic|golden hour|natural light|studio light|neon|dramatic|backlit|moody|warm|cool|vibrant|pastel|desaturated|b&w|film grain|Kodak|Fuji|color grade)\b/gi
  const styleMatches = text.match(styleKeywords)
  if (styleMatches?.length) {
    sections.push({
      icon: Palette,
      label: 'Стиль',
      content: [...new Set(styleMatches.map(m => m.toLowerCase()))].join(', '),
    })
  }

  // Extract audio content
  const audioKeywords = /\b(ambient|sound|music|dialogue|voice|whisper|footsteps|wind|rain|birds|waves|silence|no background music|sizzling|crackling|rustling)\b/gi
  const audioMatches = text.match(audioKeywords)
  if (audioMatches?.length) {
    sections.push({
      icon: Volume2,
      label: 'Звук',
      content: [...new Set(audioMatches.map(m => m.toLowerCase()))].join(', '),
    })
  }

  // If no sections detected — show as plain text
  if (!sections.length) {
    sections.push({
      icon: Film,
      label: 'Промпт',
      content: text,
    })
  }

  return sections
})

const settingsLine = computed(() => {
  const parts = [props.resolution, `${props.duration} сек`, props.aspectRatio]
  if (props.generateAudio) parts.push('со звуком')
  return parts.join(' \u00b7 ')
})
</script>

<template>
  <Teleport to="body">
    <div v-if="visible" class="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" @click.self="emit('cancel')">
      <div class="bg-white dark:bg-gray-900 rounded-2xl shadow-2xl max-w-lg w-full overflow-hidden">
        <!-- Header -->
        <div class="flex items-center justify-between px-5 py-4 border-b border-gray-100 dark:border-gray-800">
          <h3 class="text-base font-semibold text-gray-800 dark:text-gray-200">Проверьте промпт</h3>
          <button @click="emit('cancel')"
            class="p-1.5 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors">
            <X :size="16" class="text-gray-400" />
          </button>
        </div>

        <!-- Content -->
        <div class="px-5 py-4 space-y-3 max-h-[60vh] overflow-y-auto">
          <!-- Parsed sections -->
          <div v-for="(section, idx) in parsedSections" :key="idx" class="space-y-1">
            <div class="flex items-center gap-1.5">
              <component :is="section.icon" :size="13" class="text-emerald-500" />
              <span class="text-xs font-medium text-gray-600 dark:text-gray-400">{{ section.label }}</span>
            </div>
            <div class="pl-5 text-sm text-gray-700 dark:text-gray-300 leading-relaxed whitespace-pre-wrap bg-gray-50 dark:bg-gray-800/50 rounded-lg px-3 py-2">
              {{ section.content }}
            </div>
          </div>

          <!-- Settings line -->
          <div class="flex items-center gap-1.5 pt-1">
            <Settings :size="13" class="text-gray-400" />
            <span class="text-xs text-gray-500 dark:text-gray-400">{{ settingsLine }}</span>
          </div>

          <!-- Cost -->
          <div class="flex items-center gap-1.5">
            <Banknote :size="13" class="text-amber-500" />
            <span class="text-xs font-medium text-amber-600 dark:text-amber-400">~{{ costRub }} &#8381;</span>
          </div>
        </div>

        <!-- Actions -->
        <div class="flex items-center justify-end gap-3 px-5 py-4 border-t border-gray-100 dark:border-gray-800">
          <button @click="emit('cancel')"
            class="px-4 py-2 rounded-xl text-sm font-medium text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors">
            Отмена
          </button>
          <button @click="emit('confirm')"
            class="px-5 py-2 rounded-xl text-sm font-medium bg-emerald-500 hover:bg-emerald-600 text-white transition-colors shadow-sm">
            Сгенерировать за ~{{ costRub }} &#8381;
          </button>
        </div>
      </div>
    </div>
  </Teleport>
</template>
