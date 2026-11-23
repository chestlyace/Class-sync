import { sql } from 'drizzle-orm'
import { check, index, pgTable, text, timestamp, unique, uuid } from 'drizzle-orm/pg-core'
import { user } from './auth'

export const BROADCAST_AUDIENCES = ['lecturers', 'students', 'everyone'] as const
export type BroadcastAudience = (typeof BROADCAST_AUDIENCES)[number]

export const BROADCAST_STATUSES = ['sending', 'done'] as const
export type BroadcastStatus = (typeof BROADCAST_STATUSES)[number]

export const BROADCAST_RECIPIENT_STATUSES = ['pending', 'sending', 'sent', 'failed', 'skipped'] as const
export type BroadcastRecipientStatus = (typeof BROADCAST_RECIPIENT_STATUSES)[number]

/** An email an admin sent to a whole audience, kept in both languages so each person gets theirs. */
export const broadcast = pgTable(
  'broadcast',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    adminId: text('admin_id')
      .notNull()
      .references(() => user.id, { onDelete: 'restrict' }),
    audience: text('audience', { enum: BROADCAST_AUDIENCES }).notNull(),
    subjectEn: text('subject_en').notNull(),
    bodyEn: text('body_en').notNull(),
    subjectFr: text('subject_fr').notNull(),
    bodyFr: text('body_fr').notNull(),
    status: text('status', { enum: BROADCAST_STATUSES }).notNull().default('sending'),
    finishedAt: timestamp('finished_at', { withTimezone: true }),
  },
  (t) => [
    check('broadcast_audience_check', sql`${t.audience} in ('lecturers', 'students', 'everyone')`),
    check('broadcast_status_check', sql`${t.status} in ('sending', 'done')`),
    index('broadcast_created_at_idx').on(t.createdAt),
  ],
)

/**
 * One row per person a broadcast was meant for. The address is kept by value, and the user link
 * is cleared (not the row) if the account is deleted, so the send record stays complete.
 */
export const broadcastRecipient = pgTable(
  'broadcast_recipient',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    broadcastId: text('broadcast_id')
      .notNull()
      .references(() => broadcast.id, { onDelete: 'cascade' }),
    userId: text('user_id').references(() => user.id, { onDelete: 'set null' }),
    email: text('email').notNull(),
    locale: text('locale', { enum: ['en', 'fr'] }).notNull(),
    status: text('status', { enum: BROADCAST_RECIPIENT_STATUSES }).notNull().default('pending'),
    error: text('error'),
    sentAt: timestamp('sent_at', { withTimezone: true }),
  },
  (t) => [
    check('broadcast_recipient_locale_check', sql`${t.locale} in ('en', 'fr')`),
    check('broadcast_recipient_status_check', sql`${t.status} in ('pending', 'sending', 'sent', 'failed', 'skipped')`),
    unique('broadcast_recipient_broadcast_user_unique').on(t.broadcastId, t.userId),
    index('broadcast_recipient_broadcast_status_idx').on(t.broadcastId, t.status),
  ],
)
