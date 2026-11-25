import { eq } from 'drizzle-orm'
import { findGuide } from '@/components/guides/guides'
import type { Ctx } from '@/server/core/context'
import { AppError } from '@/server/core/errors'
import { userGuideSeen } from '@/server/db/schema'

/** The guides I have finished or closed, on any device. */
export async function listSeenGuides(ctx: Ctx): Promise<string[]> {
  const rows = await ctx.db
    .select({ guideId: userGuideSeen.guideId })
    .from(userGuideSeen)
    .where(eq(userGuideSeen.userId, ctx.user.id))
  return rows.map((r) => r.guideId)
}

/**
 * Records that I finished or closed a guide of my role, so it never starts by itself again for
 * this account. Seeing it again changes nothing. An unknown guide, or one of the other role's, is
 * VALIDATION.
 */
export async function markGuideSeen(ctx: Ctx, guideId: unknown): Promise<void> {
  const guide = typeof guideId === 'string' ? findGuide(guideId) : undefined
  if (!guide || guide.role !== ctx.user.role) throw new AppError('VALIDATION', 'Unknown guide', { fields: ['guideId'] })
  await ctx.db.insert(userGuideSeen).values({ userId: ctx.user.id, guideId: guide.id }).onConflictDoNothing()
}
