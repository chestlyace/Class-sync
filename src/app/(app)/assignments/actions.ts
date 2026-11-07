'use server'

import { toActionResult, type ActionResult } from '@/lib/action-result'
import { submitAssignment } from '@/server/assignments/student'
import { getCtx } from '@/server/auth/session'
import { AppError } from '@/server/core/errors'

const MAX_ID_LENGTH = 100

function invalid(fields: string[]): never {
  throw new AppError('VALIDATION', 'Invalid input', { fields })
}

/**
 * Submits (or replaces) the student's work. `text` is the editor's document (or null), `fileIds`
 * the confirmed uploads in order. Shapes are checked here; the service applies the mode, deadline
 * and file rules (VALIDATION / CONFLICT reasons the form translates).
 */
export async function submitAssignmentAction(
  assignmentId: string,
  text: unknown,
  fileIds: unknown,
): Promise<ActionResult<{ submittedAt: Date; isLate: boolean }>> {
  return toActionResult(async () => {
    if (typeof assignmentId !== 'string' || assignmentId === '' || assignmentId.length > MAX_ID_LENGTH) {
      invalid(['assignmentId'])
    }
    if (!Array.isArray(fileIds) || fileIds.some((id) => typeof id !== 'string' || id === '' || id.length > MAX_ID_LENGTH)) {
      invalid(['fileIds'])
    }
    if (text !== null && text !== undefined && !Array.isArray(text)) invalid(['text'])
    return submitAssignment(await getCtx(), assignmentId, { text: text ?? null, fileIds: fileIds as string[] })
  })
}
