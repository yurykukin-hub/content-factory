import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['src/**/__tests__/**/*.test.ts'],
    testTimeout: 10_000,
    setupFiles: ['./vitest-setup.ts'],
    env: {
      DATABASE_URL: 'postgresql://test:test@localhost:5441/test',
      JWT_SECRET: 'test-jwt-secret-at-least-32-characters-long',
      NODE_ENV: 'test',
    },
  },
})
