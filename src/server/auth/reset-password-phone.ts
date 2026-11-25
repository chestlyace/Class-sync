import { APIError } from 'better-auth/api'
import { toE164 } from '@/lib/phone'
import type { getAuth } from './auth'
import { runAsPhoneReset } from './phone-reset-scope'
import type { ResetOutcome } from './reset-password'

type AuthInstance = ReturnType<typeof getAuth>

/**
 * The plugin's answers about the code. All of them read as one "wrong or expired code": a number nobody
 * proved never has a code stored, an expired or used-up one is deleted, and telling them apart would let a
 * visitor learn which numbers belong to accounts. The page's "Send again" is the way out of every one of them.
 */
const CODE_ERRORS = new Set(['INVALID_OTP', 'OTP_EXPIRED', 'OTP_NOT_FOUND', 'TOO_MANY_ATTEMPTS'])

const wrongCode = (): ResetOutcome => ({ status: 'error', code: 'INVALID_OTP', httpStatus: 400 })

/**
 * Sets a new password with the 6-digit code sent on WhatsApp, then signs this browser in with it.
 *
 * The plugin spends the code, changes the password and (revokeSessionsOnPasswordReset) ends every session of
 * the account in one transaction; the new session is created after. `onPasswordReset` sees the reset as a
 * WhatsApp one, so the email stays unverified if it was, and a notice goes to a verified email. In a Server
 * Action the nextCookies plugin puts the session cookie on the response.
 */
export async function resetPasswordByWhatsAppAndSignIn(
  auth: AuthInstance,
  input: { phone: string; code: string; newPassword: string; headers: Headers },
): Promise<ResetOutcome> {
  const phone = typeof input.phone === 'string' ? toE164(input.phone) : null
  const code = typeof input.code === 'string' ? input.code.replace(/\s/g, '') : ''
  if (typeof input.newPassword !== 'string') return { status: 'error', code: 'VALIDATION', httpStatus: 400 }
  if (!phone || !/^\d{6}$/.test(code)) return wrongCode()
  try {
    await runAsPhoneReset(() =>
      auth.api.resetPasswordPhoneNumber({ body: { phoneNumber: phone, otp: code, newPassword: input.newPassword }, headers: input.headers }),
    )
  } catch (err) {
    if (!(err instanceof APIError)) throw err
    const errorCode = String((err.body as { code?: unknown } | undefined)?.code ?? '')
    if (CODE_ERRORS.has(errorCode)) return wrongCode()
    return { status: 'error', code: errorCode, httpStatus: err.statusCode }
  }
  try {
    await auth.api.signInPhoneNumber({ body: { phoneNumber: phone, password: input.newPassword }, headers: input.headers })
    return { status: 'signed-in' }
  } catch (err) {
    if (err instanceof APIError) return { status: 'reset' }
    throw err
  }
}
