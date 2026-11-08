'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { toActionResult, type ActionResult } from '@/lib/action-result'
import { formString } from '@/lib/form-data'
import {
  createAssignment,
  deleteDraftAssignment,
  gradeSubmission,
  publishAssignment,
  releaseGrades,
  updateAssignment,
  type AssignmentInput,
} from '@/server/assignments/lecturer'
import { FEEDBACK_MAX, MAX_FILES, MAX_RICH_TEXT_BYTES } from '@/server/assignments/rules'
import { getCtx } from '@/server/auth/session'
import { config } from '@/server/core/config'
import { AppError } from '@/server/core/errors'
import { parseLocalDateTime } from '@/server/lib/local-time'

const SUBMISSION_MODES: readonly AssignmentInput['submissionMode'][] = ['files', 'text', 'both']
const LATE_POLICIES: readonly AssignmentInput['latePolicy'][] = ['accept', 'close']

function invalid(fields: string[]): never {
  throw new AppError('VALIDATION', 'Invalid input', { fields })
}

function requireId(value: unknown, field: string): string {
  if (typeof value !== 'string' || value === '' || value.length > 100) invalid([field])
  return value
}

/** "12.5" or the French "12,5"; blank or junk → NaN. */
function parseDecimal(raw: string): number {
  const text = raw.trim().replace(',', '.')
  if (text === '' || !/^\d+(\.\d+)?$/.test(text)) return Number.NaN
  return Number(text)
}

/** The rich-text document, posted as JSON in a hidden field. Size checked before parsing. */
function parseRichText(raw: string): unknown {
  if (new TextEncoder().encode(raw).length > MAX_RICH_TEXT_BYTES) return undefined
  try {
    return JSON.parse(raw)
  } catch {
    return undefined
  }
}

/**
 * Reads the assignment form. Every field is checked here first (all bad ones reported together);
 * the service checks the values again (ranges, future due date, files).
 */
function parseAssignmentForm(data: FormData): AssignmentInput {
  const bad: string[] = []

  const title = formString(data, 'title')
  const instructions = parseRichText(formString(data, 'instructions'))
  if (!Array.isArray(instructions)) bad.push('instructions')

  const dueAt = parseLocalDateTime(formString(data, 'dueAt'), config.timeZone)
  if (!dueAt) bad.push('dueAt')

  const maxMark = parseDecimal(formString(data, 'maxMark'))
  if (!Number.isFinite(maxMark)) bad.push('maxMark')
  const weight = parseDecimal(formString(data, 'weight'))
  if (!Number.isFinite(weight)) bad.push('weight')

  const submissionMode = formString(data, 'submissionMode') as AssignmentInput['submissionMode']
  if (!SUBMISSION_MODES.includes(submissionMode)) bad.push('submissionMode')
  const latePolicy = formString(data, 'latePolicy') as AssignmentInput['latePolicy']
  if (!LATE_POLICIES.includes(latePolicy)) bad.push('latePolicy')

  const attachmentIds = data.getAll('attachmentIds')
  if (attachmentIds.length > MAX_FILES || attachmentIds.some((id) => typeof id !== 'string' || id === '')) {
    bad.push('attachments')
  }

  if (bad.length > 0) invalid(bad)
  return {
    title,
    instructions,
    dueAt: dueAt!,
    maxMark,
    weight,
    submissionMode,
    latePolicy,
    attachmentIds: attachmentIds as string[],
  }
}

const coursePath = (courseId: string) => `/courses/${encodeURIComponent(courseId)}`
const assignmentPath = (courseId: string, assignmentId: string) =>
  `${coursePath(courseId)}/assignments/${encodeURIComponent(assignmentId)}`

/** Every lecturer page that shows an assignment or its submissions. */
function revalidateAssignments() {
  revalidatePath('/courses/[courseId]/assignments', 'page')
  revalidatePath('/courses/[courseId]/assignments/[assignmentId]', 'page')
  revalidatePath('/courses/[courseId]/assignments/[assignmentId]/edit', 'page')
  revalidatePath('/courses/[courseId]/assignments/[assignmentId]/submissions/[submissionId]', 'page')
}

/** Saves a new draft, then opens its edit page, where attachments can be added (ruling B6). */
export async function createAssignmentAction(
  courseId: string,
  _prev: ActionResult<never> | null,
  data: FormData,
): Promise<ActionResult<never>> {
  return toActionResult(async () => {
    const id = requireId(courseId, 'courseId')
    const input = parseAssignmentForm(data)
    const created = await createAssignment(await getCtx(), id, input)
    revalidateAssignments()
    redirect(`${assignmentPath(created.courseId, created.id)}/edit?created=1`)
  })
}

export async function updateAssignmentAction(
  assignmentId: string,
  _prev: ActionResult<never> | null,
  data: FormData,
): Promise<ActionResult<never>> {
  return toActionResult(async () => {
    const id = requireId(assignmentId, 'assignmentId')
    const input = parseAssignmentForm(data)
    const updated = await updateAssignment(await getCtx(), id, input)
    revalidateAssignments()
    redirect(assignmentPath(updated.courseId, updated.id))
  })
}

/** Publishes the draft; students are emailed after the response. */
export async function publishAssignmentAction(assignmentId: string): Promise<ActionResult<null>> {
  return toActionResult(async () => {
    await publishAssignment(await getCtx(), requireId(assignmentId, 'assignmentId'))
    revalidateAssignments()
    return null
  })
}

/** Deletes a draft, then goes back to the course's assignments. */
export async function deleteDraftAssignmentAction(assignmentId: string, courseId: string): Promise<ActionResult<never>> {
  return toActionResult(async () => {
    const id = requireId(assignmentId, 'assignmentId')
    const course = requireId(courseId, 'courseId')
    await deleteDraftAssignment(await getCtx(), id)
    revalidateAssignments()
    redirect(`${coursePath(course)}/assignments`)
  })
}

export async function gradeSubmissionAction(
  submissionId: string,
  _prev: ActionResult<null> | null,
  data: FormData,
): Promise<ActionResult<null>> {
  return toActionResult(async () => {
    const id = requireId(submissionId, 'submissionId')
    const bad: string[] = []
    const mark = parseDecimal(formString(data, 'mark'))
    if (!Number.isFinite(mark)) bad.push('mark')
    const feedback = formString(data, 'feedback')
    if (feedback.trim().length > FEEDBACK_MAX) bad.push('feedback')
    // The version the page showed (ISO); the service refuses it once the student has resubmitted.
    const expectedSubmittedAt = new Date(formString(data, 'submittedAt'))
    if (Number.isNaN(expectedSubmittedAt.getTime())) bad.push('submittedAt')
    if (bad.length > 0) invalid(bad)
    await gradeSubmission(await getCtx(), id, {
      mark,
      feedback: feedback.trim() === '' ? null : feedback,
      expectedSubmittedAt,
    })
    revalidateAssignments()
    return null
  })
}

/** Makes the marks visible to students (emails them the first time). */
export async function releaseGradesAction(assignmentId: string): Promise<ActionResult<{ released: number }>> {
  return toActionResult(async () => {
    const result = await releaseGrades(await getCtx(), requireId(assignmentId, 'assignmentId'))
    revalidateAssignments()
    return result
  })
}
