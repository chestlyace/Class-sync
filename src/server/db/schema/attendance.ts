import { sql } from 'drizzle-orm'
import {
  boolean,
  check,
  doublePrecision,
  index,
  integer,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
} from 'drizzle-orm/pg-core'
import { user } from './auth'
import { course } from './course'

export const WINDOW_KINDS = ['start', 'end'] as const
export type WindowKind = (typeof WINDOW_KINDS)[number]

export const OVERRIDE_STATUSES = ['present', 'partial', 'absent'] as const
export type OverrideStatus = (typeof OVERRIDE_STATUSES)[number]

export const attendanceSession = pgTable(
  'attendance_session',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    courseId: text('course_id')
      .notNull()
      .references(() => course.id, { onDelete: 'cascade' }),
    requireOnCampus: boolean('require_on_campus').notNull().default(false),
    createdBy: text('created_by')
      .notNull()
      .references(() => user.id),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('attendance_session_course_id_idx').on(t.courseId)],
)

export const attendanceWindow = pgTable(
  'attendance_window',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    sessionId: text('session_id')
      .notNull()
      .references(() => attendanceSession.id, { onDelete: 'cascade' }),
    kind: text('kind', { enum: WINDOW_KINDS }).notNull(),
    secret: text('secret').notNull(),
    openedAt: timestamp('opened_at', { withTimezone: true }).notNull().defaultNow(),
    closedAt: timestamp('closed_at', { withTimezone: true }),
    openedBy: text('opened_by')
      .notNull()
      .references(() => user.id),
  },
  (t) => [
    unique('attendance_window_session_kind_unique').on(t.sessionId, t.kind),
    check('attendance_window_kind_check', sql`${t.kind} in ('start', 'end')`),
    index('attendance_window_session_id_idx').on(t.sessionId),
  ],
)

export const attendanceCheckIn = pgTable(
  'attendance_check_in',
  {
    windowId: text('window_id')
      .notNull()
      .references(() => attendanceWindow.id, { onDelete: 'cascade' }),
    studentId: text('student_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    checkedInAt: timestamp('checked_in_at', { withTimezone: true }).notNull().defaultNow(),
    latitude: doublePrecision('latitude'),
    longitude: doublePrecision('longitude'),
    accuracyM: doublePrecision('accuracy_m'),
  },
  (t) => [
    primaryKey({ columns: [t.windowId, t.studentId] }),
    index('attendance_check_in_student_id_idx').on(t.studentId),
  ],
)

export const attendanceOverride = pgTable(
  'attendance_override',
  {
    sessionId: text('session_id')
      .notNull()
      .references(() => attendanceSession.id, { onDelete: 'cascade' }),
    studentId: text('student_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    status: text('status', { enum: OVERRIDE_STATUSES }).notNull(),
    setBy: text('set_by')
      .notNull()
      .references(() => user.id),
    setAt: timestamp('set_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.sessionId, t.studentId] }),
    check('attendance_override_status_check', sql`${t.status} in ('present', 'partial', 'absent')`),
  ],
)

export const attendanceCodeFailure = pgTable(
  'attendance_code_failure',
  {
    windowId: text('window_id')
      .notNull()
      .references(() => attendanceWindow.id, { onDelete: 'cascade' }),
    studentId: text('student_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    failures: integer('failures').notNull().default(0),
  },
  (t) => [primaryKey({ columns: [t.windowId, t.studentId] })],
)
