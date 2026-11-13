import { sql } from 'drizzle-orm'
import {
  boolean,
  check,
  date,
  index,
  pgTable,
  primaryKey,
  smallint,
  text,
  timestamp,
} from 'drizzle-orm/pg-core'
import { user } from './auth'
import { course } from './course'

export const CLASS_STATUSES = ['cancelled', 'missed', 'taught'] as const
export type ClassStatus = (typeof CLASS_STATUSES)[number]

/** A weekly teaching slot for a course. Times are minutes from local midnight in the app time zone. */
export const classSlot = pgTable(
  'class_slot',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    courseId: text('course_id')
      .notNull()
      .references(() => course.id, { onDelete: 'cascade' }),
    /** ISO weekday: 1 = Monday ... 7 = Sunday. */
    weekday: smallint('weekday').notNull(),
    startMinute: smallint('start_minute').notNull(),
    endMinute: smallint('end_minute').notNull(),
    room: text('room'),
    requireOnCampus: boolean('require_on_campus').notNull().default(false),
    startsOn: date('starts_on', { mode: 'string' }).notNull(),
    endsOn: date('ends_on', { mode: 'string' }).notNull(),
    createdBy: text('created_by')
      .notNull()
      .references(() => user.id),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('class_slot_course_id_idx').on(t.courseId),
    check('class_slot_weekday_check', sql`${t.weekday} between 1 and 7`),
    check(
      'class_slot_minutes_check',
      sql`${t.startMinute} >= 0 and ${t.startMinute} < ${t.endMinute} and ${t.endMinute} <= 1440`,
    ),
    check('class_slot_dates_check', sql`${t.endsOn} >= ${t.startsOn}`),
  ],
)

/** What happened to one dated occurrence of a slot. No row means "as scheduled". */
export const classDateStatus = pgTable(
  'class_date_status',
  {
    slotId: text('slot_id')
      .notNull()
      .references(() => classSlot.id, { onDelete: 'cascade' }),
    date: date('date', { mode: 'string' }).notNull(),
    status: text('status', { enum: CLASS_STATUSES }).notNull(),
    setBy: text('set_by')
      .notNull()
      .references(() => user.id),
    setAt: timestamp('set_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.slotId, t.date] }),
    check('class_date_status_status_check', sql`${t.status} in ('cancelled', 'missed', 'taught')`),
  ],
)

/** A one-off class outside the weekly pattern, optionally replacing one dated occurrence of a slot. */
export const classExtra = pgTable(
  'class_extra',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    courseId: text('course_id')
      .notNull()
      .references(() => course.id, { onDelete: 'cascade' }),
    startsAt: timestamp('starts_at', { withTimezone: true }).notNull(),
    endsAt: timestamp('ends_at', { withTimezone: true }).notNull(),
    room: text('room'),
    requireOnCampus: boolean('require_on_campus').notNull().default(false),
    replacesSlotId: text('replaces_slot_id').references(() => classSlot.id, { onDelete: 'set null' }),
    replacesDate: date('replaces_date', { mode: 'string' }),
    status: text('status', { enum: CLASS_STATUSES }),
    createdBy: text('created_by')
      .notNull()
      .references(() => user.id),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('class_extra_course_id_starts_at_idx').on(t.courseId, t.startsAt),
    check('class_extra_range_check', sql`${t.endsAt} > ${t.startsAt}`),
    // A slot implies a date. A date alone stays as history once the slot is deleted (FK sets the slot to null).
    check('class_extra_replaces_check', sql`${t.replacesSlotId} is null or ${t.replacesDate} is not null`),
    check('class_extra_status_check', sql`${t.status} is null or ${t.status} in ('cancelled', 'missed', 'taught')`),
  ],
)

/** Records that a class notice (reminder, missed-check, ...) was already sent, so it is never sent twice. */
export const classNotice = pgTable(
  'class_notice',
  {
    occurrenceKey: text('occurrence_key').notNull(),
    kind: text('kind').notNull(),
    sentAt: timestamp('sent_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.occurrenceKey, t.kind] })],
)

/** Per-user notification switches. No row means everything is on. */
export const notificationPreference = pgTable('notification_preference', {
  userId: text('user_id')
    .primaryKey()
    .references(() => user.id, { onDelete: 'cascade' }),
  classReminders: boolean('class_reminders').notNull().default(true),
})
