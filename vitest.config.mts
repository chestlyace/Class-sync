import { defineConfig } from 'vitest/config'

export default defineConfig({
  // Resolve the "@/*" alias from tsconfig.json (native Vite support).
  resolve: { tsconfigPaths: true },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
  },
})
