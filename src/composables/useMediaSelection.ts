import { ref, computed, type Ref } from 'vue'

/**
 * Мульти-выделение медиатеки: десктоп — клик с модификаторами (Shift-диапазон,
 * Ctrl/⌘ — точечно), тач — тап/long-press. Извлечено из MediaLibraryView.
 *
 * ⚠️ Инвариант: Set ПЕРЕПРИСВАИВАЕМ (`selectedFiles.value = new Set(...)`), НЕ мутируем
 * на месте — иначе computed `hasSelection` / внешние computed (displayedFiles) не
 * пересчитываются. Каждый путь ниже создаёт новый Set.
 *
 * Дженерик по `{ id: string }`, чтобы не тащить конкретный MediaFile-тип.
 *
 * @param displayedFiles геттер видимого (отсортированного) списка — Shift-диапазон индексирует ЕГО
 * @param previewFile    ref превью — тач-тап без активного выделения открывает превью
 */
export function useMediaSelection<T extends { id: string }>(
  displayedFiles: () => T[],
  previewFile: Ref<T | null>,
) {
  const selectedFiles = ref<Set<string>>(new Set())
  const lastSelectedIndex = ref<number | null>(null) // якорь Shift-диапазона (индекс по displayedFiles)
  const hasSelection = computed(() => selectedFiles.value.size > 0)
  const isTouch = typeof window !== 'undefined' && window.matchMedia('(pointer: coarse)').matches

  function clearSelection() {
    selectedFiles.value = new Set()
    lastSelectedIndex.value = null
  }

  // Long-press на тач — вход в выделение (lpFired гасит последующий синтетический click).
  let lpTimer: ReturnType<typeof setTimeout> | null = null
  let lpFired = false
  function onCardTouchStart(file: T, index: number) {
    if (!isTouch) return
    lpFired = false
    lpTimer = setTimeout(() => {
      lpFired = true
      toggleViaCheckbox(file, index)
      try { navigator.vibrate?.(15) } catch {}
    }, 500)
  }
  function onCardTouchEnd() { if (lpTimer) { clearTimeout(lpTimer); lpTimer = null } }
  // Гасим нативное контекстное меню/«сохранить картинку» при long-press на тач (иначе оно перекрывает выделение).
  function onCardContextMenu(e: Event) { if (isTouch) e.preventDefault() }

  // Клик по карточке. index — позиция в displayedFiles (учитывает сортировку для Shift-диапазона).
  function onCardClick(file: T, index: number, e: MouseEvent) {
    // Тач: тап = превью (нет выделения) / toggle (есть выделение). Long-press входит в выделение отдельно.
    if (isTouch) {
      if (lpFired) { lpFired = false; return } // это был long-press — синтетический клик игнорируем
      if (hasSelection.value) toggleViaCheckbox(file, index)
      else previewFile.value = file
      return
    }
    // Десктоп — модель Проводника: одиночный клик ВЫДЕЛЯЕТ (превью = двойной клик / кнопка-глаз).
    if (e.shiftKey) {
      if (lastSelectedIndex.value === null) {
        selectedFiles.value = new Set([file.id])
        lastSelectedIndex.value = index
      } else {
        const lo = Math.min(lastSelectedIndex.value, index)
        const hi = Math.max(lastSelectedIndex.value, index)
        const next = new Set(selectedFiles.value)
        for (let k = lo; k <= hi; k++) { const f = displayedFiles()[k]; if (f) next.add(f.id) }
        selectedFiles.value = next
      }
      return
    }
    if (e.ctrlKey || e.metaKey) {
      const next = new Set(selectedFiles.value)
      next.has(file.id) ? next.delete(file.id) : next.add(file.id)
      selectedFiles.value = next
      lastSelectedIndex.value = index
      return
    }
    // обычный клик = выделить только это фото
    selectedFiles.value = new Set([file.id])
    lastSelectedIndex.value = index
  }

  // Тап/клик по чекбоксу-уголку (тач + hover на десктопе): toggle отдельного файла.
  function toggleViaCheckbox(file: T, index: number) {
    const next = new Set(selectedFiles.value)
    next.has(file.id) ? next.delete(file.id) : next.add(file.id)
    selectedFiles.value = next
    lastSelectedIndex.value = index
  }

  return {
    selectedFiles,
    lastSelectedIndex,
    hasSelection,
    isTouch,
    clearSelection,
    onCardTouchStart,
    onCardTouchEnd,
    onCardContextMenu,
    onCardClick,
    toggleViaCheckbox,
  }
}
