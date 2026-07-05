<script setup lang="ts">
import { onMounted } from 'vue'
import { Plus, Loader2, Save, Pencil, Trash2 } from 'lucide-vue-next'
import { useStoryTemplates } from '@/composables/useStoryTemplates'

const props = defineProps<{ businessId: string }>()

const { templates, editingTpl, savingTpl, loadTemplates, saveTpl, deleteTpl, newTpl } = useStoryTemplates(props.businessId)

onMounted(() => {
  loadTemplates()
})
</script>

<template>
  <div class="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 p-6">
    <div class="flex items-center justify-between mb-4">
      <h2 class="text-lg font-bold">Шаблоны Stories</h2>
      <button @click="newTpl" class="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-brand-600 hover:bg-brand-700 text-white text-sm font-medium">
        <Plus :size="14" /> Создать
      </button>
    </div>

    <!-- Edit form -->
    <div v-if="editingTpl" class="mb-6 p-4 rounded-xl bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 space-y-3">
      <div class="grid grid-cols-2 gap-3">
        <div>
          <label class="block text-xs font-medium mb-1">Название</label>
          <input v-model="editingTpl.name" class="w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 text-sm" placeholder="Акция" />
        </div>
        <div>
          <label class="block text-xs font-medium mb-1">Эмодзи</label>
          <input v-model="editingTpl.emoji" class="w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 text-sm" placeholder="🔥" maxlength="4" />
        </div>
      </div>
      <div>
        <label class="block text-xs font-medium mb-1">Текст на фото</label>
        <textarea v-model="editingTpl.overlayText" rows="2" class="w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 text-sm" placeholder="Скидка 20% на утренний прокат!" />
      </div>
      <div class="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <div>
          <label class="block text-xs font-medium mb-1">Позиция</label>
          <select v-model="editingTpl.textPosition" class="w-full px-2 py-1.5 rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 text-xs">
            <option value="top">Вверху</option>
            <option value="center">Центр</option>
            <option value="bottom">Внизу</option>
          </select>
        </div>
        <div>
          <label class="block text-xs font-medium mb-1">Размер</label>
          <select v-model="editingTpl.fontSize" class="w-full px-2 py-1.5 rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 text-xs">
            <option value="S">S</option>
            <option value="M">M</option>
            <option value="L">L</option>
          </select>
        </div>
        <div>
          <label class="block text-xs font-medium mb-1">Подложка</label>
          <select v-model="editingTpl.bgStyle" class="w-full px-2 py-1.5 rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 text-xs">
            <option value="dark">Тёмная</option>
            <option value="light">Светлая</option>
            <option value="none">Без</option>
          </select>
        </div>
        <div>
          <label class="block text-xs font-medium mb-1">Цвет текста</label>
          <input v-model="editingTpl.textColor" type="color" class="w-full h-8 rounded-lg border border-gray-300 dark:border-gray-700 cursor-pointer" />
        </div>
      </div>
      <div>
        <label class="block text-xs font-medium mb-1">Кнопка VK</label>
        <select v-model="editingTpl.linkType" class="w-full px-2 py-1.5 rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 text-xs">
          <option value="">Без ссылки</option>
          <option value="learn_more">Подробнее</option>
          <option value="book">Забронировать</option>
          <option value="order">Заказать</option>
        </select>
      </div>
      <div class="flex gap-2">
        <button @click="saveTpl" :disabled="savingTpl || !editingTpl.name?.trim()"
          class="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-brand-600 hover:bg-brand-700 text-white text-sm font-medium disabled:opacity-50">
          <Loader2 v-if="savingTpl" :size="14" class="animate-spin" /><Save v-else :size="14" />
          {{ editingTpl.id ? 'Сохранить' : 'Создать' }}
        </button>
        <button @click="editingTpl = null" class="px-4 py-2 rounded-lg text-sm text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-800">Отмена</button>
      </div>
    </div>

    <!-- Templates list -->
    <div v-if="templates.length" class="space-y-2">
      <div v-for="tpl in templates" :key="tpl.id"
        class="flex items-center justify-between p-3 rounded-lg bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700">
        <div class="flex items-center gap-2 min-w-0">
          <span v-if="tpl.emoji" class="text-lg">{{ tpl.emoji }}</span>
          <div class="min-w-0">
            <div class="text-sm font-medium truncate">{{ tpl.name }}</div>
            <div v-if="tpl.overlayText" class="text-xs text-gray-400 truncate">{{ tpl.overlayText }}</div>
          </div>
        </div>
        <div class="flex gap-1 shrink-0">
          <button @click="editingTpl = { ...tpl }" aria-label="Редактировать шаблон" title="Редактировать шаблон" class="p-1.5 rounded-lg hover:bg-gray-200 dark:hover:bg-gray-700">
            <Pencil :size="14" class="text-gray-400" />
          </button>
          <button @click="deleteTpl(tpl.id)" aria-label="Удалить шаблон" title="Удалить шаблон" class="p-1.5 rounded-lg hover:bg-red-100 dark:hover:bg-red-900">
            <Trash2 :size="14" class="text-red-400" />
          </button>
        </div>
      </div>
    </div>
    <div v-else-if="!editingTpl" class="text-center py-8 text-sm text-gray-400">
      Шаблонов пока нет. Нажмите «Создать» чтобы добавить первый.
    </div>
  </div>
</template>
