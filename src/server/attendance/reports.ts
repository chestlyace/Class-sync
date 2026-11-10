import { asc, count, desc, eq, inArray } from 'drizzle-orm'
import type { Ctx } from '@/server/core/context'
import { requireRole } from '@/server/core/guards'
import type { Db } from '@/server/db'
import { attendanceSession, attendanceWindow } from '@/server/db/schema'
import { courseRosterQuery } from '@/server/courses/roster'
import { getCourse, requireCourseOwner } from '@/server/courses/service'
import { loadStatusMatrix, loadStatusMatrixForRoster } from './matrix'
import { summarize, type AttendanceStatus } from './status'

export type AttendanceTotals = { present: number; partial: number; absent: number }

export type GridSession = { id: string; createdAt: Date; requireOnCampus: boolean; windowsOpened: number }

export type GridRow = {
  studentId: string
  name: string
  matricule: string | null
  /** sessionId → status (null: nothing to judge yet). */
  statuses: Record<string, AttendanceStatus | null>
  /** sessionId → whether the lecturer set that status by hand. */
  overridden: Record<string, boolean>
  totals: AttendanceTotals
}

export type MyAttendanceEntry = { sessionId: string; createdAt: Date; status: AttendanceStatus | null }

/** The course's sessions, oldest first (ties by id, as the status matrix orders them). */
async function courseSessions(db: Db, courseId: string) {
  return db
    .select({
      id: attendanceSession.id,
      createdAt: attendanceSession.createdAt,
      requireOnCampus: attendanceSession.requireOnCampus,
    })
    .from(attendanceSession)
    .where(eq(attendanceSession.courseId, courseId))
    .orderBy(asc(attendanceSession.createdAt), asc(attendanceSession.id))
}

/**
 * The lecturer's attendance grid: every session (oldest first) by every student on the roster
 * now (roster order). Statuses come from the shared status matrix.
 */
export async function getAttendanceGrid(
  ctx: Ctx,
  courseId: string,
): Promise<{ sessions: GridSession[]; rows: GridRow[] }> {
  await requireCourseOwner(ctx, courseId)
  const { db } = ctx
  const sessions = await courseSessions(db, courseId)
  const roster = await courseRosterQuery(db, { courseId })
  const [matrix, opened] = await Promise.all([
    loadStatusMatrixForRoster(db, courseId, roster),
    sessions.length === 0
      ? []
      : db
          .select({ sessionId: attendanceWindow.sessionId, n: count() })
          .from(attendanceWindow)
          .where(inArray(attendanceWindow.sessionId, sessions.map((s) => s.id)))
          .groupBy(attendanceWindow.sessionId),
  ])
  const windowsBySession = new Map(opened.map((o) => [o.sessionId, o.n]))

  // A session deleted since the list was read is missing from the matrix: leave it out.
  const live = sessions.filter((s) => matrix.has(s.id))
  return {
    sessions: live.map((s) => ({
      id: s.id,
      createdAt: s.createdAt,
      requireOnCampus: s.requireOnCampus,
      windowsOpened: windowsBySession.get(s.id) ?? 0,
    })),
    rows: roster.map(({ studentId, name, matricule }) => {
      const statuses: Record<string, AttendanceStatus | null> = {}
      const overridden: Record<string, boolean> = {}
      for (const s of live) {
        const state = matrix.get(s.id)?.get(studentId)
        statuses[s.id] = state?.status ?? null
        overridden[s.id] = state?.override != null
      }
      return { studentId, name, matricule, statuses, overridden, totals: summarize(Object.values(statuses)) }
    }),
  }
}

/** A rostered student's own attendance for the course, newest session first. */
export async function getMyAttendance(
  ctx: Ctx,
  courseId: string,
): Promise<{ entries: MyAttendanceEntry[]; totals: AttendanceTotals }> {
  requireRole(ctx, 'student')
  await getCourse(ctx, courseId) // FORBIDDEN unless I am on the roster now
  const matrix = await loadStatusMatrix(ctx.db, courseId, { studentId: ctx.user.id })
  const sessions = await ctx.db
    .select({ id: attendanceSession.id, createdAt: attendanceSession.createdAt })
    .from(attendanceSession)
    .where(eq(attendanceSession.courseId, courseId))
    .orderBy(desc(attendanceSession.createdAt), desc(attendanceSession.id))
  const entries = sessions
    .filter((s) => matrix.has(s.id))
    .map((s) => ({ sessionId: s.id, createdAt: s.createdAt, status: matrix.get(s.id)?.get(ctx.user.id)?.status ?? null }))
  return { entries, totals: summarize(entries.map((e) => e.status)) }
}
