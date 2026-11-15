import { and, eq, gte, inArray, lt, lte } from 'drizzle-orm'
import { config } from '@/server/core/config'
import type { Db } from '@/server/db'
import { attendanceSession, attendanceWindow, classDateStatus, classExtra, classSlot } from '@/server/db/schema'
import { addDays, instantAt, localDateOf } from '@/server/lib/local-time'
import {
  buildSittings,
  expandOccurrences,
  parseOccurrenceKey,
  type Occurrence,
  type Sitting,
} from './occurrences'

/** Attendance opened this long before a sitting starts still counts for it. */
export const ATTENDANCE_LEAD_MS = 30 * 60_000

/**
 * The classes of the given courses between two local dates (inclusive): weekly slots whose term overlaps the range
 * (with their per-date statuses) and one-off extras starting inside it.
 */
export async function loadOccurrences(db: Db, courseIds: string[], from: string, to: string): Promise<Occurrence[]> {
  if (courseIds.length === 0 || from > to) return []
  const timeZone = config.timeZone

  const [slots, extras] = await Promise.all([
    db
      .select()
      .from(classSlot)
      .where(and(inArray(classSlot.courseId, courseIds), lte(classSlot.startsOn, to), gte(classSlot.endsOn, from))),
    db
      .select()
      .from(classExtra)
      .where(
        and(
          inArray(classExtra.courseId, courseIds),
          gte(classExtra.startsAt, instantAt(from, 0, timeZone)),
          // Exclusive: the start of the day after `to`.
          lt(classExtra.startsAt, instantAt(addDays(to, 1), 0, timeZone)),
        ),
      ),
  ])

  const statuses =
    slots.length === 0
      ? []
      : await db
          .select()
          .from(classDateStatus)
          .where(
            and(
              inArray(
                classDateStatus.slotId,
                slots.map((s) => s.id),
              ),
              gte(classDateStatus.date, from),
              lte(classDateStatus.date, to),
            ),
          )

  return expandOccurrences({ slots, statuses, extras, from, to, timeZone })
}

/**
 * The sitting whose key is `key` (the key of its first class), rebuilt from that course's classes on that day.
 * Null when the key is malformed, its slot or extra is gone, or the sitting no longer starts with that class
 * (cancelled, or merged into an earlier one).
 */
export async function loadSittingByKey(db: Db, key: string): Promise<Sitting | null> {
  const parsed = parseOccurrenceKey(key)
  if (!parsed) return null

  let courseId: string
  let date: string
  if (parsed.kind === 'slot') {
    const [slot] = await db.select().from(classSlot).where(eq(classSlot.id, parsed.slotId))
    if (!slot) return null
    courseId = slot.courseId
    date = parsed.date
  } else {
    const [extra] = await db.select().from(classExtra).where(eq(classExtra.id, parsed.extraId))
    if (!extra) return null
    courseId = extra.courseId
    date = localDateOf(extra.startsAt, config.timeZone)
  }

  const occurrences = await loadOccurrences(db, [courseId], date, date)
  return buildSittings(occurrences).find((s) => s.key === key) ?? null
}

/**
 * Keys of the sittings that already have attendance: a window opened, or a session created, for the sitting's course
 * between ATTENDANCE_LEAD_MS before it starts and its end (both inclusive).
 */
export async function sittingsWithAttendance(db: Db, sittings: Sitting[]): Promise<Set<string>> {
  const found = new Set<string>()
  if (sittings.length === 0) return found

  const courseIds = [...new Set(sittings.map((s) => s.courseId))]
  const spanStart = new Date(Math.min(...sittings.map((s) => s.startsAt.getTime())) - ATTENDANCE_LEAD_MS)
  const spanEnd = new Date(Math.max(...sittings.map((s) => s.endsAt.getTime())))

  const [sessions, windows] = await Promise.all([
    db
      .select({ courseId: attendanceSession.courseId, at: attendanceSession.createdAt })
      .from(attendanceSession)
      .where(
        and(
          inArray(attendanceSession.courseId, courseIds),
          gte(attendanceSession.createdAt, spanStart),
          lte(attendanceSession.createdAt, spanEnd),
        ),
      ),
    db
      .select({ courseId: attendanceSession.courseId, at: attendanceWindow.openedAt })
      .from(attendanceWindow)
      .innerJoin(attendanceSession, eq(attendanceSession.id, attendanceWindow.sessionId))
      .where(
        and(
          inArray(attendanceSession.courseId, courseIds),
          gte(attendanceWindow.openedAt, spanStart),
          lte(attendanceWindow.openedAt, spanEnd),
        ),
      ),
  ])

  const events = [...sessions, ...windows]
  for (const s of sittings) {
    const from = s.startsAt.getTime() - ATTENDANCE_LEAD_MS
    const to = s.endsAt.getTime()
    if (events.some((e) => e.courseId === s.courseId && e.at.getTime() >= from && e.at.getTime() <= to)) {
      found.add(s.key)
    }
  }
  return found
}
