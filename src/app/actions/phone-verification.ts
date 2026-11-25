'use server'

import { headers } from 'next/headers'
import { verifyWhatsAppCode as verify, type VerifyWhatsAppInput, type VerifyWhatsAppOutcome } from '@/server/auth/phone-verification'

/**
 * Checks the WhatsApp code the signed-in person typed and, when it is right, marks the account verified with
 * that number (and links it for class alerts when `alerts` is true). In a Server Action the nextCookies plugin
 * refreshes the session cookie.
 */
export async function verifyWhatsAppCode(input: VerifyWhatsAppInput): Promise<VerifyWhatsAppOutcome> {
  return verify(input, await headers())
}
