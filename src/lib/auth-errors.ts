/** Maps a Better Auth error code to a message key (relative to the root of messages/*.json). */
const AUTH_ERROR_KEYS: Record<string, string> = {
  INVALID_EMAIL_OR_PASSWORD: 'auth.errors.invalidCredentials',
  USER_ALREADY_EXISTS: 'auth.errors.userExists',
  USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL: 'auth.errors.userExists',
  PASSWORD_TOO_SHORT: 'auth.errors.passwordTooShort',
  PASSWORD_TOO_LONG: 'auth.errors.passwordTooLong',
  INVALID_EMAIL: 'auth.errors.invalidEmail',
  EMAIL_NOT_VERIFIED: 'auth.errors.emailNotVerified',
  VALIDATION: 'errors.VALIDATION',
  VALIDATION_ERROR: 'errors.VALIDATION',
}

export function authErrorKey(code: string | undefined | null): string {
  return (code && AUTH_ERROR_KEYS[code]) || 'common.genericError'
}
