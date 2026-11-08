import { and, asc, eq, inArray } from 'drizzle-orm'
import type { Db } from '@/server/db'
import { courseTest, testAnswer, testAttempt, testOption, testQuestion } from '@/server/db/schema'
import { scoreAttempt, type AttemptScore, type ScoringAnswer, type ScoringQuestion } from './paper'

/** Each test's questions as scoring needs them (mark resolved against the default), in position order. */
async function loadScoringQuestions(db: Db, testIds: string[]): Promise<Map<string, ScoringQuestion[]>> {
  const rows = await db
    .select({
      testId: testQuestion.testId,
      id: testQuestion.id,
      kind: testQuestion.kind,
      mark: testQuestion.mark,
      defaultMark: courseTest.defaultMark,
      correctOptionId: testOption.id,
    })
    .from(testQuestion)
    .innerJoin(courseTest, eq(courseTest.id, testQuestion.testId))
    // At most one correct option per question (a partial unique index), so no duplicate rows.
    .leftJoin(testOption, and(eq(testOption.questionId, testQuestion.id), eq(testOption.isCorrect, true)))
    .where(inArray(testQuestion.testId, testIds))
    .orderBy(asc(testQuestion.testId), asc(testQuestion.position), asc(testQuestion.id))

  const byTest = new Map<string, ScoringQuestion[]>(testIds.map((id) => [id, []]))
  for (const r of rows) {
    byTest.get(r.testId)!.push({
      id: r.id,
      kind: r.kind,
      mark: r.mark ?? r.defaultMark,
      correctOptionId: r.correctOptionId,
    })
  }
  return byTest
}

/**
 * Scores of `studentIds` on `testIds`, computed now from the stored answers: testId → studentId →
 * score. A student without an attempt scores like an empty attempt (0, nothing pending). Always
 * two queries (questions with their correct options; answers with their attempts), however many
 * tests and students; none when either list is empty.
 */
export async function loadTestScores(
  db: Db,
  testIds: string[],
  studentIds: string[],
): Promise<Map<string, Map<string, AttemptScore>>> {
  const result = new Map<string, Map<string, AttemptScore>>()
  const tests = [...new Set(testIds)]
  const students = [...new Set(studentIds)]
  if (tests.length === 0) return result
  if (students.length === 0) {
    for (const id of tests) result.set(id, new Map())
    return result
  }

  const [questions, answers] = await Promise.all([
    loadScoringQuestions(db, tests),
    db
      .select({
        testId: testAttempt.testId,
        studentId: testAttempt.studentId,
        questionId: testAnswer.questionId,
        optionId: testAnswer.optionId,
        text: testAnswer.text,
        mark: testAnswer.mark,
      })
      .from(testAnswer)
      .innerJoin(testAttempt, eq(testAttempt.id, testAnswer.attemptId))
      .where(and(inArray(testAttempt.testId, tests), inArray(testAttempt.studentId, students))),
  ])

  // testId → studentId → questionId → answer
  const answersBy = new Map<string, Map<string, Map<string, ScoringAnswer>>>()
  for (const a of answers) {
    let byStudent = answersBy.get(a.testId)
    if (!byStudent) answersBy.set(a.testId, (byStudent = new Map()))
    let byQuestion = byStudent.get(a.studentId)
    if (!byQuestion) byStudent.set(a.studentId, (byQuestion = new Map()))
    byQuestion.set(a.questionId, { optionId: a.optionId, text: a.text, mark: a.mark })
  }

  for (const testId of tests) {
    const qs = questions.get(testId) ?? []
    const scores = new Map<string, AttemptScore>()
    for (const studentId of students) {
      scores.set(studentId, scoreAttempt(qs, answersBy.get(testId)?.get(studentId) ?? new Map()))
    }
    result.set(testId, scores)
  }
  return result
}
