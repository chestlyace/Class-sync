import { defineConfig } from 'vitest/config'

export default defineConfig({
  // Resolve the "@/*" alias from tsconfig.json (native Vite support).
  resolve: { tsconfigPaths: true },
  test: {
    environment: 'node',
    // Each PGlite database boots and migrates in-process; parallel files can exceed 5s.
    testTimeout: 30000,
    hookTimeout: 30000,
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
  },
})
