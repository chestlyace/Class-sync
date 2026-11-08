import { and, eq, inArray, sql } from 'drizzle-orm'
import { now } from '@/server/core/clock'
import type { Db } from '@/server/db'
import { assignment, courseCaSettings, participationEvent, submission } from '@/server/db/schema'
import type { CourseRosterRow } from '@/server/courses/roster'
import { enrollmentStartsFor } from '@/server/attendance/enrollment'
import { loadStatusMatrixForRoster } from '@/server/attendance/matrix'
import { summarize, type AttendanceStatus } from '@/server/attendance/status'
import { attendanceRatio, type CaInput } from './compute'
import { DEFAULT_SETTINGS, type CaSettings } from './rules'

/** Everything `computeCa` and the slipping flag need about one student. */
export type StudentCaInputs = {
  input: CaInput
  /** (present + 0.5 × partial) / counted sessions; null when no session counts yet. */
  attendanceRatio: number | null
  /** Sessions with a present, partial or absent status (not "not taken", not not_enrolled). */
  countedSessions: number
  /**
   * Assignments with no hand-in at all: released ones, plus unreleased ones past due. A hand-in
   * still waiting for its mark is pending, not missing; assignments due before the student
   * joined the course don't count against them.
   */
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
 * Loads the CA inputs of every given roster student at once. Pass the course's whole current
 * roster: whether a part has started for the class is worked out from it. The number of queries is fixed per
 * course — settings, the status matrix (a fixed handful), enrolment starts, published
 * assignments, their submissions, participation sums — never one per student.
 *
 * On a released assignment: a graded hand-in counts its mark; a hand-in not graded yet is
 * pending and left out; no hand-in counts 0 and is missing work. An assignment due before the
 * student joined the course (class `joined_at` or include date, as attendance uses) is left out
 * and never missing, unless they handed it in and it was graded: work done counts.
 *
 * A part has started for the class when: attendance — a roster student has a counted session;
 * assignments — a published assignment has its grades released; participation — a roster student
 * has a tap (taps on students who have left the roster don't count).
 */
export async function loadCaInputs(
  db: Db,
  courseId: string,
  roster: Pick<CourseRosterRow, 'studentId' | 'source'>[],
): Promise<{ settings: CaSettings; students: Map<string, StudentCaInputs> }> {
  const studentIds = roster.map((r) => r.studentId)
  const at = now()

  const [settings, matrix, starts, assignments, submissions, participation] = await Promise.all([
    getCaSettings(db, courseId),
    loadStatusMatrixForRoster(db, courseId, roster),
    enrollmentStartsFor(db, courseId, roster),
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
    // Every student with a tap in the course; only those on the roster start participation.
    db
      .select({
        studentId: participationEvent.studentId,
        net: sql<number>`sum(${participationEvent.delta})`.mapWith(Number),
      })
      .from(participationEvent)
      .where(eq(participationEvent.courseId, courseId))
      .groupBy(participationEvent.studentId),
  ])

  const onRoster = new Set(studentIds)
  const netOf = new Map(participation.filter((p) => onRoster.has(p.studentId)).map((p) => [p.studentId, p.net]))
  // assignmentId:studentId → the hand-in's mark (null: handed in, not graded yet).
  const handIns = new Map(submissions.map((s) => [`${s.assignmentId}:${s.studentId}`, s.mark]))
  const released = assignments.filter((a) => a.gradesReleasedAt !== null)
  const overdue = assignments.filter((a) => a.gradesReleasedAt === null && a.dueAt.getTime() < at.getTime())

  const summaries = new Map(
    studentIds.map((studentId) => {
      const statuses: (AttendanceStatus | null)[] = []
      for (const row of matrix.values()) statuses.push(row.get(studentId)?.status ?? null)
      return [studentId, summarize(statuses)] as const
    }),
  )
  const classStarted: CaInput['classStarted'] = {
    attendance: [...summaries.values()].some((a) => a.present + a.partial + a.absent > 0),
    assignments: released.length > 0,
    participation: netOf.size > 0,
  }

  const students = new Map<string, StudentCaInputs>()
  for (const studentId of studentIds) {
    const attendance = summaries.get(studentId)!
    const countedSessions = attendance.present + attendance.partial + attendance.absent

    // No known enrolment date: everything counts (as attendance treats them as enrolled).
    const start = starts.get(studentId)
    const dueWhileEnrolled = (a: { dueAt: Date }) => start === undefined || a.dueAt.getTime() >= start.getTime()

    let missingWork = 0
    const assignmentInputs: CaInput['assignments'] = []
    for (const a of released) {
      const key = `${a.id}:${studentId}`
      const mark = handIns.get(key) ?? null
      if (mark !== null) {
        // Graded: counts, even when due before the student joined.
        assignmentInputs.push({ weight: a.weight, mark, maxMark: a.maxMark })
      } else if (!handIns.has(key) && dueWhileEnrolled(a)) {
        missingWork++
        assignmentInputs.push({ weight: a.weight, mark: null, maxMark: a.maxMark })
      }
      // Otherwise pending (handed in, not graded) or due before they joined: left out.
    }
    for (const a of overdue) if (dueWhileEnrolled(a) && !handIns.has(`${a.id}:${studentId}`)) missingWork++

    students.set(studentId, {
      input: {
        attendance,
        assignments: assignmentInputs,
        participationNet: netOf.get(studentId) ?? 0,
        classStarted,
      },
      attendanceRatio: attendanceRatio(attendance),
      countedSessions,
      missingWork,
    })
  }
  return { settings, students }
}
