import { and, desc, eq, gt, isNull } from 'drizzle-orm'
import { AppError } from '@/server/core/errors'
import { now } from '@/server/core/clock'
import type { Ctx } from '@/server/core/context'
import { requireRole } from '@/server/core/guards'
import type { Db } from '@/server/db'
import {
  attendanceCheckIn,
  attendanceOverride,
  attendanceSession,
  attendanceWindow,
  course,
  OVERRIDE_STATUSES,
  WINDOW_KINDS,
} from '@/server/db/schema'
import { courseRosterQuery } from '@/server/courses/roster'
import { isOnCourseRoster, requireCourseOwner, type CourseSummary } from '@/server/courses/service'
import { getSchool } from '@/server/schools/service'
import { isUniqueViolation } from '@/server/lib/db-errors'
import { currentCode, newWindowSecret } from './code'
import { loadStatusMatrixForRoster, type StudentSessionState } from './matrix'
import { WINDOW_MAX_MINUTES } from './rules'
import type { OverrideStatus } from './status'

export type { StudentSessionState } from './matrix'

export type WindowKind = 'start' | 'end'

export type WindowState = { id: string; kind: WindowKind; openedAt: Date; closesAt: Date; open: boolean }

export type SessionSummary = {
  id: string
  courseId: string
  createdAt: Date
  requireOnCampus: boolean
  windows: WindowState[]
}

export type LiveWindow = {
  windowId: string
  sessionId: string
  kind: WindowKind
  open: boolean
  code: string | null
  codeExpiresInSeconds: number | null
  closesAt: Date
  checkedInCount: number
  rosterSize: number
}

const WINDOW_MAX_MS = WINDOW_MAX_MINUTES * 60_000
const WINDOW_KIND_CONSTRAINT = 'attendance_window_session_kind_unique'

type SessionRow = typeof attendanceSession.$inferSelect
type WindowRow = typeof attendanceWindow.$inferSelect

function forbidden(): never {
  throw new AppError('FORBIDDEN', 'Only the lecturer of this course can do this')
}

function invalid(field: string, message: string): never {
  throw new AppError('VALIDATION', message, { fields: [field] })
}

/** A window closes when the lecturer closes it, or by itself 15 minutes after opening. */
function windowState(row: Pick<WindowRow, 'id' | 'kind' | 'openedAt' | 'closedAt'>, at: Date): WindowState {
  const deadline = new Date(row.openedAt.getTime() + WINDOW_MAX_MS)
  return {
    id: row.id,
    kind: row.kind,
    openedAt: row.openedAt,
    closesAt: row.closedAt ?? deadline,
    open: row.closedAt === null && at.getTime() < deadline.getTime(),
  }
}

/**
 * Owner-only lookup of a session. "No such session" and "not yours" are both FORBIDDEN, so
 * session ids cannot be probed.
 */
async function requireOwnedSession(ctx: Ctx, sessionId: string): Promise<{ session: SessionRow; course: CourseSummary }> {
  requireRole(ctx, 'lecturer')
  const [session] = await ctx.db.select().from(attendanceSession).where(eq(attendanceSession.id, sessionId))
  if (!session) forbidden()
  return { session, course: await requireCourseOwner(ctx, session.courseId) }
}

/** Owner-only lookup of a window; nonexistent is FORBIDDEN too. */
async function requireOwnedWindow(ctx: Ctx, windowId: string): Promise<{ window: WindowRow; session: SessionRow }> {
  requireRole(ctx, 'lecturer')
  const [row] = await ctx.db
    .select({ window: attendanceWindow, session: attendanceSession })
    .from(attendanceWindow)
    .innerJoin(attendanceSession, eq(attendanceSession.id, attendanceWindow.sessionId))
    .where(eq(attendanceWindow.id, windowId))
  if (!row) forbidden()
  await requireCourseOwner(ctx, row.session.courseId)
  return row
}

async function sessionWindows(db: Db, sessionId: string, at: Date): Promise<WindowState[]> {
  const rows = await db
    .select()
    .from(attendanceWindow)
    .where(eq(attendanceWindow.sessionId, sessionId))
    .orderBy(desc(attendanceWindow.kind)) // one of each kind at most: 'start' before 'end'
  return rows.map((r) => windowState(r, at))
}

function toSummary(session: SessionRow, windows: WindowState[]): SessionSummary {
  return {
    id: session.id,
    courseId: session.courseId,
    createdAt: session.createdAt,
    requireOnCampus: session.requireOnCampus,
    windows,
  }
}

/** The lecturer's live view of a window. The secret stays here: only the derived code goes out. */
async function liveWindow(db: Db, window: WindowRow, courseId: string, at: Date): Promise<LiveWindow> {
  const state = windowState(window, at)
  const [roster, checkIns] = await Promise.all([
    courseRosterQuery(db, { courseId }),
    db
      .select({ studentId: attendanceCheckIn.studentId })
      .from(attendanceCheckIn)
      .where(eq(attendanceCheckIn.windowId, window.id)),
  ])
  // Only check-ins of students on the roster now count, so the count never exceeds the size.
  const onRoster = new Set(roster.map((r) => r.studentId))
  const code = state.open ? currentCode(window.secret, window.openedAt, at) : null
  return {
    windowId: window.id,
    sessionId: window.sessionId,
    kind: window.kind,
    open: state.open,
    code: code?.code ?? null,
    codeExpiresInSeconds: code?.expiresInSeconds ?? null,
    closesAt: state.closesAt,
    checkedInCount: checkIns.filter((c) => onRoster.has(c.studentId)).length,
    rosterSize: roster.length,
  }
}

export async function createSession(
  ctx: Ctx,
  courseId: string,
  input: { requireOnCampus: boolean },
): Promise<SessionSummary> {
  const owned = await requireCourseOwner(ctx, courseId)
  if (typeof input?.requireOnCampus !== 'boolean') invalid('requireOnCampus', 'Invalid input')
  if (input.requireOnCampus) {
    const sch = await getSchool(ctx, owned.schoolId)
    if (sch.latitude === null || sch.longitude === null) {
      throw new AppError('VALIDATION', 'The school has no campus location', { reason: 'no_campus_location' })
    }
  }
  const [session] = await ctx.db
    .insert(attendanceSession)
    .values({ courseId, requireOnCampus: input.requireOnCampus, createdBy: ctx.user.id, createdAt: now() })
    .returning()
  return toSummary(session, [])
}

export async function getSession(
  ctx: Ctx,
  sessionId: string,
): Promise<{
  session: SessionSummary
  course: CourseSummary
  students: ({ studentId: string; name: string; matricule: string } & StudentSessionState)[]
}> {
  const { session, course: owned } = await requireOwnedSession(ctx, sessionId)
  const at = now()
  const roster = await courseRosterQuery(ctx.db, { courseId: session.courseId })
  const [windows, matrix] = await Promise.all([
    sessionWindows(ctx.db, session.id, at),
    loadStatusMatrixForRoster(ctx.db, session.courseId, roster, { sessionId: session.id }),
  ])
  const states = matrix.get(session.id) ?? new Map<string, StudentSessionState>()
  return {
    session: toSummary(session, windows),
    course: owned,
    students: roster.map(({ studentId, name, matricule }) => ({
      studentId,
      name,
      matricule,
      ...(states.get(studentId) ?? { checkedStart: false, checkedEnd: false, override: null, status: null }),
    })),
  }
}

export async function openWindow(ctx: Ctx, sessionId: string, kind: WindowKind): Promise<LiveWindow> {
  const { session } = await requireOwnedSession(ctx, sessionId)
  if (!(WINDOW_KINDS as readonly string[]).includes(kind)) invalid('kind', 'Invalid window kind')
  const at = now()
  const windowStart = new Date(at.getTime() - WINDOW_MAX_MS)

  let created: WindowRow
  try {
    created = await ctx.db.transaction(async (tx) => {
      // Serialise window opens per course, so two sessions can't both pass the check below.
      await tx.select({ id: course.id }).from(course).where(eq(course.id, session.courseId)).for('update')

      const [sameKind] = await tx
        .select({ id: attendanceWindow.id })
        .from(attendanceWindow)
        .where(and(eq(attendanceWindow.sessionId, session.id), eq(attendanceWindow.kind, kind)))
      if (sameKind) throw new AppError('CONFLICT', 'This window was already opened', { reason: 'already_opened' })

      // Compared against the app clock, not the database's now(), so tests control time.
      const [open] = await tx
        .select({ id: attendanceWindow.id })
        .from(attendanceWindow)
        .innerJoin(attendanceSession, eq(attendanceSession.id, attendanceWindow.sessionId))
        .where(
          and(
            eq(attendanceSession.courseId, session.courseId),
            isNull(attendanceWindow.closedAt),
            gt(attendanceWindow.openedAt, windowStart),
          ),
        )
        .limit(1)
      if (open) {
        throw new AppError('CONFLICT', 'Another window of this course is open', {
          reason: 'another_open',
          windowId: open.id,
        })
      }

      const [row] = await tx
        .insert(attendanceWindow)
        .values({ sessionId: session.id, kind, secret: newWindowSecret(), openedAt: at, openedBy: ctx.user.id })
        .returning()
      return row
    })
  } catch (err) {
    if (isUniqueViolation(err, WINDOW_KIND_CONSTRAINT)) {
      throw new AppError('CONFLICT', 'This window was already opened', { reason: 'already_opened' })
    }
    throw err
  }
  return liveWindow(ctx.db, created, session.courseId, at)
}

/** Idempotent; once a window has closed by itself it keeps its natural close time. */
export async function closeWindow(ctx: Ctx, windowId: string): Promise<void> {
  await requireOwnedWindow(ctx, windowId)
  const at = now()
  await ctx.db
    .update(attendanceWindow)
    .set({ closedAt: at })
    .where(
      and(
        eq(attendanceWindow.id, windowId),
        isNull(attendanceWindow.closedAt),
        gt(attendanceWindow.openedAt, new Date(at.getTime() - WINDOW_MAX_MS)),
      ),
    )
}

export async function getLiveWindow(ctx: Ctx, windowId: string): Promise<LiveWindow> {
  const { window, session } = await requireOwnedWindow(ctx, windowId)
  return liveWindow(ctx.db, window, session.courseId, now())
}

/** Sets (or, with null, clears) the lecturer's verdict for one student in one session. */
export async function setAttendanceOverride(
  ctx: Ctx,
  sessionId: string,
  studentId: string,
  status: OverrideStatus | null,
): Promise<void> {
  const { session } = await requireOwnedSession(ctx, sessionId)
  const match = and(eq(attendanceOverride.sessionId, session.id), eq(attendanceOverride.studentId, studentId))

  if (status === null) {
    // Idempotent, and allowed for a student who has since left the roster.
    await ctx.db.delete(attendanceOverride).where(match)
    return
  }
  if (!(OVERRIDE_STATUSES as readonly string[]).includes(status)) invalid('status', 'Invalid status')
  if (!(await isOnCourseRoster(ctx.db, session.courseId, studentId))) {
    invalid('studentId', 'Student is not on the course roster')
  }

  const at = now()
  await ctx.db
    .insert(attendanceOverride)
    .values({ sessionId: session.id, studentId, status, setBy: ctx.user.id, setAt: at })
    .onConflictDoUpdate({
      target: [attendanceOverride.sessionId, attendanceOverride.studentId],
      set: { status, setBy: ctx.user.id, setAt: at },
    })
}

/** Removes the session with its windows, check-ins and overrides (cascade). */
export async function deleteSession(ctx: Ctx, sessionId: string): Promise<void> {
  const { session } = await requireOwnedSession(ctx, sessionId)
  await ctx.db.delete(attendanceSession).where(eq(attendanceSession.id, session.id))
}
