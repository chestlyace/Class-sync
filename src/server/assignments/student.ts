import { and, asc, eq, gt, inArray, lte, type SQL } from 'drizzle-orm'
import { now } from '@/server/core/clock'
import type { Ctx } from '@/server/core/context'
import { AppError } from '@/server/core/errors'
import { requireRole } from '@/server/core/guards'
import { isOnCourseRoster, rosteredCourseIds } from '@/server/courses/roster'
import type { Db } from '@/server/db'
import { assignment, assignmentAttachment, course, file, submission, submissionFile } from '@/server/db/schema'
import { assertConfirmedFilesOwnedBy, type FileInfo } from '@/server/files/service'
import { isRichTextEmpty, sanitizeRichText, type Block } from './rich-text'
import { canSubmit, isLate } from './rules'

// TODO(merge): same fields as Task 4's AssignmentDetail in queries.ts; unify there.
export type AssignmentDetail = {
  id: string
  courseId: string
  title: string
  instructions: Block[]
  dueAt: Date
  maxMark: number
  weight: number
  submissionMode: 'files' | 'text' | 'both'
  latePolicy: 'accept' | 'close'
  status: 'draft' | 'published'
  publishedAt: Date | null
  gradesReleasedAt: Date | null
  attachments: FileInfo[]
}

export type StudentAssignmentState = 'todo' | 'submitted' | 'late' | 'graded' | 'closed'

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

// ---------------------------------------------------------------------------------------------
// Loaders (private; Task 4's queries.ts has the shared ones — deduped at merge)
// ---------------------------------------------------------------------------------------------

async function loadAssignmentRow(db: Db, assignmentId: string) {
  if (typeof assignmentId !== 'string' || assignmentId.length === 0 || assignmentId.length > 100) return undefined
  const [row] = await db.select().from(assignment).where(eq(assignment.id, assignmentId))
  return row
}

type AssignmentRow = NonNullable<Awaited<ReturnType<typeof loadAssignmentRow>>>

async function loadAttachments(db: Db, assignmentId: string): Promise<FileInfo[]> {
  return db
    .select({ id: file.id, name: file.name, mimeType: file.mimeType, sizeBytes: file.sizeBytes })
    .from(assignmentAttachment)
    .innerJoin(file, eq(file.id, assignmentAttachment.fileId))
    .where(eq(assignmentAttachment.assignmentId, assignmentId))
    .orderBy(asc(assignmentAttachment.position))
}

async function loadSubmissionFiles(db: Db, submissionId: string): Promise<FileInfo[]> {
  return db
    .select({ id: file.id, name: file.name, mimeType: file.mimeType, sizeBytes: file.sizeBytes })
    .from(submissionFile)
    .innerJoin(file, eq(file.id, submissionFile.fileId))
    .where(eq(submissionFile.submissionId, submissionId))
    .orderBy(asc(submissionFile.position))
}

/** Stored rich text was sanitised on write; anything that is not a block list reads as empty. */
function asBlocks(value: unknown): Block[] {
  return Array.isArray(value) ? (value as Block[]) : []
}

function toDetail(row: AssignmentRow, attachments: FileInfo[]): AssignmentDetail {
  return {
    id: row.id,
    courseId: row.courseId,
    title: row.title,
    instructions: asBlocks(row.instructions),
    dueAt: row.dueAt,
    maxMark: row.maxMark,
    weight: row.weight,
    submissionMode: row.submissionMode,
    latePolicy: row.latePolicy,
    status: row.status,
    publishedAt: row.publishedAt,
    gradesReleasedAt: row.gradesReleasedAt,
    attachments,
  }
}

/**
 * The published assignment, if the calling student is on its course's roster. A missing
 * assignment, a draft, another course and a lecturer caller are all FORBIDDEN.
 */
async function requireVisibleAssignment(ctx: Ctx, assignmentId: string): Promise<AssignmentRow> {
  requireRole(ctx, 'student')
  const row = await loadAssignmentRow(ctx.db, assignmentId)
  if (!row || row.status !== 'published' || !(await isOnCourseRoster(ctx.db, row.courseId, ctx.user.id))) {
    forbidden()
  }
  return row
}

/**
 * The one place submission files are checked. Ruling B4 adds an assignment check to
 * assertConfirmedFilesOwnedBy; at merge `assignmentId` is passed through here.
 */
async function assertSubmissionFiles(db: Db, fileIds: string[], studentId: string, assignmentId: string) {
  void assignmentId
  await assertConfirmedFilesOwnedBy(db, fileIds, studentId, 'submission')
}

// ---------------------------------------------------------------------------------------------
// States
// ---------------------------------------------------------------------------------------------

/** graded (released and marked) > late > submitted > closed (nothing in, hard-closed) > todo. */
function stateOf(
  a: { status: 'draft' | 'published'; latePolicy: 'accept' | 'close'; dueAt: Date; gradesReleasedAt: Date | null },
  mine: { isLate: boolean; mark: number | null } | null,
  at: Date,
): StudentAssignmentState {
  if (mine) {
    if (a.gradesReleasedAt && mine.mark !== null) return 'graded'
    return mine.isLate ? 'late' : 'submitted'
  }
  return canSubmit({ status: a.status, latePolicy: a.latePolicy, dueAt: a.dueAt, now: at }) === 'closed'
    ? 'closed'
    : 'todo'
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
): Promise<{ assignment: AssignmentDetail; mySubmission: MySubmission | null; canSubmit: 'ok' | 'closed' }> {
  const row = await requireVisibleAssignment(ctx, assignmentId)
  const attachments = await loadAttachments(ctx.db, row.id)

  const [mine] = await ctx.db
    .select()
    .from(submission)
    .where(and(eq(submission.assignmentId, row.id), eq(submission.studentId, ctx.user.id)))
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

  const verdict = canSubmit({ status: row.status, latePolicy: row.latePolicy, dueAt: row.dueAt, now: now() })
  return {
    assignment: toDetail(row, attachments),
    mySubmission,
    canSubmit: verdict === 'closed' ? 'closed' : 'ok',
  }
}

/**
 * Submits (or replaces) the student's work. Mode rules:
 * - `files`: the text is ignored; at least one file (VALIDATION { reason: 'files_required' }).
 * - `text`: non-empty text (`text_required`) and no files (`files_not_allowed`).
 * - `both`: at least one of them (`empty`); empty text is stored as no text.
 * Text that is not a valid block list is VALIDATION { fields: ['text'] }. After the deadline with
 * the `close` policy: CONFLICT { reason: 'closed' }. A resubmission replaces the text and files,
 * moves `submittedAt`, recomputes `isLate` and clears any grade.
 */
export async function submitAssignment(
  ctx: Ctx,
  assignmentId: string,
  input: { text: unknown; fileIds: string[] },
): Promise<{ submittedAt: Date; isLate: boolean }> {
  const row = await requireVisibleAssignment(ctx, assignmentId)
  const at = now()
  const verdict = canSubmit({ status: row.status, latePolicy: row.latePolicy, dueAt: row.dueAt, now: at })
  if (verdict === 'closed') throw new AppError('CONFLICT', 'Submissions are closed', { reason: 'closed' })

  const fileIds = input?.fileIds
  if (!Array.isArray(fileIds)) invalid({ fields: ['fileIds'] })

  let text: Block[] | null = null
  if (row.submissionMode !== 'files' && input.text !== null && input.text !== undefined) {
    const clean = sanitizeRichText(input.text)
    if (!clean) invalid({ fields: ['text'] })
    text = isRichTextEmpty(clean) ? null : clean
  }

  if (row.submissionMode === 'files' && fileIds.length === 0) invalid({ reason: 'files_required' })
  if (row.submissionMode === 'text') {
    if (!text) invalid({ reason: 'text_required' })
    if (fileIds.length > 0) invalid({ reason: 'files_not_allowed' })
  }
  if (row.submissionMode === 'both' && !text && fileIds.length === 0) invalid({ reason: 'empty' })

  await assertSubmissionFiles(ctx.db, fileIds, ctx.user.id, row.id)

  const late = isLate(at, row.dueAt)
  await ctx.db.transaction(async (tx) => {
    // The unique (assignment, student) key makes a concurrent double submit update one row.
    const [saved] = await tx
      .insert(submission)
      .values({ assignmentId: row.id, studentId: ctx.user.id, text, submittedAt: at, isLate: late })
      .onConflictDoUpdate({
        target: [submission.assignmentId, submission.studentId],
        set: { text, submittedAt: at, isLate: late, mark: null, feedback: null, gradedAt: null, gradedBy: null },
      })
      .returning({ id: submission.id })
    await tx.delete(submissionFile).where(eq(submissionFile.submissionId, saved.id))
    if (fileIds.length > 0) {
      await tx
        .insert(submissionFile)
        .values(fileIds.map((fileId, position) => ({ submissionId: saved.id, fileId, position })))
    }
  })
  return { submittedAt: at, isLate: late }
}
