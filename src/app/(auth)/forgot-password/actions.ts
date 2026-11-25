'use server'

import { headers } from 'next/headers'
import { auth } from '@/server/auth/auth'
import { type ResetOutcome } from '@/server/auth/reset-password'
import { resetPasswordByWhatsAppAndSignIn } from '@/server/auth/reset-password-phone'

/** Sets the new password from the WhatsApp code and signs this browser in with it. */
export async function resetPasswordByWhatsAppAction(phone: string, code: string, newPassword: string): Promise<ResetOutcome> {
  if (typeof phone !== 'string' || phone.length > 40 || typeof code !== 'string' || code.length > 20 || typeof newPassword !== 'string') {
    return { status: 'error', code: 'INVALID_OTP', httpStatus: 400 }
  }
  return resetPasswordByWhatsAppAndSignIn(auth, { phone, code, newPassword, headers: await headers() })
}
