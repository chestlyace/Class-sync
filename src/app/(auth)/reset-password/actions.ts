'use server'

import { headers } from 'next/headers'
import { auth } from '@/server/auth/auth'
import { type ResetOutcome, resetPasswordAndSignIn } from '@/server/auth/reset-password'

/** Sets the new password from the emailed link and signs this browser in with it. */
export async function resetPasswordAction(token: string, newPassword: string): Promise<ResetOutcome> {
  if (typeof token !== 'string' || token.length === 0 || token.length > 200 || typeof newPassword !== 'string') {
    return { status: 'error', code: 'INVALID_TOKEN' }
  }
  return resetPasswordAndSignIn(auth, { token, newPassword, headers: await headers() })
}
