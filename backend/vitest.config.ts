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
      // Предохранитель: если тест когда-нибудь дойдёт до записи через storage-драйвер,
      // он не насорит в рабочее дерево (backend/uploads — рабочая dev-медиатека).
      UPLOADS_DIR: '/tmp/cf-test-uploads',
    },
  },
})
