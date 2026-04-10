<script setup lang="ts">
import { computed } from 'vue'
import { useRoute } from 'vue-router'
import {
  LayoutDashboard,
  FileText,
  ClipboardList,
  Building2,
  BarChart3,
  Settings,
} from 'lucide-vue-next'

const route = useRoute()

const navItems = [
  { name: 'dashboard', label: 'Dashboard', icon: LayoutDashboard, path: '/' },
  { name: 'posts', label: 'Посты', icon: FileText, path: '/posts' },
  { name: 'plans', label: 'Контент-планы', icon: ClipboardList, path: '/plans' },
  { name: 'businesses', label: 'Бизнесы', icon: Building2, path: '/businesses' },
  { name: 'analytics', label: 'Аналитика', icon: BarChart3, path: '/analytics' },
  { name: 'settings', label: 'Настройки', icon: Settings, path: '/settings' },
]

function isActive(name: string): boolean {
  return route.name === name
}
</script>

<template>
  <aside class="w-64 bg-white dark:bg-gray-900 border-r border-gray-200 dark:border-gray-800 flex flex-col">
    <!-- Logo -->
    <div class="h-16 flex items-center px-6 border-b border-gray-200 dark:border-gray-800">
      <span class="text-xl font-bold text-brand-600 dark:text-brand-400">Content Factory</span>
    </div>

    <!-- Navigation -->
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
</template>
