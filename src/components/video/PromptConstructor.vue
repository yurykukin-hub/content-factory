<script setup lang="ts">
import { reactive, computed, watch } from 'vue'
import {
  User, Mountain, Package, PawPrint, Sparkles,
  Camera, Move, RotateCw, Sun, Palette, Film, Volume2,
  ChevronDown, ChevronUp, Eraser,
} from 'lucide-vue-next'

export interface RefImage {
  url: string
  thumbUrl?: string | null
  filename: string
  role?: string // 'face' | 'background' | 'object' | 'style' | ''
}

const emit = defineEmits<{
  (e: 'update:modelValue', value: string): void
}>()

const props = defineProps<{
  modelValue: string
  referenceImages?: RefImage[]
}>()

const ROLES: { id: string; label: string; en: string }[] = [
  { id: 'face', label: 'Лицо', en: 'character appearance from' },
  { id: 'background', label: 'Фон', en: 'background environment from' },
  { id: 'object', label: 'Объект', en: 'object shown in' },
  { id: 'style', label: 'Стиль', en: 'visual style reference from' },
  { id: 'outfit', label: 'Одежда', en: 'outfit and clothing from' },
  { id: 'pose', label: 'Поза', en: 'pose and body position from' },
]

// --- Options ---

const SUBJECTS = [
  { id: 'person', label: 'Человек', icon: User, en: 'A person' },
  { id: 'landscape', label: 'Пейзаж', icon: Mountain, en: 'A scenic landscape' },
  { id: 'product', label: 'Продукт', icon: Package, en: 'A product' },
  { id: 'animal', label: 'Животное', icon: PawPrint, en: 'An animal' },
  { id: 'abstract', label: 'Абстракция', icon: Sparkles, en: 'Abstract visual' },
]

const ACTIONS = [
  { id: 'walking', label: 'Идёт', en: 'walking slowly' },
  { id: 'standing', label: 'Стоит', en: 'standing still' },
  { id: 'dancing', label: 'Танцует', en: 'dancing gracefully' },
  { id: 'floating', label: 'Плывёт', en: 'floating gently' },
  { id: 'rotating', label: 'Вращается', en: 'rotating smoothly' },
  { id: 'flying', label: 'Летит', en: 'flying through the air' },
  { id: 'running', label: 'Бежит', en: 'running dynamically' },
  { id: 'gesturing', label: 'Жестикулирует', en: 'gesturing expressively' },
]

const SHOTS = [
  { id: 'extreme-close', label: 'Макро', en: 'extreme close-up' },
  { id: 'close-up', label: 'Крупный', en: 'close-up shot' },
  { id: 'medium', label: 'Средний', en: 'medium shot' },
  { id: 'wide', label: 'Общий', en: 'wide shot' },
  { id: 'extreme-wide', label: 'Панорама', en: 'extreme wide establishing shot' },
]

const MOVEMENTS = [
  { id: 'static', label: 'Статика', en: 'locked-off static camera' },
  { id: 'dolly-push', label: 'Наезд', en: 'slow dolly push forward' },
  { id: 'dolly-pull', label: 'Отъезд', en: 'smooth dolly pull back' },
  { id: 'pan-left', label: 'Панорама ←', en: 'slow pan left' },
  { id: 'pan-right', label: 'Панорама →', en: 'slow pan right' },
  { id: 'tracking', label: 'Следящая', en: 'steady tracking shot' },
  { id: 'gimbal', label: 'Гимбал', en: 'smooth gimbal stabilized movement' },
  { id: 'handheld', label: 'Ручная', en: 'handheld natural sway' },
  { id: 'drone', label: 'Дрон', en: 'aerial drone flyover' },
  { id: 'orbit', label: 'Орбита', en: 'slow orbital movement around subject' },
]

const ANGLES = [
  { id: 'eye-level', label: 'С уровня глаз', en: 'eye level' },
  { id: 'low', label: 'Снизу', en: 'low angle looking up' },
  { id: 'high', label: 'Сверху', en: 'high angle looking down' },
  { id: 'dutch', label: 'Голландский', en: 'dutch angle tilted' },
  { id: 'overhead', label: 'Сверху вниз', en: 'overhead top-down view' },
  { id: 'over-shoulder', label: 'Из-за плеча', en: 'over-the-shoulder' },
]

const LIGHTING = [
  { id: 'golden', label: 'Золотой час', en: 'golden hour warm sunset light' },
  { id: 'natural', label: 'Естественный', en: 'soft natural daylight' },
  { id: 'studio', label: 'Студийный', en: 'professional studio lighting with key and fill' },
  { id: 'neon', label: 'Неоновый', en: 'colorful neon glow lighting' },
  { id: 'dramatic', label: 'Драматичный', en: 'dramatic high-contrast rim lighting' },
  { id: 'backlit', label: 'Контровый', en: 'backlit silhouette with lens flare' },
  { id: 'moody', label: 'Мрачный', en: 'moody dark low-key lighting' },
]

const COLORS = [
  { id: 'warm', label: 'Тёплые', en: 'warm orange and amber tones' },
  { id: 'cool', label: 'Холодные', en: 'cool blue and teal tones' },
  { id: 'vibrant', label: 'Яркие', en: 'vibrant saturated colors' },
  { id: 'pastel', label: 'Пастельные', en: 'soft muted pastel colors' },
  { id: 'desaturated', label: 'Десатурация', en: 'desaturated muted color grade' },
  { id: 'monochrome', label: 'Ч/Б', en: 'black and white monochrome' },
]

const STYLES = [
  { id: 'cinematic', label: 'Кинематограф', en: 'cinematic film look, shot on RED camera' },
  { id: 'realistic', label: 'Реалистичный', en: 'photorealistic natural look' },
  { id: 'anime', label: 'Аниме', en: 'anime hand-drawn aesthetic' },
  { id: 'commercial', label: 'Коммерческий', en: 'clean commercial advertising style' },
  { id: 'ugc', label: 'UGC', en: 'authentic user-generated content feel, slight handheld shake' },
  { id: 'editorial', label: 'Эдиториал', en: 'high-fashion editorial photography style' },
  { id: 'retro', label: 'Ретро', en: 'vintage retro film grain aesthetic' },
]

// --- State ---

const sections = reactive({
  subject: { type: '', detail: '' },
  action: { type: '', detail: '' },
  camera: { shot: '', movement: '', angle: '' },
  lighting: { type: '', color: '' },
  style: { type: '', reference: '' },
  audio: { description: '' },
})

const expanded = reactive({
  subject: true,
  action: false,
  camera: false,
  lighting: false,
  style: false,
  audio: false,
})

function toggle(key: keyof typeof expanded) {
  expanded[key] = !expanded[key]
}

// --- Assemble prompt ---

const assembledPrompt = computed(() => {
  const parts: string[] = []

  // Subject
  const subj = SUBJECTS.find(s => s.id === sections.subject.type)
  if (subj) {
    let s = subj.label
    if (sections.subject.detail) s += `, ${sections.subject.detail}`
    parts.push(s)
  }

  // Action
  const act = ACTIONS.find(a => a.id === sections.action.type)
  if (act) {
    let s = act.label
    if (sections.action.detail) s += ` ${sections.action.detail}`
    parts.push(s)
  }

  // Camera
  const camParts: string[] = []
  const shot = SHOTS.find(s => s.id === sections.camera.shot)
  if (shot) camParts.push(shot.label)
  const mov = MOVEMENTS.find(m => m.id === sections.camera.movement)
  if (mov) camParts.push(mov.label)
  const ang = ANGLES.find(a => a.id === sections.camera.angle)
  if (ang) camParts.push(ang.label)
  if (camParts.length) parts.push(camParts.join(', '))

  // Lighting
  const lightParts: string[] = []
  const light = LIGHTING.find(l => l.id === sections.lighting.type)
  if (light) lightParts.push(light.label)
  const color = COLORS.find(c => c.id === sections.lighting.color)
  if (color) lightParts.push(color.label)
  if (lightParts.length) parts.push(lightParts.join(', '))

  // Style
  const sty = STYLES.find(s => s.id === sections.style.type)
  if (sty) {
    let s = sty.label
    if (sections.style.reference) s += `, вдохновлено ${sections.style.reference}`
    parts.push(s)
  }

  // Audio
  if (sections.audio.description) {
    parts.push(`Звук: ${sections.audio.description}`)
  }

  // Reference images with roles
  if (props.referenceImages?.length) {
    const refParts: string[] = []
    props.referenceImages.forEach((ref, idx) => {
      const tag = `@Image${idx + 1}`
      const role = ROLES.find(r => r.id === ref.role)
      if (role) {
        refParts.push(`${role.label} ${tag}`)
      } else {
        refParts.push(`референс ${tag}`)
      }
    })
    if (refParts.length) parts.push('Референсы: ' + refParts.join(', '))
  }

  // Quality constraint
  if (parts.length) {
    parts.push('Плавное движение, высокая детализация, без искажений, сохранять консистентность с референсами')
  }

  return parts.join('. ') + (parts.length ? '.' : '')
})

watch(assembledPrompt, (val) => {
  if (val) emit('update:modelValue', val)
})

function reset() {
  sections.subject = { type: '', detail: '' }
  sections.action = { type: '', detail: '' }
  sections.camera = { shot: '', movement: '', angle: '' }
  sections.lighting = { type: '', color: '' }
  sections.style = { type: '', reference: '' }
  sections.audio = { description: '' }
  emit('update:modelValue', '')
}

// --- Section config ---
const sectionConfig = [
  { key: 'subject' as const, label: 'Объект', icon: User, filled: computed(() => !!sections.subject.type) },
  { key: 'action' as const, label: 'Действие', icon: Move, filled: computed(() => !!sections.action.type) },
  { key: 'camera' as const, label: 'Камера', icon: Camera, filled: computed(() => !!sections.camera.shot || !!sections.camera.movement) },
  { key: 'lighting' as const, label: 'Свет и цвет', icon: Sun, filled: computed(() => !!sections.lighting.type) },
  { key: 'style' as const, label: 'Стиль', icon: Film, filled: computed(() => !!sections.style.type) },
  { key: 'audio' as const, label: 'Звук', icon: Volume2, filled: computed(() => !!sections.audio.description) },
]
</script>

<template>
  <div class="space-y-2">
    <!-- Sections -->
    <div v-for="sec in sectionConfig" :key="sec.key"
      class="rounded-xl border border-gray-200 dark:border-gray-700 overflow-hidden transition-colors"
      :class="sec.filled.value ? 'border-emerald-200 dark:border-emerald-800' : ''">

      <!-- Header -->
      <button @click="toggle(sec.key)"
        class="w-full flex items-center gap-2 px-3 py-2.5 text-left hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors">
        <component :is="sec.icon" :size="14" :class="sec.filled.value ? 'text-emerald-500' : 'text-gray-400'" />
        <span class="text-xs font-semibold flex-1">{{ sec.label }}</span>
        <span v-if="sec.filled.value" class="w-1.5 h-1.5 rounded-full bg-emerald-500"></span>
        <component :is="expanded[sec.key] ? ChevronUp : ChevronDown" :size="14" class="text-gray-400" />
      </button>

      <!-- Content -->
      <div v-if="expanded[sec.key]" class="px-3 pb-3 space-y-2">

        <!-- Subject -->
        <template v-if="sec.key === 'subject'">
          <div class="flex flex-wrap gap-1.5">
            <button v-for="s in SUBJECTS" :key="s.id" @click="sections.subject.type = sections.subject.type === s.id ? '' : s.id"
              :class="['flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-[11px] font-medium border transition-colors',
                sections.subject.type === s.id ? 'bg-emerald-100 dark:bg-emerald-900 text-emerald-700 dark:text-emerald-300 border-emerald-300 dark:border-emerald-700' : 'bg-gray-50 dark:bg-gray-800 text-gray-600 border-gray-200 dark:border-gray-700 hover:border-emerald-300']">
              <component :is="s.icon" :size="12" /> {{ s.label }}
            </button>
          </div>
          <input v-model="sections.subject.detail" placeholder="Детали: молодая женщина, тёмные волосы, синее платье..."
            class="w-full px-3 py-1.5 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-xs outline-none focus:border-emerald-400" />
        </template>

        <!-- Action -->
        <template v-if="sec.key === 'action'">
          <div class="flex flex-wrap gap-1.5">
            <button v-for="a in ACTIONS" :key="a.id" @click="sections.action.type = sections.action.type === a.id ? '' : a.id"
              :class="['px-2.5 py-1.5 rounded-lg text-[11px] font-medium border transition-colors',
                sections.action.type === a.id ? 'bg-emerald-100 dark:bg-emerald-900 text-emerald-700 dark:text-emerald-300 border-emerald-300 dark:border-emerald-700' : 'bg-gray-50 dark:bg-gray-800 text-gray-600 border-gray-200 dark:border-gray-700 hover:border-emerald-300']">
              {{ a.label }}
            </button>
          </div>
          <input v-model="sections.action.detail" placeholder="Уточнение: вдоль берега, с ребёнком на руках..."
            class="w-full px-3 py-1.5 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-xs outline-none focus:border-emerald-400" />
        </template>

        <!-- Camera -->
        <template v-if="sec.key === 'camera'">
          <div>
            <label class="text-[10px] text-gray-500 mb-1 block">Кадр</label>
            <div class="flex flex-wrap gap-1.5">
              <button v-for="s in SHOTS" :key="s.id" @click="sections.camera.shot = sections.camera.shot === s.id ? '' : s.id"
                :class="['px-2 py-1 rounded-lg text-[10px] font-medium border transition-colors',
                  sections.camera.shot === s.id ? 'bg-emerald-100 dark:bg-emerald-900 text-emerald-700 dark:text-emerald-300 border-emerald-300' : 'bg-gray-50 dark:bg-gray-800 text-gray-600 border-gray-200 dark:border-gray-700']">
                {{ s.label }}
              </button>
            </div>
          </div>
          <div>
            <label class="text-[10px] text-gray-500 mb-1 block">Движение</label>
            <div class="flex flex-wrap gap-1.5">
              <button v-for="m in MOVEMENTS" :key="m.id" @click="sections.camera.movement = sections.camera.movement === m.id ? '' : m.id"
                :class="['px-2 py-1 rounded-lg text-[10px] font-medium border transition-colors',
                  sections.camera.movement === m.id ? 'bg-emerald-100 dark:bg-emerald-900 text-emerald-700 dark:text-emerald-300 border-emerald-300' : 'bg-gray-50 dark:bg-gray-800 text-gray-600 border-gray-200 dark:border-gray-700']">
                {{ m.label }}
              </button>
            </div>
          </div>
          <div>
            <label class="text-[10px] text-gray-500 mb-1 block">Угол</label>
            <div class="flex flex-wrap gap-1.5">
              <button v-for="a in ANGLES" :key="a.id" @click="sections.camera.angle = sections.camera.angle === a.id ? '' : a.id"
                :class="['px-2 py-1 rounded-lg text-[10px] font-medium border transition-colors',
                  sections.camera.angle === a.id ? 'bg-emerald-100 dark:bg-emerald-900 text-emerald-700 dark:text-emerald-300 border-emerald-300' : 'bg-gray-50 dark:bg-gray-800 text-gray-600 border-gray-200 dark:border-gray-700']">
                {{ a.label }}
              </button>
            </div>
          </div>
        </template>

        <!-- Lighting -->
        <template v-if="sec.key === 'lighting'">
          <div>
            <label class="text-[10px] text-gray-500 mb-1 block">Освещение</label>
            <div class="flex flex-wrap gap-1.5">
              <button v-for="l in LIGHTING" :key="l.id" @click="sections.lighting.type = sections.lighting.type === l.id ? '' : l.id"
                :class="['px-2 py-1 rounded-lg text-[10px] font-medium border transition-colors',
                  sections.lighting.type === l.id ? 'bg-emerald-100 dark:bg-emerald-900 text-emerald-700 dark:text-emerald-300 border-emerald-300' : 'bg-gray-50 dark:bg-gray-800 text-gray-600 border-gray-200 dark:border-gray-700']">
                {{ l.label }}
              </button>
            </div>
          </div>
          <div>
            <label class="text-[10px] text-gray-500 mb-1 block">Цветовая палитра</label>
            <div class="flex flex-wrap gap-1.5">
              <button v-for="c in COLORS" :key="c.id" @click="sections.lighting.color = sections.lighting.color === c.id ? '' : c.id"
                :class="['px-2 py-1 rounded-lg text-[10px] font-medium border transition-colors',
                  sections.lighting.color === c.id ? 'bg-emerald-100 dark:bg-emerald-900 text-emerald-700 dark:text-emerald-300 border-emerald-300' : 'bg-gray-50 dark:bg-gray-800 text-gray-600 border-gray-200 dark:border-gray-700']">
                {{ c.label }}
              </button>
            </div>
          </div>
        </template>

        <!-- Style -->
        <template v-if="sec.key === 'style'">
          <div class="flex flex-wrap gap-1.5">
            <button v-for="s in STYLES" :key="s.id" @click="sections.style.type = sections.style.type === s.id ? '' : s.id"
              :class="['px-2.5 py-1.5 rounded-lg text-[11px] font-medium border transition-colors',
                sections.style.type === s.id ? 'bg-emerald-100 dark:bg-emerald-900 text-emerald-700 dark:text-emerald-300 border-emerald-300' : 'bg-gray-50 dark:bg-gray-800 text-gray-600 border-gray-200 dark:border-gray-700']">
              {{ s.label }}
            </button>
          </div>
          <input v-model="sections.style.reference" placeholder="Референс: Wes Anderson, Blade Runner 2049, Apple keynote..."
            class="w-full px-3 py-1.5 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-xs outline-none focus:border-emerald-400" />
        </template>

        <!-- Audio -->
        <template v-if="sec.key === 'audio'">
          <input v-model="sections.audio.description" placeholder="Звуки: шум волн, пение птиц, энергичная музыка..."
            class="w-full px-3 py-1.5 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-xs outline-none focus:border-emerald-400" />
          <p class="text-[9px] text-gray-400">Для диалога: используйте кавычки "Привет, добро пожаловать!"</p>
        </template>
      </div>
    </div>

    <!-- Reset -->
    <button v-if="assembledPrompt" @click="reset"
      class="flex items-center gap-1 px-2 py-1 text-[10px] text-gray-400 hover:text-red-500 transition-colors">
      <Eraser :size="10" /> Сбросить конструктор
    </button>
  </div>
</template>
