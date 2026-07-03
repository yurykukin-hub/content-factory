<script setup lang="ts">
/**
 * Настройки утреннего дайджеста (Фаза C1b) — панель поверх generic
 * PUT /api/settings/config (admin-only upsert). Ключи digest_* сейчас нигде
 * не выставлены в UI — этот модал первый, кто их читает/пишет.
 */
import { ref, computed, watch } from 'vue'
import { http } from '@/api/client'
import { useToast } from '@/composables/useToast'
import { useAuthStore } from '@/stores/auth'
import { AlertTriangle } from 'lucide-vue-next'
import { UiModal, UiSwitch, UiInput, UiTextarea, UiButton, UiSpinner } from '@/components/ui'

const props = defineProps<{ modelValue: boolean }>()
const emit = defineEmits<{ 'update:modelValue': [boolean] }>()

const toast = useToast()
const auth = useAuthStore()
const isAdmin = computed(() => auth.user?.role === 'ADMIN')

const loading = ref(false)
const saving = ref(false)
const original = ref<Record<string, string>>({})
const form = ref<Record<string, string>>({})

const enabled = computed<boolean>({
  get: () => form.value.digest_enabled === 'true',
  set: (v) => { form.value.digest_enabled = v ? 'true' : 'false' },
})
const rolesEnabled = computed<boolean>({
  get: () => form.value.digest_roles_enabled === 'true',
  set: (v) => { form.value.digest_roles_enabled = v ? 'true' : 'false' },
})
const autopilotEnabled = computed<boolean>({
  get: () => form.value.digest_autopilot_enabled === 'true',
  set: (v) => { form.value.digest_autopilot_enabled = v ? 'true' : 'false' },
})

async function load() {
  if (!isAdmin.value) return
  loading.value = true
  try {
    const res = await http.get<Record<string, string>>('/settings/config?prefix=digest_')
    original.value = { ...res }
    form.value = { ...res }
  } catch (e: any) {
    toast.error('Ошибка загрузки настроек: ' + (e.message || e))
  } finally {
    loading.value = false
  }
}

watch(() => props.modelValue, (v) => { if (v) load() })

function close() {
  emit('update:modelValue', false)
}

async function save() {
  saving.value = true
  try {
    const changed = Object.keys(form.value).filter(k => form.value[k] !== original.value[k])
    for (const key of changed) {
      await http.put('/settings/config', { key, value: form.value[key] })
    }
    toast.success('Настройки сохранены')
    close()
  } catch (e: any) {
    toast.error('Ошибка сохранения: ' + (e.message || e))
  } finally {
    saving.value = false
  }
}
</script>

<template>
  <UiModal :model-value="modelValue" title="Настройки дайджеста" size="md" @update:model-value="close">
    <div v-if="!isAdmin" class="py-8 text-center text-sm text-gray-500 dark:text-gray-400">
      Настройки дайджеста доступны только администратору.
    </div>
    <div v-else-if="loading" class="flex justify-center py-10">
      <UiSpinner size="lg" />
    </div>
    <div v-else class="space-y-5">
      <div class="flex items-center justify-between gap-3">
        <div>
          <p class="text-sm font-medium text-gray-900 dark:text-gray-100">Утренний дайджест</p>
          <p class="text-xs text-gray-400 dark:text-gray-500">AI-агент каждый день предлагает, что постить</p>
        </div>
        <UiSwitch v-model="enabled" />
      </div>

      <div class="flex items-center justify-between gap-3">
        <div>
          <p class="text-sm font-medium text-gray-900 dark:text-gray-100">Ритм-роли — 3 прогона в день</p>
          <p class="text-xs text-gray-400 dark:text-gray-500">Утро / день / вечер вместо одной пачки предложений</p>
        </div>
        <UiSwitch v-model="rolesEnabled" />
      </div>

      <div v-if="rolesEnabled" class="grid grid-cols-3 gap-3 pl-1">
        <UiInput v-model="form.digest_time_utc_morning" label="Утро (UTC)" placeholder="04:00" />
        <UiInput v-model="form.digest_time_utc_day" label="День (UTC)" placeholder="10:00" />
        <UiInput v-model="form.digest_time_utc_evening" label="Вечер (UTC)" placeholder="16:00" />
      </div>

      <UiTextarea
        v-model="form.digest_key_facts"
        label="Ключевые факты"
        :rows="3"
        placeholder="Например: акция до 10 июля, новый маршрут «Закат»…"
        hint="Агент учитывает это при генерации предложений"
      />

      <div class="rounded-lg border border-danger-200 dark:border-danger-500/30 bg-danger-50 dark:bg-danger-500/10 p-3.5">
        <div class="flex items-center justify-between gap-3">
          <div class="flex items-start gap-2 min-w-0">
            <AlertTriangle :size="16" class="text-danger-600 dark:text-danger-400 shrink-0 mt-0.5" />
            <div class="min-w-0">
              <p class="text-sm font-medium text-danger-700 dark:text-danger-400">Автопилот</p>
              <p class="text-xs text-danger-600/80 dark:text-danger-400/70">
                Автопилот публикует сам, без вашего одобрения. Включайте осознанно.
              </p>
            </div>
          </div>
          <UiSwitch v-model="autopilotEnabled" />
        </div>
      </div>
    </div>

    <template v-if="isAdmin && !loading" #footer>
      <UiButton variant="secondary" @click="close">Отмена</UiButton>
      <UiButton :loading="saving" @click="save">Сохранить</UiButton>
    </template>
  </UiModal>
</template>
