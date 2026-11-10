import { and, asc, eq, gt, inArray, lte, type SQL } from 'drizzle-orm'
import { createElement } from 'react'
import { now } from '@/server/core/clock'
import { config } from '@/server/core/config'
import type { Ctx } from '@/server/core/context'
import { AppError } from '@/server/core/errors'
import { requireRole } from '@/server/core/guards'
import { isOnCourseRoster, rosteredCourseIds } from '@/server/courses/roster'
import type { Db } from '@/server/db'
import { assignment, course, submission, submissionFile } from '@/server/db/schema'
import { queueNotifications, type Notification } from '@/server/email/notify'
import { AssignmentSubmittedEmail } from '@/server/email/templates/assignment-submitted'
import { emailSubject } from '@/server/email/templates/verify-email'
import { assertConfirmedFilesOwnedBy, type FileInfo } from '@/server/files/service'
import {
  assignmentLinkBuilder,
  type AssignmentDetail,
  type AssignmentRow,
  loadAssignmentRow,
  loadAttachmentsByAssignment,
  loadSubmissionFiles,
  toAssignmentDetail,
} from './queries'
import { isRichTextEmpty, sanitizeRichText, type Block } from './rich-text'
import { canSubmit, isLate } from './rules'

export type { AssignmentDetail }

export type StudentAssignmentState = 'todo' | 'submitted' | 'late' | 'graded' | 'closed'

/** Whether the student can hand in (or replace) work now: closed by the deadline, or by the release of grades. */
export type StudentSubmitVerdict = 'ok' | 'closed' | 'released'

export type StudentAssignmentSummary = {
  id: string
  courseId: string
  courseTitle: string
  title: string
  dueAt: Date
  state: StudentAssignmentState
  /** Only once grades are released. */
  mark: number | null
  maxMark: number
}

export type MySubmission = {
  text: Block[] | null
  files: FileInfo[]
  submittedAt: Date
  isLate: boolean
  /** Only once grades are released. */
  mark: number | null
  /** Only once grades are released. */
  feedback: string | null
}

const DAY_MS = 24 * 60 * 60 * 1000
const MAX_DUE_WITHIN_DAYS = 366

function forbidden(): never {
  throw new AppError('FORBIDDEN', 'You do not have access to this assignment')
}

function invalid(details: Record<string, unknown>): never {
  throw new AppError('VALIDATION', 'Invalid submission', details)
}

/** Stored rich text was sanitised on write; anything that is not a block list reads as empty. */
function asBlocks(value: unknown): Block[] {
  return Array.isArray(value) ? (value as Block[]) : []
}

/**
 * The published assignment, if the calling student is on its course's roster. A missing
 * assignment, a draft, another course and a lecturer caller are all FORBIDDEN.
 */
async function requireVisibleAssignment(ctx: Ctx, assignmentId: string): Promise<AssignmentRow> {
  requireRole(ctx, 'student')
  // Ids are short; anything longer cannot exist, so it never reaches the database.
  if (typeof assignmentId !== 'string' || assignmentId.length > 100) forbidden()
  const row = await loadAssignmentRow(ctx.db, assignmentId)
  if (!row || row.status !== 'published' || !(await isOnCourseRoster(ctx.db, row.courseId, ctx.user.id))) {
    forbidden()
  }
  return row
}

/** The one place submission files are checked: the student's own confirmed uploads for this assignment. */
async function assertSubmissionFiles(db: Db, fileIds: string[], studentId: string, assignmentId: string) {
  await assertConfirmedFilesOwnedBy(db, fileIds, studentId, 'submission', assignmentId)
}

// ---------------------------------------------------------------------------------------------
// States
// ---------------------------------------------------------------------------------------------

/** graded (released and marked) > late > submitted > closed (nothing in; hard-closed or released) > todo. */
function stateOf(
  a: { status: 'draft' | 'published'; latePolicy: 'accept' | 'close'; dueAt: Date; gradesReleasedAt: Date | null },
  mine: { isLate: boolean; mark: number | null } | null,
  at: Date,
): StudentAssignmentState {
  if (mine) {
    if (a.gradesReleasedAt && mine.mark !== null) return 'graded'
    return mine.isLate ? 'late' : 'submitted'
  }
  const verdict = canSubmit({ ...a, now: at })
  return verdict === 'closed' || verdict === 'released' ? 'closed' : 'todo'
}

// ---------------------------------------------------------------------------------------------
// Services
// ---------------------------------------------------------------------------------------------

/**
 * Published assignments of the courses the student is on the roster of, earliest due first.
 * `courseId` narrows to one course (a course the student is not on gives an empty list);
 * `dueWithinDays` keeps those due in `(now, now + days]`.
 */
export async function listMyAssignments(
  ctx: Ctx,
  filter: { courseId?: string; dueWithinDays?: number } = {},
): Promise<StudentAssignmentSummary[]> {
  requireRole(ctx, 'student')
  const { courseId, dueWithinDays } = filter ?? {}
  if (courseId !== undefined && typeof courseId !== 'string') invalid({ fields: ['courseId'] })
  if (
    dueWithinDays !== undefined &&
    (typeof dueWithinDays !== 'number' ||
      !Number.isFinite(dueWithinDays) ||
      dueWithinDays <= 0 ||
      dueWithinDays > MAX_DUE_WITHIN_DAYS)
  ) {
    invalid({ fields: ['dueWithinDays'] })
  }

  let courseIds = await rosteredCourseIds(ctx.db, ctx.user.id)
  if (courseId !== undefined) courseIds = courseIds.filter((id) => id === courseId)
  if (courseIds.length === 0) return []

  const at = now()
  const conditions: SQL[] = [inArray(assignment.courseId, courseIds), eq(assignment.status, 'published')]
  if (dueWithinDays !== undefined) {
    conditions.push(gt(assignment.dueAt, at), lte(assignment.dueAt, new Date(at.getTime() + dueWithinDays * DAY_MS)))
  }

  const rows = await ctx.db
    .select({
      id: assignment.id,
      courseId: assignment.courseId,
      courseTitle: course.title,
      title: assignment.title,
      dueAt: assignment.dueAt,
      maxMark: assignment.maxMark,
      status: assignment.status,
      latePolicy: assignment.latePolicy,
      gradesReleasedAt: assignment.gradesReleasedAt,
      submissionId: submission.id,
      isLate: submission.isLate,
      mark: submission.mark,
    })
    .from(assignment)
    .innerJoin(course, eq(course.id, assignment.courseId))
    .leftJoin(submission, and(eq(submission.assignmentId, assignment.id), eq(submission.studentId, ctx.user.id)))
    .where(and(...conditions))
    .orderBy(asc(assignment.dueAt), asc(assignment.title), asc(assignment.id))

  return rows.map((r) => {
    const mine = r.submissionId !== null ? { isLate: r.isLate ?? false, mark: r.mark } : null
    const state = stateOf(r, mine, at)
    return {
      id: r.id,
      courseId: r.courseId,
      courseTitle: r.courseTitle,
      title: r.title,
      dueAt: r.dueAt,
      state,
      mark: state === 'graded' ? r.mark : null,
      maxMark: r.maxMark,
    }
  })
}

/** The assignment as a rostered student sees it, with their own submission (if any). */
export async function getAssignmentForStudent(
  ctx: Ctx,
  assignmentId: string,
): Promise<{ assignment: AssignmentDetail; mySubmission: MySubmission | null; canSubmit: StudentSubmitVerdict }> {
  const row = await requireVisibleAssignment(ctx, assignmentId)
  const [attachments, [mine]] = await Promise.all([
    loadAttachmentsByAssignment(ctx.db, [row.id]),
    ctx.db
      .select()
      .from(submission)
      .where(and(eq(submission.assignmentId, row.id), eq(submission.studentId, ctx.user.id))),
  ])
  let mySubmission: MySubmission | null = null
  if (mine) {
    const released = row.gradesReleasedAt !== null
    mySubmission = {
      text: mine.text === null ? null : asBlocks(mine.text),
      files: await loadSubmissionFiles(ctx.db, mine.id),
      submittedAt: mine.submittedAt,
      isLate: mine.isLate,
      mark: released ? mine.mark : null,
      feedback: released ? mine.feedback : null,
    }
  }

  // The row is published (requireVisibleAssignment), so the verdict is never 'not_published'.
  const verdict = canSubmit({ ...row, now: now() })
  return {
    assignment: toAssignmentDetail(row, attachments.get(row.id) ?? []),
    mySubmission,
    canSubmit: verdict === 'not_published' ? 'closed' : verdict,
  }
}

/** The typed answer: absent, invalid, or sanitised blocks (null when it has no content). */
type ParsedText = { kind: 'absent' } | { kind: 'invalid' } | { kind: 'ok'; blocks: Block[] | null }

function parseText(value: unknown): ParsedText {
  if (value === null || value === undefined) return { kind: 'absent' }
  const clean = sanitizeRichText(value)
  if (!clean) return { kind: 'invalid' }
  return { kind: 'ok', blocks: isRichTextEmpty(clean) ? null : clean }
}

/**
 * The deadline and submission mode rules against one assignment row (see submitAssignment).
 * Returns the text to store (none in `files` mode) and whether the work is late.
 */
function checkSubmission(
  row: AssignmentRow,
  text: ParsedText,
  fileIds: string[],
  at: Date,
): { storedText: Block[] | null; late: boolean } {
  const verdict = canSubmit({ ...row, now: at })
  if (verdict === 'not_published') forbidden()
  if (verdict === 'released') {
    throw new AppError('CONFLICT', 'Grades are released, so submissions are closed', { reason: 'released' })
  }
  if (verdict === 'closed') throw new AppError('CONFLICT', 'Submissions are closed', { reason: 'closed' })

  let storedText: Block[] | null = null
  if (row.submissionMode !== 'files') {
    if (text.kind === 'invalid') invalid({ fields: ['text'] })
    if (text.kind === 'ok') storedText = text.blocks
  }

  if (row.submissionMode === 'files' && fileIds.length === 0) invalid({ reason: 'files_required' })
  if (row.submissionMode === 'text') {
    if (!storedText) invalid({ reason: 'text_required' })
    if (fileIds.length > 0) invalid({ reason: 'files_not_allowed' })
  }
  if (row.submissionMode === 'both' && !storedText && fileIds.length === 0) invalid({ reason: 'empty' })
  return { storedText, late: isLate(at, row.dueAt) }
}

/**
 * Submits (or replaces) the student's work. Mode rules:
 * - `files`: the text is ignored; at least one file (VALIDATION { reason: 'files_required' }).
 * - `text`: non-empty text (`text_required`) and no files (`files_not_allowed`).
 * - `both`: at least one of them (`empty`); empty text is stored as no text.
 * Text that is not a valid block list is VALIDATION { fields: ['text'] }. After the deadline with
 * the `close` policy: CONFLICT { reason: 'closed' }; once grades are released, always CONFLICT
 * { reason: 'released' } (ruling B9). A resubmission (before the release) replaces the text and
 * files, moves `submittedAt`, recomputes `isLate` and clears any grade. Each accepted submission
 * emails the student a receipt after the response (best effort, never failing the submission).
 */
export async function submitAssignment(
  ctx: Ctx,
  assignmentId: string,
  input: { text: unknown; fileIds: string[] },
): Promise<{ submittedAt: Date; isLate: boolean }> {
  const row = await requireVisibleAssignment(ctx, assignmentId)
  const at = now()
  const fileIds = input?.fileIds
  if (!Array.isArray(fileIds)) invalid({ fields: ['fileIds'] })
  const text = parseText(input.text)

  // Fail fast on the unlocked row; the transaction below repeats the checks on the locked one.
  checkSubmission(row, text, fileIds, at)
  await assertSubmissionFiles(ctx.db, fileIds, ctx.user.id, row.id)

  const done = await ctx.db.transaction(async (tx) => {
    // FOR SHARE: a lecturer's concurrent edit (FOR UPDATE on this row) waits for this submission, or
    // this waits for the edit and is validated against its result — never against a stale mode,
    // deadline or late policy.
    const [locked] = await tx.select().from(assignment).where(eq(assignment.id, row.id)).for('share')
    if (!locked || locked.status !== 'published') forbidden()
    const { storedText, late } = checkSubmission(locked, text, fileIds, at)

    // The unique (assignment, student) key makes a concurrent double submit update one row.
    const [saved] = await tx
      .insert(submission)
      .values({ assignmentId: row.id, studentId: ctx.user.id, text: storedText, submittedAt: at, isLate: late })
      .onConflictDoUpdate({
        target: [submission.assignmentId, submission.studentId],
        set: {
          text: storedText,
          submittedAt: at,
          isLate: late,
          mark: null,
          feedback: null,
          gradedAt: null,
          gradedBy: null,
          // A suggestion was about the previous version.
          suggestedMark: null,
          suggestedFeedback: null,
          suggestedAt: null,
        },
      })
      .returning({ id: submission.id })
    await tx.delete(submissionFile).where(eq(submissionFile.submissionId, saved.id))
    if (fileIds.length > 0) {
      await tx
        .insert(submissionFile)
        .values(fileIds.map((fileId, position) => ({ submissionId: saved.id, fileId, position })))
    }
    return { submittedAt: at, isLate: late, title: locked.title }
  })
  await queueNotifications('submitAssignment', () =>
    submittedEmails(ctx, { id: row.id, courseId: row.courseId, title: done.title }, done),
  )
  return { submittedAt: done.submittedAt, isLate: done.isLate }
}

/** The student's receipt for a submission, in their own language. */
async function submittedEmails(
  ctx: Ctx,
  a: { id: string; courseId: string; title: string },
  saved: { submittedAt: Date; isLate: boolean },
): Promise<Notification[]> {
  const [c] = await ctx.db.select({ title: course.title }).from(course).where(eq(course.id, a.courseId))
  if (!c) return []
  const me = ctx.user
  return [
    {
      to: me.email,
      locale: me.locale,
      subject: emailSubject('assignmentSubmitted', me.locale, { courseTitle: c.title, assignmentTitle: a.title }),
      kind: 'assignmentSubmitted',
      react: createElement(AssignmentSubmittedEmail, {
        locale: me.locale,
        studentName: me.name,
        courseTitle: c.title,
        assignmentTitle: a.title,
        submittedAt: saved.submittedAt,
        isLate: saved.isLate,
        url: assignmentLinkBuilder('submitAssignment')(a.id),
        timeZone: config.timeZone,
      }),
    },
  ]
}
