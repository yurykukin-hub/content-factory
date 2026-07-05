import { ref } from 'vue'
import { http } from '@/api/client'
import { useToast } from '@/composables/useToast'

export interface StoryTemplate {
  id: string; name: string; emoji: string; overlayText: string
  textPosition: string; textColor: string; fontSize: string; bgStyle: string; linkType: string; sortOrder: number
}

export function useStoryTemplates(businessId: string) {
  const toast = useToast()

  const templates = ref<StoryTemplate[]>([])
  const editingTpl = ref<Partial<StoryTemplate> | null>(null)
  const savingTpl = ref(false)

  async function loadTemplates() {
    if (!businessId) return
    try { templates.value = await http.get<StoryTemplate[]>(`/businesses/${businessId}/story-templates`) } catch {}
  }

  async function saveTpl() {
    if (!editingTpl.value?.name?.trim()) return
    savingTpl.value = true
    try {
      if (editingTpl.value.id) {
        await http.put(`/story-templates/${editingTpl.value.id}`, editingTpl.value)
      } else {
        await http.post(`/businesses/${businessId}/story-templates`, editingTpl.value)
      }
      editingTpl.value = null
      await loadTemplates()
      toast.success('Шаблон сохранён')
    } catch (e: any) { toast.error(e.message || 'Ошибка') }
    finally { savingTpl.value = false }
  }

  async function deleteTpl(id: string) {
    if (!confirm('Удалить шаблон?')) return
    try { await http.delete(`/story-templates/${id}`); await loadTemplates(); toast.success('Удалён') } catch {}
  }

  function newTpl() {
    editingTpl.value = { name: '', emoji: '', overlayText: '', textPosition: 'bottom', textColor: '#ffffff', fontSize: 'M', bgStyle: 'dark', linkType: '', sortOrder: templates.value.length }
  }

  return { templates, editingTpl, savingTpl, loadTemplates, saveTpl, deleteTpl, newTpl }
}
