<script setup lang="ts">
import { onMounted, onUnmounted } from 'vue'
import { useRouter } from 'vue-router'
import { useAuthStore } from '@/stores/auth'
import { useBusinessesStore } from '@/stores/businesses'
import TheSidebar from '@/components/layout/TheSidebar.vue'
import TheHeader from '@/components/layout/TheHeader.vue'
import ToastContainer from '@/components/ToastContainer.vue'

const auth = useAuthStore()
const businesses = useBusinessesStore()
const router = useRouter()

onMounted(async () => {
  await auth.checkAuth()
  if (auth.user) {
    await businesses.load()
  }

  // Listen for 401 events
  window.addEventListener('auth:unauthorized', handleUnauthorized)
})

onUnmounted(() => {
  window.removeEventListener('auth:unauthorized', handleUnauthorized)
})

function handleUnauthorized() {
  auth.user = null
  router.push('/login')
}
</script>

<template>
  <!-- Loading -->
  <div v-if="!auth.checked" class="flex items-center justify-center min-h-screen">
    <div class="animate-spin rounded-full h-8 w-8 border-b-2 border-brand-500"></div>
  </div>

  <!-- Not authenticated -->
  <router-view v-else-if="!auth.user" />

  <!-- Authenticated layout -->
  <div v-else class="flex min-h-screen bg-gray-50 dark:bg-gray-950">
    <TheSidebar />
    <div class="flex-1 flex flex-col min-w-0">
      <TheHeader />
      <main class="flex-1 p-3 md:p-6 overflow-auto">
        <router-view v-slot="{ Component }">
          <KeepAlive include="VideoStudioView">
            <component :is="Component" />
          </KeepAlive>
        </router-view>
      </main>
    </div>
  </div>

  <ToastContainer />
</template>
