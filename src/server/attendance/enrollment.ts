import { and, eq } from 'drizzle-orm'
import type { Db } from '@/server/db'
import { classStudent, course, courseRosterAdjustment } from '@/server/db/schema'
import { courseRosterQuery, type CourseRosterRow } from '@/server/courses/roster'

/**
 * When each student currently on the course's roster joined it: the class `joined_at` for a
 * student who is there through the course's class, the include adjustment's `created_at` for
 * an included carry-over. A session created before that moment does not count against them.
 */
export async function enrollmentStarts(db: Db, courseId: string): Promise<Map<string, Date>> {
  const roster = await courseRosterQuery(db, { courseId })
  return enrollmentStartsFor(db, courseId, roster)
}

/** As `enrollmentStarts`, for roster rows the caller already loaded. */
export async function enrollmentStartsFor(
  db: Db,
  courseId: string,
  roster: Pick<CourseRosterRow, 'studentId' | 'source'>[],
): Promise<Map<string, Date>> {
  const starts = new Map<string, Date>()
  if (roster.length === 0) return starts

  const [classJoins, includes] = await Promise.all([
    db
      .select({ studentId: classStudent.userId, joinedAt: classStudent.joinedAt })
      .from(classStudent)
      .innerJoin(course, eq(course.classId, classStudent.classId))
      .where(and(eq(course.id, courseId), eq(classStudent.status, 'active'))),
    db
      .select({ studentId: courseRosterAdjustment.studentId, createdAt: courseRosterAdjustment.createdAt })
      .from(courseRosterAdjustment)
      .where(and(eq(courseRosterAdjustment.courseId, courseId), eq(courseRosterAdjustment.kind, 'include'))),
  ])
  const joinedAt = new Map(classJoins.map((r) => [r.studentId, r.joinedAt]))
  const includedAt = new Map(includes.map((r) => [r.studentId, r.createdAt]))

  for (const { studentId, source } of roster) {
    const start = source === 'class' ? joinedAt.get(studentId) : includedAt.get(studentId)
    if (start) starts.set(studentId, start)
  }
  return starts
}
