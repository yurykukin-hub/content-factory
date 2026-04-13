<script setup lang="ts">
import { computed, watch } from 'vue'
import { useRoute } from 'vue-router'
import { useAuthStore } from '@/stores/auth'
import { useSidebarStore } from '@/stores/sidebar'
import {
  LayoutDashboard,
  Film,
  Lightbulb,
  Clapperboard,
  UserCircle,
  ClipboardList,
  Building2,
  Settings,
  Image,
  X,
} from 'lucide-vue-next'

const route = useRoute()
const auth = useAuthStore()
const sidebar = useSidebarStore()
const isAdmin = computed(() => auth.user?.role === 'ADMIN')

const allNavItems = [
  { name: 'dashboard', label: 'Dashboard', icon: LayoutDashboard, path: '/', adminOnly: false },
  { name: 'posts', label: 'Stories', icon: Film, path: '/posts', adminOnly: false },
  { name: 'ideas', label: 'Идеи', icon: Lightbulb, path: '/ideas', adminOnly: false },
  { name: 'video-studio', label: 'Видео-студия', icon: Film, path: '/video-studio', adminOnly: true },
  { name: 'scenarios', label: 'Сценарии', icon: Clapperboard, path: '/scenarios', adminOnly: true },
  { name: 'characters', label: 'Персонажи', icon: UserCircle, path: '/characters', adminOnly: true },
  { name: 'plans', label: 'Контент-планы', icon: ClipboardList, path: '/plans', adminOnly: false },
  { name: 'media', label: 'Медиа', icon: Image, path: '/media', adminOnly: false },
  { name: 'businesses', label: 'Бизнесы', icon: Building2, path: '/businesses', adminOnly: false },
  { name: 'settings', label: 'Настройки', icon: Settings, path: '/settings', adminOnly: false },
]

const navItems = computed(() => allNavItems.filter(i => !i.adminOnly || isAdmin.value))

function isActive(name: string): boolean {
  return route.name === name
}

// Закрывать sidebar при навигации (mobile)
watch(() => route.path, () => sidebar.close())
</script>

<template>
  <!-- Desktop sidebar -->
  <aside class="hidden md:flex w-64 bg-white dark:bg-gray-900 border-r border-gray-200 dark:border-gray-800 flex-col shrink-0">
    <div class="h-16 flex items-center px-6 border-b border-gray-200 dark:border-gray-800">
      <span class="text-xl font-bold text-brand-600 dark:text-brand-400">Content Factory</span>
    </div>
    <nav class="flex-1 py-4 px-3 space-y-1">
      <router-link
        v-for="item in navItems"
        :key="item.name"
        :to="item.path"
        :class="[
          'flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors',
          isActive(item.name)
            ? 'bg-brand-50 text-brand-700 dark:bg-brand-950 dark:text-brand-300'
            : 'text-gray-600 hover:bg-gray-100 dark:text-gray-400 dark:hover:bg-gray-800',
        ]"
      >
        <component :is="item.icon" :size="20" />
        {{ item.label }}
      </router-link>
    </nav>
  </aside>

  <!-- Mobile sidebar overlay -->
  <Teleport to="body">
    <Transition name="sidebar-backdrop">
      <div
        v-if="sidebar.isOpen"
        class="md:hidden fixed inset-0 z-40 bg-black/50"
        @click="sidebar.close()"
      />
    </Transition>
    <Transition name="sidebar-slide">
      <aside
        v-if="sidebar.isOpen"
        class="md:hidden fixed inset-y-0 left-0 z-50 w-72 bg-white dark:bg-gray-900 shadow-2xl flex flex-col"
      >
        <div class="h-16 flex items-center justify-between px-5 border-b border-gray-200 dark:border-gray-800">
          <span class="text-lg font-bold text-brand-600 dark:text-brand-400">Content Factory</span>
          <button
            @click="sidebar.close()"
            class="p-1.5 rounded-lg text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800"
          >
            <X :size="20" />
          </button>
        </div>
        <nav class="flex-1 py-4 px-3 space-y-1 overflow-y-auto">
          <router-link
            v-for="item in navItems"
            :key="item.name"
            :to="item.path"
            :class="[
              'flex items-center gap-3 px-3 py-3 rounded-lg text-sm font-medium transition-colors',
              isActive(item.name)
                ? 'bg-brand-50 text-brand-700 dark:bg-brand-950 dark:text-brand-300'
                : 'text-gray-600 hover:bg-gray-100 dark:text-gray-400 dark:hover:bg-gray-800',
            ]"
          >
            <component :is="item.icon" :size="20" />
            {{ item.label }}
          </router-link>
        </nav>
      </aside>
    </Transition>
  </Teleport>
</template>

<style scoped>
/* Backdrop fade */
.sidebar-backdrop-enter-active,
.sidebar-backdrop-leave-active {
  transition: opacity 0.25s ease;
}
.sidebar-backdrop-enter-from,
.sidebar-backdrop-leave-to {
  opacity: 0;
}

/* Sidebar slide */
.sidebar-slide-enter-active,
.sidebar-slide-leave-active {
  transition: transform 0.25s ease;
}
.sidebar-slide-enter-from,
.sidebar-slide-leave-to {
  transform: translateX(-100%);
}
</style>
