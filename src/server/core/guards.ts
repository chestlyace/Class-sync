import { config } from './config'
import type { Ctx, Role } from './context'
import { AppError } from './errors'

export function requireVerified(ctx: Ctx): void {
  if (config.requireEmailVerification && !ctx.user.emailVerified) {
    throw new AppError('EMAIL_UNVERIFIED', 'Email address is not verified')
  }
}

export function requireRole(ctx: Ctx, role: Role): void {
  requireVerified(ctx)
  if (ctx.user.role !== role) {
    throw new AppError('FORBIDDEN', `This action requires the ${role} role`)
  }
}
