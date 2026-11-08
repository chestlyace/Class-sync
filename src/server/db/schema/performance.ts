import { sql } from 'drizzle-orm'
import { check, index, numeric, pgTable, smallint, text, timestamp } from 'drizzle-orm/pg-core'
import { user } from './auth'
import { course } from './course'

export const courseCaSettings = pgTable(
  'course_ca_settings',
  {
    courseId: text('course_id')
      .primaryKey()
      .references(() => course.id, { onDelete: 'cascade' }),
    total: numeric('total', { precision: 6, scale: 2, mode: 'number' }).notNull(),
    attendancePoints: numeric('attendance_points', { precision: 6, scale: 2, mode: 'number' }).notNull(),
    assignmentPoints: numeric('assignment_points', { precision: 6, scale: 2, mode: 'number' }).notNull(),
    participationPoints: numeric('participation_points', { precision: 6, scale: 2, mode: 'number' }).notNull(),
    testPoints: numeric('test_points', { precision: 6, scale: 2, mode: 'number' }).notNull(),
    // Count only the best N tests; null = every test.
    testsBestOf: smallint('tests_best_of'),
    participationTarget: smallint('participation_target').notNull().default(5),
    updatedBy: text('updated_by')
      .notNull()
      .references(() => user.id),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check('course_ca_settings_total_check', sql`${t.total} > 0`),
    check('course_ca_settings_attendance_points_check', sql`${t.attendancePoints} >= 0`),
    check('course_ca_settings_assignment_points_check', sql`${t.assignmentPoints} >= 0`),
    check('course_ca_settings_participation_points_check', sql`${t.participationPoints} >= 0`),
    check('course_ca_settings_test_points_check', sql`${t.testPoints} >= 0`),
    check('course_ca_settings_participation_target_check', sql`${t.participationTarget} between 1 and 100`),
    check('course_ca_settings_tests_best_of_check', sql`${t.testsBestOf} between 1 and 50`),
  ],
)

export const participationEvent = pgTable(
  'participation_event',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    courseId: text('course_id')
      .notNull()
      .references(() => course.id, { onDelete: 'cascade' }),
    studentId: text('student_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    delta: smallint('delta').notNull(),
    createdBy: text('created_by')
      .notNull()
      .references(() => user.id),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check('participation_event_delta_check', sql`${t.delta} in (-1, 1)`),
    index('participation_event_course_student_idx').on(t.courseId, t.studentId),
    // Undo looks up the caller's latest tap in a course.
    index('participation_event_course_creator_created_idx').on(t.courseId, t.createdBy, t.createdAt),
  ],
)
