import type { Ctx } from '@/server/core/context'
import { AppError } from '@/server/core/errors'
import { requireRole } from '@/server/core/guards'
import { courseRosterQuery } from '@/server/courses/roster'
import { getCourse, requireCourseOwner } from '@/server/courses/service'
import { computeCa, isSlipping, rankRows } from './compute'
import { loadCaInputs } from './inputs'
import type { CaSettings } from './rules'

export { getCaSettings } from './inputs'

export type StudentCa = {
  studentId: string
  name: string
  matricule: string
  result: ReturnType<typeof computeCa>
  attendanceRatio: number | null
  countedSessions: number
  missingWork: number
  slipping: boolean
  rank: number
}

/**
 * The lecturer's CA table: every student on the roster now, ranked (highest final first, ties
 * share a rank, then by name). A fixed number of queries whatever the class size.
 */
export async function getCourseCa(ctx: Ctx, courseId: string): Promise<{ settings: CaSettings; rows: StudentCa[] }> {
  await requireCourseOwner(ctx, courseId)
  const roster = await courseRosterQuery(ctx.db, { courseId })
  const { settings, students } = await loadCaInputs(ctx.db, courseId, roster)

  const unranked = roster.map(({ studentId, name, matricule }) => {
    const { input, attendanceRatio, countedSessions, missingWork } = students.get(studentId)!
    const result = computeCa(settings, input)
    const row: Omit<StudentCa, 'rank'> = {
      studentId,
      name,
      matricule,
      result,
      attendanceRatio,
      countedSessions,
      missingWork,
      slipping: isSlipping(result, attendanceRatio, countedSessions),
    }
    return { final: result.final, name, row }
  })
  return { settings, rows: rankRows(unranked).map(({ row, rank }) => ({ ...row, rank })) }
}

/** A rostered student's own CA for the course (no rank, no slipping flag: those are the lecturer's). */
export async function getMyCa(
  ctx: Ctx,
  courseId: string,
): Promise<{ settings: CaSettings; result: ReturnType<typeof computeCa>; missingWork: number }> {
  requireRole(ctx, 'student')
  await getCourse(ctx, courseId) // FORBIDDEN unless I am on the roster now
  const roster = await courseRosterQuery(ctx.db, { courseId, studentId: ctx.user.id })
  // Dropped from the roster since the check above.
  if (roster.length === 0) throw new AppError('FORBIDDEN', 'You do not have access to this course')

  const { settings, students } = await loadCaInputs(ctx.db, courseId, roster)
  const { input, missingWork } = students.get(ctx.user.id)!
  return { settings, result: computeCa(settings, input), missingWork }
}
