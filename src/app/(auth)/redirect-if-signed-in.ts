import { redirect } from 'next/navigation'
import { safeNextPath } from '@/lib/next-path'
import { getSessionUser } from '@/server/auth/session'

/**
 * Sign-in and sign-up are for visitors: a signed-in user goes to `next` when it is a same-site
 * path (e.g. the test link that sent them to sign in), otherwise to the dashboard.
 */
export async function redirectIfSignedIn(next?: unknown): Promise<void> {
  if (await getSessionUser()) redirect(safeNextPath(next) ?? '/dashboard')
}
