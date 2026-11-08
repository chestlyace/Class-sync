import { and, asc, desc, eq, gt, inArray, isNotNull, isNull, max } from 'drizzle-orm'
import { createElement } from 'react'
import { now } from '@/server/core/clock'
import { config } from '@/server/core/config'
import type { Ctx } from '@/server/core/context'
import { AppError } from '@/server/core/errors'
import { requireRole } from '@/server/core/guards'
import { courseRosterQuery } from '@/server/courses/roster'
import { requireCourseOwner, type CourseSummary } from '@/server/courses/service'
import type { Db } from '@/server/db'
import {
  assignment,
  assignmentAttachment,
  assignmentReminder,
  classStudent,
  LATE_POLICIES,
  submission,
  SUBMISSION_MODES,
  user,
} from '@/server/db/schema'
import { sendNotifications, type Notification } from '@/server/email/notify'
import { AssignmentPublishedEmail } from '@/server/email/templates/assignment-published'
import { GradesReleasedEmail } from '@/server/email/templates/grades-released'
import { emailSubject } from '@/server/email/templates/verify-email'
import { assertConfirmedFilesOwnedBy, type FileInfo } from '@/server/files/service'
import { runAfterResponse } from '@/server/lib/after-response'
import {
  assignmentLinkBuilder,
  loadAssignmentDetail,
  loadAssignmentRow,
  loadAttachmentsByAssignment,
  loadSubmissionFiles,
  localesOf,
  toAssignmentDetail,
  type AssignmentDetail,
  type AssignmentRow,
} from './queries'
import { sanitizeRichText, type Block } from './rich-text'
import { isValidMark } from './rules'

export type { AssignmentDetail } from './queries'

export type AssignmentInput = {
  title: string
  instructions: unknown
  dueAt: Date
  maxMark: number
  weight: number
  submissionMode: 'files' | 'text' | 'both'
  latePolicy: 'accept' | 'close'
  attachmentIds: string[]
}

export type AssignmentListItem = AssignmentDetail & {
  submittedCount: number
  lateCount: number
  gradedCount: number
  rosterSize: number
}

export type SubmissionRow = {
  studentId: string
  name: string
  matricule: string
  state: 'missing' | 'submitted' | 'late'
  submissionId: string | null
  submittedAt: Date | null
  mark: number | null
  graded: boolean
}

export type LecturerSubmissionView = {
  assignment: AssignmentDetail
  student: { id: string; name: string; matricule: string }
  text: Block[] | null
  files: FileInfo[]
  submittedAt: Date
  isLate: boolean
  mark: number | null
  feedback: string | null
}

const TITLE_MIN = 2
const TITLE_MAX = 200
const MAX_MARK_RANGE = [1, 1000] as const
const WEIGHT_RANGE = [0.25, 100] as const
const FEEDBACK_MAX = 5000

type SubmissionMode = AssignmentInput['submissionMode']
type LatePolicy = AssignmentInput['latePolicy']

function forbidden(): never {
  throw new AppError('FORBIDDEN', 'Only the lecturer of this course can do this')
}

function invalidFields(fields: string[], message = 'Invalid input'): never {
  throw new AppError('VALIDATION', message, { fields })
}

/** Finite, within [min, max], and at most two decimals (the numeric columns have scale 2). */
function isTwoDecimalNumber(value: unknown, min: number, max: number): value is number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max) return false
  const cents = value * 100
  return Math.abs(cents - Math.round(cents)) < 1e-6
}

const toCents = (value: number) => Math.round(value * 100) / 100

type CleanInput = {
  title: string
  instructions: Block[]
  dueAt: Date
  maxMark: number
  weight: number
  submissionMode: SubmissionMode
  latePolicy: LatePolicy
  attachmentIds: string[]
}

/**
 * Checks every field and reports all invalid ones at once. `dueAt` must be in the future, except
 * that an update may keep the assignment's current due date (so a past assignment stays editable).
 */
function parseInput(input: AssignmentInput, current?: AssignmentRow): CleanInput {
  const raw = (input ?? {}) as Partial<Record<keyof AssignmentInput, unknown>>
  const bad: string[] = []

  const title = typeof raw.title === 'string' ? raw.title.trim() : ''
  if (title.length < TITLE_MIN || title.length > TITLE_MAX) bad.push('title')

  const instructions = sanitizeRichText(raw.instructions)
  if (!instructions) bad.push('instructions')

  const dueAt = raw.dueAt instanceof Date && !Number.isNaN(raw.dueAt.getTime()) ? raw.dueAt : null
  const keepsCurrentDue = !!dueAt && !!current && dueAt.getTime() === current.dueAt.getTime()
  if (!dueAt || (!keepsCurrentDue && dueAt.getTime() <= now().getTime())) bad.push('dueAt')

  if (!isTwoDecimalNumber(raw.maxMark, ...MAX_MARK_RANGE)) bad.push('maxMark')
  if (!isTwoDecimalNumber(raw.weight, ...WEIGHT_RANGE)) bad.push('weight')

  const submissionMode = raw.submissionMode as SubmissionMode
  if (!SUBMISSION_MODES.includes(submissionMode)) bad.push('submissionMode')
  const latePolicy = raw.latePolicy as LatePolicy
  if (!LATE_POLICIES.includes(latePolicy)) bad.push('latePolicy')

  if (bad.length > 0) invalidFields(bad)
  return {
    title,
    instructions: instructions!,
    dueAt: dueAt!,
    maxMark: toCents(raw.maxMark as number),
    weight: toCents(raw.weight as number),
    submissionMode,
    latePolicy,
    attachmentIds: raw.attachmentIds as string[],
  }
}

/** The one place attachment ids are checked: the lecturer's own confirmed uploads for this assignment. */
async function assertAttachable(db: Db, target: { ownerId: string; assignmentId: string }, fileIds: string[]) {
  await assertConfirmedFilesOwnedBy(db, fileIds, target.ownerId, 'assignment', target.assignmentId)
}

/** Owner-only lookup of an assignment. "No such assignment" and "not yours" are both FORBIDDEN. */
async function requireOwnedAssignment(ctx: Ctx, assignmentId: string): Promise<{ row: AssignmentRow; course: CourseSummary }> {
  requireRole(ctx, 'lecturer')
  const row = await loadAssignmentRow(ctx.db, assignmentId)
  if (!row) forbidden()
  return { row, course: await requireCourseOwner(ctx, row.courseId) }
}

/** Owner-only lookup of a submission (through its assignment's course); nonexistent is FORBIDDEN too. */
async function requireOwnedSubmission(ctx: Ctx, submissionId: string) {
  requireRole(ctx, 'lecturer')
  if (typeof submissionId !== 'string' || submissionId.length === 0) forbidden()
  const [found] = await ctx.db
    .select({ submission, assignment })
    .from(submission)
    .innerJoin(assignment, eq(assignment.id, submission.assignmentId))
    .where(eq(submission.id, submissionId))
  if (!found) forbidden()
  const course = await requireCourseOwner(ctx, found.assignment.courseId)
  return { sub: found.submission, row: found.assignment, course }
}

async function replaceAttachments(db: Db, assignmentId: string, fileIds: string[]) {
  await db.delete(assignmentAttachment).where(eq(assignmentAttachment.assignmentId, assignmentId))
  if (fileIds.length === 0) return
  await db
    .insert(assignmentAttachment)
    .values(fileIds.map((fileId, position) => ({ assignmentId, fileId, position })))
}

export async function createAssignment(ctx: Ctx, courseId: string, input: AssignmentInput): Promise<AssignmentDetail> {
  await requireCourseOwner(ctx, courseId)
  const data = parseInput(input)
  const id = crypto.randomUUID()
  await assertAttachable(ctx.db, { ownerId: ctx.user.id, assignmentId: id }, data.attachmentIds)

  const at = now()
  const row = await ctx.db.transaction(async (tx) => {
    const [created] = await tx
      .insert(assignment)
      .values({
        id,
        courseId,
        title: data.title,
        instructions: data.instructions,
        dueAt: data.dueAt,
        maxMark: data.maxMark,
        weight: data.weight,
        submissionMode: data.submissionMode,
        latePolicy: data.latePolicy,
        status: 'draft',
        createdBy: ctx.user.id,
        createdAt: at,
        updatedAt: at,
      })
      .returning()
    await replaceAttachments(tx, id, data.attachmentIds)
    return created
  })
  return loadAssignmentDetail(ctx.db, row)
}

/**
 * Edits a draft or a published assignment. The submission mode can't change once anyone has
 * submitted (CONFLICT mode_locked), and the max mark can't drop below a mark already given.
 * The attachment list is replaced by `attachmentIds`. A new due date recomputes every
 * submission's `isLate`; a later one also clears the assignment's sent reminders (ruling B11).
 */
export async function updateAssignment(ctx: Ctx, assignmentId: string, input: AssignmentInput): Promise<AssignmentDetail> {
  const { row: current } = await requireOwnedAssignment(ctx, assignmentId)
  const data = parseInput(input, current)
  await assertAttachable(ctx.db, { ownerId: ctx.user.id, assignmentId }, data.attachmentIds)

  const row = await ctx.db.transaction(async (tx) => {
    // Lock the assignment so the checks below see the submissions as of this update.
    const [locked] = await tx.select().from(assignment).where(eq(assignment.id, assignmentId)).for('update')
    if (!locked) forbidden()

    if (data.submissionMode !== locked.submissionMode) {
      const [any] = await tx
        .select({ id: submission.id })
        .from(submission)
        .where(eq(submission.assignmentId, assignmentId))
        .limit(1)
      if (any) {
        throw new AppError('CONFLICT', 'The submission type is locked once a student has submitted', {
          reason: 'mode_locked',
        })
      }
    }
    if (data.maxMark < locked.maxMark) {
      const [top] = await tx
        .select({ mark: max(submission.mark) })
        .from(submission)
        .where(eq(submission.assignmentId, assignmentId))
      if (top?.mark != null && Number(top.mark) > data.maxMark) {
        invalidFields(['maxMark'], 'A mark already given is higher than this max mark')
      }
    }

    const [updated] = await tx
      .update(assignment)
      .set({
        title: data.title,
        instructions: data.instructions,
        dueAt: data.dueAt,
        maxMark: data.maxMark,
        weight: data.weight,
        submissionMode: data.submissionMode,
        latePolicy: data.latePolicy,
        updatedAt: now(),
      })
      .where(eq(assignment.id, assignmentId))
      .returning()
    await replaceAttachments(tx, assignmentId, data.attachmentIds)

    // Ruling B11: a new due date decides again who handed in late, and an extension forgets the
    // reminders already sent so the new deadline gets its own reminder.
    if (data.dueAt.getTime() !== locked.dueAt.getTime()) {
      await tx
        .update(submission)
        .set({ isLate: gt(submission.submittedAt, data.dueAt) })
        .where(eq(submission.assignmentId, assignmentId))
      if (data.dueAt.getTime() > locked.dueAt.getTime()) {
        await tx.delete(assignmentReminder).where(eq(assignmentReminder.assignmentId, assignmentId))
      }
    }
    return updated
  })
  return loadAssignmentDetail(ctx.db, row)
}

export async function deleteDraftAssignment(ctx: Ctx, assignmentId: string): Promise<void> {
  const { row } = await requireOwnedAssignment(ctx, assignmentId)
  const published = () =>
    new AppError('CONFLICT', 'A published assignment cannot be deleted', { reason: 'published' })
  if (row.status !== 'draft') throw published()
  // Conditional, so a publish racing this delete wins and nothing is lost.
  const deleted = await ctx.db
    .delete(assignment)
    .where(and(eq(assignment.id, assignmentId), eq(assignment.status, 'draft')))
    .returning({ id: assignment.id })
  if (deleted.length === 0) throw published()
}

/**
 * Publishes a draft and, after the response, emails every current roster student in their own
 * language. Publishing an already published assignment returns it unchanged and emails nobody.
 * A draft whose due date has passed must get a new one first (VALIDATION dueAt).
 */
export async function publishAssignment(ctx: Ctx, assignmentId: string): Promise<AssignmentDetail> {
  const { row, course } = await requireOwnedAssignment(ctx, assignmentId)
  if (row.status === 'published') return loadAssignmentDetail(ctx.db, row)
  const at = now()
  if (row.dueAt.getTime() <= at.getTime()) invalidFields(['dueAt'], 'The due date has passed')

  const [updated] = await ctx.db
    .update(assignment)
    .set({ status: 'published', publishedAt: at, updatedAt: at })
    .where(and(eq(assignment.id, assignmentId), eq(assignment.status, 'draft')))
    .returning()
  if (!updated) {
    // Published (or deleted) concurrently: whoever published sends the emails.
    const fresh = await loadAssignmentRow(ctx.db, assignmentId)
    if (!fresh) forbidden()
    return loadAssignmentDetail(ctx.db, fresh)
  }

  // Everything the emails need is gathered now; the scheduled task only sends.
  const roster = await courseRosterQuery(ctx.db, { courseId: course.id })
  if (roster.length > 0) {
    const locales = await localesOf(ctx.db, roster.map((r) => r.studentId))
    const link = assignmentLinkBuilder('assignments')
    const url = link(updated.id)
    const items: Notification[] = roster.map((student) => {
      const locale = locales.get(student.studentId) ?? 'en'
      return {
        to: student.email,
        locale,
        subject: emailSubject('assignmentPublished', locale, { courseTitle: course.title, assignmentTitle: updated.title }),
        react: createElement(AssignmentPublishedEmail, {
          locale,
          studentName: student.name,
          courseTitle: course.title,
          assignmentTitle: updated.title,
          dueAt: updated.dueAt,
          url,
          timeZone: config.timeZone,
        }),
      }
    })
    runAfterResponse(async () => {
      await sendNotifications(items)
    })
  }
  return loadAssignmentDetail(ctx.db, updated)
}

/**
 * The course's assignments (drafts included) in due date order, each with counts over the
 * current roster: `submittedCount` on time, `lateCount` late (the two never overlap, so
 * missing = rosterSize - submittedCount - lateCount), `gradedCount` with a mark.
 */
export async function listCourseAssignments(ctx: Ctx, courseId: string): Promise<AssignmentListItem[]> {
  await requireCourseOwner(ctx, courseId)
  const rows = await ctx.db
    .select()
    .from(assignment)
    .where(eq(assignment.courseId, courseId))
    .orderBy(asc(assignment.dueAt), asc(assignment.createdAt), asc(assignment.id))
  if (rows.length === 0) return []

  const ids = rows.map((r) => r.id)
  const [attachments, roster, submissions] = await Promise.all([
    loadAttachmentsByAssignment(ctx.db, ids),
    courseRosterQuery(ctx.db, { courseId }),
    ctx.db
      .select({
        assignmentId: submission.assignmentId,
        studentId: submission.studentId,
        isLate: submission.isLate,
        mark: submission.mark,
      })
      .from(submission)
      .where(inArray(submission.assignmentId, ids)),
  ])
  const onRoster = new Set(roster.map((r) => r.studentId))
  const counts = new Map(ids.map((id) => [id, { submittedCount: 0, lateCount: 0, gradedCount: 0 }]))
  for (const s of submissions) {
    if (!onRoster.has(s.studentId)) continue
    const c = counts.get(s.assignmentId)!
    if (s.isLate) c.lateCount += 1
    else c.submittedCount += 1
    if (s.mark !== null) c.gradedCount += 1
  }
  return rows.map((r) => ({
    ...toAssignmentDetail(r, attachments.get(r.id) ?? []),
    ...counts.get(r.id)!,
    rosterSize: roster.length,
  }))
}

/** One row per current roster student, in roster order, with their submission state. */
export async function listSubmissions(
  ctx: Ctx,
  assignmentId: string,
): Promise<{ assignment: AssignmentDetail; rows: SubmissionRow[] }> {
  const { row, course } = await requireOwnedAssignment(ctx, assignmentId)
  const [detail, roster, submissions] = await Promise.all([
    loadAssignmentDetail(ctx.db, row),
    courseRosterQuery(ctx.db, { courseId: course.id }),
    ctx.db
      .select({
        id: submission.id,
        studentId: submission.studentId,
        submittedAt: submission.submittedAt,
        isLate: submission.isLate,
        mark: submission.mark,
      })
      .from(submission)
      .where(eq(submission.assignmentId, assignmentId)),
  ])
  const byStudent = new Map(submissions.map((s) => [s.studentId, s]))
  const rows: SubmissionRow[] = roster.map((student) => {
    const s = byStudent.get(student.studentId)
    return {
      studentId: student.studentId,
      name: student.name,
      matricule: student.matricule,
      state: !s ? 'missing' : s.isLate ? 'late' : 'submitted',
      submissionId: s?.id ?? null,
      submittedAt: s?.submittedAt ?? null,
      mark: s?.mark ?? null,
      graded: s?.mark != null,
    }
  })
  return { assignment: detail, rows }
}

/** The student's matricule for this course: from the roster, else their latest one in the course's class. */
async function matriculeFor(db: Db, course: CourseSummary, studentId: string): Promise<string> {
  const [onRoster] = await courseRosterQuery(db, { courseId: course.id, studentId })
  if (onRoster) return onRoster.matricule
  const [membership] = await db
    .select({ matricule: classStudent.matricule })
    .from(classStudent)
    .where(and(eq(classStudent.classId, course.classId), eq(classStudent.userId, studentId)))
    .orderBy(desc(classStudent.joinedAt))
    .limit(1)
  return membership?.matricule ?? ''
}

export async function getSubmissionForLecturer(ctx: Ctx, submissionId: string): Promise<LecturerSubmissionView> {
  const { sub, row, course } = await requireOwnedSubmission(ctx, submissionId)
  const [detail, files, [student], matricule] = await Promise.all([
    loadAssignmentDetail(ctx.db, row),
    loadSubmissionFiles(ctx.db, sub.id),
    ctx.db.select({ id: user.id, name: user.name }).from(user).where(eq(user.id, sub.studentId)),
    matriculeFor(ctx.db, course, sub.studentId),
  ])
  return {
    assignment: detail,
    student: { id: sub.studentId, name: student?.name ?? '', matricule },
    // Sanitised when submitted.
    text: Array.isArray(sub.text) ? (sub.text as Block[]) : null,
    files,
    submittedAt: sub.submittedAt,
    isLate: sub.isLate,
    mark: sub.mark,
    feedback: sub.feedback,
  }
}

/**
 * Sets the mark (a multiple of 0.25 within 0..maxMark) and the feedback (trimmed, blank = none,
 * at most 5,000 characters). Allowed after grades are released too: it is an edit, with no email.
 */
export async function gradeSubmission(
  ctx: Ctx,
  submissionId: string,
  input: { mark: number; feedback: string | null },
): Promise<void> {
  const { sub, row } = await requireOwnedSubmission(ctx, submissionId)
  const mark = input?.mark
  if (typeof mark !== 'number' || !isValidMark(mark, row.maxMark)) invalidFields(['mark'], 'Invalid mark')
  const raw = input?.feedback
  if (raw !== null && raw !== undefined && typeof raw !== 'string') invalidFields(['feedback'])
  const feedback = typeof raw === 'string' && raw.trim() !== '' ? raw.trim() : null
  if (feedback !== null && feedback.length > FEEDBACK_MAX) invalidFields(['feedback'], 'Feedback is too long')

  await ctx.db
    .update(submission)
    .set({ mark, feedback, gradedAt: now(), gradedBy: ctx.user.id })
    .where(eq(submission.id, sub.id))
}

/**
 * Makes the marks visible to students. The first call sets `gradesReleasedAt` and, after the
 * response, emails each current roster student who has a mark; later calls change nothing and
 * email nobody. `released` is the number of roster students with a mark now.
 */
export async function releaseGrades(ctx: Ctx, assignmentId: string): Promise<{ released: number }> {
  const { row, course } = await requireOwnedAssignment(ctx, assignmentId)
  if (row.status !== 'published') {
    throw new AppError('CONFLICT', 'Only a published assignment has grades to release', { reason: 'not_published' })
  }
  let firstRelease = false
  if (!row.gradesReleasedAt) {
    const at = now()
    const updated = await ctx.db
      .update(assignment)
      .set({ gradesReleasedAt: at, updatedAt: at })
      .where(and(eq(assignment.id, assignmentId), isNull(assignment.gradesReleasedAt)))
      .returning({ id: assignment.id })
    firstRelease = updated.length > 0
  }

  // Read after the release, so a grade saved meanwhile is either emailed here or shown without one.
  const [roster, graded] = await Promise.all([
    courseRosterQuery(ctx.db, { courseId: course.id }),
    ctx.db
      .select({ studentId: submission.studentId })
      .from(submission)
      .where(and(eq(submission.assignmentId, assignmentId), isNotNull(submission.mark))),
  ])
  const hasMark = new Set(graded.map((g) => g.studentId))
  const recipients = roster.filter((r) => hasMark.has(r.studentId))

  if (firstRelease && recipients.length > 0) {
    const locales = await localesOf(ctx.db, recipients.map((r) => r.studentId))
    const url = assignmentLinkBuilder('assignments')(row.id)
    const items: Notification[] = recipients.map((student) => {
      const locale = locales.get(student.studentId) ?? 'en'
      return {
        to: student.email,
        locale,
        subject: emailSubject('gradesReleased', locale, { courseTitle: course.title, assignmentTitle: row.title }),
        react: createElement(GradesReleasedEmail, {
          locale,
          studentName: student.name,
          courseTitle: course.title,
          assignmentTitle: row.title,
          url,
        }),
      }
    })
    runAfterResponse(async () => {
      await sendNotifications(items)
    })
  }
  return { released: recipients.length }
}
