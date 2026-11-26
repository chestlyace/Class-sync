'use server'

import { toActionResult, type ActionResult } from '@/lib/action-result'
import { getCtx } from '@/server/auth/session'
import { AppError } from '@/server/core/errors'
import { createClassroom } from '@/server/schedule/classroom'

/**
 * "Create the classroom": `needsGoogle` sends the lecturer to Google for the Meet permission first. The caller
 * refreshes the page on `ready`, so no path is revalidated here. A Google outage is thrown, not returned.
 */
export async function createClassroomAction(
  courseId: string,
): Promise<ActionResult<{ kind: 'ready' } | { kind: 'needsGoogle' }>> {
  return toActionResult(async () => {
    if (typeof courseId !== 'string' || courseId === '') {
      throw new AppError('VALIDATION', 'Invalid input', { fields: ['courseId'] })
    }
    const result = await createClassroom(await getCtx(), courseId)
    return { kind: result.kind }
  })
}
