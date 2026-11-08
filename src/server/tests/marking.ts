import { and, asc, eq, isNull, sql } from 'drizzle-orm'
import { isValidMark } from '@/server/assignments/rules'
import { now } from '@/server/core/clock'
import type { Ctx } from '@/server/core/context'
import { AppError } from '@/server/core/errors'
import { requireRole } from '@/server/core/guards'
import { courseRosterQuery } from '@/server/courses/roster'
import { requireCourseOwner } from '@/server/courses/service'
import type { Db } from '@/server/db'
import { courseTest, testAnswer, testAttempt, testQuestion } from '@/server/db/schema'
import { getMarkSuggester, type MarkSuggester, type Suggestion } from './ai/suggester'
import { answersFinalAt } from './phase'
import { requireOwnedTest, type TestRow } from './queries'
import { COMMENT_MAX, questionMark, type QuestionKind } from './rules'
import { loadTestScores } from './scores'

export type MarkingAnswer = {
  attemptId: string
  studentId: string
  name: string
  matricule: string
  text: string
  suggestion: { mark: number; reason: string } | null
  mark: number | null
  comment: string | null
}

/**
 * One short-answer question being marked. `number` is its place among all the test's questions
 * and `shortIndex` its place among the short-answer ones (both from 1). `answers` are the non-blank
 * answers of current roster students, ordered by attempt id (stable, not alphabetical, so hidden
 * names cannot be guessed); `confirmed` counts those with a mark; `blank` counts roster students
 * who joined but left this question blank or unanswered (they get 0 with no click).
 */
export type MarkingQuestion = {
  testId: string
  questionId: string
  number: number
  shortIndex: number
  shortCount: number
  prevId: string | null
  nextId: string | null
  prompt: string
  guide: string
  maxMark: number
  answers: MarkingAnswer[]
  confirmed: number
  blank: number
  aiAvailable: boolean
}

/** Answers sent to the AI per call. */
export const SUGGEST_BATCH = 20

type QuestionRow = { id: string; position: number; kind: QuestionKind; prompt: string; mark: number | null; guide: string | null }

function forbidden(): never {
  throw new AppError('FORBIDDEN', 'Only the lecturer of this course can do this')
}

function isId(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0
}

function isBlank(text: string | null | undefined): boolean {
  return !text?.trim()
}

/** MCQ-only tests are marked automatically: nothing to mark or release by hand. */
export function automatic(): never {
  throw new AppError('CONFLICT', 'This test has no short answers to mark', { reason: 'automatic' })
}

/**
 * Marking needs final answers: from the test's end plus the 2-minute grace, when no late answer
 * can replace (and so unmark) a confirmed one. Before that, CONFLICT not_final with when it opens
 * (`finalAt: null` while the test has not started).
 */
export function requireFinal(test: TestRow, at: Date): void {
  const finalAt = answersFinalAt(test)
  if (finalAt === null || at.getTime() < finalAt.getTime()) {
    throw new AppError('CONFLICT', 'Answers can still arrive', {
      reason: 'not_final',
      finalAt: finalAt ? finalAt.toISOString() : null,
    })
  }
}

/** The test's questions in the lecturer's order (no options). One query. */
async function loadQuestionRows(db: Db, testId: string): Promise<QuestionRow[]> {
  return db
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
}

/** Owner-only lookup of a question with its test. Unknown and not-yours are both FORBIDDEN. */
async function requireOwnedQuestion(ctx: Ctx, questionId: unknown): Promise<{ test: TestRow; question: QuestionRow }> {
  requireRole(ctx, 'lecturer')
  if (!isId(questionId)) forbidden()
  const [found] = await ctx.db
    .select({
      test: courseTest,
      question: {
        id: testQuestion.id,
        position: testQuestion.position,
        kind: testQuestion.kind,
        prompt: testQuestion.prompt,
        mark: testQuestion.mark,
        guide: testQuestion.guide,
      },
    })
    .from(testQuestion)
    .innerJoin(courseTest, eq(courseTest.id, testQuestion.testId))
    .where(eq(testQuestion.id, questionId))
  if (!found) forbidden()
  await requireCourseOwner(ctx, found.test.courseId)
  return found
}

/**
 * The question being marked: `questionId`, or (null) the first short-answer question with an
 * unconfirmed real answer, else the first one. Owner only; MCQ-only → CONFLICT automatic; answers
 * not final → CONFLICT not_final. A question id that is not a short-answer question of this test
 * is FORBIDDEN. A fixed number of queries whatever the class size.
 */
export async function getMarkingQuestion(ctx: Ctx, testId: string, questionId: string | null): Promise<MarkingQuestion> {
  const { test, course } = await requireOwnedTest(ctx, testId)
  const questions = await loadQuestionRows(ctx.db, test.id)
  const shorts = questions.filter((q) => q.kind === 'short')
  if (shorts.length === 0) automatic()
  requireFinal(test, now())

  const roster = await courseRosterQuery(ctx.db, { courseId: course.id })
  const onRoster = new Map(roster.map((r) => [r.studentId, r]))

  let question: QuestionRow | undefined
  if (questionId === null) {
    const scores = (await loadTestScores(ctx.db, [test.id], [...onRoster.keys()])).get(test.id)!
    const pending = new Set<string>()
    for (const score of scores.values()) {
      for (const pq of score.perQuestion) if (pq.mark === null) pending.add(pq.questionId)
    }
    question = shorts.find((q) => pending.has(q.id)) ?? shorts[0]
  } else {
    question = shorts.find((q) => q.id === questionId)
    if (!question) forbidden()
  }

  // Every attempt, with its answer to this question when there is one.
  const rows = await ctx.db
    .select({
      attemptId: testAttempt.id,
      studentId: testAttempt.studentId,
      text: testAnswer.text,
      mark: testAnswer.mark,
      comment: testAnswer.comment,
      suggestedMark: testAnswer.suggestedMark,
      suggestedReason: testAnswer.suggestedReason,
    })
    .from(testAttempt)
    .leftJoin(testAnswer, and(eq(testAnswer.attemptId, testAttempt.id), eq(testAnswer.questionId, question.id)))
    .where(eq(testAttempt.testId, test.id))
    .orderBy(asc(testAttempt.id))

  const answers: MarkingAnswer[] = []
  let blank = 0
  let confirmed = 0
  for (const r of rows) {
    const student = onRoster.get(r.studentId)
    if (!student) continue
    if (isBlank(r.text)) {
      blank += 1
      continue
    }
    if (r.mark !== null) confirmed += 1
    answers.push({
      attemptId: r.attemptId,
      studentId: r.studentId,
      name: student.name,
      matricule: student.matricule,
      text: r.text!,
      suggestion:
        r.suggestedMark !== null && r.suggestedReason !== null ? { mark: r.suggestedMark, reason: r.suggestedReason } : null,
      mark: r.mark,
      comment: r.comment,
    })
  }

  const shortIndex = shorts.indexOf(question)
  return {
    testId: test.id,
    questionId: question.id,
    number: questions.indexOf(question) + 1,
    shortIndex: shortIndex + 1,
    shortCount: shorts.length,
    prevId: shortIndex > 0 ? shorts[shortIndex - 1].id : null,
    nextId: shortIndex < shorts.length - 1 ? shorts[shortIndex + 1].id : null,
    prompt: question.prompt,
    guide: question.guide ?? '',
    maxMark: questionMark(question, test.defaultMark),
    answers,
    confirmed,
    blank,
    aiAvailable: getMarkSuggester() !== null,
  }
}

type PendingAnswer = { attemptId: string; text: string }

/**
 * Asks the suggester about one batch and stores what comes back, only on answers still without a
 * suggestion or a mark. Never writes `mark`. Returns how many answers got a suggestion. Answers go
 * out under opaque per-batch keys; nothing identifies a student.
 */
async function suggestBatch(
  db: Db,
  suggester: MarkSuggester,
  input: { questionId: string; prompt: string; guide: string; maxMark: number; locale: Ctx['user']['locale'] },
  batch: PendingAnswer[],
  at: Date,
): Promise<number> {
  const byKey = new Map(batch.map((a, i) => [`a${i + 1}`, a.attemptId]))
  const suggestions: Suggestion[] = await suggester({
    prompt: input.prompt,
    guide: input.guide,
    maxMark: input.maxMark,
    locale: input.locale,
    answers: batch.map((a, i) => ({ key: `a${i + 1}`, text: a.text })),
  })

  // The suggester cleans its output; check again here, since a wrong mark must never be stored.
  const seen = new Set<string>()
  const values = []
  for (const s of Array.isArray(suggestions) ? suggestions : []) {
    const attemptId = byKey.get(s?.key)
    if (!attemptId || seen.has(attemptId)) continue
    if (typeof s.mark !== 'number' || !isValidMark(s.mark, input.maxMark)) continue
    if (typeof s.reason !== 'string' || s.reason.trim() === '') continue
    seen.add(attemptId)
    values.push(sql`(${attemptId}::text, ${s.mark}::numeric, ${s.reason}::text)`)
  }
  if (values.length === 0) return 0

  const updated = await db.execute<{ attempt_id: string }>(sql`
    update ${testAnswer}
    set suggested_mark = v.mark, suggested_reason = v.reason, suggested_at = ${at.toISOString()}::timestamptz
    from (values ${sql.join(values, sql`, `)}) as v(attempt_id, mark, reason)
    where ${testAnswer.attemptId} = v.attempt_id
      and ${testAnswer.questionId} = ${input.questionId}
      and ${testAnswer.suggestedAt} is null
      and ${testAnswer.mark} is null
    returning ${testAnswer.attemptId}`)
  return updated.rows.length
}

/**
 * Fetches AI suggestions for the question's real answers (current roster students) that have
 * neither a suggestion nor a mark, in batches of 20 sent in parallel. A batch that fails stores
 * nothing and makes `failed` true (the page offers to try again); the other batches still count.
 * With suggestions off: `{ suggested: 0, failed: false }`. Owner only; final answers only.
 */
export async function suggestMarks(ctx: Ctx, questionId: string): Promise<{ suggested: number; failed: boolean }> {
  const { test, question } = await requireOwnedQuestion(ctx, questionId)
  if (question.kind !== 'short') automatic()
  const at = now()
  requireFinal(test, at)
  const suggester = getMarkSuggester()
  if (!suggester) return { suggested: 0, failed: false }

  const [roster, rows] = await Promise.all([
    courseRosterQuery(ctx.db, { courseId: test.courseId }),
    ctx.db
      .select({ attemptId: testAnswer.attemptId, studentId: testAttempt.studentId, text: testAnswer.text })
      .from(testAnswer)
      .innerJoin(testAttempt, eq(testAttempt.id, testAnswer.attemptId))
      .where(
        and(
          eq(testAnswer.questionId, question.id),
          eq(testAttempt.testId, test.id),
          isNull(testAnswer.suggestedAt),
          isNull(testAnswer.mark),
        ),
      )
      .orderBy(asc(testAnswer.attemptId)),
  ])
  const onRoster = new Set(roster.map((r) => r.studentId))
  const pending: PendingAnswer[] = rows
    .filter((r) => onRoster.has(r.studentId) && !isBlank(r.text))
    .map((r) => ({ attemptId: r.attemptId, text: r.text!.trim() }))
  if (pending.length === 0) return { suggested: 0, failed: false }

  const input = {
    questionId: question.id,
    prompt: question.prompt,
    guide: question.guide ?? '',
    maxMark: questionMark(question, test.defaultMark),
    locale: ctx.user.locale,
  }
  const batches: PendingAnswer[][] = []
  for (let i = 0; i < pending.length; i += SUGGEST_BATCH) batches.push(pending.slice(i, i + SUGGEST_BATCH))

  const results = await Promise.allSettled(batches.map((batch) => suggestBatch(ctx.db, suggester, input, batch, at)))
  let suggested = 0
  let failed = false
  for (const r of results) {
    if (r.status === 'fulfilled') {
      suggested += r.value
    } else {
      failed = true
      // Only the error's name: a provider's message could quote the request (student answers).
      const name = r.reason instanceof Error ? r.reason.name : 'UnknownError'
      console.error('[suggestMarks] a batch of suggestions failed', name)
    }
  }
  return { suggested, failed }
}

/**
 * Confirms (or changes) the mark of one real short answer, with an optional comment the student
 * sees beside it. Owner only; final answers only. The mark is 0..the question's mark in 0.25
 * steps; the comment is trimmed, blank → null, at most COMMENT_MAX characters. Also allowed after
 * release: the student then sees the new mark (no new email).
 */
export async function confirmMark(
  ctx: Ctx,
  input: { attemptId: string; questionId: string; mark: number; comment: string | null },
): Promise<void> {
  requireRole(ctx, 'lecturer')
  if (!isId(input?.attemptId) || !isId(input?.questionId)) forbidden()
  const [found] = await ctx.db
    .select({
      test: courseTest,
      kind: testQuestion.kind,
      questionMark: testQuestion.mark,
      text: testAnswer.text,
    })
    .from(testQuestion)
    .innerJoin(courseTest, eq(courseTest.id, testQuestion.testId))
    .innerJoin(testAttempt, and(eq(testAttempt.testId, courseTest.id), eq(testAttempt.id, input.attemptId)))
    .leftJoin(testAnswer, and(eq(testAnswer.attemptId, testAttempt.id), eq(testAnswer.questionId, testQuestion.id)))
    .where(eq(testQuestion.id, input.questionId))
  if (!found) forbidden()
  await requireCourseOwner(ctx, found.test.courseId)
  if (found.kind !== 'short') automatic()
  const at = now()
  requireFinal(found.test, at)

  if (isBlank(found.text)) {
    throw new AppError('VALIDATION', 'A blank answer scores 0 by itself', { fields: ['answer'] })
  }
  const maxMark = questionMark({ mark: found.questionMark }, found.test.defaultMark)
  if (typeof input.mark !== 'number' || !isValidMark(input.mark, maxMark)) {
    throw new AppError('VALIDATION', 'Invalid mark', { fields: ['mark'] })
  }
  if (input.comment !== null && typeof input.comment !== 'string') {
    throw new AppError('VALIDATION', 'Invalid comment', { fields: ['comment'] })
  }
  const comment = input.comment?.trim() || null
  if (comment !== null && comment.length > COMMENT_MAX) {
    throw new AppError('VALIDATION', 'Comment too long', { fields: ['comment'] })
  }

  await ctx.db
    .update(testAnswer)
    .set({ mark: input.mark, comment, markedBy: ctx.user.id, markedAt: at })
    .where(and(eq(testAnswer.attemptId, input.attemptId), eq(testAnswer.questionId, input.questionId)))
}
