<script setup lang="ts">
/**
 * Music style configuration: style tags, title, negative tags.
 */

defineProps<{
  musicStyle: string
  musicTitle: string
  negativeTags: string
  disabled?: boolean
}>()

const emit = defineEmits<{
  'update:musicStyle': [value: string]
  'update:musicTitle': [value: string]
  'update:negativeTags': [value: string]
}>()
</script>

<template>
  <div class="flex flex-col gap-2 px-4 py-2">
    <!-- Title -->
    <div>
      <label class="text-[10px] font-medium text-gray-500 uppercase tracking-wide">Название трека</label>
      <input
        :value="musicTitle"
        @input="emit('update:musicTitle', ($event.target as HTMLInputElement).value)"
        :disabled="disabled"
        placeholder="Summer Rain"
        maxlength="80"
        class="w-full mt-0.5 px-2.5 py-1.5 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 text-sm placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-fuchsia-500/40 disabled:opacity-50"
      />
    </div>

    <!-- Style tags -->
    <div>
      <label class="text-[10px] font-medium text-gray-500 uppercase tracking-wide">
        Стиль
        <span class="text-gray-400 normal-case">(жанр, настроение, BPM, инструменты)</span>
      </label>
      <input
        :value="musicStyle"
        @input="emit('update:musicStyle', ($event.target as HTMLInputElement).value)"
        :disabled="disabled"
        placeholder="indie rock, melancholic, 120 bpm, reverb guitars"
        maxlength="1000"
        class="w-full mt-0.5 px-2.5 py-1.5 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 text-sm placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-fuchsia-500/40 disabled:opacity-50"
      />
    </div>

    <!-- Negative tags -->
    <div>
      <label class="text-[10px] font-medium text-gray-500 uppercase tracking-wide">
        Исключить
        <span class="text-gray-400 normal-case">(не хочу этого в треке)</span>
      </label>
      <input
        :value="negativeTags"
        @input="emit('update:negativeTags', ($event.target as HTMLInputElement).value)"
        :disabled="disabled"
        placeholder="metal, screaming, autotune"
        class="w-full mt-0.5 px-2.5 py-1.5 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 text-sm placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-fuchsia-500/40 disabled:opacity-50"
      />
    </div>
  </div>
</template>
