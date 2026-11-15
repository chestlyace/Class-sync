'use server'

import { toActionResult, type ActionResult } from '@/lib/action-result'
import { getCtx } from '@/server/auth/session'
import { AppError } from '@/server/core/errors'
import { recordTestPracticeOutcomes } from '@/server/tests/review'

/**
 * A student's queued practice answers for a released test. Outcomes the service cannot keep now
 * (review closed, unknown question) are skipped without failing, so `ok` means the batch can leave
 * the device's queue. Practice never counts.
 */
export async function recordTestPracticeOutcomesAction(
  testId: string,
  outcomes: { questionId: string; correct: boolean }[],
): Promise<ActionResult<{ saved: number }>> {
  return toActionResult(async () => {
    if (typeof testId !== 'string' || testId === '' || testId.length > 100) {
      throw new AppError('VALIDATION', 'Invalid input', { fields: ['testId'] })
    }
    return recordTestPracticeOutcomes(await getCtx(), testId, outcomes)
  })
}
