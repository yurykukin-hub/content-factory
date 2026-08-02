<script setup lang="ts">
/**
 * API-ключи — доступ для машин: MCP-сервер, приёмник обращений из ERP, интеграции.
 *
 * Ключ показывается ОДИН раз при создании: в базе лежит только его отпечаток
 * (sha256), восстановить значение невозможно — потерял, выпускай новый.
 */
import { ref, onMounted, computed } from 'vue'
import { http } from '@/api/client'
import { useToast } from '@/composables/useToast'
import { useConfirm } from '@/composables/useConfirm'
import { KeyRound, Plus, Copy, Check, Ban, ShieldAlert, X } from 'lucide-vue-next'

const toast = useToast()
const { confirm } = useConfirm()

interface ApiKeyItem {
  id: string
  name: string
  isActive: boolean
  lastUsed: string | null
  createdAt: string
  user: { id: string; name: string }
}

interface UserOption {
  id: string
  name: string
  login: string
  role: string
}

const keys = ref<ApiKeyItem[]>([])
const users = ref<UserOption[]>([])
const loading = ref(true)
const creating = ref(false)
const showForm = ref(false)

const form = ref({ name: '', userId: '' })

/** Показывается один раз после создания — потом значение не восстановить. */
const freshKey = ref<{ name: string; key: string } | null>(null)
const copied = ref(false)

const selectedUser = computed(() => users.value.find((u) => u.id === form.value.userId))

function fmtWhen(iso: string | null): string {
  if (!iso) return 'ни разу'
  return new Date(iso).toLocaleString('ru-RU', {
    timeZone: 'Europe/Moscow',
    day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit',
  })
}

async function load() {
  loading.value = true
  try {
    const [k, u] = await Promise.all([
      http.get<ApiKeyItem[]>('/api-keys'),
      http.get<UserOption[]>('/users'),
    ])
    keys.value = k
    users.value = u
    if (!form.value.userId && u.length) form.value.userId = u[0].id
  } catch (e: any) {
    toast.error(e.message || 'Не удалось загрузить ключи')
  } finally {
    loading.value = false
  }
}

async function create() {
  if (!form.value.name.trim()) return
  creating.value = true
  try {
    const res = await http.post<ApiKeyItem & { key: string }>('/api-keys', {
      name: form.value.name.trim(),
      userId: form.value.userId || undefined,
    })
    freshKey.value = { name: res.name, key: res.key }
    form.value.name = ''
    showForm.value = false
    await load()
  } catch (e: any) {
    toast.error(e.message || 'Не удалось создать ключ')
  } finally {
    creating.value = false
  }
}

async function copyKey() {
  if (!freshKey.value) return
  try {
    await navigator.clipboard.writeText(freshKey.value.key)
    copied.value = true
    setTimeout(() => { copied.value = false }, 2000)
  } catch {
    toast.error('Браузер не дал скопировать — выделите и скопируйте вручную')
  }
}

async function revoke(item: ApiKeyItem) {
  const ok = await confirm({
    title: 'Отозвать ключ',
    message: `Ключ «${item.name}» перестанет работать сразу. Всё, что им пользуется, отвалится.`,
    confirmLabel: 'Отозвать',
    variant: 'danger',
  })
  if (!ok) return
  try {
    await http.delete(`/api-keys/${item.id}`)
    toast.success('Ключ отозван')
    await load()
  } catch (e: any) {
    toast.error(e.message || 'Не удалось отозвать')
  }
}

onMounted(load)
</script>

<template>
  <div class="space-y-6">
    <div class="flex flex-wrap items-start justify-between gap-3">
      <div>
        <h2 class="flex items-center gap-2 text-lg font-semibold">
          <KeyRound :size="18" class="text-brand-500" />
          API-ключи
        </h2>
        <p class="mt-1 max-w-2xl text-sm text-gray-500 dark:text-gray-400">
          Доступ для программ, а не для людей: MCP-сервер, приёмник обращений из ERP, интеграции.
          Ключ работает <b>от имени выбранного пользователя</b> и имеет ровно его права —
          чтобы ограничить доступ, заведите отдельного пользователя с нужными разделами.
        </p>
      </div>
      <button
        class="inline-flex shrink-0 items-center gap-1.5 rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-brand-700"
        @click="showForm = !showForm"
      >
        <Plus :size="16" /> Новый ключ
      </button>
    </div>

    <!-- Свежий ключ: единственный момент, когда его видно -->
    <div
      v-if="freshKey"
      class="rounded-xl border-2 border-amber-300 bg-amber-50 p-4 dark:border-amber-700 dark:bg-amber-950/30"
    >
      <div class="mb-2 flex items-start justify-between gap-3">
        <div class="flex items-center gap-2 font-medium text-amber-900 dark:text-amber-200">
          <ShieldAlert :size="18" />
          Ключ «{{ freshKey.name }}» создан — скопируйте сейчас
        </div>
        <button class="text-amber-700 hover:text-amber-900 dark:text-amber-300" aria-label="Закрыть" @click="freshKey = null">
          <X :size="18" />
        </button>
      </div>
      <p class="mb-3 text-sm text-amber-800 dark:text-amber-300">
        В базе хранится только отпечаток ключа. Закроете это окно — значение не восстановить,
        придётся выпускать новый.
      </p>
      <div class="flex items-center gap-2">
        <code class="flex-1 overflow-x-auto rounded-lg bg-white px-3 py-2 font-mono text-sm dark:bg-gray-900">{{ freshKey.key }}</code>
        <button
          class="inline-flex shrink-0 items-center gap-1.5 rounded-lg bg-amber-600 px-3 py-2 text-sm font-medium text-white hover:bg-amber-700"
          @click="copyKey"
        >
          <component :is="copied ? Check : Copy" :size="16" />
          {{ copied ? 'Скопировано' : 'Копировать' }}
        </button>
      </div>
    </div>

    <!-- Форма создания -->
    <div v-if="showForm" class="rounded-xl border border-gray-200 p-4 dark:border-gray-700">
      <div class="grid gap-3 sm:grid-cols-2">
        <div>
          <label class="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300">Для чего ключ</label>
          <input
            v-model="form.name"
            type="text"
            maxlength="100"
            placeholder="Например: KB ERP — обращения"
            class="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500 dark:border-gray-600 dark:bg-gray-800"
            @keyup.enter="create"
          />
        </div>
        <div>
          <label class="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300">От имени пользователя</label>
          <select
            v-model="form.userId"
            class="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500 dark:border-gray-600 dark:bg-gray-800"
          >
            <option v-for="u in users" :key="u.id" :value="u.id">
              {{ u.name }} ({{ u.login }}) · {{ u.role }}
            </option>
          </select>
          <p v-if="selectedUser?.role === 'ADMIN'" class="mt-1 text-xs text-amber-600 dark:text-amber-400">
            У администратора полный доступ ко всему — для интеграции лучше завести
            отдельного пользователя с нужными разделами.
          </p>
        </div>
      </div>
      <div class="mt-3 flex gap-2">
        <button
          class="rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-brand-700 disabled:opacity-50"
          :disabled="!form.name.trim() || creating"
          @click="create"
        >
          {{ creating ? 'Создаю…' : 'Создать' }}
        </button>
        <button
          class="rounded-lg px-4 py-2 text-sm text-gray-600 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-800"
          @click="showForm = false"
        >
          Отмена
        </button>
      </div>
    </div>

    <!-- Список -->
    <div v-if="loading" class="py-8 text-center text-sm text-gray-500">Загружаю…</div>
    <div v-else-if="!keys.length" class="rounded-xl border border-dashed border-gray-300 py-10 text-center dark:border-gray-700">
      <KeyRound :size="28" class="mx-auto mb-2 text-gray-300" />
      <p class="text-sm text-gray-500">Ключей пока нет</p>
    </div>
    <div v-else class="overflow-x-auto">
      <table class="w-full text-sm">
        <thead>
          <tr class="border-b border-gray-200 text-left text-xs uppercase text-gray-400 dark:border-gray-700">
            <th class="pb-2 pr-4 font-medium">Назначение</th>
            <th class="pb-2 pr-4 font-medium">От имени</th>
            <th class="pb-2 pr-4 font-medium">Создан</th>
            <th class="pb-2 pr-4 font-medium">Последний раз</th>
            <th class="pb-2"></th>
          </tr>
        </thead>
        <tbody>
          <tr
            v-for="k in keys"
            :key="k.id"
            class="border-b border-gray-100 last:border-0 dark:border-gray-800"
            :class="!k.isActive && 'opacity-50'"
          >
            <td class="py-3 pr-4">
              <span class="font-medium">{{ k.name }}</span>
              <span v-if="!k.isActive" class="ml-2 rounded-full bg-gray-100 px-2 py-0.5 text-xs text-gray-500 dark:bg-gray-800">отозван</span>
            </td>
            <td class="py-3 pr-4 text-gray-600 dark:text-gray-400">{{ k.user?.name ?? '—' }}</td>
            <td class="py-3 pr-4 text-gray-500">{{ fmtWhen(k.createdAt) }}</td>
            <td class="py-3 pr-4 text-gray-500">{{ fmtWhen(k.lastUsed) }}</td>
            <td class="py-3 text-right">
              <button
                v-if="k.isActive"
                class="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-xs text-red-500 transition hover:bg-red-50 dark:hover:bg-red-900/20"
                @click="revoke(k)"
              >
                <Ban :size="14" /> Отозвать
              </button>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  </div>
</template>
