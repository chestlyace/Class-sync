import { AsyncLocalStorage } from 'node:async_hooks'

/**
 * Marks a password reset by WhatsApp code that is made through `auth.api` from our own code. Over HTTP the
 * plugin hands Better Auth's `onPasswordReset` callback the request, whose path says how the reset came;
 * a server-side call has no request, so the service wraps it in this scope instead.
 */
const scope = new AsyncLocalStorage<true>()

export function runAsPhoneReset<T>(fn: () => Promise<T>): Promise<T> {
  return scope.run(true, fn)
}

const PHONE_RESET_PATH = '/phone-number/reset-password'

/** True when the reset in progress is the WhatsApp one (and not the emailed link). */
export function isPhoneReset(request: Request | undefined): boolean {
  if (scope.getStore() === true) return true
  if (!request) return false
  try {
    return new URL(request.url).pathname.endsWith(PHONE_RESET_PATH)
  } catch {
    return false
  }
}
