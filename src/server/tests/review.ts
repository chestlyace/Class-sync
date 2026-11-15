import { and, eq } from 'drizzle-orm'
import { now } from '@/server/core/clock'
import type { Ctx } from '@/server/core/context'
import { AppError } from '@/server/core/errors'
import { requireRole } from '@/server/core/guards'
import { isOnCourseRoster } from '@/server/courses/roster'
import type { Db } from '@/server/db'
import { course, testAnswer, testAttempt } from '@/server/db/schema'
import { familyHolds } from '@/server/revision/hold'
import { scoreAttempt, type ScoringAnswer } from './paper'
import { testState } from './phase'
import { loadStoredQuestions, loadTestRow, type StoredQuestion, type TestRow } from './queries'
import { questionMark } from './rules'

/**
 * Whether a student may review a test and practise it: `off` (the lecturer's switch), `waiting_results`
 * (not released yet), `waiting_classes` (a copy elsewhere is not released yet), or `open`.
 */
export type ReviewAccess = 'open' | 'off' | 'waiting_results' | 'waiting_classes'

export type ReviewQuestion = {
  id: string
  number: number
  kind: 'mcq' | 'short'
  prompt: string
  outOf: number
  /** null = a real short answer still to be confirmed (pending), never a 0. */
  mark: number | null
  comment: string | null
  /** MCQ only, in the lecturer's order; [] for a short answer. */
  options: { id: string; text: string; isCorrect: boolean; picked: boolean }[]
  /** Short answer only; null when the student left it blank or never opened the test. */
  answerText: string | null
  /** Short answer only: what the lecturer was looking for. */
  guide: string | null
}

export type TestReview = {
  testId: string
  code: string
  title: string
  courseTitle: string
  joined: boolean
  score: number
  outOf: number
  pending: number
  questions: ReviewQuestion[]
}

const noAccess = () => new AppError('FORBIDDEN', 'You do not have access to this test')

function accessOf(test: TestRow, hasShort: boolean, at: Date, held: boolean): ReviewAccess {
  if (!test.studentsCanReview) return 'off'
  if (testState({ ...test, hasShort }, at) !== 'released') return 'waiting_results'
  return held ? 'waiting_classes' : 'open'
}

/** Checked in this order: off, waiting_results, waiting_classes, open. */
export async function reviewAccess(db: Db, test: TestRow, hasShort: boolean, at: Date): Promise<ReviewAccess> {
  const quick = accessOf(test, hasShort, at, false)
  if (quick !== 'open') return quick
  const holds = await familyHolds(db, [test.familyId], at)
  return accessOf(test, hasShort, at, holds.has(test.familyId))
}

/** The access of many tests with one family lookup, keyed by test id. */
export async function reviewAccessForTests(
  db: Db,
  tests: { test: TestRow; hasShort: boolean }[],
  at: Date,
): Promise<Map<string, ReviewAccess>> {
  const candidates = tests.filter(({ test, hasShort }) => accessOf(test, hasShort, at, false) === 'open')
  const holds = await familyHolds(db, [...new Set(candidates.map(({ test }) => test.familyId))], at)
  return new Map(tests.map(({ test, hasShort }) => [test.id, accessOf(test, hasShort, at, holds.has(test.familyId))]))
}

/**
 * The calling student's test with its questions (correct options and guides included, so callers
 * must check the access before returning any of it). Missing and not-rostered are both FORBIDDEN.
 */
export async function loadForStudent(
  ctx: Ctx,
  testId: string,
): Promise<{ test: TestRow; questions: StoredQuestion[]; access: ReviewAccess }> {
  requireRole(ctx, 'student')
  const test = await loadTestRow(ctx.db, testId)
  if (!test || !(await isOnCourseRoster(ctx.db, test.courseId, ctx.user.id))) throw noAccess()
  const questions = await loadStoredQuestions(ctx.db, test.id)
  const access = await reviewAccess(ctx.db, test, questions.some((q) => q.kind === 'short'), now())
  return { test, questions, access }
}

export function requireOpen(access: ReviewAccess): void {
  if (access !== 'open') throw new AppError('CONFLICT', 'This test cannot be reviewed now', { reason: access })
}

/** Whether the calling student may review and practise this test now. Rostered students only (else FORBIDDEN). */
export async function getReviewAccess(ctx: Ctx, testId: string): Promise<ReviewAccess> {
  return (await loadForStudent(ctx, testId)).access
}

/**
 * The calling student's review of a released test: every question with their own answer, the
 * correct answer (the right option, or the guide for a short answer), their mark and the
 * lecturer's comment. CONFLICT { reason } unless review is open. Reads only the caller's attempt;
 * a student who never joined sees every question unanswered.
 */
export async function getTestReview(ctx: Ctx, testId: string): Promise<TestReview> {
  const { test, questions, access } = await loadForStudent(ctx, testId)
  requireOpen(access)

  const [[found], answers, attempts] = await Promise.all([
    ctx.db.select({ title: course.title }).from(course).where(eq(course.id, test.courseId)),
    ctx.db
      .select({
        questionId: testAnswer.questionId,
        optionId: testAnswer.optionId,
        text: testAnswer.text,
        mark: testAnswer.mark,
        comment: testAnswer.comment,
      })
      .from(testAnswer)
      .innerJoin(testAttempt, eq(testAttempt.id, testAnswer.attemptId))
      .where(and(eq(testAttempt.testId, test.id), eq(testAttempt.studentId, ctx.user.id))),
    ctx.db
      .select({ id: testAttempt.id })
      .from(testAttempt)
      .where(and(eq(testAttempt.testId, test.id), eq(testAttempt.studentId, ctx.user.id))),
  ])

  const scoring = questions.map((q) => ({
    id: q.id,
    kind: q.kind,
    mark: questionMark(q, test.defaultMark),
    correctOptionId: q.options.find((o) => o.isCorrect)?.id ?? null,
  }))
  const byQuestion = new Map<string, ScoringAnswer & { comment: string | null }>(answers.map((a) => [a.questionId, a]))
  const score = scoreAttempt(scoring, byQuestion)

  return {
    testId: test.id,
    code: test.code,
    title: test.title,
    courseTitle: found?.title ?? '',
    joined: attempts.length > 0,
    score: score.score,
    outOf: score.outOf,
    pending: score.pendingShort,
    questions: questions.map((q, i) => {
      const answer = byQuestion.get(q.id)
      const text = answer?.text?.trim() ? answer.text : null
      return {
        id: q.id,
        number: i + 1,
        kind: q.kind,
        prompt: q.prompt,
        outOf: scoring[i].mark,
        mark: score.perQuestion[i].mark,
        // Comments go with confirmed marks of real short answers only, as in the released result.
        comment: q.kind === 'short' && text !== null && answer?.mark != null ? (answer.comment ?? null) : null,
        options:
          q.kind === 'mcq'
            ? q.options.map((o) => ({ id: o.id, text: o.text, isCorrect: o.isCorrect, picked: answer?.optionId === o.id }))
            : [],
        answerText: q.kind === 'short' ? text : null,
        guide: q.kind === 'short' ? q.guide : null,
      }
    }),
  }
}
