import { and, asc, eq, gt, inArray, isNull, lte, sql } from 'drizzle-orm'
import { AppError } from '@/server/core/errors'
import { now } from '@/server/core/clock'
import type { Ctx } from '@/server/core/context'
import { requireRole } from '@/server/core/guards'
import {
  attendanceCheckIn,
  attendanceCodeFailure,
  attendanceSession,
  attendanceWindow,
  class_,
  course,
  school,
} from '@/server/db/schema'
import { isOnCourseRoster, rosteredCourseIds } from '@/server/courses/roster'
import { isCodeAccepted } from './code'
import { checkCampus, type Position } from './geo'
import { MAX_CODE_FAILURES, WINDOW_MAX_MINUTES } from './rules'
import { windowState, type WindowKind } from './sessions'

export type OpenCheckIn = {
  windowId: string
  courseId: string
  courseTitle: string
  kind: WindowKind
  requireOnCampus: boolean
  closesAt: Date
  checkedIn: boolean
}

export type CheckInRefusal =
  | 'closed'
  | 'too_many_attempts'
  | 'wrong_code'
  | 'location_required'
  | 'location_imprecise'
  | 'off_campus'

const WINDOW_MAX_MS = WINDOW_MAX_MINUTES * 60_000

function forbidden(): never {
  throw new AppError('FORBIDDEN', 'You cannot check in to this window')
}

function refuse(reason: CheckInRefusal): never {
  throw new AppError('VALIDATION', 'Check-in refused', { reason })
}

function invalid(field: string): never {
  throw new AppError('VALIDATION', 'Invalid input', { fields: [field] })
}

const isFiniteNumber = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)

/** A position from the browser: null, or finite in-range coordinates with a non-negative accuracy. */
function parsePosition(input: unknown): Position | null {
  if (input === null) return null
  if (typeof input !== 'object') invalid('position')
  const { latitude, longitude, accuracy } = input as Record<string, unknown>
  if (
    !isFiniteNumber(latitude) ||
    !isFiniteNumber(longitude) ||
    !isFiniteNumber(accuracy) ||
    latitude < -90 ||
    latitude > 90 ||
    longitude < -180 ||
    longitude > 180 ||
    accuracy < 0
  ) {
    invalid('position')
  }
  return { latitude, longitude, accuracy }
}

/** Open check-in windows of the courses the student is on the roster of, soonest closing first. */
export async function listOpenCheckIns(ctx: Ctx): Promise<OpenCheckIn[]> {
  requireRole(ctx, 'student')
  const courseIds = await rosteredCourseIds(ctx.db, ctx.user.id)
  if (courseIds.length === 0) return []

  const at = now()
  // Pre-filter with the window-open rule; windowState below is the authority on it.
  const rows = await ctx.db
    .select({
      window: attendanceWindow,
      courseId: course.id,
      courseTitle: course.title,
      requireOnCampus: attendanceSession.requireOnCampus,
      checkedIn: sql<boolean>`exists (
        select 1 from ${attendanceCheckIn}
        where ${attendanceCheckIn.windowId} = ${attendanceWindow.id}
          and ${attendanceCheckIn.studentId} = ${ctx.user.id}
      )`,
    })
    .from(attendanceWindow)
    .innerJoin(attendanceSession, eq(attendanceSession.id, attendanceWindow.sessionId))
    .innerJoin(course, eq(course.id, attendanceSession.courseId))
    .where(
      and(
        inArray(course.id, courseIds),
        isNull(attendanceWindow.closedAt),
        gt(attendanceWindow.openedAt, new Date(at.getTime() - WINDOW_MAX_MS)),
        lte(attendanceWindow.openedAt, at),
      ),
    )
    // Open windows close 15 min after opening, so soonest closing is earliest opened.
    .orderBy(asc(attendanceWindow.openedAt), asc(course.title), asc(attendanceWindow.id))

  return rows.flatMap(({ window, courseId, courseTitle, requireOnCampus, checkedIn }) => {
    const state = windowState(window, at)
    if (!state.open) return []
    return [
      {
        windowId: window.id,
        courseId,
        courseTitle,
        kind: state.kind,
        requireOnCampus,
        closesAt: state.closesAt,
        checkedIn: Boolean(checkedIn),
      },
    ]
  })
}

/**
 * Checks the student in to a window with the code shown in class (and, when the session asks
 * for it, a position on campus). Refusals are VALIDATION with a `reason`; a window that does not
 * exist, or of a course the student is not on, is FORBIDDEN either way.
 */
export async function checkIn(
  ctx: Ctx,
  windowId: string,
  input: { code: string; position: Position | null },
): Promise<{ result: 'checked_in' | 'already_checked_in' }> {
  requireRole(ctx, 'student')
  if (typeof input?.code !== 'string') invalid('code')
  const position = parsePosition(input.position)
  const studentId = ctx.user.id

  const [row] = await ctx.db
    .select({
      window: attendanceWindow,
      courseId: attendanceSession.courseId,
      requireOnCampus: attendanceSession.requireOnCampus,
      campus: { latitude: school.latitude, longitude: school.longitude, radiusM: school.radiusM },
    })
    .from(attendanceWindow)
    .innerJoin(attendanceSession, eq(attendanceSession.id, attendanceWindow.sessionId))
    .innerJoin(course, eq(course.id, attendanceSession.courseId))
    .innerJoin(class_, eq(class_.id, course.classId))
    .innerJoin(school, eq(school.id, class_.schoolId))
    .where(eq(attendanceWindow.id, windowId))
  if (!row || !(await isOnCourseRoster(ctx.db, row.courseId, studentId))) forbidden()
  const { window, requireOnCampus, campus } = row

  const [existing] = await ctx.db
    .select({ studentId: attendanceCheckIn.studentId })
    .from(attendanceCheckIn)
    .where(and(eq(attendanceCheckIn.windowId, window.id), eq(attendanceCheckIn.studentId, studentId)))
  if (existing) return { result: 'already_checked_in' }

  // isCodeAccepted does not look at the window's bounds: it must only run on an open window.
  const at = now()
  if (window.openedAt.getTime() > at.getTime() || !windowState(window, at).open) refuse('closed')

  const [strikes] = await ctx.db
    .select({ failures: attendanceCodeFailure.failures })
    .from(attendanceCodeFailure)
    .where(and(eq(attendanceCodeFailure.windowId, window.id), eq(attendanceCodeFailure.studentId, studentId)))
  if ((strikes?.failures ?? 0) >= MAX_CODE_FAILURES) refuse('too_many_attempts')

  if (!isCodeAccepted(window.secret, window.openedAt, at, input.code)) {
    await ctx.db
      .insert(attendanceCodeFailure)
      .values({ windowId: window.id, studentId, failures: 1 })
      .onConflictDoUpdate({
        target: [attendanceCodeFailure.windowId, attendanceCodeFailure.studentId],
        set: { failures: sql`${attendanceCodeFailure.failures} + 1` },
      })
    refuse('wrong_code')
  }

  // A school that lost its coordinates after the session was created cannot be checked
  // against: createSession refuses requireOnCampus without them, so this is only a later edit.
  if (requireOnCampus && campus.latitude !== null && campus.longitude !== null) {
    const verdict = checkCampus(position, {
      latitude: campus.latitude,
      longitude: campus.longitude,
      radiusM: campus.radiusM,
    })
    if (verdict !== 'ok') refuse(verdict)
  }

  const stored = requireOnCampus && position
  const inserted = await ctx.db
    .insert(attendanceCheckIn)
    .values({
      windowId: window.id,
      studentId,
      checkedInAt: at,
      latitude: stored ? position.latitude : null,
      longitude: stored ? position.longitude : null,
      accuracyM: stored ? position.accuracy : null,
    })
    .onConflictDoNothing()
    .returning({ studentId: attendanceCheckIn.studentId })
  // An empty result means a concurrent request checked the student in first.
  return { result: inserted.length > 0 ? 'checked_in' : 'already_checked_in' }
}
