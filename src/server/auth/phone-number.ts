import { and, eq } from 'drizzle-orm'
import type { Ctx } from '@/server/core/context'
import { AppError } from '@/server/core/errors'
import { user } from '@/server/db/schema'

export type PhoneNumberState = {
  /** The account's number in E.164, or null. */
  phone: string | null
  /** A WhatsApp code (or a JOIN message) proved the number. */
  verified: boolean
  /** The email address itself is proven: the other way to sign in and recover the account. */
  emailVerified: boolean
}

/** The signed-in account's WhatsApp number and what proves it, for the Settings card. */
export async function getPhoneNumberState(ctx: Ctx): Promise<PhoneNumberState> {
  const [row] = await ctx.db
    .select({ phone: user.phoneNumber, verified: user.phoneNumberVerified, emailVerified: user.emailVerified })
    .from(user)
    .where(eq(user.id, ctx.user.id))
  if (!row) throw new AppError('NOT_FOUND', 'Account not found')
  return row
}

/**
 * Takes the WhatsApp number off the account. Refused while the email is not verified: then the number
 * is the only proof the account has, and without it the person could no longer sign in or recover it.
 * The check is part of the update, so it reads the stored state, not the session's copy. Class
 * alerts (`whatsapp_link`) are a separate choice and stay as they are.
 */
export async function removePhoneNumber(ctx: Ctx): Promise<void> {
  const rows = await ctx.db
    .update(user)
    .set({ phoneNumber: null, phoneNumberVerified: false })
    .where(and(eq(user.id, ctx.user.id), eq(user.emailVerified, true)))
    .returning({ id: user.id })
  if (rows.length === 0) {
    throw new AppError('CONFLICT', 'Verify your email before removing your WhatsApp number')
  }
}
