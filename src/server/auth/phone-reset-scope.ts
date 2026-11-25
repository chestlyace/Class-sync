import { AsyncLocalStorage } from 'node:async_hooks'

/**
 * Marks a password reset by WhatsApp code that is made through `auth.api` from our own code. A server-side
 * call has no request, so the service wraps it in this scope; the plugin's route itself is closed over HTTP
 * (`disabledPaths`), and the request check below stays only as a second line.
 */
const scope = new AsyncLocalStorage<true>()

export function runAsPhoneReset<T>(fn: () => Promise<T>): Promise<T> {
  return scope.run(true, fn)
}

const PHONE_RESET_PATH = '/phone-number/reset-password'

/**
 * True when the reset in progress is the WhatsApp one (and not the emailed link). Trailing slashes are ignored.
 * A request whose address cannot be read counts as a WhatsApp reset: an email reset marks the email verified,
 * so it must never be assumed.
 */
export function isPhoneReset(request: Request | undefined): boolean {
  if (scope.getStore() === true) return true
  if (!request) return false
  try {
    return new URL(request.url).pathname.replace(/\/+$/, '').endsWith(PHONE_RESET_PATH)
  } catch {
    return true
  }
}
