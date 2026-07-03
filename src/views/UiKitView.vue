<script setup lang="ts">
import { ref } from 'vue'
import {
  UiButton,
  UiInput,
  UiSelect,
  UiTextarea,
  UiModal,
  UiConfirmDialog,
  UiDropdown,
  UiTabs,
  UiTable,
  UiBadge,
  UiCard,
  UiEmptyState,
  UiSkeleton,
  UiSpinner,
  UiTooltip,
  UiSwitch,
  UiImage,
} from '@/components/ui'
import type { TableColumn } from '@/components/ui'
import { useToast } from '@/composables/useToast'
import { useConfirm } from '@/composables/useConfirm'
import { RotateCw, Trash2, Settings, Plus, Inbox } from 'lucide-vue-next'

const toast = useToast()
const { confirm } = useConfirm()

// Inputs
const textValue = ref('')
const errorTextValue = ref('плохое значение')
const selectValue = ref('')
const textareaValue = ref('')
const autosizeValue = ref('')

const selectOptions = [
  { label: 'НаWоде', value: 'nawode' },
  { label: 'Kukin Brothers', value: 'kb' },
  { label: 'Inpulse Production', value: 'inpulse' },
]

// Modal
const modalOpen = ref(false)

// Tabs
const underlineTab = ref('one')
const segmentedTab = ref('list')
const underlineTabs = [
  { key: 'one', label: 'Черновики', count: 3 },
  { key: 'two', label: 'Запланировано' },
  { key: 'three', label: 'Опубликовано', count: 12 },
]
const segmentedTabs = [
  { key: 'list', label: 'Список' },
  { key: 'cards', label: 'Карточки' },
]

// Table
const columns: TableColumn[] = [
  { key: 'name', label: 'Пост' },
  { key: 'status', label: 'Статус' },
  { key: 'date', label: 'Дата', align: 'right' },
]
const rows = [
  { name: 'Пост про НаWоде', status: 'Опубликован', date: '01.07.2026' },
  { name: 'Сторис Inpulse', status: 'Черновик', date: '02.07.2026' },
  { name: 'Карусель KB', status: 'Запланирован', date: '03.07.2026' },
]
const tableLoading = ref(false)
const tableEmpty = ref(false)

function toggleTableLoading() {
  tableLoading.value = true
  setTimeout(() => { tableLoading.value = false }, 1200)
}

// Buttons: loading demo
const loadingDemo = ref(false)
function toggleLoadingDemo() {
  loadingDemo.value = true
  setTimeout(() => { loadingDemo.value = false }, 1500)
}

// Switches
const switchOn = ref(true)
const switchOff = ref(false)

// Confirm demo
async function onDeleteDemo() {
  const ok = await confirm({
    title: 'Удалить элемент?',
    message: 'Действие нельзя отменить. Это демо-диалог UiConfirmDialog.',
    variant: 'danger',
    confirmLabel: 'Удалить',
  })
  toast[ok ? 'success' : 'info'](ok ? 'Удалено (демо)' : 'Отменено')
}

// Toast demo
function fireToast(type: 'success' | 'error' | 'warning' | 'info') {
  const messages: Record<string, string> = {
    success: 'Пост опубликован',
    error: 'Не удалось сохранить',
    warning: 'Баланс подходит к концу',
    info: 'Сессия автосохранена',
  }
  toast[type](messages[type])
}

// Image
const brokenImageSrc = 'https://example.invalid/does-not-exist.jpg'
</script>

<template>
  <div class="min-h-screen bg-gray-50 dark:bg-gray-900 p-6 space-y-10">
    <header>
      <h1 class="text-2xl font-bold text-gray-900 dark:text-gray-100">UI Kit — витрина примитивов</h1>
      <p class="mt-1 text-sm text-gray-500 dark:text-gray-400">
        Страница только для визуального QA (Фаза A рефактора). Переключите тёмную тему в шапке приложения —
        каждый компонент ниже должен одинаково хорошо выглядеть в обоих режимах.
      </p>
    </header>

    <!-- UiButton -->
    <section class="space-y-4">
      <h2 class="text-lg font-semibold text-gray-900 dark:text-gray-100">UiButton</h2>
      <UiCard>
        <div class="flex flex-wrap items-center gap-3">
          <UiButton variant="primary">Primary</UiButton>
          <UiButton variant="secondary">Secondary</UiButton>
          <UiButton variant="danger">Danger</UiButton>
          <UiButton variant="ghost">Ghost</UiButton>
        </div>
        <div class="mt-4 flex flex-wrap items-center gap-3">
          <UiButton size="sm">Small</UiButton>
          <UiButton size="md">Medium</UiButton>
          <UiButton size="lg">Large</UiButton>
        </div>
        <div class="mt-4 flex flex-wrap items-center gap-3">
          <UiButton :loading="loadingDemo" @click="toggleLoadingDemo">
            {{ loadingDemo ? 'Загрузка…' : 'Нажми (loading demo)' }}
          </UiButton>
          <UiButton disabled>Disabled</UiButton>
          <UiTooltip text="Обновить">
            <UiButton icon-only aria-label="Обновить" variant="secondary">
              <RotateCw class="w-4 h-4" />
            </UiButton>
          </UiTooltip>
          <UiTooltip text="Удалить" position="bottom">
            <UiButton icon-only aria-label="Удалить" variant="danger" @click="onDeleteDemo">
              <Trash2 class="w-4 h-4" />
            </UiButton>
          </UiTooltip>
        </div>
      </UiCard>
    </section>

    <!-- Inputs -->
    <section class="space-y-4">
      <h2 class="text-lg font-semibold text-gray-900 dark:text-gray-100">UiInput / UiSelect / UiTextarea</h2>
      <UiCard>
        <div class="grid gap-4 md:grid-cols-2">
          <UiInput v-model="textValue" label="Название проекта" placeholder="Например, НаWоде" hint="Отображается в списке бизнесов" />
          <UiInput v-model="errorTextValue" label="Email" error="Введите корректный email" required />
          <UiSelect v-model="selectValue" label="Бизнес" :options="selectOptions" hint="Выберите проект" />
          <UiSelect v-model="selectValue" label="Бизнес (ошибка)" :options="selectOptions" error="Обязательное поле" required />
        </div>
        <div class="mt-4 grid gap-4 md:grid-cols-2">
          <UiTextarea v-model="textareaValue" label="Текст поста" :rows="4" :max-length="280" hint="Черновик автосохраняется" />
          <UiTextarea v-model="autosizeValue" label="Автовысота" autosize placeholder="Печатайте — блок растёт сам…" />
        </div>
      </UiCard>
    </section>

    <!-- UiModal / UiConfirmDialog -->
    <section class="space-y-4">
      <h2 class="text-lg font-semibold text-gray-900 dark:text-gray-100">UiModal / UiConfirmDialog</h2>
      <UiCard>
        <div class="flex flex-wrap items-center gap-3">
          <UiButton @click="modalOpen = true">Открыть модалку</UiButton>
          <UiButton variant="danger" @click="onDeleteDemo">Открыть confirm-диалог</UiButton>
        </div>
        <UiModal v-model="modalOpen" title="Пример модалки" size="md">
          <p class="text-sm text-gray-600 dark:text-gray-300">
            Focus-trap: Tab/Shift+Tab не выходят за пределы диалога. Escape закрывает (если не persistent).
            Фокус возвращается на кнопку-триггер после закрытия.
          </p>
          <div class="mt-4">
            <UiInput label="Поле внутри модалки" placeholder="Проверка focus-trap" />
          </div>
          <template #footer>
            <UiButton variant="secondary" @click="modalOpen = false">Отмена</UiButton>
            <UiButton @click="modalOpen = false">Сохранить</UiButton>
          </template>
        </UiModal>
      </UiCard>
    </section>

    <!-- UiDropdown -->
    <section class="space-y-4">
      <h2 class="text-lg font-semibold text-gray-900 dark:text-gray-100">UiDropdown</h2>
      <UiCard>
        <UiDropdown align="left">
          <template #trigger>
            <UiButton variant="secondary">
              Опубликовать
              <template #icon><Settings class="w-4 h-4" /></template>
            </UiButton>
          </template>
          <template #items>
            <button type="button" role="menuitem" class="w-full text-left px-3 py-2 text-sm text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-700 focus-visible:outline-none focus-visible:bg-gray-50 dark:focus-visible:bg-gray-700">
              Сейчас
            </button>
            <button type="button" role="menuitem" class="w-full text-left px-3 py-2 text-sm text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-700 focus-visible:outline-none focus-visible:bg-gray-50 dark:focus-visible:bg-gray-700">
              Запланировать
            </button>
            <button type="button" role="menuitem" class="w-full text-left px-3 py-2 text-sm text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-700 focus-visible:outline-none focus-visible:bg-gray-50 dark:focus-visible:bg-gray-700">
              Черновик
            </button>
          </template>
        </UiDropdown>
      </UiCard>
    </section>

    <!-- UiTabs -->
    <section class="space-y-4">
      <h2 class="text-lg font-semibold text-gray-900 dark:text-gray-100">UiTabs</h2>
      <UiCard>
        <p class="mb-2 text-xs font-medium text-gray-400 dark:text-gray-500 uppercase">variant="underline"</p>
        <UiTabs v-model="underlineTab" :tabs="underlineTabs" variant="underline" />
        <p class="mt-6 mb-2 text-xs font-medium text-gray-400 dark:text-gray-500 uppercase">variant="segmented"</p>
        <UiTabs v-model="segmentedTab" :tabs="segmentedTabs" variant="segmented" />
      </UiCard>
    </section>

    <!-- UiTable -->
    <section class="space-y-4">
      <h2 class="text-lg font-semibold text-gray-900 dark:text-gray-100">UiTable</h2>
      <UiCard :padding="false">
        <div class="flex flex-wrap items-center gap-3 p-4 border-b border-gray-100 dark:border-gray-700/60">
          <UiButton size="sm" variant="secondary" @click="toggleTableLoading">Показать loading</UiButton>
          <UiButton size="sm" variant="secondary" @click="tableEmpty = !tableEmpty">
            {{ tableEmpty ? 'Показать данные' : 'Показать empty' }}
          </UiButton>
        </div>
        <UiTable
          caption="Демо-таблица постов"
          :columns="columns"
          :rows="tableEmpty ? [] : rows"
          :loading="tableLoading"
          empty-title="Постов пока нет"
          empty-description="Создайте первый пост, чтобы он появился здесь"
        >
          <template #cell-status="{ value }">
            <UiBadge :variant="value === 'Опубликован' ? 'success' : value === 'Черновик' ? 'default' : 'info'">
              {{ value }}
            </UiBadge>
          </template>
        </UiTable>
      </UiCard>
    </section>

    <!-- UiBadge -->
    <section class="space-y-4">
      <h2 class="text-lg font-semibold text-gray-900 dark:text-gray-100">UiBadge</h2>
      <UiCard>
        <div class="flex flex-wrap items-center gap-2">
          <UiBadge variant="default">Default</UiBadge>
          <UiBadge variant="brand">Brand</UiBadge>
          <UiBadge variant="success">Success</UiBadge>
          <UiBadge variant="warning">Warning</UiBadge>
          <UiBadge variant="danger">Danger</UiBadge>
          <UiBadge variant="info">Info</UiBadge>
        </div>
      </UiCard>
    </section>

    <!-- UiCard -->
    <section class="space-y-4">
      <h2 class="text-lg font-semibold text-gray-900 dark:text-gray-100">UiCard</h2>
      <div class="grid gap-4 md:grid-cols-3">
        <UiCard>
          <p class="text-sm text-gray-600 dark:text-gray-300">Обычная карточка (padding, border)</p>
        </UiCard>
        <UiCard hover>
          <p class="text-sm text-gray-600 dark:text-gray-300">hover=true — тень + курсор pointer + focus ring</p>
        </UiCard>
        <UiCard no-border :padding="false">
          <template #header>
            <p class="font-medium text-gray-900 dark:text-gray-100">Заголовок</p>
          </template>
          <div class="p-5">
            <p class="text-sm text-gray-600 dark:text-gray-300">noBorder + header/footer слоты</p>
          </div>
          <template #footer>
            <p class="text-xs text-gray-400">Футер карточки</p>
          </template>
        </UiCard>
      </div>
    </section>

    <!-- UiEmptyState -->
    <section class="space-y-4">
      <h2 class="text-lg font-semibold text-gray-900 dark:text-gray-100">UiEmptyState</h2>
      <UiCard :padding="false">
        <UiEmptyState title="Пока пусто" description="Здесь появятся элементы после первого действия">
          <template #icon><Inbox class="w-10 h-10" /></template>
          <template #action>
            <UiButton size="sm">
              <template #icon><Plus class="w-4 h-4" /></template>
              Создать
            </UiButton>
          </template>
        </UiEmptyState>
      </UiCard>
    </section>

    <!-- UiSkeleton / UiSpinner -->
    <section class="space-y-4">
      <h2 class="text-lg font-semibold text-gray-900 dark:text-gray-100">UiSkeleton / UiSpinner</h2>
      <UiCard>
        <div class="grid gap-6 md:grid-cols-2">
          <div class="space-y-3">
            <p class="text-xs font-medium text-gray-400 dark:text-gray-500 uppercase">line / circle</p>
            <UiSkeleton variant="line" width="70%" />
            <UiSkeleton variant="line" width="40%" />
            <UiSkeleton variant="circle" />
          </div>
          <div class="space-y-3">
            <p class="text-xs font-medium text-gray-400 dark:text-gray-500 uppercase">card / table</p>
            <UiSkeleton variant="card" />
          </div>
        </div>
        <div class="mt-6 flex items-center gap-4">
          <UiSpinner size="sm" class="text-brand-600 dark:text-brand-400" />
          <UiSpinner size="md" class="text-brand-600 dark:text-brand-400" />
          <UiSpinner size="lg" class="text-brand-600 dark:text-brand-400" />
        </div>
      </UiCard>
    </section>

    <!-- UiTooltip -->
    <section class="space-y-4">
      <h2 class="text-lg font-semibold text-gray-900 dark:text-gray-100">UiTooltip</h2>
      <UiCard>
        <div class="flex flex-wrap items-center gap-6">
          <UiTooltip text="Сверху (по умолчанию)" position="top">
            <UiButton icon-only aria-label="Настройки" variant="secondary"><Settings class="w-4 h-4" /></UiButton>
          </UiTooltip>
          <UiTooltip text="Снизу" position="bottom">
            <UiButton icon-only aria-label="Настройки" variant="secondary"><Settings class="w-4 h-4" /></UiButton>
          </UiTooltip>
          <UiTooltip text="Слева" position="left">
            <UiButton icon-only aria-label="Настройки" variant="secondary"><Settings class="w-4 h-4" /></UiButton>
          </UiTooltip>
          <UiTooltip text="Справа" position="right">
            <UiButton icon-only aria-label="Настройки" variant="secondary"><Settings class="w-4 h-4" /></UiButton>
          </UiTooltip>
          <p class="text-xs text-gray-400">Наведите или переключитесь Tab-ом — тултип появляется и по фокусу с клавиатуры</p>
        </div>
      </UiCard>
    </section>

    <!-- UiSwitch -->
    <section class="space-y-4">
      <h2 class="text-lg font-semibold text-gray-900 dark:text-gray-100">UiSwitch</h2>
      <UiCard>
        <div class="flex flex-col gap-3">
          <UiSwitch v-model="switchOn" label="Утренний дайджест (вкл)" />
          <UiSwitch v-model="switchOff" label="Автопилот (выкл)" />
          <UiSwitch :model-value="true" disabled label="Заблокировано (disabled)" />
        </div>
      </UiCard>
    </section>

    <!-- UiImage -->
    <section class="space-y-4">
      <h2 class="text-lg font-semibold text-gray-900 dark:text-gray-100">UiImage</h2>
      <UiCard>
        <div class="grid grid-cols-2 gap-4 md:grid-cols-4">
          <UiImage
            src="https://placehold.co/400x400/d946ef/white?text=CF"
            alt="Пример квадратного изображения"
            aspect="1/1"
          />
          <UiImage
            src="https://placehold.co/640x360/d946ef/white?text=16:9"
            alt="Пример видео-превью 16:9"
            aspect="16/9"
          />
          <UiImage :src="null" alt="Нет src — плейсхолдер по умолчанию" aspect="1/1" />
          <UiImage :src="brokenImageSrc" alt="Битая ссылка — fallback после ошибки загрузки" aspect="1/1" />
        </div>
      </UiCard>
    </section>

    <!-- UiToastContainer -->
    <section class="space-y-4">
      <h2 class="text-lg font-semibold text-gray-900 dark:text-gray-100">Toasts (useToast)</h2>
      <UiCard>
        <div class="flex flex-wrap items-center gap-3">
          <UiButton size="sm" variant="secondary" @click="fireToast('success')">success</UiButton>
          <UiButton size="sm" variant="secondary" @click="fireToast('error')">error</UiButton>
          <UiButton size="sm" variant="secondary" @click="fireToast('warning')">warning</UiButton>
          <UiButton size="sm" variant="secondary" @click="fireToast('info')">info</UiButton>
        </div>
        <p class="mt-2 text-xs text-gray-400">
          Использует старый ToastContainer.vue (уже смонтирован в App.vue). UiToastContainer.vue создан, но
          не подключён — переключение делает Юрий вручную после ревью.
        </p>
      </UiCard>
    </section>

    <UiConfirmDialog />
  </div>
</template>
