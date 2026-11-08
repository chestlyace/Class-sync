import { sql } from 'drizzle-orm'
import { boolean, check, index, integer, pgTable, primaryKey, text, timestamp, uniqueIndex } from 'drizzle-orm/pg-core'
import { user } from './auth'
import { course } from './course'
import { courseTopic } from './notes'
import { courseTest } from './tests'

export const PRACTICE_KINDS = ['mcq', 'short'] as const
export type PracticeKind = (typeof PRACTICE_KINDS)[number]

/**
 * Practice questions of one topic: either written here (`source_family_id` null, one per topic) or
 * brought in from a test (`source_family_id` = the test's family, held until every copy is released).
 */
export const revisionGroup = pgTable(
  'revision_group',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    courseId: text('course_id')
      .notNull()
      .references(() => course.id, { onDelete: 'cascade' }),
    topicId: text('topic_id')
      .notNull()
      .references(() => courseTopic.id, { onDelete: 'restrict' }),
    sourceTestId: text('source_test_id').references(() => courseTest.id, { onDelete: 'set null' }),
    sourceFamilyId: text('source_family_id'),
    sourceTitle: text('source_title'),
    position: integer('position').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('revision_group_course_source_test_idx')
      .on(t.courseId, t.sourceTestId)
      .where(sql`${t.sourceTestId} is not null`),
    uniqueIndex('revision_group_topic_written_here_idx')
      .on(t.topicId)
      .where(sql`${t.sourceFamilyId} is null`),
    index('revision_group_topic_id_position_idx').on(t.topicId, t.position),
    index('revision_group_course_id_idx').on(t.courseId),
  ],
)

export const revisionQuestion = pgTable(
  'revision_question',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    groupId: text('group_id')
      .notNull()
      .references(() => revisionGroup.id, { onDelete: 'cascade' }),
    position: integer('position').notNull(),
    kind: text('kind', { enum: PRACTICE_KINDS }).notNull(),
    prompt: text('prompt').notNull(),
    guide: text('guide'),
    explanation: text('explanation'),
  },
  (t) => [
    check('revision_question_kind_check', sql`${t.kind} in ('mcq', 'short')`),
    index('revision_question_group_id_position_idx').on(t.groupId, t.position),
  ],
)

export const revisionOption = pgTable(
  'revision_option',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    questionId: text('question_id')
      .notNull()
      .references(() => revisionQuestion.id, { onDelete: 'cascade' }),
    position: integer('position').notNull(),
    text: text('text').notNull(),
    isCorrect: boolean('is_correct').notNull().default(false),
  },
  (t) => [
    uniqueIndex('revision_option_one_correct_idx')
      .on(t.questionId)
      .where(sql`${t.isCorrect}`),
  ],
)

/** A student's latest answer to a practice question: only whether it was right. */
export const revisionOutcome = pgTable(
  'revision_outcome',
  {
    studentId: text('student_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    questionId: text('question_id')
      .notNull()
      .references(() => revisionQuestion.id, { onDelete: 'cascade' }),
    correct: boolean('correct').notNull(),
    answeredAt: timestamp('answered_at', { withTimezone: true }).notNull(),
  },
  (t) => [primaryKey({ columns: [t.studentId, t.questionId] }), index('revision_outcome_question_id_idx').on(t.questionId)],
)
