import { and, eq, gte, inArray, lt, lte } from 'drizzle-orm'
import { config } from '@/server/core/config'
import type { Db } from '@/server/db'
import {
  attendanceSession,
  attendanceWindow,
  classDateStatus,
  classExtra,
  classSlot,
  course,
} from '@/server/db/schema'
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

/**
 * The occurrence behind a key, its pasted URL (if any) and the course's owner. This is only for server-side
 * gating; generation happens after the caller checks who is asking. `Occurrence` never carries a URL into pages.
 */
export async function loadOnlineOccurrence(
  db: Db,
  key: string,
): Promise<{ occurrence: Occurrence; courseId: string; lecturerId: string; meetingUrl: string | null } | null> {
  const parsed = parseOccurrenceKey(key)
  if (!parsed) return null

  let courseId: string
  let meetingUrl: string | null = null
  let date: string
  if (parsed.kind === 'slot') {
    const [slot] = await db
      .select({ courseId: classSlot.courseId, meetingUrl: classSlot.meetingUrl })
      .from(classSlot)
      .where(eq(classSlot.id, parsed.slotId))
    if (!slot) return null
    courseId = slot.courseId
    meetingUrl = slot.meetingUrl
    date = parsed.date
  } else {
    const [extra] = await db
      .select({ courseId: classExtra.courseId, meetingUrl: classExtra.meetingUrl, startsAt: classExtra.startsAt })
      .from(classExtra)
      .where(eq(classExtra.id, parsed.extraId))
    if (!extra) return null
    courseId = extra.courseId
    meetingUrl = extra.meetingUrl
    date = localDateOf(extra.startsAt, config.timeZone)
  }

  const [owned] = await db.select({ lecturerId: course.lecturerId }).from(course).where(eq(course.id, courseId))
  if (!owned) return null
  const occurrence = (await loadOccurrences(db, [courseId], date, date)).find((o) => o.key === key)
  if (!occurrence?.online) return null
  return { occurrence, courseId, lecturerId: owned.lecturerId, meetingUrl }
}

/** Occurrence key → meeting URL, for the course owner's class page only. Includes cached generated links. */
export async function meetingUrlsFor(db: Db, occurrences: Occurrence[]): Promise<Map<string, string>> {
  const urls = new Map<string, string>()
  const slotIds = [...new Set(occurrences.flatMap((o) => (o.source.kind === 'slot' ? [o.source.slotId] : [])))]
  const extraIds = occurrences.flatMap((o) => (o.source.kind === 'extra' ? [o.source.extraId] : []))
  const [slots, extras] = await Promise.all([
    slotIds.length === 0
      ? []
      : db
          .select({ id: classSlot.id, meetingUrl: classSlot.meetingUrl })
          .from(classSlot)
          .where(inArray(classSlot.id, slotIds)),
    extraIds.length === 0
      ? []
      : db
          .select({ id: classExtra.id, meetingUrl: classExtra.meetingUrl })
          .from(classExtra)
          .where(inArray(classExtra.id, extraIds)),
  ])
  const bySlot = new Map(slots.map((s) => [s.id, s.meetingUrl]))
  const byExtra = new Map(extras.map((e) => [e.id, e.meetingUrl]))
  for (const o of occurrences) {
    const url = o.source.kind === 'slot' ? bySlot.get(o.source.slotId) : byExtra.get(o.source.extraId)
    if (url) urls.set(o.key, url)
  }
  return urls
}

/**
 * The sittings a session belongs to. Sessions have no class FK, so a session is matched by its course and the
 * time it (or one of its windows) was opened, with the same lead used when check-in is started from a class.
 */
export async function sittingsForSession(db: Db, sessionId: string): Promise<Sitting[]> {
  const [session] = await db
    .select({ courseId: attendanceSession.courseId, createdAt: attendanceSession.createdAt })
    .from(attendanceSession)
    .where(eq(attendanceSession.id, sessionId))
  if (!session) return []
  const windows = await db
    .select({ openedAt: attendanceWindow.openedAt })
    .from(attendanceWindow)
    .where(eq(attendanceWindow.sessionId, sessionId))
  const events = [session.createdAt, ...windows.map((w) => w.openedAt)].map((d) => d.getTime())
  if (events.length === 0) return []
  const from = localDateOf(new Date(Math.min(...events) - ATTENDANCE_LEAD_MS), config.timeZone)
  const to = localDateOf(new Date(Math.max(...events)), config.timeZone)
  const sittings = buildSittings(await loadOccurrences(db, [session.courseId], from, to))
  return sittings.filter((s) => {
    const start = s.startsAt.getTime() - ATTENDANCE_LEAD_MS
    const end = s.endsAt.getTime()
    return events.some((at) => at >= start && at <= end)
  })
}
