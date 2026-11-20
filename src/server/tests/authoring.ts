import { and, count, desc, eq, inArray, isNull, notInArray, sql } from 'drizzle-orm'
import { z } from 'zod'
import { generateJoinCode } from '@/server/classes/join-code'
import { now } from '@/server/core/clock'
import type { Ctx } from '@/server/core/context'
import { AppError } from '@/server/core/errors'
import { courseRosterQuery } from '@/server/courses/roster'
import { requireCourseOwner } from '@/server/courses/service'
import type { Db } from '@/server/db'
import {
  CATCH_UP_FOR,
  courseTest,
  testAttempt,
  testCatchUpStudent,
  testOption,
  testQuestion,
  type CatchUpFor,
} from '@/server/db/schema'
import { isUniqueViolation } from '@/server/lib/db-errors'
import { eligibleStudents } from './catch-up'
import { endsAt, testPhase, testState, type TestState } from './phase'
import { loadStoredQuestions, requireOwnedTest, type StoredQuestion, type TestRow } from './queries'
import { validateTestInput, type QuestionInput, type TestInput } from './rules'

export type { CatchUpFor }

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
  /** Students may review the paper and practise it once released (the lecturer's switch). */
  studentsCanReview: boolean
  /** The test this one is a catch-up of; null for an ordinary test. */
  catchUpOf: { id: string; title: string } | null
  catchUpFor: CatchUpFor | null
  /** Picked catch-ups only: how many students on the current roster are picked. */
  pickedCount: number | null
}

/** How a student fared on the original test, as the catch-up form shows it. */
export type OriginalStatus = 'not_joined' | 'left_early' | 'not_handed_in' | 'handed_in'

export type CatchUpOptions = {
  original: TestSummary
  students: { studentId: string; name: string; matricule: string | null; status: OriginalStatus }[]
  /** How many students on the roster an "everyone who missed it" catch-up would admit now. */
  missedCount: number
  /** The original's results are out and students may review it: its answers may be known. */
  answersMayBeOut: boolean
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

/** What makes a new test a catch-up: its original, who it is for, and (picked) the students. */
type NewCatchUp = { ofId: string; for: CatchUpFor; studentIds: string[] }

/**
 * Inserts a new, not-started test with its questions under a fresh code, and for a catch-up its
 * picked students, in one transaction. A code already taken (the unique constraint) is retried
 * with a new one, up to MAX_CODE_ATTEMPTS times.
 */
async function insertNewTest(
  ctx: Ctx,
  courseId: string,
  settings: TestSettings,
  questions: QuestionInput[],
  copiedFromId: string | null,
  studentsCanReview = true,
  catchUp: NewCatchUp | null = null,
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
            studentsCanReview,
            catchUpOfId: catchUp?.ofId ?? null,
            catchUpFor: catchUp?.for ?? null,
            createdBy: ctx.user.id,
            createdAt: at,
            updatedAt: at,
          })
          .returning()
        await insertQuestions(tx, created.id, questions)
        if (catchUp && catchUp.studentIds.length > 0) {
          await tx
            .insert(testCatchUpStudent)
            .values(catchUp.studentIds.map((studentId) => ({ testId: id, studentId, addedBy: ctx.user.id })))
        }
        return created
      })
    } catch (err) {
      if (!isUniqueViolation(err, CODE_CONSTRAINT)) throw err
    }
  }
  throw new Error('Could not generate a unique test code')
}

/**
 * Summaries for the given tests in the same order: two queries, one more when any is a catch-up,
 * plus one roster query per course, whatever the number of tests or attempts.
 */
async function summarize(db: Db, tests: TestRow[]): Promise<TestSummary[]> {
  if (tests.length === 0) return []
  const ids = tests.map((t) => t.id)
  const courseIds = [...new Set(tests.map((t) => t.courseId))]
  // The originals (for their titles) and the picked catch-ups (for their lists), in one query.
  const catchUpIds = new Set<string>()
  for (const t of tests) {
    if (t.catchUpOfId === null) continue
    catchUpIds.add(t.catchUpOfId)
    if (t.catchUpFor === 'picked') catchUpIds.add(t.id)
  }
  const [questionStats, attempts, rosters, catchUpRows] = await Promise.all([
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
    catchUpIds.size === 0
      ? []
      : db
          .select({ id: courseTest.id, title: courseTest.title, pickedId: testCatchUpStudent.studentId })
          .from(courseTest)
          .leftJoin(testCatchUpStudent, eq(testCatchUpStudent.testId, courseTest.id))
          .where(inArray(courseTest.id, [...catchUpIds])),
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
  const titles = new Map<string, string>()
  const picked = new Map<string, string[]>()
  for (const row of catchUpRows) {
    titles.set(row.id, row.title)
    if (row.pickedId === null) continue
    const list = picked.get(row.id) ?? []
    list.push(row.pickedId)
    picked.set(row.id, list)
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
      studentsCanReview: t.studentsCanReview,
      catchUpOf: t.catchUpOfId === null ? null : { id: t.catchUpOfId, title: titles.get(t.catchUpOfId) ?? '' },
      catchUpFor: t.catchUpFor,
      // Like `joined`, only students still on the roster count.
      pickedCount:
        t.catchUpFor === 'picked'
          ? (picked.get(t.id) ?? []).filter((id) => onRoster.get(t.courseId)?.has(id)).length
          : null,
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
 * in between is FORBIDDEN. A catch-up keeps its original's weight, whatever the input says.
 */
export async function updateTest(ctx: Ctx, testId: string, input: unknown): Promise<TestSummary> {
  const { test } = await requireOwnedTest(ctx, testId)
  const data = parseTestInput(input)
  const settings = settingsOf(data)
  if (test.catchUpOfId !== null) {
    const [original] = await ctx.db
      .select({ weight: courseTest.weight })
      .from(courseTest)
      .where(eq(courseTest.id, test.catchUpOfId))
    if (original) settings.weight = original.weight
  }
  const updated = await ctx.db.transaction(async (tx) => {
    const [row] = await tx
      .update(courseTest)
      .set({ ...settings, updatedAt: now() })
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
  const created = await insertNewTest(ctx, targetCourseId, settingsOf(data), data.questions, test.id, test.studentsCanReview)
  return summarizeTest(ctx.db, created)
}

/**
 * Whether students may review this test (questions, their answers, the correct ones) and practise
 * it once it is released everywhere. Owner only; changeable in any state, effective at once.
 */
export async function setStudentsCanReview(ctx: Ctx, testId: string, on: boolean): Promise<void> {
  await requireOwnedTest(ctx, testId)
  if (typeof on !== 'boolean') throw new AppError('VALIDATION', 'Invalid input', { fields: ['on'] })
  await ctx.db.update(courseTest).set({ studentsCanReview: on, updatedAt: now() }).where(eq(courseTest.id, testId))
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

const catchUpInputSchema = z.object({
  for: z.enum(CATCH_UP_FOR),
  // Picked mode only; ignored for "everyone who missed it".
  studentIds: z.array(z.string().min(1)).max(1000).default([]),
})

type CatchUpInput = { for: CatchUpFor; studentIds: string[] }

function invalidStudents(): AppError {
  return new AppError('VALIDATION', 'Pick at least one student on the course', { fields: ['studentIds'] })
}

/**
 * The validated choice of who sits a catch-up: VALIDATION { fields } for a malformed one, and
 * { fields: ['studentIds'] } when a picked list is empty or names a student off the roster.
 * `studentIds` comes back de-duplicated, and empty for `missed`.
 */
function parseCatchUpInput(input: unknown, rosterIds: Set<string>): CatchUpInput {
  const result = catchUpInputSchema.safeParse(input)
  if (!result.success) {
    const fields = [...new Set(result.error.issues.map((i) => i.path.join('.')))]
    throw new AppError('VALIDATION', 'Invalid input', { fields })
  }
  if (result.data.for === 'missed') return { for: 'missed', studentIds: [] }
  const studentIds = [...new Set(result.data.studentIds)]
  if (studentIds.length === 0 || studentIds.some((id) => !rosterIds.has(id))) throw invalidStudents()
  return { for: 'picked', studentIds }
}

/**
 * A test I own that may be given a catch-up: CONFLICT is_catch_up for a catch-up (a catch-up
 * is always of the original), CONFLICT not_ended until the test has ended (released included).
 */
async function requireCatchUpOriginal(ctx: Ctx, originalId: string): Promise<TestRow> {
  const { test } = await requireOwnedTest(ctx, originalId)
  if (test.catchUpOfId !== null) {
    throw new AppError('CONFLICT', 'A catch-up cannot have its own catch-up', { reason: 'is_catch_up' })
  }
  if (testPhase(test, now()) !== 'ended') {
    throw new AppError('CONFLICT', 'The test has not ended yet', { reason: 'not_ended' })
  }
  return test
}

/** Of the roster, who a new "everyone who missed it" catch-up of `original` would admit now. */
async function missedStudents(db: Db, original: TestRow, rosterIds: string[]): Promise<Set<string>> {
  const hypothetical = {
    id: crypto.randomUUID(),
    courseId: original.courseId,
    catchUpOfId: original.id,
    catchUpFor: 'missed' as const,
    startedAt: null,
  }
  return eligibleStudents(db, hypothetical, rosterIds)
}

/**
 * What the "Give a catch-up" form shows for an ended test I own: each student on the roster with
 * how they fared on it, how many missed it, and whether its answers may be known already.
 */
export async function getCatchUpOptions(ctx: Ctx, originalId: string): Promise<CatchUpOptions> {
  const original = await requireCatchUpOriginal(ctx, originalId)
  const [summary, roster, attempts] = await Promise.all([
    summarizeTest(ctx.db, original),
    courseRosterQuery(ctx.db, { courseId: original.courseId }),
    ctx.db
      .select({ studentId: testAttempt.studentId, closedReason: testAttempt.closedReason })
      .from(testAttempt)
      .where(eq(testAttempt.testId, original.id)),
  ])
  const missed = await missedStudents(
    ctx.db,
    original,
    roster.map((r) => r.studentId),
  )
  const closedReasonOf = new Map(attempts.map((a) => [a.studentId, a.closedReason]))
  const statusOf = (studentId: string): OriginalStatus => {
    if (!closedReasonOf.has(studentId)) return 'not_joined'
    const reason = closedReasonOf.get(studentId)
    if (reason === 'left') return 'left_early'
    if (reason === 'handed_in') return 'handed_in'
    return 'not_handed_in'
  }
  return {
    original: summary,
    students: roster.map((r) => ({
      studentId: r.studentId,
      name: r.name,
      matricule: r.matricule,
      status: statusOf(r.studentId),
    })),
    missedCount: missed.size,
    answersMayBeOut: summary.state === 'released' && summary.studentsCanReview,
  }
}

/**
 * Gives a catch-up of an ended test I own: a new, not-started test in the same course and family
 * with the original's questions, settings, weight and review switch, titled
 * "<original title> (<titleSuffix>)" (the caller passes the localized suffix). `missed` needs
 * someone who missed it (VALIDATION { reason: 'nobody_missed' }); `picked` needs at least one
 * student on the roster.
 */
export async function giveCatchUp(
  ctx: Ctx,
  originalId: string,
  input: unknown,
  titleSuffix: string,
): Promise<TestSummary> {
  const original = await requireCatchUpOriginal(ctx, originalId)
  if (typeof titleSuffix !== 'string' || titleSuffix.trim().length === 0) {
    throw new AppError('VALIDATION', 'Invalid input', { fields: ['titleSuffix'] })
  }
  const roster = await courseRosterQuery(ctx.db, { courseId: original.courseId })
  const rosterIds = roster.map((r) => r.studentId)
  const choice = parseCatchUpInput(input, new Set(rosterIds))
  if (choice.for === 'missed' && (await missedStudents(ctx.db, original, rosterIds)).size === 0) {
    throw new AppError('VALIDATION', 'Everyone sat this test', { reason: 'nobody_missed' })
  }
  const questions = await loadStoredQuestions(ctx.db, original.id)
  // Checked like a new test, as a copy is.
  const data = parseTestInput({
    ...settingsOf(original),
    title: `${original.title} (${titleSuffix.trim()})`,
    questions: questions.map(toQuestionInput),
  })
  const created = await insertNewTest(
    ctx,
    original.courseId,
    settingsOf(data),
    data.questions,
    original.id,
    original.studentsCanReview,
    { ofId: original.id, for: choice.for, studentIds: choice.studentIds },
  )
  return summarizeTest(ctx.db, created)
}

/**
 * The students picked for a catch-up I own (empty for "everyone who missed it"), as the edit
 * page ticks them. CONFLICT not_catch_up on an ordinary test.
 */
export async function getCatchUpStudents(ctx: Ctx, catchUpId: string): Promise<string[]> {
  const { test } = await requireOwnedTest(ctx, catchUpId)
  if (test.catchUpOfId === null || test.catchUpFor === null) {
    throw new AppError('CONFLICT', 'This test is not a catch-up', { reason: 'not_catch_up' })
  }
  if (test.catchUpFor !== 'picked') return []
  const rows = await ctx.db
    .select({ studentId: testCatchUpStudent.studentId })
    .from(testCatchUpStudent)
    .where(eq(testCatchUpStudent.testId, catchUpId))
  return rows.map((r) => r.studentId)
}

/**
 * Changes who sits a catch-up I own. Before Start: replaces the mode and the picked list, then
 * deletes the waiting attempts of students no longer eligible, in one transaction whose first
 * statement is the conditional update on `started_at is null` (so it cannot race Start: CONFLICT
 * started, nothing changed; a catch-up deleted in between is FORBIDDEN). After Start: students
 * may only be added to a picked list; a mode change or a removal is CONFLICT started.
 */
export async function setCatchUpStudents(ctx: Ctx, catchUpId: string, input: unknown): Promise<TestSummary> {
  const { test } = await requireOwnedTest(ctx, catchUpId)
  if (test.catchUpOfId === null || test.catchUpFor === null) {
    throw new AppError('CONFLICT', 'This test is not a catch-up', { reason: 'not_catch_up' })
  }
  const roster = await courseRosterQuery(ctx.db, { courseId: test.courseId })
  const rosterIds = new Set(roster.map((r) => r.studentId))
  const choice = parseCatchUpInput(input, rosterIds)

  if (test.startedAt !== null) {
    if (choice.for !== test.catchUpFor) throw started()
    if (choice.for === 'picked') {
      const current = await ctx.db
        .select({ studentId: testCatchUpStudent.studentId })
        .from(testCatchUpStudent)
        .where(eq(testCatchUpStudent.testId, catchUpId))
      // Picked students who have since left the roster are not shown, so leaving them out is no removal.
      const kept = new Set(choice.studentIds)
      if (current.some((c) => rosterIds.has(c.studentId) && !kept.has(c.studentId))) throw started()
      await ctx.db
        .insert(testCatchUpStudent)
        .values(choice.studentIds.map((studentId) => ({ testId: catchUpId, studentId, addedBy: ctx.user.id })))
        .onConflictDoNothing()
    }
    return summarizeTest(ctx.db, test)
  }

  const updated = await ctx.db.transaction(async (tx) => {
    const [row] = await tx
      .update(courseTest)
      .set({ catchUpFor: choice.for, updatedAt: now() })
      .where(and(eq(courseTest.id, catchUpId), isNull(courseTest.startedAt)))
      .returning()
    if (!row) throw await startedOrGone(tx, catchUpId)
    // The picked list becomes exactly the new one (empty for `missed`); kept rows keep their dates.
    const removal = [eq(testCatchUpStudent.testId, catchUpId)]
    if (choice.studentIds.length > 0) removal.push(notInArray(testCatchUpStudent.studentId, choice.studentIds))
    await tx.delete(testCatchUpStudent).where(and(...removal))
    if (choice.studentIds.length > 0) {
      await tx
        .insert(testCatchUpStudent)
        .values(choice.studentIds.map((studentId) => ({ testId: catchUpId, studentId, addedBy: ctx.user.id })))
        .onConflictDoNothing()
    }
    // Opening the link early makes a waiting attempt; it gives no hold before Start.
    const waiting = await tx
      .select({ studentId: testAttempt.studentId })
      .from(testAttempt)
      .where(eq(testAttempt.testId, catchUpId))
    const holders = waiting.map((w) => w.studentId)
    const eligible = await eligibleStudents(tx, row, holders)
    const dropped = holders.filter((id) => !eligible.has(id))
    if (dropped.length > 0) {
      // Their answers, exits and logs go with the attempt (cascade); before Start there are none.
      await tx
        .delete(testAttempt)
        .where(and(eq(testAttempt.testId, catchUpId), inArray(testAttempt.studentId, dropped)))
    }
    return row
  })
  return summarizeTest(ctx.db, updated)
}
