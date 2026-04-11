/**
 * Vitest setup: polyfill Bun-specific APIs for Node.js test environment
 */
import { createHash, randomBytes } from 'node:crypto'

// Polyfill Bun.password for tests (simple hash, compatible with itself)
const bunPolyfill = {
  password: {
    hash: async (password: string): Promise<string> => {
      const salt = randomBytes(16).toString('hex')
      const hash = createHash('sha256').update(password + salt).digest('hex')
      return `$polyfill$${salt}$${hash}`
    },
    verify: async (password: string, stored: string): Promise<boolean> => {
      if (!stored.startsWith('$polyfill$')) return false
      const parts = stored.split('$')
      // Format: $polyfill$salt$hash
      const salt = parts[2]
      const hash = parts[3]
      const computed = createHash('sha256').update(password + salt).digest('hex')
      return hash === computed
    },
  },
  file: (path: string) => ({
    exists: async () => false,
    text: async () => '',
    json: async () => ({}),
  }),
}

// Set globally (Bun is a global in Bun runtime)
;(globalThis as any).Bun = bunPolyfill
