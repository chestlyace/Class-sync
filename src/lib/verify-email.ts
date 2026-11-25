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
