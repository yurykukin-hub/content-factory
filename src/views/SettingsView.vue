<script setup lang="ts">
import { ref, computed } from 'vue'
import { User, Sparkles, Link, Users } from 'lucide-vue-next'
import { useAuthStore } from '@/stores/auth'
import { useSectionAccess } from '@/composables/useSectionAccess'
import VkOAuthTab from '@/components/settings/VkOAuthTab.vue'
import ProfileTab from '@/components/settings/ProfileTab.vue'
import AiTab from '@/components/settings/AiTab.vue'
import UsersTab from '@/components/settings/UsersTab.vue'

const auth = useAuthStore()
const { canEdit } = useSectionAccess()
const isAdmin = computed(() => auth.user?.role === 'ADMIN')

const allTabs = [
  { key: 'vk-oauth', label: 'VK OAuth', icon: Link, adminOnly: true },
  { key: 'users', label: 'Пользователи', icon: Users, adminOnly: true },
  { key: 'profile', label: 'Профиль и тема', icon: User, adminOnly: false },
  { key: 'ai', label: 'AI', icon: Sparkles, adminOnly: true },
] as const

type TabKey = typeof allTabs[number]['key']
const activeTab = ref<TabKey>('profile')

// Админские табы: видны только при full доступе к settings; профиль — всем
const tabs = computed(() => allTabs.filter(t =>
  !t.adminOnly || (isAdmin.value || canEdit('settings')),
))
</script>

<template>
  <div>
    <h1 class="text-2xl font-bold mb-6">Настройки</h1>

    <!-- Tabs -->
    <div class="flex gap-1 mb-6 bg-gray-100 dark:bg-gray-800 rounded-xl p-1 w-full sm:w-fit overflow-x-auto">
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
    <VkOAuthTab v-if="activeTab === 'vk-oauth'" />
    <ProfileTab v-if="activeTab === 'profile'" />
    <UsersTab v-if="activeTab === 'users'" />
    <AiTab v-if="activeTab === 'ai'" />
  </div>
</template>
