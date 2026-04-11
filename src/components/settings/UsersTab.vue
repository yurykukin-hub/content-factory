<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { http } from '@/api/client'
import { useToast } from '@/composables/useToast'
import { useBusinessesStore } from '@/stores/businesses'
import { Plus, Save, UserPlus, Shield, Eye, Pencil, X } from 'lucide-vue-next'

const toast = useToast()
const businesses = useBusinessesStore()

interface UserItem {
  id: string
  login: string
  name: string
  role: 'ADMIN' | 'EDITOR' | 'VIEWER'
  isActive: boolean
  businesses: { businessId: string; role: string; business: { id: string; name: string } }[]
}

const users = ref<UserItem[]>([])
const loading = ref(true)
const showForm = ref(false)
const editingId = ref<string | null>(null)

const form = ref({
  login: '',
  password: '',
  name: '',
  role: 'EDITOR' as 'ADMIN' | 'EDITOR' | 'VIEWER',
  businessIds: [] as string[],
})

async function loadUsers() {
  try {
    users.value = await http.get<UserItem[]>('/users')
  } catch (e: any) {
    toast.error(e.message || 'Ошибка загрузки пользователей')
  } finally {
    loading.value = false
  }
}

function startCreate() {
  editingId.value = null
  form.value = { login: '', password: '', name: '', role: 'EDITOR', businessIds: [] }
  showForm.value = true
}

function startEdit(user: UserItem) {
  editingId.value = user.id
  form.value = {
    login: user.login,
    password: '',
    name: user.name,
    role: user.role,
    businessIds: user.businesses.map(b => b.businessId),
  }
  showForm.value = true
}

async function saveUser() {
  try {
    if (editingId.value) {
      const data: Record<string, unknown> = {
        name: form.value.name,
        role: form.value.role,
        businessIds: form.value.businessIds,
      }
      if (form.value.password) data.password = form.value.password
      await http.put(`/users/${editingId.value}`, data)
      toast.success('Пользователь обновлён')
    } else {
      if (!form.value.login || !form.value.password || !form.value.name) {
        toast.error('Заполните все обязательные поля')
        return
      }
      await http.post('/users', form.value)
      toast.success('Пользователь создан')
    }
    showForm.value = false
    await loadUsers()
  } catch (e: any) {
    toast.error(e.message || 'Ошибка сохранения')
  }
}

function toggleBusiness(bizId: string) {
  const idx = form.value.businessIds.indexOf(bizId)
  if (idx >= 0) {
    form.value.businessIds.splice(idx, 1)
  } else {
    form.value.businessIds.push(bizId)
  }
}

function roleColor(role: string) {
  return {
    ADMIN: 'bg-red-100 text-red-700 dark:bg-red-900 dark:text-red-300',
    EDITOR: 'bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300',
    VIEWER: 'bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300',
  }[role] || ''
}

function roleLabel(role: string) {
  return { ADMIN: 'Админ', EDITOR: 'Редактор', VIEWER: 'Просмотр' }[role] || role
}

onMounted(loadUsers)
</script>

<template>
  <div>
    <div class="flex items-center justify-between mb-4">
      <h3 class="text-lg font-semibold text-gray-900 dark:text-white">Пользователи</h3>
      <button @click="startCreate" class="flex items-center gap-1.5 px-3 py-1.5 bg-brand-600 text-white rounded-lg text-sm hover:bg-brand-700">
        <UserPlus class="w-4 h-4" />
        Добавить
      </button>
    </div>

    <!-- Users list -->
    <div v-if="loading" class="text-center py-8 text-gray-500">Загрузка...</div>
    <div v-else class="space-y-3">
      <div v-for="user in users" :key="user.id"
        class="flex items-center justify-between p-3 bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700">
        <div>
          <div class="flex items-center gap-2">
            <span class="font-medium text-gray-900 dark:text-white">{{ user.name }}</span>
            <span class="text-sm text-gray-500">@{{ user.login }}</span>
            <span :class="[roleColor(user.role), 'px-2 py-0.5 rounded text-xs font-medium']">
              {{ roleLabel(user.role) }}
            </span>
            <span v-if="!user.isActive" class="px-2 py-0.5 bg-gray-200 dark:bg-gray-700 rounded text-xs text-gray-500">
              Неактивен
            </span>
          </div>
          <div v-if="user.businesses.length" class="mt-1 flex gap-1 flex-wrap">
            <span v-for="ub in user.businesses" :key="ub.businessId"
              class="px-2 py-0.5 bg-brand-50 dark:bg-brand-900/20 text-brand-700 dark:text-brand-300 rounded text-xs">
              {{ ub.business.name }}
            </span>
          </div>
          <div v-else class="mt-1 text-xs text-gray-400">Нет привязанных бизнесов</div>
        </div>
        <button @click="startEdit(user)" class="p-1.5 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300">
          <Pencil class="w-4 h-4" />
        </button>
      </div>
    </div>

    <!-- Create/Edit form -->
    <div v-if="showForm" class="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div class="bg-white dark:bg-gray-800 rounded-xl shadow-xl max-w-md w-full p-6">
        <div class="flex items-center justify-between mb-4">
          <h3 class="text-lg font-semibold text-gray-900 dark:text-white">
            {{ editingId ? 'Редактирование' : 'Новый пользователь' }}
          </h3>
          <button @click="showForm = false" class="text-gray-400 hover:text-gray-600">
            <X class="w-5 h-5" />
          </button>
        </div>

        <div class="space-y-4">
          <div v-if="!editingId">
            <label class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Логин *</label>
            <input v-model="form.login" type="text" class="w-full px-3 py-2 border rounded-lg dark:bg-gray-700 dark:border-gray-600 dark:text-white" />
          </div>

          <div>
            <label class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
              {{ editingId ? 'Новый пароль (оставьте пустым)' : 'Пароль *' }}
            </label>
            <input v-model="form.password" type="password" class="w-full px-3 py-2 border rounded-lg dark:bg-gray-700 dark:border-gray-600 dark:text-white" />
          </div>

          <div>
            <label class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Имя *</label>
            <input v-model="form.name" type="text" class="w-full px-3 py-2 border rounded-lg dark:bg-gray-700 dark:border-gray-600 dark:text-white" />
          </div>

          <div>
            <label class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Роль</label>
            <select v-model="form.role" class="w-full px-3 py-2 border rounded-lg dark:bg-gray-700 dark:border-gray-600 dark:text-white">
              <option value="ADMIN">Админ (все бизнесы)</option>
              <option value="EDITOR">Редактор (только выбранные)</option>
              <option value="VIEWER">Просмотр (только чтение)</option>
            </select>
          </div>

          <div v-if="form.role !== 'ADMIN'">
            <label class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Доступ к бизнесам</label>
            <div class="space-y-2">
              <label v-for="biz in businesses.businesses" :key="biz.id" class="flex items-center gap-2 cursor-pointer">
                <input type="checkbox"
                  :checked="form.businessIds.includes(biz.id)"
                  @change="toggleBusiness(biz.id)"
                  class="rounded border-gray-300 text-brand-600 focus:ring-brand-500" />
                <span class="text-sm text-gray-700 dark:text-gray-300">{{ biz.name }}</span>
              </label>
            </div>
          </div>
        </div>

        <div class="flex justify-end gap-3 mt-6">
          <button @click="showForm = false" class="px-4 py-2 text-sm text-gray-600 hover:text-gray-800 dark:text-gray-400">
            Отмена
          </button>
          <button @click="saveUser" class="flex items-center gap-1.5 px-4 py-2 bg-brand-600 text-white rounded-lg text-sm hover:bg-brand-700">
            <Save class="w-4 h-4" />
            {{ editingId ? 'Сохранить' : 'Создать' }}
          </button>
        </div>
      </div>
    </div>
  </div>
</template>
