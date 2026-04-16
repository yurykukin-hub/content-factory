<script setup lang="ts">
import { ref, onMounted, computed } from 'vue'
import { http } from '@/api/client'
import { useToast } from '@/composables/useToast'
import { useBusinessesStore } from '@/stores/businesses'
import { SECTIONS, SECTION_LABELS, getDefault, type Section, type AccessLevel } from '@/composables/useSectionAccess'
import { Save, UserPlus, Pencil, X, RotateCcw, Plus, Wallet } from 'lucide-vue-next'

const toast = useToast()
const businesses = useBusinessesStore()

interface UserItem {
  id: string
  login: string
  name: string
  role: 'ADMIN' | 'EDITOR' | 'VIEWER'
  isActive: boolean
  sectionAccess: Record<string, AccessLevel> | null
  balanceKopecks?: number
  businesses: { businessId: string; role: string; business: { id: string; name: string } }[]
}

// Top-up modal
const topupUserId = ref<string | null>(null)
const topupUserName = ref('')
const topupAmount = ref(500)
const topupSaving = ref(false)

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
  sectionAccess: {} as Record<string, AccessLevel>,
})

/** Количество кастомных ограничений у пользователя */
function countCustomAccess(user: UserItem): number {
  if (!user.sectionAccess) return 0
  return Object.entries(user.sectionAccess).filter(
    ([section, level]) => level !== getDefault(user.role, section as Section),
  ).length
}

/** Есть ли у секции кастомное значение (не дефолт) */
function isCustom(section: Section): boolean {
  const level = form.value.sectionAccess[section]
  if (level === undefined) return false
  return level !== getDefault(form.value.role, section)
}

/** Сбросить секцию к дефолту */
function resetSection(section: Section) {
  delete form.value.sectionAccess[section]
}

/** Сбросить все секции к дефолтам */
function resetAllSections() {
  form.value.sectionAccess = {}
}

/** Получить текущий уровень (явный или дефолт) */
function currentLevel(section: Section): AccessLevel {
  return form.value.sectionAccess[section] ?? getDefault(form.value.role, section)
}

/** Установить уровень */
function setLevel(section: Section, level: AccessLevel) {
  const def = getDefault(form.value.role, section)
  if (level === def) {
    // Значение совпадает с дефолтом — не сохраняем (чище)
    delete form.value.sectionAccess[section]
  } else {
    form.value.sectionAccess[section] = level
  }
}

const hasCustomAccess = computed(() => Object.keys(form.value.sectionAccess).length > 0)

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
  form.value = { login: '', password: '', name: '', role: 'EDITOR', businessIds: [], sectionAccess: {} }
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
    sectionAccess: user.sectionAccess ? { ...user.sectionAccess } : {},
  }
  showForm.value = true
}

async function saveUser() {
  try {
    // Очищаем sectionAccess от дефолтных значений перед отправкой
    const cleanedAccess: Record<string, AccessLevel> = {}
    for (const [section, level] of Object.entries(form.value.sectionAccess)) {
      if (level !== getDefault(form.value.role, section as Section)) {
        cleanedAccess[section] = level
      }
    }
    const sectionAccess = Object.keys(cleanedAccess).length > 0 ? cleanedAccess : null

    if (editingId.value) {
      const data: Record<string, unknown> = {
        name: form.value.name,
        role: form.value.role,
        businessIds: form.value.businessIds,
        sectionAccess,
      }
      if (form.value.password) data.password = form.value.password
      await http.put(`/users/${editingId.value}`, data)
      toast.success('Пользователь обновлён')
    } else {
      if (!form.value.login || !form.value.password || !form.value.name) {
        toast.error('Заполните все обязательные поля')
        return
      }
      await http.post('/users', { ...form.value, sectionAccess })
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

function levelLabel(level: AccessLevel) {
  return { full: 'Полный', view: 'Просмотр', none: 'Скрыт' }[level]
}

function levelColor(level: AccessLevel) {
  return {
    full: 'text-green-600 dark:text-green-400',
    view: 'text-blue-600 dark:text-blue-400',
    none: 'text-gray-400 dark:text-gray-600',
  }[level]
}

function openTopup(user: UserItem) {
  topupUserId.value = user.id
  topupUserName.value = user.name
  topupAmount.value = 500
}

async function doTopup() {
  if (!topupUserId.value || topupAmount.value <= 0) return
  topupSaving.value = true
  try {
    await http.post(`/users/${topupUserId.value}/topup`, { amountRub: topupAmount.value })
    toast.success(`Баланс ${topupUserName.value} пополнен на ${topupAmount.value} ₽`)
    topupUserId.value = null
    await loadUsers()
  } catch (e: any) {
    toast.error(e.message || 'Ошибка пополнения')
  } finally {
    topupSaving.value = false
  }
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
        <div class="min-w-0">
          <div class="flex items-center gap-2 flex-wrap">
            <span class="font-medium text-gray-900 dark:text-white">{{ user.name }}</span>
            <span class="text-sm text-gray-500">@{{ user.login }}</span>
            <span :class="[roleColor(user.role), 'px-2 py-0.5 rounded text-xs font-medium']">
              {{ roleLabel(user.role) }}
            </span>
            <span v-if="!user.isActive" class="px-2 py-0.5 bg-gray-200 dark:bg-gray-700 rounded text-xs text-gray-500">
              Неактивен
            </span>
            <span v-if="countCustomAccess(user) > 0"
              class="px-2 py-0.5 bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-300 rounded text-xs font-medium">
              {{ countCustomAccess(user) }} настр.
            </span>
          </div>
          <div v-if="user.businesses.length" class="mt-1 flex gap-1 flex-wrap">
            <span v-for="ub in user.businesses" :key="ub.businessId"
              class="px-2 py-0.5 bg-brand-50 dark:bg-brand-900/20 text-brand-700 dark:text-brand-300 rounded text-xs">
              {{ ub.business.name }}
            </span>
          </div>
          <div v-else-if="user.role !== 'ADMIN'" class="mt-1 text-xs text-gray-400">Нет привязанных проектов</div>
          <!-- Balance -->
          <div v-if="user.role !== 'ADMIN' && user.balanceKopecks !== undefined" class="mt-1 flex items-center gap-2">
            <span class="flex items-center gap-1 text-xs"
              :class="(user.balanceKopecks ?? 0) > 0 ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400'">
              <Wallet :size="12" />
              {{ ((user.balanceKopecks ?? 0) / 100).toFixed(0) }} ₽
            </span>
          </div>
        </div>
        <div class="flex items-center gap-1 shrink-0">
          <button v-if="user.role !== 'ADMIN'" @click="openTopup(user)" class="p-1.5 text-green-500 hover:text-green-700 dark:hover:text-green-300" title="Пополнить баланс">
            <Plus class="w-4 h-4" />
          </button>
          <button @click="startEdit(user)" class="p-1.5 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300">
            <Pencil class="w-4 h-4" />
          </button>
        </div>
      </div>
    </div>

    <!-- Create/Edit form -->
    <div v-if="showForm" class="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div class="bg-white dark:bg-gray-800 rounded-xl shadow-xl max-w-lg w-full p-6 max-h-[90vh] overflow-y-auto">
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
              <option value="ADMIN">Админ (все проекты)</option>
              <option value="EDITOR">Редактор (только выбранные)</option>
              <option value="VIEWER">Просмотр (только чтение)</option>
            </select>
          </div>

          <!-- Доступ к проектам (только для не-админов) -->
          <div v-if="form.role !== 'ADMIN'">
            <label class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Доступ к проектам</label>
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

          <!-- Доступ к разделам (только для не-админов) -->
          <div v-if="form.role !== 'ADMIN'">
            <div class="flex items-center justify-between mb-2">
              <label class="block text-sm font-medium text-gray-700 dark:text-gray-300">Доступ к разделам</label>
              <button v-if="hasCustomAccess" @click="resetAllSections"
                class="flex items-center gap-1 text-xs text-gray-500 hover:text-gray-700 dark:hover:text-gray-300">
                <RotateCcw class="w-3 h-3" />
                Сбросить все
              </button>
            </div>
            <div class="border rounded-lg dark:border-gray-600 overflow-hidden">
              <table class="w-full text-sm">
                <thead>
                  <tr class="bg-gray-50 dark:bg-gray-700/50">
                    <th class="text-left px-3 py-2 font-medium text-gray-600 dark:text-gray-300">Раздел</th>
                    <th class="px-2 py-2 font-medium text-gray-600 dark:text-gray-300 text-center w-16">Полный</th>
                    <th class="px-2 py-2 font-medium text-gray-600 dark:text-gray-300 text-center w-20">Просмотр</th>
                    <th class="px-2 py-2 font-medium text-gray-600 dark:text-gray-300 text-center w-16">Скрыт</th>
                    <th class="w-8"></th>
                  </tr>
                </thead>
                <tbody>
                  <tr v-for="section in SECTIONS" :key="section"
                    :class="[
                      'border-t dark:border-gray-700 transition-colors',
                      isCustom(section) ? 'bg-amber-50/50 dark:bg-amber-900/10' : '',
                    ]">
                    <td class="px-3 py-2 text-gray-700 dark:text-gray-300">
                      {{ SECTION_LABELS[section] }}
                      <span v-if="!isCustom(section)" class="text-xs text-gray-400 ml-1">({{ levelLabel(getDefault(form.role, section)) }})</span>
                    </td>
                    <td class="px-2 py-2 text-center">
                      <input type="radio" :name="`section-${section}`"
                        :checked="currentLevel(section) === 'full'"
                        @change="setLevel(section, 'full')"
                        class="text-green-600 focus:ring-green-500" />
                    </td>
                    <td class="px-2 py-2 text-center">
                      <input type="radio" :name="`section-${section}`"
                        :checked="currentLevel(section) === 'view'"
                        @change="setLevel(section, 'view')"
                        class="text-blue-600 focus:ring-blue-500" />
                    </td>
                    <td class="px-2 py-2 text-center">
                      <input type="radio" :name="`section-${section}`"
                        :checked="currentLevel(section) === 'none'"
                        @change="setLevel(section, 'none')"
                        class="text-gray-400 focus:ring-gray-400" />
                    </td>
                    <td class="px-1 py-2">
                      <button v-if="isCustom(section)" @click="resetSection(section)"
                        class="p-1 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300"
                        title="Сбросить к дефолту">
                        <RotateCcw class="w-3 h-3" />
                      </button>
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
            <p class="mt-1 text-xs text-gray-400">
              По умолчанию: {{ form.role === 'VIEWER' ? 'просмотр основных разделов' : 'полный доступ к основным разделам' }}.
              Настройте индивидуально при необходимости.
            </p>
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

    <!-- Top-up modal -->
    <div v-if="topupUserId" class="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div class="bg-white dark:bg-gray-800 rounded-xl shadow-xl max-w-sm w-full p-6">
        <h3 class="text-lg font-semibold mb-4 text-gray-900 dark:text-white">
          Пополнение баланса
        </h3>
        <p class="text-sm text-gray-500 mb-4">{{ topupUserName }}</p>
        <div class="mb-4">
          <label class="block text-sm font-medium mb-1">Сумма, ₽</label>
          <input v-model.number="topupAmount" type="number" min="1" step="100"
            class="w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 text-lg font-mono" />
          <div class="flex gap-2 mt-2">
            <button v-for="a in [200, 500, 1000, 2000]" :key="a" @click="topupAmount = a"
              :class="['px-3 py-1 rounded-lg text-xs font-medium transition-colors',
                topupAmount === a ? 'bg-green-600 text-white' : 'bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-400']">
              {{ a }} ₽
            </button>
          </div>
        </div>
        <div class="flex gap-2 justify-end">
          <button @click="topupUserId = null"
            class="px-4 py-2 rounded-lg text-sm text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-700">
            Отмена
          </button>
          <button @click="doTopup" :disabled="topupSaving || topupAmount <= 0"
            class="px-4 py-2 rounded-lg bg-green-600 hover:bg-green-700 text-white text-sm font-medium disabled:opacity-50">
            {{ topupSaving ? 'Пополняю...' : `Пополнить ${topupAmount} ₽` }}
          </button>
        </div>
      </div>
    </div>
  </div>
</template>
