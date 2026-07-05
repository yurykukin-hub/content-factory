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
    path: '/analytics',
    name: 'analytics',
    component: () => import('@/views/AnalyticsView.vue'),
    meta: { section: 'dashboard' },
  },
  {
    // Фаза C1 — единый кокпит «Лента» заменяет Дайджест + Контент. Старые пути — редирект (обратная совместимость).
    path: '/feed',
    name: 'feed',
    component: () => import('@/views/FeedView.vue'),
    meta: { section: 'posts' },
  },
  {
    path: '/digest',
    redirect: '/feed',
  },
  {
    path: '/posts',
    redirect: '/feed',
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
    path: '/sound-studio',
    name: 'sound-studio',
    component: () => import('@/views/SoundStudioView.vue'),
    meta: { section: 'soundStudio' },
  },
  {
    path: '/photo-studio',
    name: 'photo-studio',
    component: () => import('@/views/PhotoStudioView.vue'),
    meta: { section: 'photoStudio' },
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
  {
    // Фаза A рефактора — визуальный QA-стенд UI-кита. Без meta.section (не завязан
    // на sectionAccess), но требует логин через обычный auth guard ниже.
    path: '/ui-kit',
    name: 'ui-kit',
    component: () => import('@/views/UiKitView.vue'),
  },
  {
    // Фаза B — dev-стенд единого модуля запекания (OverlayEditor/useOverlaySpec), Playwright-only.
    // Без meta.section (не завязан на sectionAccess), требует логин через обычный auth guard ниже.
    path: '/overlay-lab',
    name: 'overlay-lab',
    component: () => import('@/views/OverlayLabView.vue'),
  },
  {
    // Любой неизвестный путь (в т.ч. удалённые /plans, /ideas) → дашборд, а не пустой экран.
    path: '/:pathMatch(.*)*',
    redirect: '/',
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
