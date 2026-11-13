import { eq } from 'drizzle-orm'
import type { Ctx } from '@/server/core/context'
import { requireRole } from '@/server/core/guards'
import { notificationPreference } from '@/server/db/schema'

/** Whether the signed-in user gets a push 15 minutes before each class. No row means yes. */
export async function getClassReminders(ctx: Ctx): Promise<boolean> {
  const [row] = await ctx.db
    .select({ classReminders: notificationPreference.classReminders })
    .from(notificationPreference)
    .where(eq(notificationPreference.userId, ctx.user.id))
  return row?.classReminders ?? true
}

/** Turns the 15-minute class reminder on or off. Students only: lecturers always get theirs. */
export async function setClassReminders(ctx: Ctx, on: boolean): Promise<void> {
  requireRole(ctx, 'student')
  await ctx.db
    .insert(notificationPreference)
    .values({ userId: ctx.user.id, classReminders: on })
    .onConflictDoUpdate({ target: notificationPreference.userId, set: { classReminders: on } })
}
