/**
 * HTTP client for Content Factory API.
 * - credentials: 'include' for httpOnly JWT cookie
 * - Automatic refresh on 401 (once per request)
 * - X-Tab-ID for SSE filtering
 */

export const TAB_ID = typeof crypto.randomUUID === 'function'
  ? crypto.randomUUID()
  : Math.random().toString(36).slice(2) + Date.now().toString(36)

// Shared promise pattern: concurrent 401s share a single refresh request
// instead of failing immediately when another refresh is in progress
let refreshPromise: Promise<boolean> | null = null

async function tryRefresh(): Promise<boolean> {
  // If a refresh is already in progress, wait for it instead of returning false
  if (refreshPromise) return refreshPromise

  // Use finally to ensure cleanup even if doRefresh throws unexpectedly
  refreshPromise = doRefresh().finally(() => { refreshPromise = null })
  return refreshPromise
}

async function doRefresh(): Promise<boolean> {
  try {
    const res = await fetch('/api/auth/refresh', {
      method: 'POST',
      credentials: 'include',
    })
    return res.ok
  } catch {
    return false
  }
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const headers: Record<string, string> = { 'X-Tab-ID': TAB_ID }
  if (body) headers['Content-Type'] = 'application/json'

  const opts = {
    method,
    headers,
    credentials: 'include' as const,
    body: body ? JSON.stringify(body) : undefined,
  }

  let res = await fetch(`/api${path}`, opts)

  // Auto-refresh on 401
  if (res.status === 401 && !path.startsWith('/auth/')) {
    const refreshed = await tryRefresh()
    if (refreshed) {
      // Retry original request with new token
      res = await fetch(`/api${path}`, opts)
    }
  }

  if (res.status === 401) {
    window.dispatchEvent(new Event('auth:unauthorized'))
    throw new Error('Не авторизован')
  }

  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }))
    throw new Error(err.error || `HTTP ${res.status}`)
  }

  return res.json() as Promise<T>
}

export const http = {
  get:    <T>(path: string)                => request<T>('GET', path),
  post:   <T>(path: string, body: unknown) => request<T>('POST', path, body),
  put:    <T>(path: string, body: unknown) => request<T>('PUT', path, body),
  patch:  <T>(path: string, body: unknown) => request<T>('PATCH', path, body),
  delete: <T>(path: string)                => request<T>('DELETE', path),
}
