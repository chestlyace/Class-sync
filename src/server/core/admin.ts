import type { SessionUser } from './context'

export type Env = Record<string, string | undefined>

/** The emails listed in ADMIN_EMAILS (comma separated), trimmed and lower-cased. */
export function adminEmails(env: Env = process.env): Set<string> {
  return new Set(
    (env.ADMIN_EMAILS ?? '')
      .split(',')
      .map((email) => email.trim().toLowerCase())
      .filter((email) => email.length > 0),
  )
}

/**
 * True for a user whose verified email is on ADMIN_EMAILS. The verified flag is checked
 * directly, so an unverified address stays out even when email verification is switched off.
 */
export function isAdmin(user: Pick<SessionUser, 'email' | 'emailVerified'>, env: Env = process.env): boolean {
  return user.emailVerified && adminEmails(env).has(user.email.trim().toLowerCase())
}
