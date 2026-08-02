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
import { SECTIONS, SECTION_LABELS, type Section, type AccessLevel } from '@/composables/useSectionAccess'
import { KeyRound, Plus, Copy, Check, Ban, ShieldAlert, X, ChevronRight, ChevronDown } from 'lucide-vue-next'

const toast = useToast()
const { confirm } = useConfirm()

interface ApiKeyItem {
  id: string
  name: string
  isActive: boolean
  lastUsed: string | null
  createdAt: string
  sectionAccess: Record<string, AccessLevel> | null
  user: { id: string; name: string; role?: string }
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

/** Пустая карта разделов — все выключены. Иначе селекты рисуются пустыми. */
function emptyScope(): Record<string, AccessLevel> {
  return Object.fromEntries(SECTIONS.map((s) => [s, 'none' as AccessLevel]))
}

const form = ref({ name: '', userId: '', preset: 'tickets', scope: emptyScope() })
const showAdvanced = ref(false)

/**
 * Готовые варианты обычными словами. Ручной выбор разделов — редкий случай,
 * поэтому он спрятан за отдельным вариантом, а не висит перед глазами.
 */
const PRESETS = [
  {
    key: 'tickets',
    label: 'Принимать обращения',
    hint: 'для кнопки «Сообщить о проблеме» в приложениях и ночного разбора',
    build: () => ({ ...emptyScope(), tickets: 'full' as AccessLevel }),
  },
  {
    key: 'readonly',
    label: 'Только смотреть',
    hint: 'выгрузки и аналитика: читать можно всё, менять — ничего',
    build: () => Object.fromEntries(SECTIONS.map((s) => [s, 'view' as AccessLevel])),
  },
  {
    key: 'inherit',
    label: 'Полный доступ',
    hint: 'ключ может всё то же, что и его владелец. Осторожно',
    build: () => emptyScope(),
  },
  {
    key: 'custom',
    label: 'Выбрать разделы',
    hint: 'ручная настройка — если ни один вариант выше не подходит',
    build: () => emptyScope(),
  },
] as const

function openForm() {
  showForm.value = !showForm.value
  // Открываем всегда на самом частом варианте, а не на пустой матрице разделов.
  if (showForm.value) choosePreset('tickets')
}

function choosePreset(key: string) {
  form.value.preset = key
  const preset = PRESETS.find((p) => p.key === key)
  if (preset) form.value.scope = preset.build() as Record<string, AccessLevel>
}

/** Что реально уедет на сервер: пусто = права владельца целиком. */
const effectiveScope = computed(() => {
  if (form.value.preset === 'inherit') return {}
  return Object.fromEntries(Object.entries(form.value.scope).filter(([, v]) => v !== 'none'))
})

const scopeSummary = computed(() => {
  const entries = Object.entries(effectiveScope.value)
  if (!entries.length) return 'всё, что доступно владельцу ключа'
  if (entries.length > 4) return `${entries.length} разделов`
  return entries.map(([s, v]) => `${SECTION_LABELS[s as Section]} — ${v === 'full' ? 'полный' : 'чтение'}`).join(', ')
})

/** Что умеет уже созданный ключ — одной строкой для таблицы. */
function keyScopeLabel(k: ApiKeyItem): string {
  const scope = k.sectionAccess
  if (!scope || !Object.keys(scope).length) return `все права: ${k.user?.name ?? '—'}`
  const allowed = Object.entries(scope).filter(([, v]) => v !== 'none')
  if (allowed.length > 3) return `${allowed.length} разделов`
  return allowed.map(([s]) => SECTION_LABELS[s as Section] ?? s).join(', ')
}

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
    const scope = effectiveScope.value
    const res = await http.post<ApiKeyItem & { key: string }>('/api-keys', {
      name: form.value.name.trim(),
      userId: form.value.userId || undefined,
      sectionAccess: Object.keys(scope).length ? scope : undefined,
    })
    freshKey.value = { name: res.name, key: res.key }
    form.value.name = ''
    choosePreset('tickets')
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
          У ключа своя область действия — выдавайте ровно те разделы, которые нужны.
          Расширить права владельца ключ не может, только сузить.
        </p>
      </div>
      <button
        class="inline-flex shrink-0 items-center gap-1.5 rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-brand-700"
        @click="openForm"
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
      <label class="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300">Для чего этот ключ</label>
      <input
        v-model="form.name"
        type="text"
        maxlength="100"
        placeholder="Например: KB ERP — обращения"
        class="w-full max-w-lg rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500 dark:border-gray-600 dark:bg-gray-800"
        @keyup.enter="create"
      />

      <!-- Что ключ сможет делать: обычные слова, ручной выбор — отдельным вариантом -->
      <p class="mb-2 mt-5 text-sm font-medium text-gray-700 dark:text-gray-300">Что ключ сможет делать</p>
      <div class="max-w-lg space-y-2">
        <label
          v-for="p in PRESETS"
          :key="p.key"
          class="flex cursor-pointer items-start gap-3 rounded-xl border p-3 transition"
          :class="form.preset === p.key
            ? 'border-brand-500 bg-brand-50 dark:border-brand-400 dark:bg-brand-950/30'
            : 'border-gray-200 hover:border-gray-300 dark:border-gray-700 dark:hover:border-gray-600'"
        >
          <input
            type="radio"
            :value="p.key"
            :checked="form.preset === p.key"
            class="mt-1 accent-brand-600"
            @change="choosePreset(p.key)"
          />
          <span>
            <span class="block text-sm font-medium text-gray-900 dark:text-gray-100">{{ p.label }}</span>
            <span class="block text-xs text-gray-500 dark:text-gray-400">{{ p.hint }}</span>
          </span>
        </label>
      </div>

      <!-- Разделы показываем, только если человек сам этого попросил -->
      <div v-if="form.preset === 'custom'" class="mt-3 max-w-2xl rounded-xl bg-gray-50 p-3 dark:bg-gray-800/50">
        <div class="grid gap-x-6 gap-y-1 sm:grid-cols-2">
          <label
            v-for="s in SECTIONS"
            :key="s"
            class="flex items-center justify-between gap-2 rounded-lg px-2 py-1 text-sm"
          >
            <span class="truncate text-gray-700 dark:text-gray-300">{{ SECTION_LABELS[s] }}</span>
            <select
              v-model="form.scope[s]"
              class="shrink-0 rounded border border-gray-300 bg-white px-1.5 py-0.5 text-xs dark:border-gray-600 dark:bg-gray-800"
            >
              <option value="none">нельзя</option>
              <option value="view">смотреть</option>
              <option value="full">менять</option>
            </select>
          </label>
        </div>
      </div>

      <p class="mt-3 max-w-lg rounded-lg bg-gray-50 px-3 py-2 text-xs text-gray-600 dark:bg-gray-800/60 dark:text-gray-400">
        Ключ получит: <b>{{ scopeSummary }}</b>. Больше, чем может владелец ключа, он всё равно не сможет.
      </p>

      <!-- Владелец нужен редко — прячем, чтобы не отвлекал -->
      <button
        class="mt-3 flex items-center gap-1 text-xs text-gray-500 transition hover:text-gray-700 dark:hover:text-gray-300"
        @click="showAdvanced = !showAdvanced"
      >
        <component :is="showAdvanced ? ChevronDown : ChevronRight" :size="14" />
        Дополнительно: от чьего имени работает ключ
      </button>
      <div v-if="showAdvanced" class="mt-2 max-w-lg rounded-lg bg-gray-50 p-3 dark:bg-gray-800/50">
        <p class="mb-2 text-xs text-gray-500 dark:text-gray-400">
          Ключ всегда закреплён за человеком — это видно в списке и нужно, чтобы понимать,
          кто его выпустил. Обычно оставляйте себя.
        </p>
        <select
          v-model="form.userId"
          class="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm dark:border-gray-600 dark:bg-gray-800"
        >
          <option v-for="u in users" :key="u.id" :value="u.id">
            {{ u.name }} ({{ u.login }})
          </option>
        </select>
        <p v-if="selectedUser?.role === 'ADMIN' && form.preset === 'inherit'" class="mt-2 text-xs text-amber-600 dark:text-amber-400">
          Владелец — администратор, а доступ выбран «Полный». Такой ключ сможет всё,
          включая выпуск новых ключей. Лучше выбрать вариант поуже.
        </p>
      </div>

      <div class="mt-4 flex gap-2">
        <button
          class="rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-brand-700 disabled:opacity-50"
          :disabled="!form.name.trim() || creating"
          @click="create"
        >
          {{ creating ? 'Создаю…' : 'Создать ключ' }}
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
            <th class="pb-2 pr-4 font-medium">Что умеет</th>
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
            <td class="py-3 pr-4">
              <span
                class="rounded-full px-2 py-0.5 text-xs"
                :class="k.sectionAccess && Object.keys(k.sectionAccess).length
                  ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300'
                  : 'bg-amber-50 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300'"
              >
                {{ keyScopeLabel(k) }}
              </span>
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
