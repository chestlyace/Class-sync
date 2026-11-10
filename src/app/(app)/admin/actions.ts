'use server'

import { revalidatePath } from 'next/cache'
import { toActionResult, type ActionResult } from '@/lib/action-result'
import { resendVerification, revokeSessions, suspendUser, unsuspendUser } from '@/server/admin/actions'
import { getCtx } from '@/server/auth/session'
import type { Ctx } from '@/server/core/context'
import { AppError } from '@/server/core/errors'
import { requireAdmin } from '@/server/core/guards'

type AdminService = (ctx: Ctx, targetId: string, reason?: string) => Promise<void>

/**
 * Runs one admin action on a person. The services check the caller is an admin (NOT_FOUND
 * otherwise) and write the audit row; the person page is refreshed afterwards.
 */
async function run(service: AdminService, targetId: unknown, reason: unknown): Promise<ActionResult<null>> {
  return toActionResult(async () => {
    const ctx = await getCtx()
    requireAdmin(ctx) // before looking at the input, so a non-admin learns nothing
    if (typeof targetId !== 'string' || targetId === '' || (reason != null && typeof reason !== 'string')) {
      throw new AppError('VALIDATION', 'Invalid request')
    }
    await service(ctx, targetId, reason ?? undefined)
    revalidatePath(`/admin/people/${targetId}`)
    return null
  })
}

/** Suspends an account and signs it out everywhere. */
export async function suspendAction(targetId: string, reason?: string): Promise<ActionResult<null>> {
  return run(suspendUser, targetId, reason)
}

export async function unsuspendAction(targetId: string, reason?: string): Promise<ActionResult<null>> {
  return run(unsuspendUser, targetId, reason)
}

/** Deletes every web session of the account. */
export async function revokeSessionsAction(targetId: string, reason?: string): Promise<ActionResult<null>> {
  return run(revokeSessions, targetId, reason)
}

/** Sends a fresh verification email to an unverified account. */
export async function resendVerificationAction(targetId: string, reason?: string): Promise<ActionResult<null>> {
  return run((ctx, id, why) => resendVerification(ctx, id, why), targetId, reason)
}
