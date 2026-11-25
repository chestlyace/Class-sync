import { isAdmin, type Env } from './admin'
import { config } from './config'
import type { Ctx, Role, SessionUser } from './context'
import { AppError } from './errors'

/**
 * An account is verified once its email or its WhatsApp number is proven. Only this rule opens
 * the app for creating and joining: `emailVerified` itself keeps meaning "email proven" (admin
 * rights, Google linking and announcement emails read it directly).
 */
export function isAccountVerified(user: Pick<SessionUser, 'emailVerified' | 'phoneNumberVerified'>): boolean {
  return user.emailVerified || user.phoneNumberVerified
}

/** True while the user still has to verify their account before creating or joining anything. */
export function isVerificationPending(user: Pick<SessionUser, 'emailVerified' | 'phoneNumberVerified'>): boolean {
  return config.requireEmailVerification && !isAccountVerified(user)
}

export function requireVerified(ctx: Ctx): void {
  if (isVerificationPending(ctx.user)) {
    throw new AppError('EMAIL_UNVERIFIED', 'Verify your Clasync account first')
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
