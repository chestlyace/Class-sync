import { and, eq, gt } from 'drizzle-orm'
import { now } from '@/server/core/clock'
import { db as defaultDb, type Db } from '@/server/db'
import { user, verification } from '@/server/db/schema'

/** What the reset page needs before showing its form: whether the link still works, and for whom. */
export type ResetLink = { status: 'valid'; email: string } | { status: 'invalid' }

/**
 * Checks an emailed reset link when its page opens, so an expired or used link is reported before
 * anyone types a new password. The email is shown on the page and given to password managers, so
 * they save the new password under the right account. Only the holder of the link sees it, and the
 * link already lets them change that account's password.
 */
export async function describeResetLink(token: string | null, deps: { db?: Db } = {}): Promise<ResetLink> {
  if (!token) return { status: 'invalid' }
  const [row] = await (deps.db ?? defaultDb)
    .select({ email: user.email })
    .from(verification)
    .innerJoin(user, eq(user.id, verification.value))
    .where(and(eq(verification.identifier, `reset-password:${token}`), gt(verification.expiresAt, now())))
    .limit(1)
  return row ? { status: 'valid', email: row.email } : { status: 'invalid' }
}
