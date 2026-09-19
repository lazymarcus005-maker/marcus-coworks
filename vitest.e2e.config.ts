import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['apps/*/test/**/*.e2e.ts'],
    environment: 'node',
    testTimeout: 240_000,
    hookTimeout: 240_000,
    sequence: { concurrent: false },
  },
})
