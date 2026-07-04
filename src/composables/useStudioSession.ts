import {
  ref, computed, watch, onMounted, onBeforeUnmount, onDeactivated,
  type Ref, type WatchSource,
} from 'vue'
import { http, TAB_ID } from '@/api/client'
import { useToast } from '@/composables/useToast'
import { useStudioSSE } from '@/composables/useStudioSSE'

/**
 * Единый движок сессий генеративных студий (Photo/Sound).
 *
 * Раньше ~180 строк логики (автосейв с debounce, CRUD сессий, SSE-синк,
 * lifecycle) были скопированы почти байт-в-байт в Photo/Sound/Video студии.
 * Доменное здесь — только маппинг полей (`buildSavePayload`/`applySession`/
 * `resetState`), реактивные источники автосейва (`watchSources`) и пара
 * тостовых хуков. Всё остальное — общая механика.
 *
 * `generating`/`generatingStartedAt` ВЫЧИСЛЯЮТСЯ из статуса текущей сессии —
 * единый источник правды (переживает F5/навигацию/смену устройства). Студии
 * больше не ведут эти флаги руками.
 *
 * Auto-save гварды (сохранены дословно из исходных студий):
 * - debounce 2000 мс;
 * - `generating`/`completed` → сейв пропускается;
 * - `failed` → сохраняется ТОЛЬКО `chatHistory` (не затираем остальные поля);
 * - `flushBeforeUnload` → `fetch` PUT с `keepalive:true` + заголовок `X-Tab-ID`.
 *
 * @param opts.type               тип студии — уходит в `?type=` и в POST body
 * @param opts.businessId         текущий бизнес (реактивный)
 * @param opts.buildSavePayload   доменные поля для PUT (ОБЯЗАН включать ключ `chatHistory`)
 * @param opts.applySession       разложить полную сессию в доменный стейт (currentSessionId ставит движок сам)
 * @param opts.resetState         очистить доменный стейт (новая/пустая сессия)
 * @param opts.watchSources       реактивные источники автосейва (массив ref-ов; вызывается один раз)
 * @param opts.onCompleted        SSE-хук: текущая сессия завершилась (доменный тост)
 * @param opts.onFailed           SSE-хук: текущая сессия упала (доменный тост)
 * @param opts.onRenamed          хук после успешного переименования (напр. синк musicTitle)
 * @param opts.onBusinessChanged  хук после смены бизнеса (напр. перезагрузка персонажей)
 */

/** Минимальная форма сессии, нужная движку; домен добавляет свои поля. */
export interface StudioSessionBase {
  id: string
  status: string
  kieTaskCreatedAt?: string | null
  updatedAt: string
}

export interface UseStudioSessionOptions {
  type: 'photo' | 'music'
  businessId: Ref<string | null>
  buildSavePayload: () => Record<string, any>
  applySession: (session: any) => void
  resetState: () => void
  watchSources: () => WatchSource[]
  onCompleted?: (event: any) => void
  onFailed?: (event: any) => void
  onRenamed?: (id: string, title: string) => void
  onBusinessChanged?: () => void
}

export function useStudioSession<T extends StudioSessionBase = StudioSessionBase>(
  opts: UseStudioSessionOptions,
) {
  const {
    type, businessId, buildSavePayload, applySession, resetState, watchSources,
    onCompleted, onFailed, onRenamed, onBusinessChanged,
  } = opts
  const toast = useToast()

  // --- Состояние сессий ---
  const sessions = ref<T[]>([]) as Ref<T[]>
  const currentSessionId = ref<string | null>(null)

  const currentSession = computed(() => sessions.value.find(s => s.id === currentSessionId.value))
  const generating = computed(() => currentSession.value?.status === 'generating')
  const generatingStartedAt = computed(() =>
    currentSession.value?.status === 'generating'
      ? (currentSession.value.kieTaskCreatedAt || currentSession.value.updatedAt)
      : null,
  )

  // --- Автосейв ---
  let autoSaveTimer: ReturnType<typeof setTimeout> | null = null
  let autoSavePaused = false

  function scheduleAutoSave() {
    if (autoSavePaused) return
    if (autoSaveTimer) clearTimeout(autoSaveTimer)
    autoSaveTimer = setTimeout(saveSession, 2000)
  }

  function pauseAutoSave() { autoSavePaused = true }
  function resumeAutoSave() { autoSavePaused = false }

  async function saveSession() {
    if (!currentSessionId.value || autoSavePaused) return
    const current = sessions.value.find(s => s.id === currentSessionId.value)
    // draft → полный сейв, failed → только chat, generating/completed → пропуск
    if (current && current.status === 'generating' || current?.status === 'completed') return

    try {
      if (current?.status === 'failed') {
        // Для failed сохраняем ТОЛЬКО chatHistory (не затираем прочие поля)
        await http.put(`/sessions/${currentSessionId.value}`, { chatHistory: buildSavePayload().chatHistory })
      } else {
        await http.put(`/sessions/${currentSessionId.value}`, buildSavePayload())
      }
    } catch {}
  }

  /** Flush отложенного сейва на выгрузке страницы (F5, закрытие вкладки). */
  function flushBeforeUnload() {
    if (autoSaveTimer && currentSessionId.value) {
      clearTimeout(autoSaveTimer)
      autoSaveTimer = null
      const current = sessions.value.find(s => s.id === currentSessionId.value)
      if (current?.status === 'generating' || current?.status === 'completed') return
      const payload = current?.status === 'failed'
        ? { chatHistory: buildSavePayload().chatHistory }
        : buildSavePayload()
      fetch(`/api/sessions/${currentSessionId.value}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', 'X-Tab-ID': TAB_ID },
        body: JSON.stringify(payload),
        credentials: 'include',
        keepalive: true,
      })
    }
  }

  /** Немедленный flush (переключение таба / деактивация KeepAlive). */
  function flush() {
    if (autoSaveTimer) {
      clearTimeout(autoSaveTimer)
      autoSaveTimer = null
    }
    saveSession()
  }

  // --- CRUD сессий ---
  async function loadSessions() {
    if (!businessId.value) return
    try {
      sessions.value = await http.get<T[]>(`/sessions?businessId=${businessId.value}&type=${type}`)
    } catch {}
  }

  /** Поставить currentSessionId + разложить домен (единый вход для загрузки полной сессии). */
  function applyFull(session: any) {
    currentSessionId.value = session.id
    applySession(session)
  }

  async function loadDraft() {
    if (!businessId.value) return
    autoSavePaused = true
    // Сначала пробуем существующий черновик
    const draft = await http.get<any>(`/sessions/draft?businessId=${businessId.value}&type=${type}`).catch(() => null)
    if (draft) {
      applyFull(draft)
      autoSavePaused = false
      return
    }
    // Черновика нет — грузим самую свежую сессию (а не создаём пустую)
    if (sessions.value.length > 0) {
      const latest = sessions.value[0] // уже отсортированы updatedAt desc
      const full = await http.get<any>(`/sessions/${latest.id}`).catch(() => null)
      if (full) {
        applyFull(full)
        autoSavePaused = false
        return
      }
    }
    // Реально пусто — создаём первую сессию
    await createNew()
    autoSavePaused = false
  }

  async function createNew() {
    if (!businessId.value) return
    resetState()
    try {
      const session = await http.post<any>('/sessions', { businessId: businessId.value, type })
      currentSessionId.value = session.id
      await loadSessions()
    } catch {}
  }

  async function onLoadSession(session: { id: string }) {
    // Flush отложенный автосейв текущей сессии перед переключением
    if (autoSaveTimer) {
      clearTimeout(autoSaveTimer)
      autoSaveTimer = null
      await saveSession()
    }
    autoSavePaused = true
    const full = await http.get<any>(`/sessions/${session.id}`).catch(() => null)
    if (full) applyFull(full)
    autoSavePaused = false
  }

  async function onDeleteSession(id: string) {
    try {
      await http.delete(`/sessions/${id}`)
      if (currentSessionId.value === id) {
        currentSessionId.value = null
        await loadDraft()
      }
      await loadSessions()
    } catch (e: any) {
      toast.error(e.message || 'Ошибка удаления')
    }
  }

  async function onRenameSession(id: string, title: string) {
    try {
      await http.put(`/sessions/${id}`, { title })
      onRenamed?.(id, title)
      await loadSessions()
    } catch {}
  }

  // --- SSE-синк ---
  const sse = useStudioSSE((event) => {
    if (event.type !== 'session_updated') return
    loadSessions()
    if (event.sessionId !== currentSessionId.value) return
    if (event.status === 'completed') {
      autoSavePaused = false
      onCompleted?.(event)
      // Подтягиваем полную сессию (результат/аудио) в доменный стейт
      http.get<any>(`/sessions/${currentSessionId.value}`).then(applyFull).catch(() => {})
    } else if (event.status === 'failed') {
      autoSavePaused = false
      onFailed?.(event)
    }
  })

  // --- Автосейв watch (массив ref-ов вычисляется один раз) ---
  watch(watchSources(), scheduleAutoSave, { deep: true })

  // --- Смена бизнеса (глобальный селектор в шапке) ---
  watch(businessId, (newId, oldId) => {
    if (newId && newId !== oldId) handleBusinessChange()
  })

  async function handleBusinessChange() {
    // Flush отложенного автосейва перед сменой бизнеса
    if (autoSaveTimer) {
      clearTimeout(autoSaveTimer)
      autoSaveTimer = null
      await saveSession()
    }
    sessions.value = []
    currentSessionId.value = null
    resetState()
    loadSessions()
    loadDraft()
    onBusinessChanged?.()
  }

  // --- Lifecycle ---
  onMounted(async () => {
    window.addEventListener('beforeunload', flushBeforeUnload)
    // Строгий порядок: SSE → сессии → черновик
    sse.connect()
    await loadSessions()
    await loadDraft()
  })

  onBeforeUnmount(() => {
    window.removeEventListener('beforeunload', flushBeforeUnload)
    sse.close()
    // Flush отложенного сейва перед размонтированием
    if (autoSaveTimer) {
      clearTimeout(autoSaveTimer)
      autoSaveTimer = null
      saveSession()
    }
  })

  // KeepAlive: flush при уходе со страницы (студии живут в кэше — hook переживает)
  onDeactivated(flush)

  return {
    // состояние
    sessions,
    currentSessionId,
    generating,
    generatingStartedAt,
    // CRUD
    loadSessions,
    loadDraft,
    createNew,
    onLoadSession,
    onDeleteSession,
    onRenameSession,
    // автосейв
    scheduleAutoSave,
    pauseAutoSave,
    resumeAutoSave,
    flush,
  }
}
