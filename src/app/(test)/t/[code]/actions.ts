'use server'

import { toActionResult, type ActionResult } from '@/lib/action-result'
import { getCtx } from '@/server/auth/session'
import { AppError } from '@/server/core/errors'
import { handIn, openTest, syncAttempt } from '@/server/tests/attempt'
import { parseSyncPayload } from './sync-payload'
import { toAttemptViewDto, type AttemptViewDto } from './view-dto'

const MAX_CODE_LENGTH = 50
const MAX_ID_LENGTH = 100

function invalid(field: string): never {
  throw new AppError('VALIDATION', 'Invalid input', { fields: [field] })
}

function checkId(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.length === 0 || value.length > MAX_ID_LENGTH) invalid(field)
  return value
}

/** Opens the test behind the link on this device (creates the attempt at the first open). */
export async function openTestAction(code: string, deviceId: string): Promise<ActionResult<AttemptViewDto>> {
  return toActionResult(async () => {
    if (typeof code !== 'string' || code.length === 0 || code.length > MAX_CODE_LENGTH) invalid('code')
    checkId(deviceId, 'deviceId')
    return toAttemptViewDto(await openTest(await getCtx(), code, deviceId))
  })
}

/** The runner's heartbeat: queued answers and leave reports up, the attempt's state and server time down. */
export async function syncAttemptAction(attemptId: string, payload: unknown): Promise<ActionResult<AttemptViewDto>> {
  return toActionResult(async () => {
    checkId(attemptId, 'attemptId')
    const input = parseSyncPayload(payload)
    if (!input) invalid('payload')
    return toAttemptViewDto(await syncAttempt(await getCtx(), attemptId, input))
  })
}

/**
 * Hands in with every local answer. Leave reports still queued are delivered first (with the
 * answers), so the log is complete and a leaving that already ended the attempt stands.
 */
export async function handInAction(attemptId: string, payload: unknown): Promise<ActionResult<AttemptViewDto>> {
  return toActionResult(async () => {
    checkId(attemptId, 'attemptId')
    const input = parseSyncPayload(payload)
    if (!input) invalid('payload')
    const ctx = await getCtx()
    let acceptedRevs: Record<string, number> = {}
    if (input.exits.length > 0) acceptedRevs = (await syncAttempt(ctx, attemptId, input)).acceptedRevs
    const view = await handIn(ctx, attemptId, { deviceId: input.deviceId, answers: input.answers })
    return toAttemptViewDto({ ...view, acceptedRevs })
  })
}
