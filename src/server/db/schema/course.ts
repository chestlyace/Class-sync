import { sql } from 'drizzle-orm'
import { check, pgTable, primaryKey, smallint, text, timestamp } from 'drizzle-orm/pg-core'
import { user } from './auth'
import { class_ } from './class'

export const ROSTER_ADJUSTMENT_KINDS = ['include', 'exclude'] as const
export type RosterAdjustmentKind = (typeof ROSTER_ADJUSTMENT_KINDS)[number]

export const course = pgTable(
  'course',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    classId: text('class_id')
      .notNull()
      .references(() => class_.id, { onDelete: 'cascade' }),
    lecturerId: text('lecturer_id')
      .notNull()
      .references(() => user.id),
    title: text('title').notNull(),
    code: text('code'),
    semester: smallint('semester').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [check('course_semester_check', sql`${t.semester} between 1 and 3`)],
)

export const courseRosterAdjustment = pgTable(
  'course_roster_adjustment',
  {
    courseId: text('course_id')
      .notNull()
      .references(() => course.id, { onDelete: 'cascade' }),
    studentId: text('student_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    kind: text('kind', { enum: ROSTER_ADJUSTMENT_KINDS }).notNull(),
    createdBy: text('created_by')
      .notNull()
      .references(() => user.id),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.courseId, t.studentId] }),
    check('course_roster_adjustment_kind_check', sql`${t.kind} in ('include', 'exclude')`),
  ],
)
