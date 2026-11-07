import { randomBytes } from 'node:crypto'
import { defineConfig, devices } from '@playwright/test'

const PORT = 3000
const BASE_URL = `http://localhost:${PORT}`

/**
 * End-to-end run against a built app (`next start`) and a THROWAWAY database.
 *
 * Before `npm run e2e`, point E2E_DATABASE_URL at an empty database and migrate it:
 *   DATABASE_URL=$E2E_DATABASE_URL npm run db:migrate
 * The default below is the local Postgres from the dev setup notes. Never aim this at a
 * database you care about: the scenario creates users, schools, classes and courses.
 */
const DATABASE_URL = process.env.E2E_DATABASE_URL ?? 'postgres://postgres@127.0.0.1:54329/clasync_e2e'

export default defineConfig({
  testDir: './e2e',
  // One serial scenario per project, one project after the other. Sign-ups are rate-limited to
  // 30 per minute per IP under `next start` (src/server/auth/auth.ts); a full run (both scenarios, both projects) signs up 12 users.
  workers: 1,
  fullyParallel: false,
  retries: 0,
  timeout: 120_000,
  expect: { timeout: 10_000 },
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL: BASE_URL,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'] } },
    // Pixel 7 emulation, narrowed to 360 px wide: the smallest phone width the app targets.
    { name: 'mobile', use: { ...devices['Pixel 7'], viewport: { width: 360, height: 780 } } },
  ],
  webServer: {
    command: 'npm run build && npm start',
    url: BASE_URL,
    // Never reuse: a stray dev server on :3000 would run against the wrong database.
    reuseExistingServer: false,
    timeout: 300_000,
    env: {
      DATABASE_URL,
      BETTER_AUTH_URL: BASE_URL,
      // Fresh random secret per run; nothing secret is committed.
      BETTER_AUTH_SECRET: randomBytes(32).toString('hex'),
      AUTH_REQUIRE_EMAIL_VERIFICATION: 'false',
      NEXT_TELEMETRY_DISABLED: '1',
    },
  },
})
