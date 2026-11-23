import { sql } from 'drizzle-orm'
import {
  boolean,
  check,
  index,
  integer,
  numeric,
  pgTable,
  primaryKey,
  smallint,
  text,
  timestamp,
  unique,
  uniqueIndex,
  type AnyPgColumn,
} from 'drizzle-orm/pg-core'
import { user } from './auth'
import { course } from './course'
import { caTestGroup } from './performance'

export const QUESTION_KINDS = ['mcq', 'short'] as const
export type QuestionKindDb = (typeof QUESTION_KINDS)[number]

export const CLOSE_REASONS = ['handed_in', 'left'] as const
export type CloseReason = (typeof CLOSE_REASONS)[number]

export const TEST_LOG_KINDS = ['ended_left', 'reopened', 'handed_in'] as const
export type TestLogKind = (typeof TEST_LOG_KINDS)[number]

export const CATCH_UP_FOR = ['missed', 'picked'] as const
export type CatchUpFor = (typeof CATCH_UP_FOR)[number]

export const courseTest = pgTable(
  'course_test',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    courseId: text('course_id')
      .notNull()
      .references(() => course.id, { onDelete: 'cascade' }),
    code: text('code').notNull().unique(),
    title: text('title').notNull(),
    durationMinutes: smallint('duration_minutes').notNull(),
    defaultMark: numeric('default_mark', {
      precision: 5,
      scale: 2,
      mode: 'number',
    }).notNull(),
    shuffle: boolean('shuffle').notNull().default(true),
    // How much the test counts among the course's tests in the CA (like an assignment's weight).
    weight: numeric('weight', { precision: 6, scale: 2, mode: 'number' }).notNull().default(1),
    // Off: a practice test, left out of the CA. A catch-up follows its original.
    countsInCa: boolean('counts_in_ca').notNull().default(true),
    // Which named CA of the course it counts in; null when the course has none (or it was deleted).
    caGroupId: text('ca_group_id').references(() => caTestGroup.id, { onDelete: 'set null' }),
    maxExits: smallint('max_exits').notNull().default(3),
    maxAbsenceSeconds: smallint('max_absence_seconds').notNull().default(10),
    startedAt: timestamp('started_at', { withTimezone: true }),
    deadlineAt: timestamp('deadline_at', { withTimezone: true }),
    endedAt: timestamp('ended_at', { withTimezone: true }),
    resultsReleasedAt: timestamp('results_released_at', { withTimezone: true }),
    // Students may review the paper (their answers, the correct ones) and practise it once released.
    studentsCanReview: boolean('students_can_review').notNull().default(true),
    // The root of the copied_from chain: every copy shares it. A test inserted without one is its own family.
    familyId: text('family_id')
      .notNull()
      .$defaultFn(() => crypto.randomUUID()),
    copiedFromId: text('copied_from_id').references((): AnyPgColumn => courseTest.id, { onDelete: 'set null' }),
    // A catch-up sits for students who missed the original (or were picked by the lecturer). Null on ordinary tests.
    catchUpOfId: text('catch_up_of_id').references((): AnyPgColumn => courseTest.id, { onDelete: 'cascade' }),
    catchUpFor: text('catch_up_for', { enum: CATCH_UP_FOR }),
    createdBy: text('created_by')
      .notNull()
      .references(() => user.id),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check('course_test_duration_check', sql`${t.durationMinutes} between 1 and 300`),
    check('course_test_max_exits_check', sql`${t.maxExits} between 1 and 10`),
    check('course_test_max_absence_check', sql`${t.maxAbsenceSeconds} between 3 and 300`),
    check('course_test_default_mark_check', sql`${t.defaultMark} > 0`),
    check('course_test_weight_check', sql`${t.weight} between 0.25 and 100`),
    // Start and deadline are set together (Start fixes both).
    check('course_test_started_deadline_check', sql`(${t.startedAt} is null) = (${t.deadlineAt} is null)`),
    index('course_test_course_id_idx').on(t.courseId),
    index('course_test_family_id_idx').on(t.familyId),
    // A catch-up names its original and who it is for, together or not at all.
    check('course_test_catch_up_check', sql`(${t.catchUpOfId} is null) = (${t.catchUpFor} is null)`),
    index('course_test_catch_up_of_id_idx').on(t.catchUpOfId),
  ],
)

// The students a "picked" catch-up is for.
export const testCatchUpStudent = pgTable(
  'test_catch_up_student',
  {
    testId: text('test_id')
      .notNull()
      .references(() => courseTest.id, { onDelete: 'cascade' }),
    studentId: text('student_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    addedAt: timestamp('added_at', { withTimezone: true }).notNull().defaultNow(),
    addedBy: text('added_by')
      .notNull()
      .references(() => user.id),
  },
  (t) => [primaryKey({ columns: [t.testId, t.studentId] })],
)

export const testQuestion = pgTable(
  'test_question',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    testId: text('test_id')
      .notNull()
      .references(() => courseTest.id, { onDelete: 'cascade' }),
    position: smallint('position').notNull(),
    kind: text('kind', { enum: QUESTION_KINDS }).notNull(),
    prompt: text('prompt').notNull(),
    // null = the test's default mark.
    mark: numeric('mark', { precision: 5, scale: 2, mode: 'number' }),
    guide: text('guide'),
  },
  (t) => [
    check('test_question_kind_check', sql`${t.kind} in ('mcq', 'short')`),
    check('test_question_mark_check', sql`${t.mark} > 0`),
    index('test_question_test_id_position_idx').on(t.testId, t.position),
  ],
)

export const testOption = pgTable(
  'test_option',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    questionId: text('question_id')
      .notNull()
      .references(() => testQuestion.id, { onDelete: 'cascade' }),
    position: smallint('position').notNull(),
    text: text('text').notNull(),
    isCorrect: boolean('is_correct').notNull().default(false),
  },
  (t) => [
    // At most one correct option per question, enforced by the database.
    uniqueIndex('test_option_one_correct_idx')
      .on(t.questionId)
      .where(sql`${t.isCorrect}`),
  ],
)

export const testAttempt = pgTable(
  'test_attempt',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    testId: text('test_id')
      .notNull()
      .references(() => courseTest.id, { onDelete: 'cascade' }),
    studentId: text('student_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    seed: text('seed').notNull(),
    deviceId: text('device_id').notNull(),
    deviceSeenAt: timestamp('device_seen_at', { withTimezone: true }).notNull(),
    joinedAt: timestamp('joined_at', { withTimezone: true }).notNull().defaultNow(),
    closedAt: timestamp('closed_at', { withTimezone: true }),
    closedReason: text('closed_reason', { enum: CLOSE_REASONS }),
    exitsSinceReopen: smallint('exits_since_reopen').notNull().default(0),
  },
  (t) => [
    check('test_attempt_closed_reason_check', sql`${t.closedReason} in ('handed_in', 'left')`),
    unique('test_attempt_test_student_unique').on(t.testId, t.studentId),
    index('test_attempt_student_id_idx').on(t.studentId),
  ],
)

export const testAnswer = pgTable(
  'test_answer',
  {
    attemptId: text('attempt_id')
      .notNull()
      .references(() => testAttempt.id, { onDelete: 'cascade' }),
    questionId: text('question_id')
      .notNull()
      .references(() => testQuestion.id, { onDelete: 'cascade' }),
    optionId: text('option_id').references(() => testOption.id, {
      onDelete: 'set null',
    }),
    text: text('text'),
    // Per-question revision counter from the device; the highest one wins.
    rev: integer('rev').notNull(),
    receivedAt: timestamp('received_at', { withTimezone: true }).notNull(),
    // Marking (used by the companion plan).
    mark: numeric('mark', { precision: 5, scale: 2, mode: 'number' }),
    comment: text('comment'),
    markedBy: text('marked_by').references(() => user.id),
    markedAt: timestamp('marked_at', { withTimezone: true }),
    suggestedMark: numeric('suggested_mark', {
      precision: 5,
      scale: 2,
      mode: 'number',
    }),
    suggestedReason: text('suggested_reason'),
    suggestedAt: timestamp('suggested_at', { withTimezone: true }),
  },
  (t) => [
    primaryKey({ columns: [t.attemptId, t.questionId] }),
    index('test_answer_question_id_idx').on(t.questionId),
    // The upper bound depends on the question, so only the service checks it.
    check('test_answer_mark_check', sql`${t.mark} >= 0`),
    check('test_answer_suggested_mark_check', sql`${t.suggestedMark} >= 0`),
  ],
)

export const testExit = pgTable(
  'test_exit',
  {
    attemptId: text('attempt_id')
      .notNull()
      .references(() => testAttempt.id, { onDelete: 'cascade' }),
    // Client-generated uuid, so a retried report is the same exit.
    exitId: text('exit_id').notNull(),
    exitNumber: smallint('exit_number').notNull(),
    firstReportedAt: timestamp('first_reported_at', {
      withTimezone: true,
    }).notNull(),
    awayMs: integer('away_ms'),
    returnedAt: timestamp('returned_at', { withTimezone: true }),
  },
  (t) => [primaryKey({ columns: [t.attemptId, t.exitId] })],
)

export const testLog = pgTable(
  'test_log',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    attemptId: text('attempt_id')
      .notNull()
      .references(() => testAttempt.id, { onDelete: 'cascade' }),
    kind: text('kind', { enum: TEST_LOG_KINDS }).notNull(),
    at: timestamp('at', { withTimezone: true }).notNull().defaultNow(),
    byUserId: text('by_user_id').references(() => user.id),
  },
  (t) => [
    check('test_log_kind_check', sql`${t.kind} in ('ended_left', 'reopened', 'handed_in')`),
    index('test_log_attempt_id_idx').on(t.attemptId),
  ],
)

/** A student's latest practice answer to a released test's question: only whether it was right. Never counts. */
export const testPracticeOutcome = pgTable(
  'test_practice_outcome',
  {
    studentId: text('student_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    questionId: text('question_id')
      .notNull()
      .references(() => testQuestion.id, { onDelete: 'cascade' }),
    correct: boolean('correct').notNull(),
    answeredAt: timestamp('answered_at', { withTimezone: true }).notNull(),
  },
  (t) => [primaryKey({ columns: [t.studentId, t.questionId] }), index('test_practice_outcome_question_id_idx').on(t.questionId)],
)
