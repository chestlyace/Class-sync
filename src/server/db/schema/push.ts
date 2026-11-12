import { index, integer, pgTable, text, timestamp } from 'drizzle-orm/pg-core'
import { user } from './auth'

/** One browser or device that agreed to receive push notifications. The endpoint identifies it. */
export const pushSubscription = pgTable(
  'push_subscription',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    endpoint: text('endpoint').notNull().unique(),
    p256dh: text('p256dh').notNull(),
    auth: text('auth').notNull(),
    label: text('label').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    lastSuccessAt: timestamp('last_success_at', { withTimezone: true }),
    failureCount: integer('failure_count').notNull().default(0),
  },
  (t) => [index('push_subscription_user_id_idx').on(t.userId)],
)

/** Keys that must not be pushed again until `until` (one row per notification being throttled). */
export const pushCooldown = pgTable('push_cooldown', {
  key: text('key').primaryKey(),
  until: timestamp('until', { withTimezone: true }).notNull(),
})
