import { resolve } from 'node:path'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  resolve: { alias: { '@shared': resolve(__dirname, 'src/shared') } },
  test: {
    include: ['test/**/*.test.ts'],
    exclude: process.env.INTEGRATION ? [] : ['test/integration/**'],
    testTimeout: 20_000
  }
})
