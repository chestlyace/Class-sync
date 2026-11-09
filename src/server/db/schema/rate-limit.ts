import { index, integer, pgTable, text, timestamp } from 'drizzle-orm/pg-core'

/**
 * Fixed-window request counters shared by every function instance (memory counters are per
 * instance on Vercel). One row per key, e.g. `mcp:ip:<address>`; `count` is the hits in the window
 * starting at `window_start`. Old rows are pruned by the daily cron.
 */
export const rateLimit = pgTable(
  'rate_limit',
  {
    key: text('key').primaryKey(),
    windowStart: timestamp('window_start', { withTimezone: true }).notNull(),
    count: integer('count').notNull(),
  },
  (t) => [index('rate_limit_window_start_idx').on(t.windowStart)],
)
