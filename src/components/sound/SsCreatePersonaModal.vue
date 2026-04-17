<script setup lang="ts">
/**
 * Modal for creating a Voice Persona from a completed music track.
 * Uses KIE.ai Generate Persona API (Suno V5.5).
 */
import { ref, computed } from 'vue'
import { UserCircle, X, Loader2, Music } from 'lucide-vue-next'
import { http } from '@/api/client'
import { useToast } from '@/composables/useToast'

interface CompletedSession {
  id: string
  title: string
  musicTitle: string | null
  prompt: string
  completedTaskId: string | null
  kieAudioId: string | null
  audioUrl: string | null
}

const props = defineProps<{
  show: boolean
  sessions: CompletedSession[]
}>()

const emit = defineEmits<{
  close: []
  created: []
}>()

const toast = useToast()

// Form state
const selectedSessionId = ref<string | null>(null)
const name = ref('')
const description = ref('')
const gender = ref<'f' | 'm' | 'neutral'>('f')
const vocalStart = ref(0)
const vocalEnd = ref(30)
const style = ref('')
const creating = ref(false)

const completedSessions = computed(() =>
  props.sessions.filter(s => s.completedTaskId && s.kieAudioId)
)

const selectedSession = computed(() =>
  completedSessions.value.find(s => s.id === selectedSessionId.value)
)

const canCreate = computed(() =>
  selectedSessionId.value && name.value.trim() && (vocalEnd.value - vocalStart.value) >= 10
)

const segmentLength = computed(() => vocalEnd.value - vocalStart.value)

async function create() {
  if (!canCreate.value || !selectedSessionId.value) return
  creating.value = true

  try {
    await http.post('/music/personas/from-track', {
      sessionId: selectedSessionId.value,
      name: name.value.trim(),
      description: description.value.trim(),
      gender: gender.value,
      vocalStart: vocalStart.value,
      vocalEnd: vocalEnd.value,
      style: style.value.trim() || undefined,
    })

    toast.success('Голосовая персона создана!')
    emit('created')
    emit('close')
    resetForm()
  } catch (err: any) {
    toast.error(err.message || 'Ошибка создания персоны')
  } finally {
    creating.value = false
  }
}

function resetForm() {
  selectedSessionId.value = null
  name.value = ''
  description.value = ''
  gender.value = 'f'
  vocalStart.value = 0
  vocalEnd.value = 30
  style.value = ''
}
</script>

<template>
  <Teleport to="body">
    <div v-if="show" class="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div class="absolute inset-0 bg-black/50" @click="emit('close')" />

      <div class="relative bg-white dark:bg-gray-900 rounded-2xl shadow-2xl max-w-lg w-full max-h-[85vh] overflow-y-auto">
        <!-- Header -->
        <div class="flex items-center justify-between px-5 py-4 border-b border-gray-100 dark:border-gray-800">
          <div class="flex items-center gap-2">
            <UserCircle :size="18" class="text-fuchsia-500" />
            <h3 class="text-base font-semibold text-gray-800 dark:text-gray-200">Создать Voice Persona</h3>
          </div>
          <button @click="emit('close')" class="p-1.5 rounded-lg text-gray-400 hover:text-gray-600 hover:bg-gray-100 dark:hover:bg-gray-800">
            <X :size="16" />
          </button>
        </div>

        <!-- Content -->
        <div class="px-5 py-4 space-y-4">
          <!-- Info -->
          <div class="p-3 rounded-lg bg-fuchsia-50 dark:bg-fuchsia-900/20 text-xs text-fuchsia-700 dark:text-fuchsia-300">
            Voice Clone создаёт голосовую персону из готового трека. Выберите трек с хорошим вокалом (10-30 сек чистого голоса).
          </div>

          <!-- Select track -->
          <div>
            <label class="text-[11px] font-medium text-gray-500 uppercase tracking-wide">Исходный трек</label>
            <select v-model="selectedSessionId"
              class="w-full mt-1 px-3 py-2 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 text-sm focus:outline-none focus:ring-2 focus:ring-fuchsia-500/40">
              <option :value="null" disabled>Выберите завершённый трек...</option>
              <option v-for="s in completedSessions" :key="s.id" :value="s.id">
                {{ s.musicTitle || s.title || s.prompt?.slice(0, 40) || 'Без названия' }}
              </option>
            </select>
            <p v-if="!completedSessions.length" class="mt-1 text-[10px] text-red-500">
              Нет треков с KIE данными. Сгенерируйте трек с вокалом.
            </p>
          </div>

          <!-- Name -->
          <div>
            <label class="text-[11px] font-medium text-gray-500 uppercase tracking-wide">Название персоны</label>
            <input v-model="name" maxlength="100"
              placeholder="Женский инди-вокал"
              class="w-full mt-1 px-3 py-2 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 text-sm placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-fuchsia-500/40" />
          </div>

          <!-- Description -->
          <div>
            <label class="text-[11px] font-medium text-gray-500 uppercase tracking-wide">Описание голоса</label>
            <textarea v-model="description" maxlength="500" rows="2"
              placeholder="Мягкий женский голос, инди-фолк стиль, тёплый тембр с лёгкой хрипотцой"
              class="w-full mt-1 px-3 py-2 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 text-sm placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-fuchsia-500/40 resize-none" />
          </div>

          <!-- Gender -->
          <div>
            <label class="text-[11px] font-medium text-gray-500 uppercase tracking-wide">Пол</label>
            <div class="flex gap-2 mt-1">
              <button v-for="g in [{ id: 'f' as const, label: 'Женский' }, { id: 'm' as const, label: 'Мужской' }, { id: 'neutral' as const, label: 'Нейтральный' }]"
                :key="g.id" @click="gender = g.id"
                :class="[
                  'px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors',
                  gender === g.id
                    ? 'border-fuchsia-300 bg-fuchsia-50 dark:bg-fuchsia-900/20 text-fuchsia-600'
                    : 'border-gray-200 dark:border-gray-700 text-gray-500 hover:border-fuchsia-300'
                ]">
                {{ g.label }}
              </button>
            </div>
          </div>

          <!-- Vocal segment (start/end) -->
          <div>
            <label class="text-[11px] font-medium text-gray-500 uppercase tracking-wide">
              Вокальный сегмент
              <span class="normal-case text-gray-400">(10-30 сек чистого голоса)</span>
            </label>
            <div class="flex items-center gap-3 mt-1">
              <div class="flex items-center gap-1">
                <span class="text-[10px] text-gray-400">Начало:</span>
                <input v-model.number="vocalStart" type="number" min="0" step="1"
                  class="w-16 px-2 py-1 rounded border border-gray-200 dark:border-gray-700 text-sm text-center focus:outline-none focus:ring-2 focus:ring-fuchsia-500/40" />
                <span class="text-[10px] text-gray-400">сек</span>
              </div>
              <div class="flex items-center gap-1">
                <span class="text-[10px] text-gray-400">Конец:</span>
                <input v-model.number="vocalEnd" type="number" min="10" step="1"
                  class="w-16 px-2 py-1 rounded border border-gray-200 dark:border-gray-700 text-sm text-center focus:outline-none focus:ring-2 focus:ring-fuchsia-500/40" />
                <span class="text-[10px] text-gray-400">сек</span>
              </div>
              <span :class="[
                'text-[10px] font-medium',
                segmentLength >= 10 && segmentLength <= 30 ? 'text-emerald-500' : 'text-red-500'
              ]">
                {{ segmentLength }}с {{ segmentLength >= 10 && segmentLength <= 30 ? '✓' : '(нужно 10-30с)' }}
              </span>
            </div>
          </div>

          <!-- Style tags (optional) -->
          <div>
            <label class="text-[11px] font-medium text-gray-500 uppercase tracking-wide">
              Стиль <span class="normal-case text-gray-400">(опционально)</span>
            </label>
            <input v-model="style" maxlength="200"
              placeholder="Electronic Pop, Indie Folk"
              class="w-full mt-1 px-3 py-2 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 text-sm placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-fuchsia-500/40" />
          </div>
        </div>

        <!-- Footer -->
        <div class="px-5 py-4 border-t border-gray-100 dark:border-gray-800 flex justify-end gap-2">
          <button @click="emit('close')"
            class="px-4 py-2 rounded-xl text-sm font-medium text-gray-600 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors">
            Отмена
          </button>
          <button @click="create" :disabled="!canCreate || creating"
            class="flex items-center gap-1.5 px-5 py-2 rounded-xl text-sm font-medium bg-fuchsia-600 hover:bg-fuchsia-700 text-white disabled:opacity-50 transition-colors">
            <Loader2 v-if="creating" :size="14" class="animate-spin" />
            <UserCircle v-else :size="14" />
            {{ creating ? 'Создаю...' : 'Создать персону' }}
          </button>
        </div>
      </div>
    </div>
  </Teleport>
</template>
