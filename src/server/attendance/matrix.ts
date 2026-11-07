import { and, asc, eq, inArray, type SQL } from 'drizzle-orm'
import type { Db } from '@/server/db'
import { attendanceCheckIn, attendanceOverride, attendanceSession, attendanceWindow } from '@/server/db/schema'
import { courseRosterQuery, type CourseRosterRow } from '@/server/courses/roster'
import { enrollmentStartsFor } from './enrollment'
import { computeStatus, type AttendanceStatus, type OverrideStatus } from './status'

export type StudentSessionState = {
  checkedStart: boolean
  checkedEnd: boolean
  override: OverrideStatus | null
  status: AttendanceStatus | null
}

/** sessionId → studentId → state. Sessions in creation order, students in roster order. */
export type StatusMatrix = Map<string, Map<string, StudentSessionState>>

/**
 * THE place attendance statuses are assembled: for every session of the course (or the one
 * asked for) and every student currently on its roster (or the one asked for). A student is
 * enrolled for a session when they joined the roster no later than the session was created, or
 * checked in to one of its windows; the status itself is `computeStatus`.
 */
export async function loadStatusMatrix(
  db: Db,
  courseId: string,
  filter: { sessionId?: string; studentId?: string } = {},
): Promise<StatusMatrix> {
  const roster = await courseRosterQuery(db, { courseId, studentId: filter.studentId })
  return loadStatusMatrixForRoster(db, courseId, roster, filter)
}

/** As `loadStatusMatrix`, for roster rows the caller already loaded (they must match `filter`). */
export async function loadStatusMatrixForRoster(
  db: Db,
  courseId: string,
  roster: Pick<CourseRosterRow, 'studentId' | 'source'>[],
  filter: { sessionId?: string; studentId?: string } = {},
): Promise<StatusMatrix> {
  const sessionConditions: SQL[] = [eq(attendanceSession.courseId, courseId)]
  if (filter.sessionId !== undefined) sessionConditions.push(eq(attendanceSession.id, filter.sessionId))
  const sessions = await db
    .select({ id: attendanceSession.id, createdAt: attendanceSession.createdAt })
    .from(attendanceSession)
    .where(and(...sessionConditions))
    .orderBy(asc(attendanceSession.createdAt), asc(attendanceSession.id))

  const matrix: StatusMatrix = new Map()
  if (sessions.length === 0) return matrix
  for (const s of sessions) matrix.set(s.id, new Map())
  if (roster.length === 0) return matrix

  const sessionIds = sessions.map((s) => s.id)
  const studentIds = roster.map((r) => r.studentId)

  const [starts, windows, checkIns, overrides] = await Promise.all([
    enrollmentStartsFor(db, courseId, roster),
    db
      .select({ sessionId: attendanceWindow.sessionId, kind: attendanceWindow.kind })
      .from(attendanceWindow)
      .where(inArray(attendanceWindow.sessionId, sessionIds)),
    db
      .select({
        sessionId: attendanceWindow.sessionId,
        kind: attendanceWindow.kind,
        studentId: attendanceCheckIn.studentId,
      })
      .from(attendanceCheckIn)
      .innerJoin(attendanceWindow, eq(attendanceWindow.id, attendanceCheckIn.windowId))
      .where(and(inArray(attendanceWindow.sessionId, sessionIds), inArray(attendanceCheckIn.studentId, studentIds))),
    db
      .select({
        sessionId: attendanceOverride.sessionId,
        studentId: attendanceOverride.studentId,
        status: attendanceOverride.status,
      })
      .from(attendanceOverride)
      .where(and(inArray(attendanceOverride.sessionId, sessionIds), inArray(attendanceOverride.studentId, studentIds))),
  ])

  const opened = new Set(windows.map((w) => `${w.sessionId}:${w.kind}`))
  const checked = new Set(checkIns.map((c) => `${c.sessionId}:${c.kind}:${c.studentId}`))
  const overridden = new Map(overrides.map((o) => [`${o.sessionId}:${o.studentId}`, o.status]))

  for (const s of sessions) {
    const row = matrix.get(s.id)!
    const startOpened = opened.has(`${s.id}:start`)
    const endOpened = opened.has(`${s.id}:end`)
    for (const { studentId } of roster) {
      const checkedStart = checked.has(`${s.id}:start:${studentId}`)
      const checkedEnd = checked.has(`${s.id}:end:${studentId}`)
      const override = overridden.get(`${s.id}:${studentId}`) ?? null
      const start = starts.get(studentId)
      // No known enrolment date: treat as enrolled rather than hide their attendance. A check-in
      // proves enrolment too: a student who joined after the session was created but checked in
      // to it was there.
      const enrolled =
        start === undefined || start.getTime() <= s.createdAt.getTime() || checkedStart || checkedEnd
      row.set(studentId, {
        checkedStart,
        checkedEnd,
        override,
        status: computeStatus({ startOpened, endOpened, checkedStart, checkedEnd, enrolled, override }),
      })
    }
  }
  return matrix
}
