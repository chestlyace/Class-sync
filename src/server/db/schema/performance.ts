import { sql } from 'drizzle-orm'
import { check, index, jsonb, numeric, pgTable, smallint, text, timestamp, uniqueIndex } from 'drizzle-orm/pg-core'
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

/**
 * A named CA inside a course's tests part ("CA 1", "CA 2"): its own points, out of the course's
 * test points, and its own "best N". A course without any keeps one tests part, as before.
 */
export const caTestGroup = pgTable(
  'ca_test_group',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    courseId: text('course_id')
      .notNull()
      .references(() => course.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    points: numeric('points', { precision: 6, scale: 2, mode: 'number' }).notNull(),
    // Count only the best N tests of this CA; null = every test.
    bestOf: smallint('best_of'),
    position: smallint('position').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check('ca_test_group_points_check', sql`${t.points} >= 0`),
    check('ca_test_group_best_of_check', sql`${t.bestOf} between 1 and 50`),
    uniqueIndex('ca_test_group_course_name_idx').on(t.courseId, sql`lower(${t.name})`),
  ],
)

/** A CA split as a template: the course settings and the named CAs, without ids. */
export type CaTemplateSettingsDb = {
  total: number
  attendancePoints: number
  assignmentPoints: number
  participationPoints: number
  testPoints: number
  participationTarget: number
  testsBestOf: number | null
  groups: { name: string; points: number; bestOf: number | null }[]
}

/** A lecturer's own CA template, to set up other courses the same way. */
export const caTemplate = pgTable(
  'ca_template',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    ownerId: text('owner_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    settings: jsonb('settings').$type<CaTemplateSettingsDb>().notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex('ca_template_owner_name_idx').on(t.ownerId, sql`lower(${t.name})`)],
)

/**
 * The template a lecturer's new courses start with: one of their own, or a built-in one by id.
 * No row: new courses get the app's defaults.
 */
export const caTemplateDefault = pgTable(
  'ca_template_default',
  {
    userId: text('user_id')
      .primaryKey()
      .references(() => user.id, { onDelete: 'cascade' }),
    templateId: text('template_id').references(() => caTemplate.id, { onDelete: 'cascade' }),
    builtInId: text('built_in_id'),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [check('ca_template_default_one_check', sql`(${t.templateId} is null) <> (${t.builtInId} is null)`)],
)
