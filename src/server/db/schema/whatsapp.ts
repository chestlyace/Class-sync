import { boolean, index, integer, pgTable, text, timestamp, unique, uuid } from 'drizzle-orm/pg-core'
import { user } from './auth'

export const WHATSAPP_KINDS = [
  'checkinOpen',
  'testStarted',
  'resultsReleased',
  'assignmentPublished',
  'classSoonLecturer',
] as const
export type WhatsAppKind = (typeof WHATSAPP_KINDS)[number]

// 'pending' is the dispatcher's claim on a (user, event) before the provider call; it becomes 'sent' with the provider id.
// The column is plain text (the enum is TypeScript only), so adding a status needs no migration.
export const WHATSAPP_STATUSES = ['pending', 'sent', 'delivered', 'read', 'failed', 'skipped_cap'] as const
export type WhatsAppStatus = (typeof WHATSAPP_STATUSES)[number]

/** A user's linked WhatsApp number (E.164, for example +2376...). One number per user, one user per number. */
export const whatsappLink = pgTable('whatsapp_link', {
  userId: text('user_id')
    .primaryKey()
    .references(() => user.id, { onDelete: 'cascade' }),
  phone: text('phone').notNull().unique(),
  linkedAt: timestamp('linked_at', { withTimezone: true }).notNull().defaultNow(),
})

/** A short-lived code the user sends from WhatsApp to prove they own the number. */
export const whatsappConnectCode = pgTable(
  'whatsapp_connect_code',
  {
    code: text('code').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    usedAt: timestamp('used_at', { withTimezone: true }),
  },
  (t) => [index('whatsapp_connect_code_user_id_idx').on(t.userId)],
)

/** Which kinds of alert a user wants on WhatsApp. All on by default. */
export const whatsappPreference = pgTable('whatsapp_preference', {
  userId: text('user_id')
    .primaryKey()
    .references(() => user.id, { onDelete: 'cascade' }),
  checkin: boolean('checkin').notNull().default(true),
  tests: boolean('tests').notNull().default(true),
  results: boolean('results').notNull().default(true),
  assignments: boolean('assignments').notNull().default(true),
  classSoon: boolean('class_soon').notNull().default(true),
})

/** One row per alert attempted; (user, event key) makes sending idempotent. */
export const whatsappMessage = pgTable(
  'whatsapp_message',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: text('user_id').references(() => user.id, { onDelete: 'set null' }),
    kind: text('kind', { enum: WHATSAPP_KINDS }).notNull(),
    eventKey: text('event_key').notNull(),
    template: text('template').notNull(),
    providerMessageId: text('provider_message_id').unique(),
    status: text('status', { enum: WHATSAPP_STATUSES }).notNull(),
    error: text('error'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique('whatsapp_message_user_event_unique').on(t.userId, t.eventKey),
    index('whatsapp_message_created_at_idx').on(t.createdAt),
  ],
)

/** Messages sent per calendar month (`YYYY-MM`), for the monthly cap. */
export const whatsappMonthUsage = pgTable('whatsapp_month_usage', {
  month: text('month').primaryKey(),
  sent: integer('sent').notNull().default(0),
  capMailedAt: timestamp('cap_mailed_at', { withTimezone: true }),
})
