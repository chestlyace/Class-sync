import { headers } from 'next/headers'
import { cache } from 'react'
import { now } from '@/server/core/clock'
import type { Ctx, SessionUser } from '@/server/core/context'
import { AppError } from '@/server/core/errors'
import { db } from '@/server/db'
import { resolveSessionUser } from './account-state'
import { auth } from './auth'

/**
 * The signed-in user, looked up once per request (layout, page and i18n share it). A suspended
 * account counts as signed out; see resolveSessionUser.
 */
export const getSessionUser = cache(async function getSessionUser(): Promise<SessionUser | null> {
  const session = await auth.api.getSession({ headers: await headers() })
  return resolveSessionUser(db, (session?.user as Record<string, unknown> | undefined) ?? null, now())
})

/** Request context for Server Actions and pages that require a signed-in user. */
export async function getCtx(): Promise<Ctx> {
  const user = await getSessionUser()
  if (!user) throw new AppError('UNAUTHENTICATED', 'Not signed in')
  return { db, user }
}
