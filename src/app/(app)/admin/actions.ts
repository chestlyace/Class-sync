'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { toActionResult, type ActionResult } from '@/lib/action-result'
import { formString } from '@/lib/form-data'
import { resendVerification, revokeSessions, sendPasswordReset, suspendUser, unsuspendUser } from '@/server/admin/actions'
import {
  adminDeleteSchool,
  adminUpdateSchool,
  mergeSchools,
  searchSchoolsForMerge,
  type SchoolSummary,
} from '@/server/admin/schools'
import { getCtx } from '@/server/auth/session'
import type { Ctx } from '@/server/core/context'
import { AppError } from '@/server/core/errors'
import { requireAdmin } from '@/server/core/guards'

type AdminService = (ctx: Ctx, targetId: string, reason?: string) => Promise<void>

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
 * Runs one admin action on a person. Anyone but a signed-in admin gets NOT_FOUND; the services
 * check again and write the audit row; the person page is refreshed afterwards.
 */
async function run(service: AdminService, targetId: unknown, reason: unknown): Promise<ActionResult<null>> {
  return toActionResult(async () => {
    const ctx = await adminCtx() // before looking at the input, so a non-admin learns nothing
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

/**
 * Deletes every web session of the account. On your own account that includes this one, so you
 * go to sign-in instead of back to a person page you can no longer see.
 */
export async function revokeSessionsAction(targetId: string, reason?: string): Promise<ActionResult<null>> {
  let self = false
  const result = await run(
    (ctx, id, why) => {
      self = id === ctx.user.id
      return revokeSessions(ctx, id, why)
    },
    targetId,
    reason,
  )
  // Outside toActionResult's try: redirect() throws Next's control-flow error.
  if (result.ok && self) redirect('/sign-in')
  return result
}

/** Sends a fresh verification email to an unverified account. */
export async function resendVerificationAction(targetId: string, reason?: string): Promise<ActionResult<null>> {
  return run((ctx, id, why) => resendVerification(ctx, id, why), targetId, reason)
}

/** Emails the account a link to choose a new password (the same link as "Forgot password"). */
export async function sendPasswordResetAction(targetId: string, reason?: string): Promise<ActionResult<null>> {
  return run((ctx, id, why) => sendPasswordReset(ctx, id, why), targetId, reason)
}

// ---------------------------------------------------------------------------------------------
// Schools. Form actions (for useActionState); the admin check comes before the input is read.

/** A required id from the form; missing is VALIDATION on that field. */
function formId(data: FormData, key: string): string {
  const value = formString(data, key)
  if (value === '') throw new AppError('VALIDATION', 'Invalid request', { fields: [key] })
  return value
}

/** Renames a school; the list and the school's page are refreshed. */
export async function updateSchoolAdminAction(_prev: ActionResult<null> | null, data: FormData): Promise<ActionResult<null>> {
  return toActionResult(async () => {
    const ctx = await adminCtx()
    const schoolId = formId(data, 'schoolId')
    await adminUpdateSchool(ctx, schoolId, { name: formString(data, 'name'), town: formString(data, 'town') }, formString(data, 'reason'))
    revalidatePath('/admin/schools')
    revalidatePath(`/admin/schools/${schoolId}`)
    return null
  })
}

/** Deletes a school with its classes (the name typed as confirmation), then back to the list. */
export async function deleteSchoolAdminAction(_prev: ActionResult<never> | null, data: FormData): Promise<ActionResult<never>> {
  return toActionResult(async () => {
    const ctx = await adminCtx()
    await adminDeleteSchool(ctx, formId(data, 'schoolId'), formString(data, 'confirm'), formString(data, 'reason'))
    revalidatePath('/admin/schools')
    redirect('/admin/schools')
  })
}

/** Moves the classes of `fromId` to `intoId` and removes `fromId`, then opens the kept school. */
export async function mergeSchoolsAdminAction(_prev: ActionResult<never> | null, data: FormData): Promise<ActionResult<never>> {
  return toActionResult(async () => {
    const ctx = await adminCtx()
    const intoId = formId(data, 'intoId')
    await mergeSchools(ctx, formId(data, 'fromId'), intoId, formString(data, 'reason'))
    revalidatePath('/admin/schools')
    redirect(`/admin/schools/${encodeURIComponent(intoId)}`)
  })
}

/** Schools to merge with, by name or town, leaving out `excludeId`. */
export async function searchSchoolsForMergeAction(query: string, excludeId: string): Promise<ActionResult<SchoolSummary[]>> {
  return toActionResult(async () => {
    const ctx = await adminCtx()
    if (typeof query !== 'string' || typeof excludeId !== 'string') throw new AppError('VALIDATION', 'Invalid request')
    return searchSchoolsForMerge(ctx, query.slice(0, 200), excludeId)
  })
}
