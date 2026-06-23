<script setup lang="ts">
// Текст «в стиле макета»: в режиме editable превращается в textarea, визуально неотличимую
// от текста превью (тот же шрифт/размер/цвет, без рамки и фона) — редактируешь прямо в ленте.
import { ref, watch, nextTick, onMounted } from 'vue'

const props = defineProps<{ text: string; editable?: boolean }>()
const emit = defineEmits<{ 'update:text': [string] }>()

const ta = ref<HTMLTextAreaElement | null>(null)
function resize() {
  const el = ta.value
  if (!el) return
  el.style.height = 'auto'
  el.style.height = el.scrollHeight + 'px'
}
function onInput(e: Event) {
  resize()
  emit('update:text', (e.target as HTMLTextAreaElement).value)
}
watch(() => props.editable, async v => { if (v) { await nextTick(); resize(); ta.value?.focus() } })
watch(() => props.text, async () => { if (props.editable) { await nextTick(); resize() } })
onMounted(() => { if (props.editable) resize() })
</script>

<template>
  <textarea v-if="editable" ref="ta" :value="text" @input="onInput" rows="1"
    class="block w-full bg-transparent border-0 p-0 m-0 focus:outline-none resize-none overflow-hidden whitespace-pre-wrap"
    style="font: inherit; color: inherit; line-height: inherit; letter-spacing: inherit;" />
  <span v-else class="whitespace-pre-wrap">{{ text }}</span>
</template>
