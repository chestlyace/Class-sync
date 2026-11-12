import { and, asc, eq, isNull } from 'drizzle-orm'
import { createElement } from 'react'
import { localesOf } from '@/server/assignments/queries'
import { now } from '@/server/core/clock'
import type { Ctx } from '@/server/core/context'
import { AppError } from '@/server/core/errors'
import { requireRole } from '@/server/core/guards'
import { courseRosterQuery, isOnCourseRoster } from '@/server/courses/roster'
import { course, courseTest, testAnswer, testAttempt, testOption, testQuestion } from '@/server/db/schema'
import { sendNotifications, type Notification } from '@/server/email/notify'
import { TestResultsReleasedEmail } from '@/server/email/templates/test-results-released'
import { emailSubject } from '@/server/email/templates/verify-email'
import { runAfterResponse } from '@/server/lib/after-response'
import { safePushItems } from '@/server/push/build'
import { pushPayload } from '@/server/push/payload'
import { sendPush } from '@/server/push/send'
import { automatic, requireFinal } from './marking'
import { scoreAttempt, type ScoringAnswer } from './paper'
import { canSeeResult, testPhase } from './phase'
import { requireOwnedTest } from './queries'
import { loadTestScores } from './scores'

/**
 * A student's released result: the total; multiple choice as one total only (`mcq`, null when the
 * test has none), so a per-question mark never tells a student which option was right; and each
 * short-answer question (`number` in the lecturer's order) with its mark and the lecturer's
 * comment. Never the MCQ prompts, the options, the correct answers or the marking guide. `joined`
 * is false for a student who never opened the test (every mark 0). A real short answer without a
 * confirmed mark (possible only when a student is back on the roster after the release) has
 * `mark: null` — pending, never shown as 0 — and is left out of `score`; `pending` counts them.
 */
export type MyTestResult = {
  title: string
  courseTitle: string
  joined: boolean
  score: number
  outOf: number
  pending: number
  mcq: { score: number; outOf: number; count: number } | null
  questions: { number: number; prompt: string; mark: number | null; outOf: number; comment: string | null }[]
}

/** Builds `<BETTER_AUTH_URL>/t/<code>`; relative (with one warning) when the base is not set. */
function testLink(code: string): string {
  const base = (process.env.BETTER_AUTH_URL ?? '').replace(/\/+$/, '')
  if (!base) console.warn('[releaseResults] BETTER_AUTH_URL is not set: notification emails will carry relative links')
  return `${base}/t/${encodeURIComponent(code)}`
}

/**
 * Releases a test's results once every real short answer of a current roster student is confirmed
 * (blank answers and students who never joined score 0 by themselves). Owner only; MCQ-only →
 * CONFLICT automatic; answers not final → CONFLICT not_final; anything unconfirmed → CONFLICT
 * unmarked with the count. The check runs on every call, from the stored answers. The first call
 * stamps `resultsReleasedAt` and, after the response, emails each roster student with an attempt
 * in their language; later calls email nobody. `released` is the number of roster students with
 * an attempt.
 */
export async function releaseResults(ctx: Ctx, testId: string): Promise<{ released: number }> {
  const { test, course: owned } = await requireOwnedTest(ctx, testId)
  const [short] = await ctx.db
    .select({ id: testQuestion.id })
    .from(testQuestion)
    .where(and(eq(testQuestion.testId, test.id), eq(testQuestion.kind, 'short')))
    .limit(1)
  if (!short) automatic()
  const at = now()
  requireFinal(test, at)

  const [roster, attempts] = await Promise.all([
    courseRosterQuery(ctx.db, { courseId: owned.id }),
    ctx.db.select({ studentId: testAttempt.studentId }).from(testAttempt).where(eq(testAttempt.testId, test.id)),
  ])
  const scores = (await loadTestScores(ctx.db, [test.id], roster.map((r) => r.studentId))).get(test.id)!
  let unmarked = 0
  for (const score of scores.values()) unmarked += score.pendingShort
  if (unmarked > 0) {
    throw new AppError('CONFLICT', 'Some answers still need a confirmed mark', { reason: 'unmarked', count: unmarked })
  }

  let firstRelease = false
  if (test.resultsReleasedAt === null) {
    const updated = await ctx.db
      .update(courseTest)
      .set({ resultsReleasedAt: at, updatedAt: at })
      .where(and(eq(courseTest.id, test.id), isNull(courseTest.resultsReleasedAt)))
      .returning({ id: courseTest.id })
    firstRelease = updated.length > 0
  }

  const joined = new Set(attempts.map((a) => a.studentId))
  const recipients = roster.filter((r) => joined.has(r.studentId))
  if (firstRelease && recipients.length > 0) {
    const locales = await localesOf(ctx.db, recipients.map((r) => r.studentId))
    const url = testLink(test.code)
    const items: Notification[] = recipients.map((student) => {
      const locale = locales.get(student.studentId) ?? 'en'
      return {
        to: student.email,
        locale,
        subject: emailSubject('testResultsReleased', locale, { courseTitle: owned.title, testTitle: test.title }),
        kind: 'testResultsReleased',
        react: createElement(TestResultsReleasedEmail, {
          locale,
          studentName: student.name,
          courseTitle: owned.title,
          testTitle: test.title,
          url,
        }),
      }
    })
    // Best effort: neither send throws, and a failure here never undoes the release.
    runAfterResponse(async () => {
      const pushItems = safePushItems('releaseResults', () =>
        recipients.map((student) => ({
          userId: student.studentId,
          payload: pushPayload('testResultsReleased', locales.get(student.studentId) ?? 'en', {
            courseTitle: owned.title,
            testTitle: test.title,
            url: '/t/' + encodeURIComponent(test.code),
          }),
        })),
      )
      await Promise.all([sendNotifications(items), sendPush(pushItems)])
    })
  }
  return { released: recipients.length }
}

/**
 * The calling student's released result for a test with short answers. A rostered student only
 * (anyone else, or an unknown test, is FORBIDDEN); MCQ-only → CONFLICT automatic (the quick
 * result shows the total); not released → CONFLICT not_released. Reads only the caller's own
 * attempt; a student who never joined scores 0 on every question. Five queries.
 */
export async function getMyTestResult(ctx: Ctx, testId: string): Promise<MyTestResult> {
  requireRole(ctx, 'student')
  if (typeof testId !== 'string' || testId.length === 0) {
    throw new AppError('FORBIDDEN', 'You do not have access to this test')
  }
  const [found] = await ctx.db
    .select({ test: courseTest, courseTitle: course.title })
    .from(courseTest)
    .innerJoin(course, eq(course.id, courseTest.courseId))
    .where(eq(courseTest.id, testId))
  if (!found || !(await isOnCourseRoster(ctx.db, found.test.courseId, ctx.user.id))) {
    throw new AppError('FORBIDDEN', 'You do not have access to this test')
  }
  const { test } = found

  const [questions, answers, attempts] = await Promise.all([
    ctx.db
      .select({
        id: testQuestion.id,
        kind: testQuestion.kind,
        prompt: testQuestion.prompt,
        mark: testQuestion.mark,
        correctOptionId: testOption.id,
      })
      .from(testQuestion)
      // At most one correct option per question (a partial unique index), so no duplicate rows.
      .leftJoin(testOption, and(eq(testOption.questionId, testQuestion.id), eq(testOption.isCorrect, true)))
      .where(eq(testQuestion.testId, test.id))
      .orderBy(asc(testQuestion.position), asc(testQuestion.id)),
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
  const hasShort = questions.some((q) => q.kind === 'short')
  if (!hasShort) automatic()
  const phase = testPhase(test, now())
  const released = test.resultsReleasedAt !== null && phase === 'ended'
  // With short answers, only a release shows anything (the attempt's closing does not matter).
  if (!canSeeResult({ hasShort, phase, closedReason: null, released })) {
    throw new AppError('CONFLICT', 'Results have not been released yet', { reason: 'not_released' })
  }

  const scoring = questions.map((q) => ({
    id: q.id,
    kind: q.kind,
    mark: q.mark ?? test.defaultMark,
    correctOptionId: q.correctOptionId,
  }))
  const byQuestion = new Map<string, ScoringAnswer & { comment: string | null }>(answers.map((a) => [a.questionId, a]))
  const score = scoreAttempt(scoring, byQuestion)
  const mcqIndexes = questions.flatMap((q, i) => (q.kind === 'mcq' ? [i] : []))
  return {
    title: test.title,
    courseTitle: found.courseTitle,
    joined: attempts.length > 0,
    score: score.score,
    outOf: score.outOf,
    pending: score.pendingShort,
    mcq:
      mcqIndexes.length === 0
        ? null
        : {
            // Marks are in 0.25 steps, so these sums are exact.
            score: mcqIndexes.reduce((sum, i) => sum + (score.perQuestion[i].mark ?? 0), 0),
            outOf: mcqIndexes.reduce((sum, i) => sum + scoring[i].mark, 0),
            count: mcqIndexes.length,
          },
    questions: questions.flatMap((q, i) => {
      if (q.kind !== 'short') return []
      const answer = byQuestion.get(q.id)
      return [
        {
          number: i + 1,
          prompt: q.prompt,
          // null = a real answer still to be confirmed (pending), never a 0.
          mark: score.perQuestion[i].mark,
          outOf: scoring[i].mark,
          // Comments go with confirmed marks of real answers only.
          comment: answer?.mark !== null && answer?.text?.trim() ? (answer.comment ?? null) : null,
        },
      ]
    }),
  }
}
