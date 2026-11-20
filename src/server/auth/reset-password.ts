import { APIError } from 'better-auth/api'
import type { Db } from '@/server/db'
import type { getAuth } from './auth'
import { describeResetLink } from './reset-link'

type AuthInstance = ReturnType<typeof getAuth>

/**
 * `signed-in`: the password changed and this browser now has a session. `reset`: the password
 * changed but signing in did not work (a suspended account, say), so the person goes to sign-in.
 * `error`: nothing changed; `code` is Better Auth's error code for the message.
 */
export type ResetOutcome = { status: 'signed-in' } | { status: 'reset' } | { status: 'error'; code: string; httpStatus?: number }

/**
 * Sets the new password from an emailed link, then signs this browser in with it, so the person
 * lands back where they were going instead of on another form. The reset ends every other
 * session first (revokeSessionsOnPasswordReset); the new one is created after. In a Server Action
 * the nextCookies plugin puts the session cookie on the response.
 */
export async function resetPasswordAndSignIn(
  auth: AuthInstance,
  input: { token: string; newPassword: string; headers: Headers },
  deps: { db?: Db } = {},
): Promise<ResetOutcome> {
  // Read before the reset spends the token: it names the account to sign in to.
  const link = await describeResetLink(input.token, deps)
  if (link.status !== 'valid') return { status: 'error', code: 'INVALID_TOKEN' }
  try {
    await auth.api.resetPassword({ body: { token: input.token, newPassword: input.newPassword }, headers: input.headers })
  } catch (err) {
    if (err instanceof APIError) {
      return { status: 'error', code: String((err.body as { code?: unknown } | undefined)?.code ?? ''), httpStatus: err.statusCode }
    }
    throw err
  }
  try {
    await auth.api.signInEmail({ body: { email: link.email, password: input.newPassword }, headers: input.headers })
    return { status: 'signed-in' }
  } catch (err) {
    if (err instanceof APIError) return { status: 'reset' }
    throw err
  }
}
