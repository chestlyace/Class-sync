import { and, count, desc, eq, inArray, isNull, sql } from 'drizzle-orm'
import { generateJoinCode } from '@/server/classes/join-code'
import { now } from '@/server/core/clock'
import type { Ctx } from '@/server/core/context'
import { AppError } from '@/server/core/errors'
import { courseRosterQuery } from '@/server/courses/roster'
import { requireCourseOwner } from '@/server/courses/service'
import type { Db } from '@/server/db'
import { courseTest, testAttempt, testOption, testQuestion } from '@/server/db/schema'
import { isUniqueViolation } from '@/server/lib/db-errors'
import { endsAt, testState, type TestState } from './phase'
import { loadStoredQuestions, requireOwnedTest, type StoredQuestion, type TestRow } from './queries'
import { validateTestInput, type QuestionInput, type TestInput } from './rules'

export type TestSummary = {
  id: string
  courseId: string
  code: string
  title: string
  state: TestState
  questionCount: number
  totalMarks: number
  hasShort: boolean
  durationMinutes: number
  startedAt: Date | null
  endsAt: Date | null
  /**
   * Students on the course's current roster who have opened the test (an attempt exists),
   * whatever its state; the live view counts the same way.
   */
  joined: number
}

/** The whole test as the editor loads it, correct flags and marking guides included (owner only). */
export type TestForEdit = {
  summary: TestSummary
  input: Omit<TestInput, 'questions'> & { questions: (QuestionInput & { id: string })[] }
}

type TestSettings = Omit<TestInput, 'questions'>

const CODE_CONSTRAINT = 'course_test_code_unique'
const MAX_CODE_ATTEMPTS = 5

function started(): AppError {
  return new AppError('CONFLICT', 'The test has started: it can no longer be changed', { reason: 'started' })
}

/**
 * Why a conditional write on `started_at is null` matched nothing: CONFLICT started when the test
 * is still there, FORBIDDEN (as for any missing test) when it was deleted in between.
 */
async function startedOrGone(db: Db, testId: string): Promise<AppError> {
  const [row] = await db.select({ id: courseTest.id }).from(courseTest).where(eq(courseTest.id, testId))
  return row ? started() : new AppError('FORBIDDEN', 'Only the lecturer of this course can do this')
}

/** The validated test, or VALIDATION { reason, question? } naming the first problem found. */
function parseTestInput(input: unknown): TestInput {
  const result = validateTestInput(input)
  if ('error' in result) {
    const details: Record<string, unknown> = { reason: result.error }
    if (result.question !== undefined) details.question = result.question
    throw new AppError('VALIDATION', 'Invalid test', details)
  }
  return result
}

function settingsOf(t: TestSettings): TestSettings {
  return {
    title: t.title,
    durationMinutes: t.durationMinutes,
    defaultMark: t.defaultMark,
    shuffle: t.shuffle,
    maxExits: t.maxExits,
    maxAbsenceSeconds: t.maxAbsenceSeconds,
    weight: t.weight,
  }
}

/** Inserts the questions (positions 0, 1, 2…) and their options, in two statements. */
async function insertQuestions(db: Db, testId: string, questions: QuestionInput[]): Promise<void> {
  const rows = questions.map((q, position) => ({
    id: crypto.randomUUID(),
    testId,
    position,
    kind: q.kind,
    prompt: q.prompt,
    mark: q.mark,
    guide: q.kind === 'short' ? q.guide : null,
  }))
  await db.insert(testQuestion).values(rows)
  const options = questions.flatMap((q, i) =>
    q.kind === 'mcq'
      ? q.options.map((o, position) => ({ questionId: rows[i].id, position, text: o.text, isCorrect: o.correct }))
      : [],
  )
  if (options.length > 0) await db.insert(testOption).values(options)
}

/**
 * Inserts a new, not-started test with its questions under a fresh code. A code already taken
 * (the unique constraint) is retried with a new one, up to MAX_CODE_ATTEMPTS times.
 */
async function insertNewTest(
  ctx: Ctx,
  courseId: string,
  settings: TestSettings,
  questions: QuestionInput[],
  copiedFromId: string | null,
): Promise<TestRow> {
  for (let attempt = 0; attempt < MAX_CODE_ATTEMPTS; attempt++) {
    const code = generateJoinCode()
    const at = now()
    try {
      return await ctx.db.transaction(async (tx) => {
        const id = crypto.randomUUID()
        let familyId = id
        if (copiedFromId) {
          const [source] = await tx.select({ familyId: courseTest.familyId }).from(courseTest).where(eq(courseTest.id, copiedFromId))
          if (source) familyId = source.familyId
        }
        const [created] = await tx
          .insert(courseTest)
          .values({
            id,
            familyId,
            courseId,
            code,
            ...settingsOf(settings),
            copiedFromId,
            createdBy: ctx.user.id,
            createdAt: at,
            updatedAt: at,
          })
          .returning()
        await insertQuestions(tx, created.id, questions)
        return created
      })
    } catch (err) {
      if (!isUniqueViolation(err, CODE_CONSTRAINT)) throw err
    }
  }
  throw new Error('Could not generate a unique test code')
}

/**
 * Summaries for the given tests in the same order: two queries plus one roster query per course,
 * whatever the number of tests or attempts.
 */
async function summarize(db: Db, tests: TestRow[]): Promise<TestSummary[]> {
  if (tests.length === 0) return []
  const ids = tests.map((t) => t.id)
  const courseIds = [...new Set(tests.map((t) => t.courseId))]
  const [questionStats, attempts, rosters] = await Promise.all([
    db
      .select({
        testId: testQuestion.testId,
        questionCount: count(),
        ownMarks: sql<number>`coalesce(sum(${testQuestion.mark}), 0)`.mapWith(Number),
        onDefault: sql<number>`count(*) filter (where ${testQuestion.mark} is null)`.mapWith(Number),
        shortCount: sql<number>`count(*) filter (where ${testQuestion.kind} = 'short')`.mapWith(Number),
      })
      .from(testQuestion)
      .where(inArray(testQuestion.testId, ids))
      .groupBy(testQuestion.testId),
    db
      .select({ testId: testAttempt.testId, studentId: testAttempt.studentId })
      .from(testAttempt)
      .where(inArray(testAttempt.testId, ids)),
    Promise.all(courseIds.map((courseId) => courseRosterQuery(db, { courseId }))),
  ])
  const stats = new Map(questionStats.map((s) => [s.testId, s]))
  const onRoster = new Map(courseIds.map((id, i) => [id, new Set(rosters[i].map((r) => r.studentId))]))
  const courseOf = new Map(tests.map((t) => [t.id, t.courseId]))
  // Only students still on the roster count, so the list agrees with the live view.
  const joined = new Map<string, number>()
  for (const a of attempts) {
    if (!onRoster.get(courseOf.get(a.testId)!)?.has(a.studentId)) continue
    joined.set(a.testId, (joined.get(a.testId) ?? 0) + 1)
  }
  const at = now()
  return tests.map((t) => {
    const s = stats.get(t.id)
    const hasShort = (s?.shortCount ?? 0) > 0
    return {
      id: t.id,
      courseId: t.courseId,
      code: t.code,
      title: t.title,
      state: testState({ ...t, hasShort }, at),
      questionCount: s?.questionCount ?? 0,
      // Marks are 0.25 steps, so this sum is exact.
      totalMarks: (s?.ownMarks ?? 0) + (s?.onDefault ?? 0) * t.defaultMark,
      hasShort,
      durationMinutes: t.durationMinutes,
      startedAt: t.startedAt,
      endsAt: endsAt(t),
      joined: joined.get(t.id) ?? 0,
    }
  })
}

/** One test's summary, timing judged against `now()`. */
export async function summarizeTest(db: Db, test: TestRow): Promise<TestSummary> {
  const [summary] = await summarize(db, [test])
  return summary
}

function toQuestionInput(q: StoredQuestion): QuestionInput {
  if (q.kind === 'mcq') {
    return {
      kind: 'mcq',
      prompt: q.prompt,
      mark: q.mark,
      options: q.options.map((o) => ({ text: o.text, correct: o.isCorrect })),
    }
  }
  return { kind: 'short', prompt: q.prompt, mark: q.mark, guide: q.guide ?? '' }
}

/** Creates a not-started test in a course I own; it gets its own `/t/<code>` link code. */
export async function createTest(ctx: Ctx, courseId: string, input: unknown): Promise<TestSummary> {
  await requireCourseOwner(ctx, courseId)
  const data = parseTestInput(input)
  const created = await insertNewTest(ctx, courseId, settingsOf(data), data.questions, null)
  return summarizeTest(ctx.db, created)
}

/**
 * Replaces the settings and every question of a test that has not started. The first statement
 * of the transaction is the conditional update on `started_at is null`, so it cannot race Start:
 * once Start has committed, nothing is changed (CONFLICT { reason: 'started' }); a test deleted
 * in between is FORBIDDEN.
 */
export async function updateTest(ctx: Ctx, testId: string, input: unknown): Promise<TestSummary> {
  await requireOwnedTest(ctx, testId)
  const data = parseTestInput(input)
  const updated = await ctx.db.transaction(async (tx) => {
    const [row] = await tx
      .update(courseTest)
      .set({ ...settingsOf(data), updatedAt: now() })
      .where(and(eq(courseTest.id, testId), isNull(courseTest.startedAt)))
      .returning()
    if (!row) throw await startedOrGone(tx, testId)
    // Options go with their questions (cascade).
    await tx.delete(testQuestion).where(eq(testQuestion.testId, testId))
    await insertQuestions(tx, testId, data.questions)
    return row
  })
  return summarizeTest(ctx.db, updated)
}

export async function getTestForEdit(ctx: Ctx, testId: string): Promise<TestForEdit> {
  const { test } = await requireOwnedTest(ctx, testId)
  const [summary, questions] = await Promise.all([summarizeTest(ctx.db, test), loadStoredQuestions(ctx.db, test.id)])
  return {
    summary,
    input: {
      ...settingsOf(test),
      questions: questions.map((q) => ({ id: q.id, ...toQuestionInput(q) })),
    },
  }
}

/** The course's tests, newest first, in a fixed number of queries. */
export async function listCourseTests(ctx: Ctx, courseId: string): Promise<TestSummary[]> {
  await requireCourseOwner(ctx, courseId)
  const rows = await ctx.db
    .select()
    .from(courseTest)
    .where(eq(courseTest.courseId, courseId))
    .orderBy(desc(courseTest.createdAt), desc(courseTest.id))
  return summarize(ctx.db, rows)
}

/**
 * Copies a test (settings, weight in CA included, and questions) into a course I own, the same one included, as a new
 * not-started test with a new code. Nothing of the original's run (timing, attempts) comes along.
 */
export async function copyTest(ctx: Ctx, testId: string, targetCourseId: string): Promise<TestSummary> {
  const { test } = await requireOwnedTest(ctx, testId)
  await requireCourseOwner(ctx, targetCourseId)
  const questions = await loadStoredQuestions(ctx.db, test.id)
  // Checked like a new test, so a copy never carries a test the rules now refuse.
  const data = parseTestInput({ ...settingsOf(test), questions: questions.map(toQuestionInput) })
  const created = await insertNewTest(ctx, targetCourseId, settingsOf(data), data.questions, test.id)
  return summarizeTest(ctx.db, created)
}

/** Deletes a test that has not started (conditional, so it cannot race Start); already gone is FORBIDDEN. */
export async function deleteTest(ctx: Ctx, testId: string): Promise<void> {
  await requireOwnedTest(ctx, testId)
  const deleted = await ctx.db
    .delete(courseTest)
    .where(and(eq(courseTest.id, testId), isNull(courseTest.startedAt)))
    .returning({ id: courseTest.id })
  if (deleted.length === 0) throw await startedOrGone(ctx.db, testId)
}
