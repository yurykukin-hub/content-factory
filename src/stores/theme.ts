import { defineStore } from 'pinia'
import { ref, watchEffect } from 'vue'

export const useThemeStore = defineStore('theme', () => {
  const isDark = ref(localStorage.getItem('cf_theme') === 'dark')
  const devMode = ref(localStorage.getItem('cf_dev_mode') === 'true')

  watchEffect(() => {
    document.documentElement.classList.toggle('dark', isDark.value)
    localStorage.setItem('cf_theme', isDark.value ? 'dark' : 'light')
  })

  function toggle() {
    isDark.value = !isDark.value
  }

  function toggleDevMode() {
    devMode.value = !devMode.value
    localStorage.setItem('cf_dev_mode', devMode.value ? 'true' : 'false')
  }

  return { isDark, toggle, devMode, toggleDevMode }
})
