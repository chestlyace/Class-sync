import { headers } from 'next/headers'
import { cache } from 'react'
import { isLocale } from '@/i18n/locale'
import type { Ctx, Role, SessionUser } from '@/server/core/context'
import { AppError } from '@/server/core/errors'
import { db } from '@/server/db'
import { auth } from './auth'

/** The signed-in user, looked up once per request (layout, page and i18n share it). */
export const getSessionUser = cache(async function getSessionUser(): Promise<SessionUser | null> {
  const session = await auth.api.getSession({ headers: await headers() })
  if (!session) return null
  const u = session.user as typeof session.user & { role?: unknown; locale?: unknown }
  // The DB CHECK constraint guarantees role; treat anything else as no session.
  if (u.role !== 'lecturer' && u.role !== 'student') return null
  return {
    id: u.id,
    name: u.name,
    email: u.email,
    role: u.role as Role,
    locale: isLocale(u.locale) ? u.locale : 'en',
    emailVerified: u.emailVerified,
  }
})

/** Request context for Server Actions and pages that require a signed-in user. */
export async function getCtx(): Promise<Ctx> {
  const user = await getSessionUser()
  if (!user) throw new AppError('UNAUTHENTICATED', 'Not signed in')
  return { db, user }
}
