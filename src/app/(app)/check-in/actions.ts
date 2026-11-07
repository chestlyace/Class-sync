'use server'

import { toActionResult, type ActionResult } from '@/lib/action-result'
import { parsePosition } from '@/lib/position'
import { checkIn, listOpenCheckIns } from '@/server/attendance/check-in'
import { getCtx } from '@/server/auth/session'
import { AppError } from '@/server/core/errors'
import { toOpenCheckInView, type OpenCheckInView } from './view'

const MAX_CODE_LENGTH = 20

function invalid(field: string): never {
  throw new AppError('VALIDATION', 'Invalid input', { fields: [field] })
}

/** The student's open check-ins, for the dashboard banner's polling. */
export async function listOpenCheckInsAction(): Promise<ActionResult<OpenCheckInView[]>> {
  return toActionResult(async () => (await listOpenCheckIns(await getCtx())).map(toOpenCheckInView))
}

/**
 * Checks in with the code on the screen. A blank code is refused here, before the service
 * counts it as a wrong attempt; a missing or malformed position goes on as null.
 */
export async function checkInAction(
  windowId: string,
  code: string,
  position: unknown,
): Promise<ActionResult<{ result: 'checked_in' | 'already_checked_in' }>> {
  return toActionResult(async () => {
    if (typeof windowId !== 'string' || !windowId) invalid('windowId')
    if (typeof code !== 'string' || code.length > MAX_CODE_LENGTH || !code.trim()) invalid('code')
    return checkIn(await getCtx(), windowId, { code, position: parsePosition(position) })
  })
}
