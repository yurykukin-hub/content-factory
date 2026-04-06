<script setup lang="ts">
import { ref } from 'vue'
import { Radio, Palette, User, Sparkles } from 'lucide-vue-next'
import ChannelsTab from '@/components/settings/ChannelsTab.vue'
import BrandProfilesTab from '@/components/settings/BrandProfilesTab.vue'
import ProfileTab from '@/components/settings/ProfileTab.vue'
import AiTab from '@/components/settings/AiTab.vue'

const tabs = [
  { key: 'channels', label: 'Каналы', icon: Radio },
  { key: 'brands', label: 'Бренд-профили', icon: Palette },
  { key: 'profile', label: 'Профиль и тема', icon: User },
  { key: 'ai', label: 'AI', icon: Sparkles },
] as const

type TabKey = typeof tabs[number]['key']
const activeTab = ref<TabKey>('channels')
</script>

<template>
  <div>
    <h1 class="text-2xl font-bold mb-6">Настройки</h1>

    <!-- Tabs -->
    <div class="flex gap-1 mb-6 bg-gray-100 dark:bg-gray-800 rounded-xl p-1 w-fit">
      <button
        v-for="tab in tabs"
        :key="tab.key"
        @click="activeTab = tab.key"
        :class="[
          'flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-medium transition-all',
          activeTab === tab.key
            ? 'bg-white dark:bg-gray-900 text-brand-600 dark:text-brand-400 shadow-sm'
            : 'text-gray-500 hover:text-gray-700 dark:hover:text-gray-300'
        ]"
      >
        <component :is="tab.icon" :size="16" />
        {{ tab.label }}
      </button>
    </div>

    <!-- Tab content -->
    <ChannelsTab v-if="activeTab === 'channels'" />
    <BrandProfilesTab v-if="activeTab === 'brands'" />
    <ProfileTab v-if="activeTab === 'profile'" />
    <AiTab v-if="activeTab === 'ai'" />
  </div>
</template>
