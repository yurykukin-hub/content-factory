<script setup lang="ts">
import { computed, watch, ref, onMounted, onUnmounted } from 'vue'
import { useRoute } from 'vue-router'
import { useSidebarStore } from '@/stores/sidebar'
import { useAuthStore } from '@/stores/auth'
import { useSectionAccess, type Section } from '@/composables/useSectionAccess'
import { http } from '@/api/client'
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
  Camera,
  Activity,
  Music,
  Sunrise,
  X,
} from 'lucide-vue-next'

const route = useRoute()
const sidebar = useSidebarStore()
const auth = useAuthStore()
const { canView } = useSectionAccess()

// AI Logs error badge
const aiErrorCount = ref(0)
let errorPollTimer: ReturnType<typeof setInterval> | null = null

async function fetchErrorCount() {
  if (!canView('aiLogs')) return
  try {
    const res = await http.get<{ count: number }>('/ai-logs/error-count')
    aiErrorCount.value = res.count
  } catch { /* ignore */ }
}

onMounted(() => {
  fetchErrorCount()
  errorPollTimer = setInterval(fetchErrorCount, 5 * 60 * 1000)
})

onUnmounted(() => {
  if (errorPollTimer) clearInterval(errorPollTimer)
})

interface NavItem {
  name: string
  label: string
  icon: any
  path: string
  section: Section
}

interface NavGroup {
  title: string
  items: NavItem[]
}

const navGroups: NavGroup[] = [
  {
    title: '',
    items: [
      { name: 'dashboard', label: 'Обзор', icon: LayoutDashboard, path: '/', section: 'dashboard' },
    ],
  },
  {
    title: 'Студии',
    items: [
      { name: 'video-studio', label: 'Видео', icon: Film, path: '/video-studio', section: 'videoStudio' },
      { name: 'photo-studio', label: 'Фото', icon: Camera, path: '/photo-studio', section: 'photoStudio' },
      { name: 'sound-studio', label: 'Звук', icon: Music, path: '/sound-studio', section: 'soundStudio' },
    ],
  },
  {
    title: 'Контент',
    items: [
      { name: 'digest', label: 'Дайджест', icon: Sunrise, path: '/digest', section: 'posts' },
      { name: 'posts', label: 'Контент', icon: Film, path: '/posts', section: 'posts' },
      { name: 'ideas', label: 'Идеи', icon: Lightbulb, path: '/ideas', section: 'ideas' },
      { name: 'scenarios', label: 'Сценарии', icon: Clapperboard, path: '/scenarios', section: 'scenarios' },
      { name: 'plans', label: 'Контент-планы', icon: ClipboardList, path: '/plans', section: 'plans' },
    ],
  },
  {
    title: 'Библиотека',
    items: [
      { name: 'characters', label: 'Референсы', icon: UserCircle, path: '/characters', section: 'characters' },
      { name: 'media', label: 'Медиатека', icon: Image, path: '/media', section: 'media' },
    ],
  },
  {
    title: 'Система',
    items: [
      { name: 'businesses', label: 'Проекты', icon: Building2, path: '/businesses', section: 'businesses' },
      { name: 'ai-logs', label: 'AI Логи', icon: Activity, path: '/ai-logs', section: 'aiLogs' },
      { name: 'settings', label: 'Настройки', icon: Settings, path: '/settings', section: 'settings' },
    ],
  },
]

// Filter groups by section access
const filteredGroups = computed(() =>
  navGroups
    .map(g => ({ ...g, items: g.items.filter(i => canView(i.section)) }))
    .filter(g => g.items.length > 0)
)

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
    <nav class="flex-1 py-3 px-3 overflow-y-auto">
      <div v-for="(group, gi) in filteredGroups" :key="gi" :class="gi > 0 ? 'mt-4' : ''">
        <!-- Group title -->
        <p v-if="group.title" class="px-3 mb-1.5 text-[10px] font-semibold uppercase tracking-wider text-gray-400 dark:text-gray-500">
          {{ group.title }}
        </p>
        <!-- Items -->
        <router-link
          v-for="item in group.items"
          :key="item.name"
          :to="item.path"
          :class="[
            'flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium transition-colors',
            isActive(item.name)
              ? 'bg-brand-50 text-brand-700 dark:bg-brand-950 dark:text-brand-300'
              : 'text-gray-600 hover:bg-gray-100 dark:text-gray-400 dark:hover:bg-gray-800',
          ]"
        >
          <component :is="item.icon" :size="18" />
          <span class="flex-1">{{ item.label }}</span>
          <span
            v-if="item.name === 'ai-logs' && aiErrorCount > 0"
            class="ml-auto inline-flex items-center justify-center min-w-[20px] h-5 px-1.5 rounded-full bg-red-500 text-white text-[10px] font-bold"
          >{{ aiErrorCount }}</span>
        </router-link>
      </div>
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
        <nav class="flex-1 py-3 px-3 overflow-y-auto">
          <div v-for="(group, gi) in filteredGroups" :key="gi" :class="gi > 0 ? 'mt-4' : ''">
            <p v-if="group.title" class="px-3 mb-1.5 text-[10px] font-semibold uppercase tracking-wider text-gray-400 dark:text-gray-500">
              {{ group.title }}
            </p>
            <router-link
              v-for="item in group.items"
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
              <span class="flex-1">{{ item.label }}</span>
              <span
                v-if="item.name === 'ai-logs' && aiErrorCount > 0"
                class="ml-auto inline-flex items-center justify-center min-w-[20px] h-5 px-1.5 rounded-full bg-red-500 text-white text-[10px] font-bold"
              >{{ aiErrorCount }}</span>
            </router-link>
          </div>
        </nav>
      </aside>
    </Transition>
  </Teleport>
</template>

<style scoped>
.sidebar-backdrop-enter-active,
.sidebar-backdrop-leave-active {
  transition: opacity 0.25s ease;
}
.sidebar-backdrop-enter-from,
.sidebar-backdrop-leave-to {
  opacity: 0;
}

.sidebar-slide-enter-active,
.sidebar-slide-leave-active {
  transition: transform 0.25s ease;
}
.sidebar-slide-enter-from,
.sidebar-slide-leave-to {
  transform: translateX(-100%);
}
</style>
