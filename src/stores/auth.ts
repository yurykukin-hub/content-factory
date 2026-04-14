import { defineStore } from 'pinia'
import { ref } from 'vue'
import { http } from '@/api/client'

export interface User {
  id: string
  name: string
  login: string
  role: 'ADMIN' | 'EDITOR' | 'VIEWER'
  sectionAccess?: Record<string, 'full' | 'view' | 'none'> | null
}

export const useAuthStore = defineStore('auth', () => {
  const user = ref<User | null>(null)
  const checked = ref(false)

  async function checkAuth() {
    try {
      const res = await http.get<User | null>('/auth/me')
      user.value = res
    } catch {
      user.value = null
    } finally {
      checked.value = true
    }
  }

  async function login(loginStr: string, password: string) {
    const res = await http.post<{ success: boolean; user: User }>('/auth/login', {
      login: loginStr,
      password,
    })
    user.value = res.user
  }

  async function logout() {
    await http.post('/auth/logout', {})
    user.value = null
  }

  return { user, checked, checkAuth, login, logout }
})
