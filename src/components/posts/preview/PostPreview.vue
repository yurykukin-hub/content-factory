<script setup lang="ts">
import { computed } from 'vue'
import VkPreview from './VkPreview.vue'
import TelegramPreview from './TelegramPreview.vue'
import InstagramPreview from './InstagramPreview.vue'

interface Media { url: string; thumbUrl: string | null; mimeType: string }
const props = defineProps<{
  platform: string
  accountName: string
  text: string
  hashtags?: string[]
  mediaFiles?: Media[]
  postType?: string
  editable?: boolean
}>()
defineEmits<{ 'update:text': [string] }>()

const component = computed(() => {
  switch (props.platform) {
    case 'VK': return VkPreview
    case 'TELEGRAM': return TelegramPreview
    case 'INSTAGRAM': return InstagramPreview
    default: return VkPreview
  }
})
</script>

<template>
  <component :is="component" :account-name="accountName" :text="text" :hashtags="hashtags" :media-files="mediaFiles" :editable="editable" @update:text="$emit('update:text', $event)" />
</template>
