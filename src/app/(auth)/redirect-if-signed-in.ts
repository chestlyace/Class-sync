import { redirect } from 'next/navigation'
import { getSessionUser } from '@/server/auth/session'

/** Sign-in and sign-up are for visitors: a signed-in user goes straight to the dashboard. */
export async function redirectIfSignedIn(): Promise<void> {
  if (await getSessionUser()) redirect('/dashboard')
}
