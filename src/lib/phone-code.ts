import { authClient } from '@/lib/auth-client'
import { toE164 } from '@/lib/phone'

/** Seconds a number waits between two codes: the server's per-number wait (src/server/auth/phone-otp.ts). Longer waits are not counted down. */
export const CODE_RESEND_SECONDS = 60

/** A failed request: the message to show, the server's error code (null when it sent none) and the wait it asked for. */
export type CodeRequestFailure = { ok: false; messageKey: string; code: string | null; retryAfter: number | null }
export type CodeRequestResult = { ok: true } | CodeRequestFailure

/** Message keys (root of messages/*.json) for the errors the code routes answer with. */
const REQUEST_ERROR_KEYS: Record<string, string> = {
  INVALID_PHONE_NUMBER: 'auth.whatsapp.errors.invalidNumber',
  NUMBER_TAKEN: 'auth.whatsapp.errors.NUMBER_TAKEN',
  NUMBER_NOT_ALLOWED: 'auth.whatsapp.errors.numberNotAllowed',
  WHATSAPP_CODES_OFF: 'auth.whatsapp.errors.unavailable',
  UNAUTHORIZED: 'auth.whatsapp.errors.UNAUTHORIZED',
}

/** The message key for a failed `sendOtp`, and how long to wait before the next one when the server said. */
export function codeRequestError(error: { code?: string; status?: number; retryAfter?: unknown }): CodeRequestFailure {
  const retryAfter = typeof error.retryAfter === 'number' && error.retryAfter > 0 ? Math.ceil(error.retryAfter) : null
  const code = error.code ?? null
  if (error.code === 'PHONE_CODE_LIMITED') {
    // A short wait is the 60-second gap after the last code; anything longer is a daily limit.
    const short = retryAfter !== null && retryAfter <= CODE_RESEND_SECONDS
    return { ok: false, messageKey: short ? 'auth.whatsapp.errors.codeWait' : 'auth.whatsapp.errors.codeLimited', code, retryAfter }
  }
  if (error.status === 429) return { ok: false, messageKey: 'auth.errors.tooManyAttempts', code, retryAfter }
  if (error.status === 401) return { ok: false, messageKey: 'auth.whatsapp.errors.UNAUTHORIZED', code, retryAfter: null }
  const key = (error.code && REQUEST_ERROR_KEYS[error.code]) || 'common.genericError'
  return { ok: false, messageKey: key, code, retryAfter: null }
}

/** Asks the server to send a WhatsApp code to `raw` (what the person typed) for the signed-in account. */
export async function requestPhoneCode(raw: string): Promise<{ ok: true; phone: string } | CodeRequestFailure> {
  const phone = toE164(raw)
  if (!phone) return { ok: false, messageKey: 'auth.whatsapp.errors.invalidNumber', code: 'INVALID_PHONE_NUMBER', retryAfter: null }
  try {
    const { error } = await authClient.phoneNumber.sendOtp({ phoneNumber: phone })
    if (error) return codeRequestError(error as { code?: string; status?: number; retryAfter?: unknown })
    return { ok: true, phone }
  } catch {
    return { ok: false, messageKey: 'common.genericError', code: null, retryAfter: null }
  }
}

/** The `/verify-whatsapp` address for a number whose code was just sent; without a number, the page asks for one. */
export function verifyWhatsAppHref(
  phone: string | null,
  options: { alerts?: boolean; next?: string | null; error?: string | null } = {},
): string {
  const query = new URLSearchParams()
  if (phone) query.set('phone', phone)
  if (options.alerts) query.set('alerts', '1')
  if (options.next) query.set('next', options.next)
  if (options.error) query.set('error', options.error)
  const text = query.toString()
  return text ? `/verify-whatsapp?${text}` : '/verify-whatsapp'
}
