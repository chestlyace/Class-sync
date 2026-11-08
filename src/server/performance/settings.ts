import { AppError } from '@/server/core/errors'
import { now } from '@/server/core/clock'
import type { Ctx } from '@/server/core/context'
import { courseCaSettings } from '@/server/db/schema'
import { requireCourseOwner } from '@/server/courses/service'
import { validateSettings, type CaSettings } from './rules'

/**
 * Saves a course's CA settings. Owner only. The numbers are checked by `validateSettings`;
 * test points stay 0 until tests exist (phase 3).
 */
export async function updateCaSettings(ctx: Ctx, courseId: string, input: unknown): Promise<CaSettings> {
  await requireCourseOwner(ctx, courseId)
  const parsed = validateSettings(input)
  if ('error' in parsed) {
    throw new AppError('VALIDATION', `Invalid CA settings: ${parsed.error}`, { reason: parsed.error })
  }
  if (parsed.testPoints !== 0) {
    throw new AppError('VALIDATION', 'Test points are not available yet', { reason: 'tests' })
  }
  const values = { ...parsed, updatedBy: ctx.user.id, updatedAt: now() }
  await ctx.db
    .insert(courseCaSettings)
    .values({ courseId, ...values })
    .onConflictDoUpdate({ target: courseCaSettings.courseId, set: values })
  return parsed
}
