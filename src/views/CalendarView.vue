<script setup lang="ts">
import { onMounted } from 'vue'
import { useRouter } from 'vue-router'

// CalendarView → redirect к ContentPlansView
// Полноценный календарь встроен в контент-планы (переключатель Таблица/Календарь)
const router = useRouter()
onMounted(() => {
  router.replace('/plans')
})
</script>

<template>
  <div class="text-gray-500 py-8 text-center">Перенаправление...</div>
</template>
