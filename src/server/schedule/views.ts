import { and, desc, eq, gte, lte } from 'drizzle-orm'
import { now } from '@/server/core/clock'
import { config } from '@/server/core/config'
import type { Ctx } from '@/server/core/context'
import { AppError } from '@/server/core/errors'
import { requireRole } from '@/server/core/guards'
import { attendanceSession, attendanceWindow, classExtra, classSlot } from '@/server/db/schema'
import {
  listLecturerCourses,
  listStudentCourses,
  requireCourseOwner,
  type CourseSummary,
} from '@/server/courses/service'
import { createSession, openWindow } from '@/server/attendance/sessions'
import { addDays, localDateOf } from '@/server/lib/local-time'
import { buildSittings, parseOccurrenceKey, type Occurrence, type Sitting } from './occurrences'
import { ATTENDANCE_LEAD_MS, loadOccurrences, loadSittingByKey, sittingsWithAttendance } from './queries'

export type WeekRow = {
  occurrence: Occurrence
  courseTitle: string
  className: string
  schoolName: string
  badge: 'cancelled' | 'makeUp' | 'missed' | null
  replacesDate: string | null
  canOpenCheckIn: boolean
}

/** A sitting that ended this long ago or less still asks the lecturer whether it was taught. */
const ANSWER_WINDOW_MS = 14 * 24 * 60 * 60_000

function badgeOf(o: Occurrence): WeekRow['badge'] {
  if (o.status === 'cancelled') return 'cancelled'
  if (o.status === 'missed') return 'missed'
  return o.source.kind === 'extra' ? 'makeUp' : null
}

async function weekOf(ctx: Ctx, courses: CourseSummary[], weekStart: string, lecturer: boolean): Promise<WeekRow[]> {
  const occurrences = await loadOccurrences(
    ctx.db,
    courses.map((c) => c.id),
    weekStart,
    addDays(weekStart, 6),
  )
  const byId = new Map(courses.map((c) => [c.id, c]))
  const at = now().getTime()
  return occurrences
    .sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime() || a.key.localeCompare(b.key))
    .map((occurrence) => {
      const course = byId.get(occurrence.courseId)!
      return {
        occurrence,
        courseTitle: course.title,
        className: course.className,
        schoolName: course.schoolName,
        badge: badgeOf(occurrence),
        replacesDate: occurrence.source.kind === 'extra' ? (occurrence.source.replaces?.date ?? null) : null,
        canOpenCheckIn:
          lecturer &&
          occurrence.status !== 'cancelled' &&
          occurrence.status !== 'missed' &&
          at >= occurrence.startsAt.getTime() - ATTENDANCE_LEAD_MS &&
          at <= occurrence.endsAt.getTime(),
      }
    })
}

/** The lecturer's classes across all their schools for the seven days from `weekStart`, cancelled ones included. */
export async function lecturerWeek(ctx: Ctx, weekStart: string): Promise<WeekRow[]> {
  return weekOf(ctx, await listLecturerCourses(ctx), weekStart, true)
}

/** The classes of the courses the student is rostered on. They can never open check-in. */
export async function studentWeek(ctx: Ctx, weekStart: string): Promise<WeekRow[]> {
  return weekOf(ctx, await listStudentCourses(ctx), weekStart, false)
}

/** Sittings of the last 14 days that ended without an answer (taught or missed) and without any attendance. */
export async function needsAnswer(ctx: Ctx): Promise<{ sitting: Sitting; courseTitle: string }[]> {
  const courses = await listLecturerCourses(ctx)
  if (courses.length === 0) return []
  const at = now()
  const since = at.getTime() - ANSWER_WINDOW_MS
  const occurrences = await loadOccurrences(
    ctx.db,
    courses.map((c) => c.id),
    localDateOf(new Date(since), config.timeZone),
    localDateOf(at, config.timeZone),
  )
  const ended = buildSittings(occurrences).filter(
    (s) => s.status === null && s.endsAt.getTime() >= since && s.endsAt.getTime() <= at.getTime(),
  )
  const answered = await sittingsWithAttendance(ctx.db, ended)
  const titles = new Map(courses.map((c) => [c.id, c.title]))
  return ended
    .filter((s) => !answered.has(s.key))
    .sort((a, b) => b.startsAt.getTime() - a.startsAt.getTime())
    .map((sitting) => ({
      sitting,
      courseTitle: titles.get(sitting.courseId)!,
    }))
}

function forbidden(): never {
  throw new AppError('FORBIDDEN', 'Only the lecturer of this course can do this')
}

/** The course a key points at, or null when the key is malformed or its slot or extra is gone. */
async function courseOfKey(ctx: Ctx, key: string): Promise<string | null> {
  const parsed = parseOccurrenceKey(key)
  if (!parsed) return null
  if (parsed.kind === 'slot') {
    const [slot] = await ctx.db
      .select({ courseId: classSlot.courseId })
      .from(classSlot)
      .where(eq(classSlot.id, parsed.slotId))
    return slot?.courseId ?? null
  }
  const [extra] = await ctx.db
    .select({ courseId: classExtra.courseId })
    .from(classExtra)
    .where(eq(classExtra.id, parsed.extraId))
  return extra?.courseId ?? null
}

/** The lecturer's own sitting for this key. Anything missing, foreign or cancelled is FORBIDDEN. */
async function requireOwnedSitting(ctx: Ctx, key: string): Promise<{ sitting: Sitting; course: CourseSummary }> {
  requireRole(ctx, 'lecturer')
  const courseId = await courseOfKey(ctx, key)
  if (!courseId) forbidden()
  const course = await requireCourseOwner(ctx, courseId)
  const sitting = await loadSittingByKey(ctx.db, key)
  if (!sitting) forbidden()
  return { sitting, course }
}

/** The most recent attendance session of the sitting's course created, or with a window opened, in its window. */
async function sittingSessionId(ctx: Ctx, sitting: Sitting): Promise<string | null> {
  const from = new Date(sitting.startsAt.getTime() - ATTENDANCE_LEAD_MS)
  const to = sitting.endsAt
  const [created] = await ctx.db
    .select({ id: attendanceSession.id, at: attendanceSession.createdAt })
    .from(attendanceSession)
    .where(
      and(
        eq(attendanceSession.courseId, sitting.courseId),
        gte(attendanceSession.createdAt, from),
        lte(attendanceSession.createdAt, to),
      ),
    )
    .orderBy(desc(attendanceSession.createdAt))
    .limit(1)
  const [opened] = await ctx.db
    .select({ id: attendanceSession.id, at: attendanceWindow.openedAt })
    .from(attendanceWindow)
    .innerJoin(attendanceSession, eq(attendanceSession.id, attendanceWindow.sessionId))
    .where(
      and(
        eq(attendanceSession.courseId, sitting.courseId),
        gte(attendanceWindow.openedAt, from),
        lte(attendanceWindow.openedAt, to),
      ),
    )
    .orderBy(desc(attendanceWindow.openedAt))
    .limit(1)
  if (created && opened) return created.at.getTime() >= opened.at.getTime() ? created.id : opened.id
  return created?.id ?? opened?.id ?? null
}

/** One of the lecturer's sittings with its course, room and the attendance session already opened for it, if any. */
export async function getClassSitting(
  ctx: Ctx,
  sittingKey: string,
): Promise<{
  sitting: Sitting
  course: CourseSummary
  room: string | null
  sessionId: string | null
}> {
  const { sitting, course } = await requireOwnedSitting(ctx, sittingKey)
  return {
    sitting,
    course,
    room: sitting.occurrences[0].room,
    sessionId: await sittingSessionId(ctx, sitting),
  }
}

/**
 * One tap on a sitting: returns the attendance session already opened for it, or creates one and opens its start
 * window. Only from 30 minutes before the sitting until it ends.
 */
export async function startClassAttendance(
  ctx: Ctx,
  sittingKey: string,
): Promise<{ courseId: string; sessionId: string }> {
  const { sitting } = await requireOwnedSitting(ctx, sittingKey)
  const existing = await sittingSessionId(ctx, sitting)
  if (existing) return { courseId: sitting.courseId, sessionId: existing }

  const at = now().getTime()
  if (at < sitting.startsAt.getTime() - ATTENDANCE_LEAD_MS || at > sitting.endsAt.getTime()) {
    throw new AppError('VALIDATION', 'Check-in can only be opened around class time', { reason: 'outside_class_time' })
  }
  const session = await createSession(ctx, sitting.courseId, {
    requireOnCampus: sitting.occurrences[0].requireOnCampus,
  })
  await openWindow(ctx, session.id, 'start')
  return { courseId: sitting.courseId, sessionId: session.id }
}
