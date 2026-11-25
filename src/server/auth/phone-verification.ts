import { eq } from 'drizzle-orm'
import { APIError } from 'better-auth/api'
import { toE164 } from '@/lib/phone'
import { db } from '@/server/db'
import { user, whatsappLink, whatsappPreference } from '@/server/db/schema'
import { whatsAppVerificationEnabled } from '@/server/whatsapp/config'
import { auth } from './auth'
import { codesAvailableToday, resetCodesAvailableToday } from './phone-otp'

export type VerifyWhatsAppInput = { phone: string; code: string; alerts: boolean }
export type VerifyWhatsAppCodeError = 'INVALID_OTP' | 'OTP_EXPIRED' | 'TOO_MANY_ATTEMPTS' | 'NUMBER_TAKEN' | 'UNAUTHORIZED'
export type VerifyWhatsAppOutcome = { status: 'verified' } | { status: 'error'; code: VerifyWhatsAppCodeError }

/** The plugin's error codes, as the few the page tells apart. A code nobody asked for (or one that expired) reads as expired. */
const PLUGIN_CODES: Record<string, VerifyWhatsAppCodeError> = {
  INVALID_OTP: 'INVALID_OTP',
  OTP_EXPIRED: 'OTP_EXPIRED',
  OTP_NOT_FOUND: 'OTP_EXPIRED',
  TOO_MANY_ATTEMPTS: 'TOO_MANY_ATTEMPTS',
  PHONE_NUMBER_EXIST: 'NUMBER_TAKEN',
}

/**
 * Checks the 6-digit code the signed-in person received on WhatsApp. A right code makes the number theirs and
 * the account verified (the plugin's `updatePhoneNumber`); with `alerts`, the number is also linked for class
 * alerts, with every alert type on. The code is only spent once the session is known and the number is free,
 * so a wrong request cannot burn a good code.
 */
export async function verifyWhatsAppCode(input: VerifyWhatsAppInput, headers: Headers): Promise<VerifyWhatsAppOutcome> {
  const session = await auth.api.getSession({ headers })
  if (!session) return { status: 'error', code: 'UNAUTHORIZED' }
  const userId = session.user.id
  const phone = typeof input.phone === 'string' ? toE164(input.phone) : null
  const code = typeof input.code === 'string' ? input.code.replace(/\s/g, '') : ''
  if (!phone || !/^\d{6}$/.test(code)) return { status: 'error', code: 'INVALID_OTP' }

  const [holder] = await db
    .select({ id: user.id, verified: user.phoneNumberVerified })
    .from(user)
    .where(eq(user.phoneNumber, phone))
  // Another account proved this number first. Their code is not touched either.
  if (holder && holder.id !== userId) return { status: 'error', code: 'NUMBER_TAKEN' }

  // The person's own, already proven number needs no second proof.
  if (!(holder && holder.verified)) {
    try {
      await auth.api.verifyPhoneNumber({ body: { phoneNumber: phone, code, updatePhoneNumber: true }, headers })
    } catch (err) {
      if (!(err instanceof APIError)) throw err
      const mapped = PLUGIN_CODES[String((err.body as { code?: unknown } | undefined)?.code ?? '')]
      if (mapped) return { status: 'error', code: mapped }
      if (err.statusCode === 401) return { status: 'error', code: 'UNAUTHORIZED' }
      throw err
    }
  }

  if (input.alerts === true) {
    // Nothing happens when this account or this number is already linked: the existing link stays.
    await db.insert(whatsappLink).values({ userId, phone }).onConflictDoNothing()
    await db.insert(whatsappPreference).values({ userId }).onConflictDoNothing()
  }
  return { status: 'verified' }
}

/**
 * Whether pages should offer verification by WhatsApp now: WhatsApp codes are switched on and today's
 * platform budget of verification codes still has room. Pages pass the answer to their client components as a boolean.
 */
export async function whatsAppCodesOpen(): Promise<boolean> {
  return whatsAppVerificationEnabled() && (await codesAvailableToday(db))
}

/**
 * The same for "Forgot password": WhatsApp codes are switched on and today's budget of password-reset codes,
 * which is kept apart from the verification one, still has room.
 */
export async function whatsAppResetCodesOpen(): Promise<boolean> {
  return whatsAppVerificationEnabled() && (await resetCodesAvailableToday(db))
}
