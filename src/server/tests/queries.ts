import { asc, eq, inArray } from 'drizzle-orm'
import type { Ctx } from '@/server/core/context'
import { AppError } from '@/server/core/errors'
import { requireRole } from '@/server/core/guards'
import { requireCourseOwner, type CourseSummary } from '@/server/courses/service'
import type { Db } from '@/server/db'
import { courseTest, testOption, testQuestion } from '@/server/db/schema'
import { questionMark, type QuestionKind } from './rules'

export type TestRow = typeof courseTest.$inferSelect

export type LoadedOption = { id: string; position: number; text: string; isCorrect: boolean }

/** A question as stored, with its mark resolved against the test's default. */
export type LoadedQuestion = {
  id: string
  position: number
  kind: QuestionKind
  prompt: string
  mark: number
  guide: string | null
  options: LoadedOption[]
}

/** A question as stored: `mark` is null where the test's default applies. */
export type StoredQuestion = Omit<LoadedQuestion, 'mark'> & { mark: number | null }

function forbidden(): never {
  throw new AppError('FORBIDDEN', 'Only the lecturer of this course can do this')
}

export async function loadTestRow(db: Db, testId: string): Promise<TestRow | undefined> {
  if (typeof testId !== 'string' || testId.length === 0) return undefined
  const [row] = await db.select().from(courseTest).where(eq(courseTest.id, testId))
  return row
}

/**
 * Owner-only lookup of a test: a lecturer who owns the test's course. "No such test" and "not
 * yours" are both FORBIDDEN, so test ids cannot be probed.
 */
export async function requireOwnedTest(ctx: Ctx, testId: string): Promise<{ test: TestRow; course: CourseSummary }> {
  requireRole(ctx, 'lecturer')
  const test = await loadTestRow(ctx.db, testId)
  if (!test) forbidden()
  return { test, course: await requireCourseOwner(ctx, test.courseId) }
}

/**
 * The test's questions with their options, both in position order; marks as stored.
 * Owner-only data (correct options, guide); never return to students.
 */
export async function loadStoredQuestions(db: Db, testId: string): Promise<StoredQuestion[]> {
  const questions = await db
    .select({
      id: testQuestion.id,
      position: testQuestion.position,
      kind: testQuestion.kind,
      prompt: testQuestion.prompt,
      mark: testQuestion.mark,
      guide: testQuestion.guide,
    })
    .from(testQuestion)
    .where(eq(testQuestion.testId, testId))
    .orderBy(asc(testQuestion.position), asc(testQuestion.id))
  if (questions.length === 0) return []

  const options = await db
    .select({
      questionId: testOption.questionId,
      id: testOption.id,
      position: testOption.position,
      text: testOption.text,
      isCorrect: testOption.isCorrect,
    })
    .from(testOption)
    .where(
      inArray(
        testOption.questionId,
        questions.map((q) => q.id),
      ),
    )
    .orderBy(asc(testOption.position), asc(testOption.id))
  const byQuestion = new Map<string, LoadedOption[]>(questions.map((q) => [q.id, []]))
  for (const { questionId, ...option } of options) byQuestion.get(questionId)?.push(option)
  return questions.map((q) => ({ ...q, options: byQuestion.get(q.id) ?? [] }))
}

/**
 * The test's questions in position order, each mark resolved against the test's default.
 * Owner-only data (correct options, guide); never return to students.
 */
export async function loadQuestions(db: Db, testId: string): Promise<LoadedQuestion[]> {
  const [test, questions] = await Promise.all([loadTestRow(db, testId), loadStoredQuestions(db, testId)])
  if (!test) return []
  return questions.map((q) => ({ ...q, mark: questionMark(q, test.defaultMark) }))
}
