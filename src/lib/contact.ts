/** Clasync's public address: the landing page, social profiles. */
export const HELLO_EMAIL = 'hello@clasync.online'

/**
 * Where users get help: replies to the app's emails, and the contact line a suspended account sees
 * at sign-in. SUPPORT_EMAIL overrides it per Vercel environment.
 */
export function supportEmail(): string {
  return process.env.SUPPORT_EMAIL || 'support@clasync.online'
}
