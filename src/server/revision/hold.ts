import { asc, count, eq, inArray } from 'drizzle-orm'
import type { Db } from '@/server/db'
import { class_, courseTest, course, school, testQuestion } from '@/server/db/schema'
import { testState } from '@/server/tests/phase'

export type HoldInfo = { testTitle: string; schoolName: string; className: string }

/**
 * Which test families are still held: a family is held while any test with its `family_id` is not
 * yet released (not started, running, or ended without released results). The value names the first
 * such test by creation time with its school and class. A family absent from the map is fully released.
 */
export async function familyHolds(db: Db, familyIds: string[], at: Date): Promise<Map<string, HoldInfo>> {
  const holds = new Map<string, HoldInfo>()
  if (familyIds.length === 0) return holds
  const rows = await db
    .select({
      id: courseTest.id,
      familyId: courseTest.familyId,
      title: courseTest.title,
      startedAt: courseTest.startedAt,
      deadlineAt: courseTest.deadlineAt,
      endedAt: courseTest.endedAt,
      resultsReleasedAt: courseTest.resultsReleasedAt,
      className: class_.name,
      schoolName: school.name,
    })
    .from(courseTest)
    .innerJoin(course, eq(course.id, courseTest.courseId))
    .innerJoin(class_, eq(class_.id, course.classId))
    .innerJoin(school, eq(school.id, class_.schoolId))
    .where(inArray(courseTest.familyId, familyIds))
    .orderBy(asc(courseTest.createdAt), asc(courseTest.id))
  if (rows.length === 0) return holds
  const shortCounts = await db
    .select({ testId: testQuestion.testId, n: count() })
    .from(testQuestion)
    .where(
      inArray(
        testQuestion.testId,
        rows.map((r) => r.id),
      ),
    )
    .groupBy(testQuestion.testId, testQuestion.kind)
    .having(eq(testQuestion.kind, 'short'))
  const hasShort = new Set(shortCounts.filter((r) => r.n > 0).map((r) => r.testId))
  for (const r of rows) {
    if (holds.has(r.familyId)) continue
    const state = testState({ ...r, hasShort: hasShort.has(r.id) }, at)
    if (state !== 'released') holds.set(r.familyId, { testTitle: r.title, schoolName: r.schoolName, className: r.className })
  }
  return holds
}
