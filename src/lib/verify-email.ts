/**
 * The check-your-inbox address. `sent: false` adds the fixed flag `sent=0`: the page then says the email
 * could not be sent and offers another try. Only this flag exists (the page maps it to its own text), so
 * the address can never carry a message of its own.
 */
export function verifyEmailHref(email: string, options: { next?: string | null; sent?: boolean } = {}): string {
  const query = new URLSearchParams({ email })
  if (options.next) query.set('next', options.next)
  if (options.sent === false) query.set('sent', '0')
  return `/verify-email?${query}`
}

/** True when the page's `sent` parameter is the failure flag. */
export function emailNotSent(value: unknown): boolean {
  return value === '0'
}

/**
 * True when the user in a sign-in answer is already verified, by email or by WhatsApp: the sign-up page then
 * has nothing to verify (someone signed up again with their own account's email and password). Client-safe.
 */
export function isAlreadyVerified(user: unknown): boolean {
  if (!user || typeof user !== 'object') return false
  const u = user as { emailVerified?: unknown; phoneNumberVerified?: unknown }
  return u.emailVerified === true || u.phoneNumberVerified === true
}
