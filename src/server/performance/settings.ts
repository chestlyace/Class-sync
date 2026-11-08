import { eq } from 'drizzle-orm'
import { AppError } from '@/server/core/errors'
import { now } from '@/server/core/clock'
import type { Ctx } from '@/server/core/context'
import type { Db } from '@/server/db'
import { courseCaSettings } from '@/server/db/schema'
import { requireCourseOwner } from '@/server/courses/service'
import { DEFAULT_SETTINGS, validateSettings, type CaSettings } from './rules'

/** The stored CA settings of a course, or the defaults when none were saved yet. */
export async function readCaSettings(db: Db, courseId: string): Promise<CaSettings> {
  const [row] = await db
    .select({
      total: courseCaSettings.total,
      attendancePoints: courseCaSettings.attendancePoints,
      assignmentPoints: courseCaSettings.assignmentPoints,
      participationPoints: courseCaSettings.participationPoints,
      testPoints: courseCaSettings.testPoints,
      participationTarget: courseCaSettings.participationTarget,
    })
    .from(courseCaSettings)
    .where(eq(courseCaSettings.courseId, courseId))
  return row ?? { ...DEFAULT_SETTINGS }
}

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
