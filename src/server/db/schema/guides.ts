import { pgTable, primaryKey, text, timestamp } from 'drizzle-orm/pg-core'
import { user } from './auth'

/**
 * In-app guides a user has finished or closed: kept on the account, so a guide that starts by
 * itself (the welcome tour, the course tour) does so once per account, on any device.
 */
export const userGuideSeen = pgTable(
  'user_guide_seen',
  {
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    guideId: text('guide_id').notNull(),
    seenAt: timestamp('seen_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.guideId] })],
)
