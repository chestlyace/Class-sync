import { eq, inArray, like } from 'drizzle-orm'
import type { Ctx } from '@/server/core/context'
import type { Db } from '@/server/db'
import { classMeeting, course, user } from '@/server/db/schema'
import { createMeetEvent } from './google-meet'
import type { Occurrence } from './occurrences'

/**
 * Auto-generated links are cached by occurrence key: an event is expensive, and students must get the same link every
 * time. The first caller creates it; a race is safe because the Google event id is deterministic.
 */
export async function ensureGeneratedMeetingUrl(ctx: Ctx, occurrence: Occurrence): Promise<string | null> {
  if (!occurrence.autoMeet) return null

  const [cached] = await ctx.db
    .select({ meetingUrl: classMeeting.meetingUrl })
    .from(classMeeting)
    .where(eq(classMeeting.occurrenceKey, occurrence.key))
  if (cached) return cached.meetingUrl

  const [owner] = await ctx.db
    .select({ title: course.title, email: user.email })
    .from(course)
    .innerJoin(user, eq(user.id, course.lecturerId))
    .where(eq(course.id, occurrence.courseId))
  if (!owner) return null

  const generated = await createMeetEvent({
    occurrenceKey: occurrence.key,
    courseTitle: owner.title,
    lecturerEmail: owner.email,
    startsAt: occurrence.startsAt,
    endsAt: occurrence.endsAt,
  })
  await ctx.db
    .insert(classMeeting)
    .values({
      occurrenceKey: occurrence.key,
      meetingUrl: generated.meetingUrl,
      calendarEventId: generated.calendarEventId,
      lecturerEmail: owner.email,
    })
    .onConflictDoNothing()
  const [saved] = await ctx.db
    .select({ meetingUrl: classMeeting.meetingUrl })
    .from(classMeeting)
    .where(eq(classMeeting.occurrenceKey, occurrence.key))
  return saved?.meetingUrl ?? generated.meetingUrl
}

/** A pasted link wins; a generated one is created only when this occurrence asks for it. */
export async function resolveMeetingUrl(
  ctx: Ctx,
  occurrence: Occurrence,
  pastedUrl: string | null,
): Promise<string | null> {
  if (pastedUrl !== null) return pastedUrl
  return ensureGeneratedMeetingUrl(ctx, occurrence)
}

/** All cached links of a slot, for invalidation when its dates, time or mode change. */
export async function cachedMeetingKeysForSlot(db: Db, slotId: string): Promise<string[]> {
  const rows = await db
    .select({ key: classMeeting.occurrenceKey })
    .from(classMeeting)
    .where(like(classMeeting.occurrenceKey, `slot:${slotId}:%`))
  return rows.map((r) => r.key)
}

export async function deleteCachedMeetings(db: Db, keys: string[]): Promise<void> {
  if (keys.length === 0) return
  await db.delete(classMeeting).where(inArray(classMeeting.occurrenceKey, keys))
}
