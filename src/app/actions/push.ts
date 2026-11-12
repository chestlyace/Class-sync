'use server'

import { revalidatePath } from 'next/cache'
import { toActionResult, type ActionResult } from '@/lib/action-result'
import { getCtx } from '@/server/auth/session'
import { AppError } from '@/server/core/errors'
import { hitRateLimit } from '@/server/lib/rate-limit'
import { pushPayload } from '@/server/push/payload'
import { sendPush } from '@/server/push/send'
import { isMyDevice, removeDevice, subscribe, unsubscribe } from '@/server/push/subscriptions'

/** Test notifications per user per hour. */
const TEST_PUSH_RULE = { max: 5, windowMs: 3_600_000 }

/** Stores this browser's push subscription (`PushSubscription.toJSON()` plus `userAgent`) for the signed-in user. */
export async function subscribePushAction(input: unknown): Promise<ActionResult<null>> {
  return toActionResult(async () => {
    await subscribe(await getCtx(), input)
    return null
  })
}

/** Forgets this browser's subscription (turned off here, or signing out). */
export async function unsubscribePushAction(endpoint: string): Promise<ActionResult<null>> {
  return toActionResult(async () => {
    await unsubscribe(await getCtx(), endpoint)
    return null
  })
}

/**
 * Whether this browser's subscription (its endpoint) is stored for the signed-in user, so the UI
 * shows "on" only when notifications for this account actually reach this device.
 */
export async function isMyDeviceAction(endpoint: string): Promise<ActionResult<boolean>> {
  return toActionResult(async () => isMyDevice(await getCtx(), endpoint))
}

/** Removes one of the caller's devices from the Settings list. */
export async function removeDeviceAction(id: string): Promise<ActionResult<null>> {
  return toActionResult(async () => {
    await removeDevice(await getCtx(), id)
    revalidatePath('/settings')
    return null
  })
}

/**
 * Sends a test notification to every device of the caller, a few per hour. Over the limit:
 * CONFLICT with `{ reason: 'rate_limited', retryAfter }` (seconds), which the UI shows as such.
 */
export async function sendTestPushAction(): Promise<ActionResult<{ sent: number }>> {
  return toActionResult(async () => {
    const ctx = await getCtx()
    const { limited, retryAfter } = await hitRateLimit(ctx.db, `push-test:${ctx.user.id}`, TEST_PUSH_RULE)
    if (limited) throw new AppError('CONFLICT', 'Too many test notifications', { reason: 'rate_limited', retryAfter })
    const { sent } = await sendPush(
      [{ userId: ctx.user.id, payload: pushPayload('test', ctx.user.locale, { url: '/settings', tag: 'test' }) }],
      ctx.db,
    )
    return { sent }
  })
}
