'use server'

import { revalidatePath } from 'next/cache'
import { toActionResult, type ActionResult } from '@/lib/action-result'
import { getCtx } from '@/server/auth/session'
import { createBroadcast, sendTestBroadcast, type BroadcastInput, type BroadcastTestInput } from '@/server/broadcasts/service'
import type { Ctx } from '@/server/core/context'
import { AppError } from '@/server/core/errors'
import { requireAdmin } from '@/server/core/guards'

/** The signed-in caller; signed out is NOT_FOUND like any other non-admin. */
async function adminCtx(): Promise<Ctx> {
  let ctx: Ctx
  try {
    ctx = await getCtx()
  } catch (err) {
    if (err instanceof AppError && err.code === 'UNAUTHENTICATED') throw new AppError('NOT_FOUND', 'Not found')
    throw err
  }
  requireAdmin(ctx)
  return ctx
}

/**
 * Saves the announcement and queues it for sending. The service checks the fields, the
 * confirmation word and the admin again; sending the same `id` twice never sends twice.
 */
export async function createBroadcastAction(
  input: BroadcastInput,
  confirmation: string,
): Promise<ActionResult<{ id: string; recipients: number }>> {
  return toActionResult(async () => {
    const ctx = await adminCtx() // before looking at the input, so a non-admin learns nothing
    const created = await createBroadcast(ctx, input, typeof confirmation === 'string' ? confirmation : '')
    revalidatePath('/admin/broadcasts')
    return created
  })
}

/** Sends both versions of the announcement to the admin's own address. Writes nothing. */
export async function sendTestBroadcastAction(input: BroadcastTestInput): Promise<ActionResult<null>> {
  return toActionResult(async () => {
    const ctx = await adminCtx()
    await sendTestBroadcast(ctx, input)
    return null
  })
}
