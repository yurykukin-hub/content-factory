<script setup lang="ts">
import { ref, computed, onMounted, watch } from 'vue'
import { http } from '@/api/client'
import { useToast } from '@/composables/useToast'

const props = defineProps<{ businessId: string }>()

const toast = useToast()

interface UserAccess {
  id: string
  login: string
  name: string
  role: 'ADMIN' | 'EDITOR' | 'VIEWER'
  isActive: boolean
  businesses: { businessId: string }[]
}
const allUsers = ref<UserAccess[]>([])
const accessLoading = ref(false)

const usersWithAccess = computed(() =>
  allUsers.value.filter(u => u.role === 'ADMIN' || u.businesses.some(b => b.businessId === props.businessId))
)

const usersWithoutAccess = computed(() =>
  allUsers.value.filter(u => u.role !== 'ADMIN' && !u.businesses.some(b => b.businessId === props.businessId) && u.isActive)
)

// Выбранный в дропдауне пользователь для «Дать доступ» (v-model вместо чтения через $refs).
// Держим = первому доступному — это воспроизводит нативный дефолт <select> (первая опция).
const selectedUserId = ref<string>('')
watch(usersWithoutAccess, (list) => {
  if (!list.some(u => u.id === selectedUserId.value)) selectedUserId.value = list[0]?.id || ''
}, { immediate: true })

async function loadUsers() {
  accessLoading.value = true
  try {
    allUsers.value = await http.get<UserAccess[]>('/users')
  } catch {} finally { accessLoading.value = false }
}

async function grantAccess(userId: string) {
  const user = allUsers.value.find(u => u.id === userId)
  if (!user) return
  const currentBizIds = user.businesses.map(b => b.businessId)
  try {
    await http.put(`/users/${userId}`, { businessIds: [...currentBizIds, props.businessId] })
    toast.success('Доступ выдан')
    await loadUsers()
  } catch (e: any) { toast.error(e.message || 'Ошибка') }
}

async function revokeAccess(userId: string) {
  const user = allUsers.value.find(u => u.id === userId)
  if (!user) return
  const newBizIds = user.businesses.map(b => b.businessId).filter(id => id !== props.businessId)
  try {
    await http.put(`/users/${userId}`, { businessIds: newBizIds })
    toast.success('Доступ отозван')
    await loadUsers()
  } catch (e: any) { toast.error(e.message || 'Ошибка') }
}

onMounted(loadUsers)
</script>

<template>
  <div class="mt-5 pt-5 border-t border-gray-200 dark:border-gray-800">
    <div class="flex items-center justify-between mb-3">
      <div class="text-xs text-gray-400">Доступ к проекту</div>
    </div>

    <!-- Users with access -->
    <div class="space-y-2 mb-3">
      <div
        v-for="user in usersWithAccess"
        :key="user.id"
        class="flex items-center justify-between px-3 py-2 rounded-lg bg-gray-50 dark:bg-gray-800"
      >
        <div class="flex items-center gap-2">
          <span class="text-sm font-medium">{{ user.name }}</span>
          <span class="text-xs text-gray-400">@{{ user.login }}</span>
          <span :class="[
            'px-1.5 py-0.5 rounded text-[10px] font-medium',
            user.role === 'ADMIN' ? 'bg-red-100 text-red-700 dark:bg-red-900 dark:text-red-300' : 'bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300'
          ]">
            {{ user.role === 'ADMIN' ? 'Админ' : user.role === 'EDITOR' ? 'Редактор' : 'Просмотр' }}
          </span>
        </div>
        <button
          v-if="user.role !== 'ADMIN'"
          @click="revokeAccess(user.id)"
          class="text-xs text-red-500 hover:text-red-700 hover:underline"
        >
          Отозвать
        </button>
        <span v-else class="text-[10px] text-gray-400">все проекты</span>
      </div>
    </div>

    <!-- Add user -->
    <div v-if="usersWithoutAccess.length" class="flex items-center gap-2">
      <select
        v-model="selectedUserId"
        class="flex-1 px-2 py-1.5 rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 text-xs"
      >
        <option v-for="u in usersWithoutAccess" :key="u.id" :value="u.id">
          {{ u.name }} (@{{ u.login }})
        </option>
      </select>
      <button
        @click="grantAccess(selectedUserId)"
        class="px-3 py-1.5 rounded-lg bg-brand-600 text-white text-xs font-medium hover:bg-brand-700"
      >
        Дать доступ
      </button>
    </div>
    <div v-else-if="!accessLoading" class="text-xs text-gray-400">Все пользователи уже имеют доступ</div>
  </div>
</template>
