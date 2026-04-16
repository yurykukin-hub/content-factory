import { createRouter, createWebHistory, type RouteRecordRaw } from 'vue-router'
import { useAuthStore } from '@/stores/auth'
import { useSectionAccess, type Section } from '@/composables/useSectionAccess'

const routes: RouteRecordRaw[] = [
  {
    path: '/login',
    name: 'login',
    component: () => import('@/views/LoginView.vue'),
    meta: { public: true },
  },
  {
    path: '/',
    name: 'dashboard',
    component: () => import('@/views/DashboardView.vue'),
    meta: { section: 'dashboard' },
  },
  {
    path: '/posts',
    name: 'posts',
    component: () => import('@/views/PostsView.vue'),
    meta: { section: 'posts' },
  },
  {
    path: '/posts/:id',
    name: 'post-editor',
    component: () => import('@/views/PostEditorView.vue'),
    meta: { section: 'posts' },
  },
  {
    path: '/stories/:id',
    name: 'story-editor',
    component: () => import('@/views/StoryEditorView.vue'),
    meta: { section: 'posts' },
  },
  {
    path: '/calendar',
    name: 'calendar',
    component: () => import('@/views/CalendarView.vue'),
    meta: { section: 'plans' },
  },
  {
    path: '/plans',
    name: 'plans',
    component: () => import('@/views/ContentPlansView.vue'),
    meta: { section: 'plans' },
  },
  {
    path: '/media',
    name: 'media',
    component: () => import('@/views/MediaLibraryView.vue'),
    meta: { section: 'media' },
  },
  {
    path: '/businesses',
    name: 'businesses',
    component: () => import('@/views/BusinessesView.vue'),
    meta: { section: 'businesses' },
  },
  {
    path: '/businesses/:id',
    name: 'business-detail',
    component: () => import('@/views/BusinessDetailView.vue'),
    meta: { section: 'businesses' },
  },
  {
    path: '/ideas',
    name: 'ideas',
    component: () => import('@/views/IdeasView.vue'),
    meta: { section: 'ideas' },
  },
  {
    path: '/scenarios',
    name: 'scenarios',
    component: () => import('@/views/ScenariosView.vue'),
    meta: { section: 'scenarios' },
  },
  {
    path: '/characters',
    name: 'characters',
    component: () => import('@/views/CharactersView.vue'),
    meta: { section: 'characters' },
  },
  {
    path: '/video-studio',
    name: 'video-studio',
    component: () => import('@/views/VideoStudioView.vue'),
    meta: { section: 'videoStudio' },
  },
  {
    path: '/settings',
    name: 'settings',
    component: () => import('@/views/SettingsView.vue'),
    meta: { section: 'settings' },
  },
  {
    path: '/ai-logs',
    name: 'ai-logs',
    component: () => import('@/views/AiLogsView.vue'),
    meta: { section: 'aiLogs' },
  },
]

const router = createRouter({
  history: createWebHistory(),
  routes,
})

// Auth + section access guard
router.beforeEach(async (to) => {
  const auth = useAuthStore()

  if (!auth.checked) {
    await auth.checkAuth()
  }

  if (!to.meta.public && !auth.user) {
    return { name: 'login' }
  }

  if (to.name === 'login' && auth.user) {
    return { name: 'dashboard' }
  }

  // Section access guard — заменяет старый adminOnly
  if (to.meta.section && auth.user) {
    const { canView } = useSectionAccess()
    if (!canView(to.meta.section as Section)) {
      return { name: 'dashboard' }
    }
  }
})

export default router
