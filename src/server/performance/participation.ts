import { and, desc, eq, gt, sql } from 'drizzle-orm'
import { AppError } from '@/server/core/errors'
import { now } from '@/server/core/clock'
import { config } from '@/server/core/config'
import type { Ctx } from '@/server/core/context'
import type { Db } from '@/server/db'
import { participationEvent } from '@/server/db/schema'
import { courseRosterQuery, isOnCourseRoster } from '@/server/courses/roster'
import { requireCourseOwner } from '@/server/courses/service'
import { parseLocalDateTime, toLocalDateTimeInput } from '@/server/lib/local-time'

/** A tap can be undone for this long. */
const UNDO_WINDOW_MS = 10 * 60_000

/** A student's all-time net in a course: the sum of their deltas, not floored. */
async function netFor(db: Db, courseId: string, studentId: string): Promise<number> {
  const [row] = await db
    .select({ net: sql<number>`coalesce(sum(${participationEvent.delta}), 0)::int` })
    .from(participationEvent)
    .where(and(eq(participationEvent.courseId, courseId), eq(participationEvent.studentId, studentId)))
  return row.net
}

/** The start of today (local midnight) in the app's time zone. */
function startOfToday(at: Date): Date {
  const zone = config.timeZone
  const midnight = parseLocalDateTime(`${toLocalDateTimeInput(at, zone).slice(0, 10)}T00:00`, zone)
  if (!midnight) throw new Error(`Cannot find local midnight in ${zone}`)
  return midnight
}

/** Gives a student one participation point (+1) or takes one away (-1). Returns their new net. */
export async function tapParticipation(
  ctx: Ctx,
  courseId: string,
  studentId: string,
  delta: 1 | -1,
): Promise<{ net: number }> {
  await requireCourseOwner(ctx, courseId)
  if (delta !== 1 && delta !== -1) {
    throw new AppError('VALIDATION', 'A tap is +1 or -1', { fields: ['delta'] })
  }
  if (!(await isOnCourseRoster(ctx.db, courseId, studentId))) {
    throw new AppError('VALIDATION', 'Not a student of this course', { fields: ['studentId'] })
  }
  await ctx.db.insert(participationEvent).values({
    courseId,
    studentId,
    delta,
    createdBy: ctx.user.id,
    createdAt: now(),
  })
  return { net: await netFor(ctx.db, courseId, studentId) }
}

/**
 * Removes the caller's own most recent tap in the course from the last 10 minutes.
 * Null when there is none. The pick and the delete are one statement, and the picked row is
 * locked (skipping rows another undo holds), so two undos at once remove two different taps.
 */
export async function undoLastTap(ctx: Ctx, courseId: string): Promise<{ studentId: string; net: number } | null> {
  await requireCourseOwner(ctx, courseId)
  const since = new Date(now().getTime() - UNDO_WINDOW_MS)
  const latest = ctx.db
    .select({ id: participationEvent.id })
    .from(participationEvent)
    .where(
      and(
        eq(participationEvent.courseId, courseId),
        eq(participationEvent.createdBy, ctx.user.id),
        gt(participationEvent.createdAt, since),
      ),
    )
    .orderBy(desc(participationEvent.createdAt), desc(participationEvent.id))
    .limit(1)
  const removed = await ctx.db.execute<{ student_id: string }>(
    sql`delete from ${participationEvent}
      where ${participationEvent.id} = (${latest} for update skip locked)
      returning ${participationEvent.studentId} as student_id`,
  )
  const row = removed.rows[0]
  if (!row) return null
  return { studentId: row.student_id, net: await netFor(ctx.db, courseId, row.student_id) }
}

/** The current roster with each student's taps today (local day) and all-time net. */
export async function listParticipationToday(
  ctx: Ctx,
  courseId: string,
): Promise<{ studentId: string; name: string; matricule: string; today: number; net: number }[]> {
  await requireCourseOwner(ctx, courseId)
  const roster = await courseRosterQuery(ctx.db, { courseId })
  const start = startOfToday(now())
  const sums = await ctx.db
    .select({
      studentId: participationEvent.studentId,
      net: sql<number>`sum(${participationEvent.delta})::int`,
      today: sql<number>`coalesce(sum(case when ${participationEvent.createdAt} >= ${start} then ${participationEvent.delta} else 0 end), 0)::int`,
    })
    .from(participationEvent)
    .where(eq(participationEvent.courseId, courseId))
    .groupBy(participationEvent.studentId)
  const byStudent = new Map(sums.map((s) => [s.studentId, s]))
  return roster.map((r) => ({
    studentId: r.studentId,
    name: r.name,
    matricule: r.matricule,
    today: byStudent.get(r.studentId)?.today ?? 0,
    net: byStudent.get(r.studentId)?.net ?? 0,
  }))
}
