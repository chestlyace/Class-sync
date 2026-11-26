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
    /** A pasted Google Meet link. Non-null means the class is online (it may still have a room too). */
    meetingUrl: text('meeting_url'),
    /** Uses the course's Meet classroom (`course_classroom`) instead of a pasted link. */
    autoMeet: boolean('auto_meet').notNull().default(false),
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
    check(
      'class_slot_online_campus_check',
      sql`(${t.meetingUrl} is null and ${t.autoMeet} = false) or ${t.requireOnCampus} = false`,
    ),
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
    /** A pasted Google Meet link. Non-null means the class is online (it may still have a room too). */
    meetingUrl: text('meeting_url'),
    /** Uses the course's Meet classroom (`course_classroom`) instead of a pasted link. */
    autoMeet: boolean('auto_meet').notNull().default(false),
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
    check(
      'class_extra_online_campus_check',
      sql`(${t.meetingUrl} is null and ${t.autoMeet} = false) or ${t.requireOnCampus} = false`,
    ),
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

/** A student's first and last tap on a Google Meet Join button. Occurrence keys are not rows, so there is no class FK. */
export const onlineClassJoin = pgTable(
  'online_class_join',
  {
    occurrenceKey: text('occurrence_key').notNull(),
    studentId: text('student_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    firstJoinedAt: timestamp('first_joined_at', { withTimezone: true }).notNull(),
    lastJoinedAt: timestamp('last_joined_at', { withTimezone: true }).notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.occurrenceKey, t.studentId] }),
    index('online_class_join_student_id_idx').on(t.studentId),
  ],
)

/**
 * The one Google Meet "classroom" of a course, created through the lecturer's own Google account so the lecturer is
 * the host. Every class of the course with `auto_meet` uses this link. `google_account_id` is the Better Auth
 * `account.id` that created the space; it is not a foreign key so unlinking Google never deletes the classroom.
 */
export const courseClassroom = pgTable('course_classroom', {
  courseId: text('course_id')
    .primaryKey()
    .references(() => course.id, { onDelete: 'cascade' }),
  /** The Meet API space name, e.g. `spaces/abc123`. */
  spaceName: text('space_name').notNull(),
  meetingUrl: text('meeting_url').notNull(),
  meetingCode: text('meeting_code').notNull(),
  googleAccountId: text('google_account_id').notNull(),
  /** Whether the space was switched to host-managed (knocking) entry. */
  knockingConfirmed: boolean('knocking_confirmed').notNull(),
  createdBy: text('created_by')
    .notNull()
    .references(() => user.id),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
})
export type CourseClassroom = typeof courseClassroom.$inferSelect

/** Per-user notification switches. No row means everything is on. */
export const notificationPreference = pgTable('notification_preference', {
  userId: text('user_id')
    .primaryKey()
    .references(() => user.id, { onDelete: 'cascade' }),
  classReminders: boolean('class_reminders').notNull().default(true),
})
