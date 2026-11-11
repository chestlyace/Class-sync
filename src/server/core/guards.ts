import { isAdmin, type Env } from './admin'
import { config } from './config'
import type { Ctx, Role, SessionUser } from './context'
import { AppError } from './errors'

/** True while the user still has to verify their email before creating or joining anything. */
export function isVerificationPending(user: SessionUser): boolean {
  return config.requireEmailVerification && !user.emailVerified
}

export function requireVerified(ctx: Ctx): void {
  if (isVerificationPending(ctx.user)) {
    throw new AppError('EMAIL_UNVERIFIED', 'Email address is not verified')
  }
}

export function requireRole(ctx: Ctx, role: Role): void {
  requireVerified(ctx)
  if (ctx.user.role !== role) {
    throw new AppError('FORBIDDEN', `This action requires the ${role} role`)
  }
}

/** Admins only. Non-admins get NOT_FOUND so the admin area does not reveal that it exists. */
export function requireAdmin(ctx: Ctx, env?: Env): void {
  if (!isAdmin(ctx.user, env)) {
    throw new AppError('NOT_FOUND')
  }
}
