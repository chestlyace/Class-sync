import type { Ctx } from '@/server/core/context'
import { requireCourseOwner } from '@/server/courses/service'
import { validateSettings, type CaSettings } from './rules'
import { settingsError, writeCourseCa } from './write'

/** Saves a course's CA settings and named CAs. Owner only. The numbers are checked by `validateSettings`. */
export async function updateCaSettings(ctx: Ctx, courseId: string, input: unknown): Promise<CaSettings> {
  await requireCourseOwner(ctx, courseId)
  const parsed = validateSettings(input)
  if ('error' in parsed) throw settingsError(parsed)
  return writeCourseCa(ctx.db, courseId, parsed, ctx.user.id)
}
