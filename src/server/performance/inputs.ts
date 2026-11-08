import { and, eq, inArray, sql } from 'drizzle-orm'
import { now } from '@/server/core/clock'
import type { Db } from '@/server/db'
import { assignment, courseCaSettings, participationEvent, submission } from '@/server/db/schema'
import type { CourseRosterRow } from '@/server/courses/roster'
import { loadStatusMatrixForRoster } from '@/server/attendance/matrix'
import { summarize, type AttendanceStatus } from '@/server/attendance/status'
import type { CaInput } from './compute'
import { DEFAULT_SETTINGS, type CaSettings } from './rules'

/** Everything `computeCa` and the slipping flag need about one student. */
export type StudentCaInputs = {
  input: CaInput
  /** (present + 0.5 × partial) / counted sessions; null when no session counts yet. */
  attendanceRatio: number | null
  /** Sessions with a present, partial or absent status (not "not taken", not not_enrolled). */
  countedSessions: number
  /** Released assignments without a graded hand-in + unreleased ones past due with no hand-in. */
  missingWork: number
}

/** A course's CA settings, or the defaults when the lecturer hasn't saved any. */
export async function getCaSettings(db: Db, courseId: string): Promise<CaSettings> {
  const [row] = await db
    .select({
      total: courseCaSettings.total,
      attendancePoints: courseCaSettings.attendancePoints,
      assignmentPoints: courseCaSettings.assignmentPoints,
      participationPoints: courseCaSettings.participationPoints,
      testPoints: courseCaSettings.testPoints,
      participationTarget: courseCaSettings.participationTarget,
    })
    .from(courseCaSettings)
    .where(eq(courseCaSettings.courseId, courseId))
  return row ?? { ...DEFAULT_SETTINGS }
}

/**
 * Loads the CA inputs of every given roster student at once. The number of queries is fixed per
 * course — settings, the status matrix (a fixed handful), published assignments, their
 * submissions, participation sums — never one per student.
 */
export async function loadCaInputs(
  db: Db,
  courseId: string,
  roster: Pick<CourseRosterRow, 'studentId' | 'source'>[],
): Promise<{ settings: CaSettings; students: Map<string, StudentCaInputs> }> {
  const studentIds = roster.map((r) => r.studentId)
  const at = now()

  const [settings, matrix, assignments, submissions, participation] = await Promise.all([
    getCaSettings(db, courseId),
    loadStatusMatrixForRoster(db, courseId, roster),
    db
      .select({
        id: assignment.id,
        dueAt: assignment.dueAt,
        maxMark: assignment.maxMark,
        weight: assignment.weight,
        gradesReleasedAt: assignment.gradesReleasedAt,
      })
      .from(assignment)
      .where(and(eq(assignment.courseId, courseId), eq(assignment.status, 'published'))),
    studentIds.length === 0
      ? []
      : db
          .select({ assignmentId: submission.assignmentId, studentId: submission.studentId, mark: submission.mark })
          .from(submission)
          .innerJoin(assignment, eq(assignment.id, submission.assignmentId))
          .where(
            and(
              eq(assignment.courseId, courseId),
              eq(assignment.status, 'published'),
              inArray(submission.studentId, studentIds),
            ),
          ),
    // Every student with a tap in the course (on the roster or not): any row means the class has
    // participation.
    db
      .select({
        studentId: participationEvent.studentId,
        net: sql<number>`sum(${participationEvent.delta})`.mapWith(Number),
      })
      .from(participationEvent)
      .where(eq(participationEvent.courseId, courseId))
      .groupBy(participationEvent.studentId),
  ])

  const classHasParticipation = participation.length > 0
  const netOf = new Map(participation.map((p) => [p.studentId, p.net]))
  // assignmentId:studentId → the hand-in's mark (null: handed in, not graded).
  const handIns = new Map(submissions.map((s) => [`${s.assignmentId}:${s.studentId}`, s.mark]))
  const released = assignments.filter((a) => a.gradesReleasedAt !== null)
  const overdue = assignments.filter((a) => a.gradesReleasedAt === null && a.dueAt.getTime() < at.getTime())

  const students = new Map<string, StudentCaInputs>()
  for (const studentId of studentIds) {
    const statuses: (AttendanceStatus | null)[] = []
    for (const row of matrix.values()) statuses.push(row.get(studentId)?.status ?? null)
    const attendance = summarize(statuses)
    const countedSessions = attendance.present + attendance.partial + attendance.absent

    let missingWork = 0
    const assignmentInputs = released.map((a) => {
      const mark = handIns.get(`${a.id}:${studentId}`) ?? null
      if (mark === null) missingWork++
      return { weight: a.weight, mark, maxMark: a.maxMark }
    })
    for (const a of overdue) if (!handIns.has(`${a.id}:${studentId}`)) missingWork++

    students.set(studentId, {
      input: {
        attendance,
        assignments: assignmentInputs,
        participationNet: netOf.get(studentId) ?? 0,
        classHasParticipation,
      },
      attendanceRatio: countedSessions > 0 ? (attendance.present + 0.5 * attendance.partial) / countedSessions : null,
      countedSessions,
      missingWork,
    })
  }
  return { settings, students }
}
