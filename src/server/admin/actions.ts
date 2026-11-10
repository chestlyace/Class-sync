import { eq } from 'drizzle-orm'
import { isAdmin } from '@/server/core/admin'
import type { Ctx } from '@/server/core/context'
import { AppError } from '@/server/core/errors'
import { requireAdmin } from '@/server/core/guards'
import type { Db } from '@/server/db'
import { adminAction, session, user } from '@/server/db/schema'

const MAX_REASON_LENGTH = 500

type Tx = Parameters<Parameters<Db['transaction']>[0]>[0]
type AdminActionKind = (typeof adminAction.$inferInsert)['action']

function cleanReason(reason?: string): string | null {
  const trimmed = (reason ?? '').trim().slice(0, MAX_REASON_LENGTH).trim()
  return trimmed === '' ? null : trimmed
}

/** Reads and locks the target row for the rest of the transaction, so concurrent actions queue. */
async function lockTarget(tx: Tx, targetId: string) {
  const [target] = await tx
    .select({ id: user.id, email: user.email, emailVerified: user.emailVerified, suspendedAt: user.suspendedAt })
    .from(user)
    .where(eq(user.id, targetId))
    .for('update')
  if (!target) throw new AppError('NOT_FOUND', 'No such user')
  return target
}

async function audit(tx: Tx, ctx: Ctx, action: AdminActionKind, targetUserId: string, reason: string | null) {
  await tx.insert(adminAction).values({ adminId: ctx.user.id, action, targetUserId, reason })
}

/**
 * Suspends an account and signs it out everywhere. The session rows are deleted in the same
 * transaction because Better Auth's own routes would otherwise still accept the cookie.
 */
export async function suspendUser(ctx: Ctx, targetId: string, reason?: string): Promise<void> {
  requireAdmin(ctx)
  const why = cleanReason(reason)
  await ctx.db.transaction(async (tx) => {
    const target = await lockTarget(tx, targetId)
    if (target.id === ctx.user.id || isAdmin(target)) {
      throw new AppError('FORBIDDEN', 'Admin accounts cannot be suspended')
    }
    if (target.suspendedAt) throw new AppError('CONFLICT', 'Account is already suspended')
    await tx.update(user).set({ suspendedAt: new Date(), suspendedReason: why }).where(eq(user.id, target.id))
    await tx.delete(session).where(eq(session.userId, target.id))
    await audit(tx, ctx, 'suspend', target.id, why)
  })
}

export async function unsuspendUser(ctx: Ctx, targetId: string, reason?: string): Promise<void> {
  requireAdmin(ctx)
  const why = cleanReason(reason)
  await ctx.db.transaction(async (tx) => {
    const target = await lockTarget(tx, targetId)
    if (!target.suspendedAt) throw new AppError('CONFLICT', 'Account is not suspended')
    await tx.update(user).set({ suspendedAt: null, suspendedReason: null }).where(eq(user.id, target.id))
    await audit(tx, ctx, 'unsuspend', target.id, why)
  })
}

/** Signs the account out everywhere. Allowed on any user, the caller included. */
export async function revokeSessions(ctx: Ctx, targetId: string, reason?: string): Promise<void> {
  requireAdmin(ctx)
  const why = cleanReason(reason)
  await ctx.db.transaction(async (tx) => {
    const target = await lockTarget(tx, targetId)
    await tx.delete(session).where(eq(session.userId, target.id))
    await audit(tx, ctx, 'revoke_sessions', target.id, why)
  })
}

async function sendViaAuth(email: string): Promise<void> {
  const { getAuth } = await import('@/server/auth/auth')
  await getAuth().api.sendVerificationEmail({ body: { email } })
}

/** Sends a fresh verification email, after the audit row has committed. */
export async function resendVerification(
  ctx: Ctx,
  targetId: string,
  reason?: string,
  send: (email: string) => Promise<void> = sendViaAuth,
): Promise<void> {
  requireAdmin(ctx)
  const why = cleanReason(reason)
  const email = await ctx.db.transaction(async (tx) => {
    const target = await lockTarget(tx, targetId)
    if (target.emailVerified) throw new AppError('CONFLICT', 'Email is already verified')
    if (target.suspendedAt) throw new AppError('CONFLICT', 'Account is suspended')
    await audit(tx, ctx, 'resend_verification', target.id, why)
    return target.email
  })
  await send(email)
}
