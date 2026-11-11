/** Maps a Better Auth error code to a message key (relative to the root of messages/*.json). */
const AUTH_ERROR_KEYS: Record<string, string> = {
  INVALID_EMAIL_OR_PASSWORD: 'auth.errors.invalidCredentials',
  USER_ALREADY_EXISTS: 'auth.errors.userExists',
  USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL: 'auth.errors.userExists',
  PASSWORD_TOO_SHORT: 'auth.errors.passwordTooShort',
  PASSWORD_TOO_LONG: 'auth.errors.passwordTooLong',
  INVALID_EMAIL: 'auth.errors.invalidEmail',
  EMAIL_NOT_VERIFIED: 'auth.errors.emailNotVerified',
  ACCOUNT_SUSPENDED: 'auth.errors.accountSuspended',
  // Disconnecting Google needs a recent sign-in.
  SESSION_NOT_FRESH: 'auth.errors.signInAgain',
  SESSION_EXPIRED: 'auth.errors.signInAgain',
  VALIDATION: 'errors.VALIDATION',
  VALIDATION_ERROR: 'errors.VALIDATION',
}

/**
 * The message key for a failed Better Auth call. `status` is the HTTP status: a 429 from the rate
 * limiter carries no error code, and whatever the code, "wait and retry" is the useful message.
 */
export function authErrorKey(code: string | undefined | null, status?: number): string {
  if (status === 429) return 'auth.errors.tooManyAttempts'
  return (code && AUTH_ERROR_KEYS[code]) || 'common.genericError'
}

/** `error` codes Better Auth puts in the URL when a Google round trip fails. */
const GOOGLE_ERROR_KEYS: Record<string, string> = {
  // From the sign-in page, a Google account with no Clasync account yet.
  signup_disabled: 'auth.google.noAccount',
  // An account with that email exists but isn't verified, so it isn't joined automatically.
  account_not_linked: 'auth.google.notLinked',
  // Settings: that Google account already signs in to another Clasync account.
  account_already_linked_to_different_user: 'auth.google.linkedElsewhere',
  ACCOUNT_SUSPENDED: 'auth.errors.accountSuspended',
  access_denied: 'auth.google.cancelled',
}

/**
 * The message key for the `error` query parameter a failed Google sign-in, sign-up or link comes
 * back with; null when there is none. Unknown codes get a generic "didn't work" message.
 */
export function googleErrorKey(code: string | string[] | undefined | null): string | null {
  if (typeof code !== 'string' || code === '') return null
  return GOOGLE_ERROR_KEYS[code] ?? 'auth.google.failed'
}
