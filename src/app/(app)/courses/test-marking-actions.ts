'use server'

import { revalidatePath } from 'next/cache'
import { toActionResult, type ActionResult } from '@/lib/action-result'
import { getCtx } from '@/server/auth/session'
import { AppError } from '@/server/core/errors'
import { confirmMark, suggestMarks } from '@/server/tests/marking'
import { releaseResults } from '@/server/tests/results'
import { parseMarkInput } from './marking-format'

function invalid(field: string): never {
  throw new AppError('VALIDATION', 'Invalid input', { fields: [field] })
}

function requireId(value: unknown, field: string): string {
  if (typeof value !== 'string' || value === '' || value.length > 100) invalid(field)
  return value
}

/** Every page that shows a test's marks: the lecturer's, the course page and the student's link. */
function revalidateMarks() {
  revalidatePath('/courses/[courseId]', 'page')
  revalidatePath('/courses/[courseId]/tests', 'page')
  revalidatePath('/courses/[courseId]/tests/[testId]', 'page')
  revalidatePath('/courses/[courseId]/tests/[testId]/results', 'page')
  revalidatePath('/courses/[courseId]/tests/[testId]/mark', 'page')
  revalidatePath('/t/[code]', 'page')
}

/**
 * Asks the AI for suggestions on the question's real answers that have none (called when the
 * lecturer opens the question, or presses Try again). Stores suggestions only; never a mark.
 */
export async function suggestMarksAction(
  questionId: string,
): Promise<ActionResult<{ suggested: number; failed: boolean }>> {
  return toActionResult(async () => suggestMarks(await getCtx(), requireId(questionId, 'questionId')))
}

/**
 * Confirms (or changes) one answer's mark. `mark` is the picker's text ("3.5" or the French
 * "3,5"); `comment` is optional (blank → none).
 */
export async function confirmMarkAction(
  attemptId: string,
  questionId: string,
  mark: string,
  comment: string,
): Promise<ActionResult<null>> {
  return toActionResult(async () => {
    const attempt = requireId(attemptId, 'attemptId')
    const question = requireId(questionId, 'questionId')
    const value = typeof mark === 'string' ? parseMarkInput(mark) : Number.NaN
    if (!Number.isFinite(value)) invalid('mark')
    if (typeof comment !== 'string') invalid('comment')
    await confirmMark(await getCtx(), {
      attemptId: attempt,
      questionId: question,
      mark: value,
      comment: comment.trim() === '' ? null : comment,
    })
    revalidateMarks()
    return null
  })
}

/** Releases the results: students see their marks and are emailed (the first time only). */
export async function releaseResultsAction(testId: string): Promise<ActionResult<{ released: number }>> {
  return toActionResult(async () => {
    const result = await releaseResults(await getCtx(), requireId(testId, 'testId'))
    revalidateMarks()
    return result
  })
}
