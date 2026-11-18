import { sql } from 'drizzle-orm'
import {
  boolean,
  check,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  primaryKey,
  smallint,
  text,
  timestamp,
  unique,
} from 'drizzle-orm/pg-core'
import { user } from './auth'
import { course } from './course'

export const FILE_PURPOSES = ['assignment', 'submission', 'resource'] as const
export type FilePurpose = (typeof FILE_PURPOSES)[number]

export const SUBMISSION_MODES = ['files', 'text', 'both'] as const
export type SubmissionMode = (typeof SUBMISSION_MODES)[number]

export const LATE_POLICIES = ['accept', 'close'] as const
export type LatePolicy = (typeof LATE_POLICIES)[number]

export const ASSIGNMENT_STATUSES = ['draft', 'published'] as const
export type AssignmentStatus = (typeof ASSIGNMENT_STATUSES)[number]

export const SUGGESTED_BY = ['assistant', 'clasync'] as const
export type SuggestedBy = (typeof SUGGESTED_BY)[number]

export const AI_STATUSES = ['queued', 'failed'] as const
export type AiStatus = (typeof AI_STATUSES)[number]

export const AI_ERRORS = ['provider', 'cap', 'unreadable'] as const
export type AiError = (typeof AI_ERRORS)[number]

export const UNREAD_REASONS = ['heic', 'too_large', 'unsupported', 'limit'] as const
/** A submitted file the AI could not read; `position` is its place in the submission's file list. */
export type UnreadFile = { position: number; reason: (typeof UNREAD_REASONS)[number] }

export const file = pgTable(
  'file',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    ownerId: text('owner_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    purpose: text('purpose', { enum: FILE_PURPOSES }).notNull(),
    storageKey: text('storage_key').notNull().unique(),
    name: text('name').notNull(),
    mimeType: text('mime_type').notNull(),
    sizeBytes: integer('size_bytes').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    confirmedAt: timestamp('confirmed_at', { withTimezone: true }),
  },
  (t) => [
    check('file_purpose_check', sql`${t.purpose} in ('assignment', 'submission', 'resource')`),
    index('file_owner_id_idx').on(t.ownerId),
  ],
)

export const assignment = pgTable(
  'assignment',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    courseId: text('course_id')
      .notNull()
      .references(() => course.id, { onDelete: 'cascade' }),
    title: text('title').notNull(),
    instructions: jsonb('instructions').notNull().default(sql`'[]'::jsonb`),
    // Lecturer-only notes for the AI marker (what a good answer contains); never shown to students.
    markingGuide: text('marking_guide'),
    dueAt: timestamp('due_at', { withTimezone: true }).notNull(),
    maxMark: numeric('max_mark', { precision: 7, scale: 2, mode: 'number' }).notNull(),
    weight: numeric('weight', { precision: 6, scale: 2, mode: 'number' }).notNull().default(1),
    submissionMode: text('submission_mode', { enum: SUBMISSION_MODES }).notNull(),
    latePolicy: text('late_policy', { enum: LATE_POLICIES }).notNull().default('accept'),
    status: text('status', { enum: ASSIGNMENT_STATUSES }).notNull().default('draft'),
    publishedAt: timestamp('published_at', { withTimezone: true }),
    gradesReleasedAt: timestamp('grades_released_at', { withTimezone: true }),
    createdBy: text('created_by')
      .notNull()
      .references(() => user.id),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check('assignment_submission_mode_check', sql`${t.submissionMode} in ('files', 'text', 'both')`),
    check('assignment_late_policy_check', sql`${t.latePolicy} in ('accept', 'close')`),
    check('assignment_status_check', sql`${t.status} in ('draft', 'published')`),
    index('assignment_course_id_idx').on(t.courseId),
    index('assignment_status_due_at_idx').on(t.status, t.dueAt),
  ],
)

export const assignmentAttachment = pgTable(
  'assignment_attachment',
  {
    assignmentId: text('assignment_id')
      .notNull()
      .references(() => assignment.id, { onDelete: 'cascade' }),
    fileId: text('file_id')
      .notNull()
      .references(() => file.id, { onDelete: 'cascade' }),
    position: smallint('position').notNull(),
  },
  // file_id: access checks look links up by file (mayRead), and file deletes cascade through it.
  (t) => [primaryKey({ columns: [t.assignmentId, t.fileId] }), index('assignment_attachment_file_id_idx').on(t.fileId)],
)

export const submission = pgTable(
  'submission',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    assignmentId: text('assignment_id')
      .notNull()
      .references(() => assignment.id, { onDelete: 'cascade' }),
    studentId: text('student_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    text: jsonb('text'),
    submittedAt: timestamp('submitted_at', { withTimezone: true }).notNull(),
    isLate: boolean('is_late').notNull().default(false),
    mark: numeric('mark', { precision: 7, scale: 2, mode: 'number' }),
    feedback: text('feedback'),
    gradedAt: timestamp('graded_at', { withTimezone: true }),
    gradedBy: text('graded_by').references(() => user.id),
    // A lecturer's AI assistant may suggest a mark (MCP); only the lecturer turns it into `mark`.
    suggestedMark: numeric('suggested_mark', { precision: 7, scale: 2, mode: 'number' }),
    suggestedFeedback: text('suggested_feedback'),
    suggestedAt: timestamp('suggested_at', { withTimezone: true }),
    // Who made the suggestion: the lecturer's own assistant (MCP) or Clasync's built-in AI marking.
    suggestedBy: text('suggested_by', { enum: SUGGESTED_BY }),
    // What the AI read from the submitted files, so the lecturer can check it against the originals.
    suggestedTranscript: text('suggested_transcript'),
    suggestedUnread: jsonb('suggested_unread').$type<UnreadFile[]>(),
    aiStatus: text('ai_status', { enum: AI_STATUSES }),
    aiStatusAt: timestamp('ai_status_at', { withTimezone: true }),
    aiError: text('ai_error', { enum: AI_ERRORS }),
  },
  (t) => [
    check('submission_suggested_mark_check', sql`${t.suggestedMark} >= 0`),
    check('submission_suggested_by_check', sql`${t.suggestedBy} in ('assistant', 'clasync')`),
    check('submission_ai_status_check', sql`${t.aiStatus} in ('queued', 'failed')`),
    check('submission_ai_error_check', sql`${t.aiError} in ('provider', 'cap', 'unreadable')`),
    unique('submission_assignment_student_unique').on(t.assignmentId, t.studentId),
    index('submission_student_id_idx').on(t.studentId),
  ],
)

export const submissionFile = pgTable(
  'submission_file',
  {
    submissionId: text('submission_id')
      .notNull()
      .references(() => submission.id, { onDelete: 'cascade' }),
    fileId: text('file_id')
      .notNull()
      .references(() => file.id, { onDelete: 'cascade' }),
    position: smallint('position').notNull(),
  },
  // file_id: access checks look links up by file (mayRead), and file deletes cascade through it.
  (t) => [primaryKey({ columns: [t.submissionId, t.fileId] }), index('submission_file_file_id_idx').on(t.fileId)],
)

export const assignmentReminder = pgTable(
  'assignment_reminder',
  {
    assignmentId: text('assignment_id')
      .notNull()
      .references(() => assignment.id, { onDelete: 'cascade' }),
    studentId: text('student_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    sentAt: timestamp('sent_at', { withTimezone: true }).notNull(),
  },
  (t) => [primaryKey({ columns: [t.assignmentId, t.studentId] })],
)
