import { and, asc, count, desc, eq, inArray, lte, or, sql, type Column } from 'drizzle-orm'
import { createElement } from 'react'
import { isWellFormedJoinCode, normalizeJoinCode } from '@/server/classes/join-code'
import { now } from '@/server/core/clock'
import { config } from '@/server/core/config'
import type { Ctx } from '@/server/core/context'
import { AppError } from '@/server/core/errors'
import { requireRole, requireVerified } from '@/server/core/guards'
import { isOnCourseRoster } from '@/server/courses/roster'
import type { Db } from '@/server/db'
import { course, courseTest, testAnswer, testAttempt, testExit, testLog, testOption, testQuestion } from '@/server/db/schema'
import { appLinkBuilder, queueNotifications, type Notification } from '@/server/email/notify'
import { TestHandedInEmail } from '@/server/email/templates/test-handed-in'
import { emailSubject } from '@/server/email/templates/verify-email'
import { judgeExit, type LeavingRule } from './leaving'
import { orderFor, scoreAttempt, type ScoringAnswer, type ScoringQuestion } from './paper'
import { acceptsAnswers, answersFinalAt, canSeeResult, endsAt, testPhase, testState, type TestPhase, type TestState } from './phase'
import { MAX_QUESTIONS, SHORT_ANSWER_MAX, DEVICE_STALE_MS, questionMark, type QuestionKind } from './rules'

// ---------------------------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------------------------

/** One answer as the device sends it; `rev` counts up per question on that device. */
export type AnswerInput = { questionId: string; optionId: string | null; text: string | null; rev: number }

/** One exit report: `left` when the page was left, `back` with the absence measured on the device. */
export type ExitReport = { exitId: string; phase: 'left' | 'back'; awayMs: number | null }

/** A question as the student sees it: no correct flag, no guide; already in this student's order. */
export type PaperQuestion = {
  id: string
  kind: QuestionKind
  prompt: string
  mark: number
  options: { id: string; text: string }[]
}

export type TestInfo = {
  title: string
  courseTitle: string
  durationMinutes: number
  questionCount: number
  totalMarks: number
  rule: LeavingRule
  hasShort: boolean
}

/** The total only, never which questions were right. */
export type QuickResult = { score: number; outOf: number; mcqCorrect: number; mcqCount: number }

export type AttemptStage = 'waiting' | 'answering' | 'ended_left' | 'handed_in' | 'over'

export type AttemptView = {
  attemptId: string | null
  /** `over` = the test ended for everyone (a hand-in by the student stays `handed_in`). */
  stage: AttemptStage
  info: TestInfo
  endsAt: Date | null
  serverNow: Date
  /** Exits since the last reopening (the leaving rule counts these). */
  exitsSoFar: number
  /** Only while answering. */
  paper: PaperQuestion[] | null
  /** The server's copy of my answers. */
  saved: AnswerInput[]
  /** Only when the student may see it (canSeeResult). */
  result: QuickResult | null
  /** Done, and the result waits for the lecturer to release it (tests with short answers). */
  awaitingRelease: boolean
}

/** A view without the paper and the saved answers (a sync that did not ask for them). */
export type LeanView = Omit<AttemptView, 'paper' | 'saved'>

/**
 * A sync's view: `paper` and `saved` only when the device asked for them (`withPaper`: it holds no
 * paper yet, e.g. it was waiting at Start), else left out and the device keeps its own.
 */
export type SyncView = LeanView & Partial<Pick<AttemptView, 'paper' | 'saved'>> & { acceptedRevs: Record<string, number> }

/** What the device sends with each sync. */
export type SyncInput = { deviceId: string; answers: AnswerInput[]; exits: ExitReport[]; withPaper?: boolean }

export type MyTestItem = {
  testId: string
  code: string
  title: string
  state: TestState
  myStatus: 'not_joined' | 'working' | 'ended_left' | 'handed_in'
  result: QuickResult | null
}

type TestRow = typeof courseTest.$inferSelect
type AttemptRow = typeof testAttempt.$inferSelect

type LoadedQuestion = {
  id: string
  position: number
  kind: QuestionKind
  prompt: string
  /** Already resolved against the test's default mark. */
  mark: number
  options: { id: string; position: number; text: string; isCorrect: boolean }[]
}

const MAX_ID_LENGTH = 100
const MAX_EXITS_PER_CALL = 50
const MAX_REV = 1_000_000
const MAX_AWAY_MS = 86_400_000

// ---------------------------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------------------------

/** One error for every way a link can fail: nothing about the test leaks. */
function notYourCourse(): never {
  throw new AppError('FORBIDDEN', 'This test is not for one of your courses', { reason: 'not_your_course' })
}

function forbidden(): never {
  throw new AppError('FORBIDDEN', 'You do not have access to this attempt')
}

function invalid(field: 'answers' | 'exits' | 'deviceId'): never {
  throw new AppError('VALIDATION', 'Invalid input', { fields: [field] })
}

function openElsewhere(): never {
  throw new AppError('CONFLICT', 'This test is already open on another device', { reason: 'open_elsewhere' })
}

// ---------------------------------------------------------------------------------------------
// Input parsing (the actions validate too; services never trust their callers)
// ---------------------------------------------------------------------------------------------

function isId(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= MAX_ID_LENGTH
}

function parseDeviceId(value: unknown): string {
  if (!isId(value)) invalid('deviceId')
  return value
}

/** Shape-checks the answers and keeps the highest rev per question (one upsert row each). */
function parseAnswers(value: unknown): AnswerInput[] {
  if (!Array.isArray(value) || value.length > MAX_QUESTIONS) invalid('answers')
  const byQuestion = new Map<string, AnswerInput>()
  for (const raw of value as unknown[]) {
    if (typeof raw !== 'object' || raw === null) invalid('answers')
    const a = raw as Record<string, unknown>
    if (!isId(a.questionId)) invalid('answers')
    if (a.optionId !== null && !isId(a.optionId)) invalid('answers')
    if (a.text !== null && typeof a.text !== 'string') invalid('answers')
    if (typeof a.rev !== 'number' || !Number.isInteger(a.rev) || a.rev < 1 || a.rev > MAX_REV) invalid('answers')
    const answer: AnswerInput = {
      questionId: a.questionId,
      optionId: a.optionId as string | null,
      text: a.text as string | null,
      rev: a.rev,
    }
    const seen = byQuestion.get(answer.questionId)
    if (!seen || answer.rev > seen.rev) byQuestion.set(answer.questionId, answer)
  }
  return [...byQuestion.values()]
}

function parseExits(value: unknown): ExitReport[] {
  if (!Array.isArray(value) || value.length > MAX_EXITS_PER_CALL) invalid('exits')
  return (value as unknown[]).map((raw) => {
    if (typeof raw !== 'object' || raw === null) invalid('exits')
    const e = raw as Record<string, unknown>
    if (!isId(e.exitId) || (e.phase !== 'left' && e.phase !== 'back')) invalid('exits')
    const awayMs = e.awayMs ?? null
    if (
      awayMs !== null &&
      (typeof awayMs !== 'number' || !Number.isInteger(awayMs) || awayMs < 0 || awayMs > MAX_AWAY_MS)
    ) {
      invalid('exits')
    }
    // A `back` without its length is judged on the exit count only.
    return { exitId: e.exitId, phase: e.phase, awayMs: e.phase === 'back' ? awayMs : null }
  })
}

/**
 * Every answer must fit its question: an MCQ takes one of its own options (or none) and no text;
 * a short answer takes text up to SHORT_ANSWER_MAX (or none) and no option.
 */
function checkAgainstQuestions(answers: AnswerInput[], questions: LoadedQuestion[]): void {
  const byId = new Map(questions.map((q) => [q.id, q]))
  for (const a of answers) {
    const q = byId.get(a.questionId)
    if (!q) invalid('answers')
    if (q.kind === 'mcq') {
      if (a.text !== null) invalid('answers')
      if (a.optionId !== null && !q.options.some((o) => o.id === a.optionId)) invalid('answers')
    } else {
      if (a.optionId !== null) invalid('answers')
      if (a.text !== null && a.text.length > SHORT_ANSWER_MAX) invalid('answers')
    }
  }
}

// ---------------------------------------------------------------------------------------------
// Loaders (kept here: the authoring loaders belong to another module)
// ---------------------------------------------------------------------------------------------

/** Questions with their options per test, in the lecturer's order, marks resolved. Two queries. */
async function loadQuestionsByTest(db: Db, testIds: string[]): Promise<Map<string, LoadedQuestion[]>> {
  const result = new Map<string, LoadedQuestion[]>(testIds.map((id) => [id, []]))
  if (testIds.length === 0) return result
  const questions = await db
    .select({
      id: testQuestion.id,
      testId: testQuestion.testId,
      position: testQuestion.position,
      kind: testQuestion.kind,
      prompt: testQuestion.prompt,
      mark: testQuestion.mark,
      defaultMark: courseTest.defaultMark,
    })
    .from(testQuestion)
    .innerJoin(courseTest, eq(courseTest.id, testQuestion.testId))
    .where(inArray(testQuestion.testId, testIds))
    .orderBy(asc(testQuestion.testId), asc(testQuestion.position), asc(testQuestion.id))
  if (questions.length === 0) return result
  const options = await db
    .select({
      id: testOption.id,
      questionId: testOption.questionId,
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
    .orderBy(asc(testOption.questionId), asc(testOption.position), asc(testOption.id))
  const optionsByQuestion = new Map<string, LoadedQuestion['options']>()
  for (const o of options) {
    const list = optionsByQuestion.get(o.questionId) ?? []
    list.push({ id: o.id, position: o.position, text: o.text, isCorrect: o.isCorrect })
    optionsByQuestion.set(o.questionId, list)
  }
  for (const q of questions) {
    result.get(q.testId)!.push({
      id: q.id,
      position: q.position,
      kind: q.kind,
      prompt: q.prompt,
      mark: questionMark(q, q.defaultMark),
      options: optionsByQuestion.get(q.id) ?? [],
    })
  }
  return result
}

async function loadQuestions(db: Db, testId: string): Promise<LoadedQuestion[]> {
  return (await loadQuestionsByTest(db, [testId])).get(testId) ?? []
}

/** The test behind a link with its course, or null for a malformed or unknown code. */
async function findTestByCode(
  db: Db,
  rawCode: unknown,
): Promise<{ test: TestRow; courseTitle: string; lecturerId: string } | null> {
  if (typeof rawCode !== 'string' || rawCode.length > 50) return null
  const code = normalizeJoinCode(rawCode)
  if (!isWellFormedJoinCode(code)) return null
  const [row] = await db
    .select({ test: courseTest, courseTitle: course.title, lecturerId: course.lecturerId })
    .from(courseTest)
    .innerJoin(course, eq(course.id, courseTest.courseId))
    .where(eq(courseTest.code, code))
  return row ?? null
}

/** The calling student's view of a link: a rostered student, else FORBIDDEN not_your_course. */
async function requireTestForStudent(ctx: Ctx, code: unknown): Promise<{ test: TestRow; courseTitle: string }> {
  requireVerified(ctx)
  if (ctx.user.role !== 'student') notYourCourse()
  const found = await findTestByCode(ctx.db, code)
  if (!found || !(await isOnCourseRoster(ctx.db, found.test.courseId, ctx.user.id))) notYourCourse()
  return { test: found.test, courseTitle: found.courseTitle }
}

/** The calling student's own attempt (still on the roster), else FORBIDDEN. */
async function requireMyAttempt(
  ctx: Ctx,
  attemptId: unknown,
): Promise<{ test: TestRow; courseTitle: string; attempt: AttemptRow }> {
  requireRole(ctx, 'student')
  if (!isId(attemptId)) forbidden()
  const [row] = await ctx.db
    .select({ attempt: testAttempt, test: courseTest, courseTitle: course.title })
    .from(testAttempt)
    .innerJoin(courseTest, eq(courseTest.id, testAttempt.testId))
    .innerJoin(course, eq(course.id, courseTest.courseId))
    .where(and(eq(testAttempt.id, attemptId), eq(testAttempt.studentId, ctx.user.id)))
  if (!row || !(await isOnCourseRoster(ctx.db, row.test.courseId, ctx.user.id))) forbidden()
  return row
}

// ---------------------------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------------------------

function round2(n: number): number {
  return Math.round(n * 100) / 100
}

function infoOf(test: TestRow, courseTitle: string, questions: LoadedQuestion[]): TestInfo {
  return {
    title: test.title,
    courseTitle,
    durationMinutes: test.durationMinutes,
    questionCount: questions.length,
    totalMarks: round2(questions.reduce((sum, q) => sum + q.mark, 0)),
    rule: { maxExits: test.maxExits, maxAbsenceSeconds: test.maxAbsenceSeconds },
    hasShort: questions.some((q) => q.kind === 'short'),
  }
}

/** The paper in this student's order (when the test shuffles), without correct flags or guides. */
function paperFor(test: TestRow, seed: string, questions: LoadedQuestion[]): PaperQuestion[] {
  const byId = new Map(questions.map((q) => [q.id, q]))
  const ordered = test.shuffle
    ? orderFor(
        seed,
        questions.map((q) => q.id),
      ).map((id) => byId.get(id)!)
    : questions
  return ordered.map((q) => {
    const optionsById = new Map(q.options.map((o) => [o.id, o]))
    const options = test.shuffle
      ? orderFor(
          `${seed}:${q.id}`,
          q.options.map((o) => o.id),
        ).map((id) => optionsById.get(id)!)
      : q.options
    return {
      id: q.id,
      kind: q.kind,
      prompt: q.prompt,
      mark: q.mark,
      options: options.map((o) => ({ id: o.id, text: o.text })),
    }
  })
}

function toScoringQuestions(questions: LoadedQuestion[]): ScoringQuestion[] {
  return questions.map((q) => ({
    id: q.id,
    kind: q.kind,
    mark: q.mark,
    correctOptionId: q.options.find((o) => o.isCorrect)?.id ?? null,
  }))
}

function quickResult(questions: LoadedQuestion[], answers: Map<string, ScoringAnswer>): QuickResult {
  const s = scoreAttempt(toScoringQuestions(questions), answers)
  return { score: s.score, outOf: s.outOf, mcqCorrect: s.mcqCorrect, mcqCount: s.mcqCount }
}

/**
 * A hand-in is shown as such for good; otherwise the end for everyone wins (answers handed in as
 * they stand, derived from the test's end, never stored); then an ending for leaving.
 */
function stageOf(phase: TestPhase, attempt: AttemptRow | null): AttemptStage {
  if (!attempt) return phase === 'ended' ? 'over' : 'waiting'
  if (phase === 'not_started') return 'waiting'
  if (attempt.closedReason === 'handed_in') return 'handed_in'
  if (phase === 'ended') return 'over'
  if (attempt.closedReason === 'left') return 'ended_left'
  return 'answering'
}

function isReleased(test: TestRow, phase: TestPhase): boolean {
  return test.resultsReleasedAt !== null && phase === 'ended'
}

/**
 * Whether the student may see their total now: canSeeResult, and only once nothing they send can
 * change the attempt (a hand-in, or the answers final). Otherwise an answer sent in the grace with
 * a higher rev would move the total, and repeating that would reveal the answer key.
 */
function resultVisible(test: TestRow, attempt: AttemptRow, hasShort: boolean, phase: TestPhase, at: Date): boolean {
  if (acceptsAnswers(test, attempt, at)) return false
  return canSeeResult({ hasShort, phase, closedReason: attempt.closedReason, released: isReleased(test, phase) })
}

/**
 * Whether the device check applies: not once the attempt is handed in or the answers are final,
 * when nothing more can be written and any device may look at the outcome.
 */
function deviceMatters(test: TestRow, attempt: AttemptRow, at: Date): boolean {
  if (attempt.closedReason === 'handed_in') return false
  const finalAt = answersFinalAt(test)
  return finalAt === null || at.getTime() < finalAt.getTime()
}

// ---------------------------------------------------------------------------------------------
// Writes
// ---------------------------------------------------------------------------------------------

/**
 * Makes `deviceId` the active device: kept when it already is, or when the active one has been
 * silent for DEVICE_STALE_MS; otherwise CONFLICT open_elsewhere. One conditional update, so two
 * devices racing cannot both win.
 */
async function claimDevice(db: Db, attemptId: string, deviceId: string, at: Date): Promise<AttemptRow> {
  const [row] = await db
    .update(testAttempt)
    .set({ deviceId, deviceSeenAt: at })
    .where(
      and(
        eq(testAttempt.id, attemptId),
        or(eq(testAttempt.deviceId, deviceId), lte(testAttempt.deviceSeenAt, new Date(at.getTime() - DEVICE_STALE_MS))),
      ),
    )
    .returning()
  if (!row) openElsewhere()
  return row
}

/**
 * Keeps each answer whose rev is higher than the stored one, when the attempt still accepts
 * answers; outside the window they are dropped silently. Returns the revs acknowledged (the server
 * now holds that rev or a later one). An answer whose option or text changes loses any mark or
 * suggestion it had; a re-send of the same content keeps them.
 */
async function saveAnswers(
  db: Db,
  test: TestRow,
  attempt: AttemptRow,
  answers: AnswerInput[],
  at: Date,
): Promise<Record<string, number>> {
  const acceptedRevs: Record<string, number> = {}
  if (answers.length === 0 || !acceptsAnswers(test, attempt, at)) return acceptedRevs
  const changed = sql`(${testAnswer.optionId} is distinct from excluded.option_id or ${testAnswer.text} is distinct from excluded.text)`
  const clearIfChanged = (column: Column) => sql`case when ${changed} then null else ${column} end`
  await db
    .insert(testAnswer)
    .values(
      answers.map((a) => ({
        attemptId: attempt.id,
        questionId: a.questionId,
        optionId: a.optionId,
        text: a.text,
        rev: a.rev,
        receivedAt: at,
      })),
    )
    .onConflictDoUpdate({
      target: [testAnswer.attemptId, testAnswer.questionId],
      set: {
        optionId: sql`excluded.option_id`,
        text: sql`excluded.text`,
        rev: sql`excluded.rev`,
        receivedAt: sql`excluded.received_at`,
        mark: clearIfChanged(testAnswer.mark),
        comment: clearIfChanged(testAnswer.comment),
        markedBy: clearIfChanged(testAnswer.markedBy),
        markedAt: clearIfChanged(testAnswer.markedAt),
        suggestedMark: clearIfChanged(testAnswer.suggestedMark),
        suggestedReason: clearIfChanged(testAnswer.suggestedReason),
        suggestedAt: clearIfChanged(testAnswer.suggestedAt),
      },
      setWhere: sql`excluded.rev > ${testAnswer.rev}`,
    })
  for (const a of answers) acceptedRevs[a.questionId] = a.rev
  return acceptedRevs
}

/**
 * Applies exit reports in order, only while the attempt is open and the test running. Each exit is
 * counted on its first report (`left`, or `back` when `left` never arrived) and judged with the
 * count; a `back` also stores the absence (capped at how long the test has been running) and judges
 * it. Reports are idempotent per exitId. An
 * ending closes the attempt (`left`) and logs `ended_left`; later reports are ignored.
 */
async function applyExits(
  db: Db,
  test: TestRow,
  attempt: AttemptRow,
  exits: ExitReport[],
  at: Date,
): Promise<AttemptRow> {
  if (exits.length === 0 || attempt.closedAt !== null || testPhase(test, at) !== 'running') return attempt
  const rule: LeavingRule = { maxExits: test.maxExits, maxAbsenceSeconds: test.maxAbsenceSeconds }
  // Nobody can have been away longer than the test has been running (startedAt is set: running).
  const runningMs = Math.max(0, at.getTime() - test.startedAt!.getTime())
  const capAway = (awayMs: number | null) => (awayMs === null ? null : Math.min(awayMs, runningMs))

  const known = new Map(
    (
      await db
        .select({ exitId: testExit.exitId, returnedAt: testExit.returnedAt })
        .from(testExit)
        .where(
          and(
            eq(testExit.attemptId, attempt.id),
            inArray(testExit.exitId, [...new Set(exits.map((e) => e.exitId))]),
          ),
        )
    ).map((e) => [e.exitId, { returned: e.returnedAt !== null }]),
  )
  const [{ total }] = await db.select({ total: count() }).from(testExit).where(eq(testExit.attemptId, attempt.id))
  let exitNumber = total
  let exitsSinceReopen = attempt.exitsSinceReopen
  let verdict: ReturnType<typeof judgeExit> = 'continue'

  for (const e of exits) {
    const seen = known.get(e.exitId)
    const back = e.phase === 'back'
    const awayMs = capAway(e.awayMs)
    if (!seen) {
      exitNumber += 1
      exitsSinceReopen += 1
      await db.insert(testExit).values({
        attemptId: attempt.id,
        exitId: e.exitId,
        exitNumber,
        firstReportedAt: at,
        awayMs: back ? awayMs : null,
        returnedAt: back ? at : null,
      })
      known.set(e.exitId, { returned: back })
      verdict = judgeExit(rule, exitsSinceReopen, back ? awayMs : null)
    } else if (back && !seen.returned) {
      await db
        .update(testExit)
        .set({ awayMs, returnedAt: at })
        .where(and(eq(testExit.attemptId, attempt.id), eq(testExit.exitId, e.exitId)))
      seen.returned = true
      verdict = judgeExit(rule, exitsSinceReopen, awayMs)
    }
    if (verdict !== 'continue') break
  }

  const ended = verdict !== 'continue'
  if (exitsSinceReopen === attempt.exitsSinceReopen && !ended) return attempt
  const [updated] = await db
    .update(testAttempt)
    .set(ended ? { exitsSinceReopen, closedAt: at, closedReason: 'left' } : { exitsSinceReopen })
    .where(eq(testAttempt.id, attempt.id))
    .returning()
  if (ended) await db.insert(testLog).values({ attemptId: attempt.id, kind: 'ended_left', at })
  return updated
}

// ---------------------------------------------------------------------------------------------
// View
// ---------------------------------------------------------------------------------------------

/**
 * The student's view. `full` (the default) carries the paper and the saved answers; a lean view
 * (a sync that did not ask for them) leaves both out, so a heartbeat costs a few hundred bytes
 * and skips the shuffle.
 */
async function buildView(
  db: Db,
  test: TestRow,
  courseTitle: string,
  questions: LoadedQuestion[],
  attempt: AttemptRow | null,
  at: Date,
): Promise<AttemptView>
async function buildView(
  db: Db,
  test: TestRow,
  courseTitle: string,
  questions: LoadedQuestion[],
  attempt: AttemptRow | null,
  at: Date,
  full: boolean,
): Promise<AttemptView | LeanView>
async function buildView(
  db: Db,
  test: TestRow,
  courseTitle: string,
  questions: LoadedQuestion[],
  attempt: AttemptRow | null,
  at: Date,
  full = true,
): Promise<AttemptView | LeanView> {
  const phase = testPhase(test, at)
  const stage = stageOf(phase, attempt)
  const info = infoOf(test, courseTitle, questions)
  const base = {
    attemptId: attempt?.id ?? null,
    stage,
    info,
    endsAt: endsAt(test),
    serverNow: at,
    exitsSoFar: attempt?.exitsSinceReopen ?? 0,
  }
  if (!attempt) {
    const none = { ...base, result: null, awaitingRelease: false }
    return full ? { ...none, paper: null, saved: [] } : none
  }

  const released = isReleased(test, phase)
  const done = stage === 'handed_in' || stage === 'over'
  const visible = done && resultVisible(test, attempt, info.hasShort, phase, at)
  const rows =
    full || visible
      ? await db
          .select({
            questionId: testAnswer.questionId,
            optionId: testAnswer.optionId,
            text: testAnswer.text,
            rev: testAnswer.rev,
            mark: testAnswer.mark,
          })
          .from(testAnswer)
          .where(eq(testAnswer.attemptId, attempt.id))
      : []
  const lean: LeanView = {
    ...base,
    result: visible ? quickResult(questions, new Map(rows.map((r) => [r.questionId, r]))) : null,
    awaitingRelease: done && info.hasShort && !released,
  }
  if (!full) return lean
  const position = new Map(questions.map((q) => [q.id, q.position]))
  rows.sort((a, b) => (position.get(a.questionId) ?? 0) - (position.get(b.questionId) ?? 0))
  return {
    ...lean,
    paper: stage === 'answering' ? paperFor(test, attempt.seed, questions) : null,
    saved: rows.map((r) => ({ questionId: r.questionId, optionId: r.optionId, text: r.text, rev: r.rev })),
  }
}

// ---------------------------------------------------------------------------------------------
// Services
// ---------------------------------------------------------------------------------------------

/**
 * Who a `/t/<code>` link is for: its course's lecturer (owner) or a rostered student. A malformed
 * or unknown code, a student off the roster and any other lecturer get the same FORBIDDEN
 * { reason: 'not_your_course' }.
 */
export async function resolveTestLink(
  ctx: Ctx,
  code: string,
): Promise<{ role: 'owner'; courseId: string; testId: string } | { role: 'student'; testId: string }> {
  requireVerified(ctx)
  const found = await findTestByCode(ctx.db, code)
  if (!found) notYourCourse()
  if (ctx.user.role === 'lecturer') {
    if (found.lecturerId !== ctx.user.id) notYourCourse()
    return { role: 'owner', courseId: found.test.courseId, testId: found.test.id }
  }
  if (!(await isOnCourseRoster(ctx.db, found.test.courseId, ctx.user.id))) notYourCourse()
  return { role: 'student', testId: found.test.id }
}

/**
 * Opens the test for a rostered student. The attempt (with its random shuffle seed) is created at
 * the first open, unless the test has already ended (then `over` with no attempt). Another device
 * heard from within DEVICE_STALE_MS is CONFLICT open_elsewhere; otherwise this device becomes the
 * active one.
 */
export async function openTest(ctx: Ctx, code: string, deviceId: string): Promise<AttemptView> {
  const { test, courseTitle } = await requireTestForStudent(ctx, code)
  const device = parseDeviceId(deviceId)
  const at = now()
  const questions = await loadQuestions(ctx.db, test.id)

  const mine = and(eq(testAttempt.testId, test.id), eq(testAttempt.studentId, ctx.user.id))
  let [attempt] = await ctx.db.select().from(testAttempt).where(mine)
  if (!attempt) {
    if (testPhase(test, at) === 'ended') return buildView(ctx.db, test, courseTitle, questions, null, at)
    // The unique (test, student) key: two first opens racing make one attempt.
    const [created] = await ctx.db
      .insert(testAttempt)
      .values({
        testId: test.id,
        studentId: ctx.user.id,
        seed: crypto.randomUUID(),
        deviceId: device,
        deviceSeenAt: at,
        joinedAt: at,
      })
      .onConflictDoNothing({ target: [testAttempt.testId, testAttempt.studentId] })
      .returning()
    if (created) return buildView(ctx.db, test, courseTitle, questions, created, at)
    ;[attempt] = await ctx.db.select().from(testAttempt).where(mine)
  }
  if (deviceMatters(test, attempt, at)) attempt = await claimDevice(ctx.db, attempt.id, device, at)
  return buildView(ctx.db, test, courseTitle, questions, attempt, at)
}

/** Everything syncAttempt and handIn share: checks, the device, then answers before exits. */
async function writeAttempt(
  ctx: Ctx,
  attemptId: string,
  input: { deviceId: string; answers: AnswerInput[]; exits: ExitReport[] },
  close: boolean,
): Promise<{
  test: TestRow
  courseTitle: string
  questions: LoadedQuestion[]
  attempt: AttemptRow
  acceptedRevs: Record<string, number>
  at: Date
  /** True only for the call that closed the attempt as handed in. */
  handedInNow: boolean
}> {
  const { test, courseTitle } = await requireMyAttempt(ctx, attemptId)
  const deviceId = parseDeviceId(input?.deviceId)
  const answers = parseAnswers(input?.answers)
  const exits = parseExits(input?.exits)
  const questions = await loadQuestions(ctx.db, test.id)
  checkAgainstQuestions(answers, questions)
  const at = now()
  if (close && testPhase(test, at) === 'not_started') {
    throw new AppError('CONFLICT', 'The test has not started', { reason: 'not_started' })
  }

  const { attempt, acceptedRevs, handedInNow } = await ctx.db.transaction(async (tx) => {
    // One write at a time per attempt, so exits are numbered and counted once.
    const [locked] = await tx.select().from(testAttempt).where(eq(testAttempt.id, attemptId)).for('update')
    if (!locked) forbidden()
    // A hand-in is final: nothing more is written, whichever device asks.
    if (locked.closedReason === 'handed_in') return { attempt: locked, acceptedRevs: {}, handedInNow: false }
    let attempt = locked
    if (deviceMatters(test, attempt, at)) attempt = await claimDevice(tx, attempt.id, deviceId, at)
    const acceptedRevs = await saveAnswers(tx, test, attempt, answers, at)
    attempt = await applyExits(tx, test, attempt, exits, at)
    // Handing in closes an open attempt while the test runs. Once the test has ended for everyone
    // the hand-in stays derived from the end (never stored), so grace answers are not refused.
    if (close && attempt.closedAt === null && testPhase(test, at) === 'running') {
      ;[attempt] = await tx
        .update(testAttempt)
        .set({ closedAt: at, closedReason: 'handed_in' })
        .where(eq(testAttempt.id, attempt.id))
        .returning()
      await tx.insert(testLog).values({ attemptId: attempt.id, kind: 'handed_in', at })
      return { attempt, acceptedRevs, handedInNow: true }
    }
    return { attempt, acceptedRevs, handedInNow: false }
  })
  return { test, courseTitle, questions, attempt, acceptedRevs, at, handedInNow }
}

/**
 * The student's heartbeat: my attempt only (else FORBIDDEN); the active-device check; then answers
 * (kept while the attempt accepts them and the rev is higher than the stored one; an answer that
 * does not fit its question is VALIDATION { fields: ['answers'] }); then exit reports.
 */
export async function syncAttempt(ctx: Ctx, attemptId: string, input: SyncInput): Promise<SyncView> {
  const w = await writeAttempt(ctx, attemptId, input, false)
  const view = await buildView(ctx.db, w.test, w.courseTitle, w.questions, w.attempt, w.at, input?.withPaper === true)
  return { ...view, acceptedRevs: w.acceptedRevs }
}

/**
 * Saves the answers like syncAttempt, then closes the attempt as handed in and logs it. Already
 * handed in: the view, unchanged. Ended for leaving: answers within its grace are saved, the
 * ending stays. Before Start: CONFLICT not_started. The hand-in that closes the attempt emails the
 * student a receipt after the response (best effort, never failing the hand-in).
 */
export async function handIn(
  ctx: Ctx,
  attemptId: string,
  input: { deviceId: string; answers: AnswerInput[] },
): Promise<AttemptView> {
  const w = await writeAttempt(ctx, attemptId, { deviceId: input?.deviceId, answers: input?.answers, exits: [] }, true)
  if (w.handedInNow) {
    await queueNotifications('handIn', async () => handedInEmails(ctx, w.test, w.courseTitle, w.at))
  }
  return buildView(ctx.db, w.test, w.courseTitle, w.questions, w.attempt, w.at)
}

/** The student's receipt for handing in, in their own language: the test, the course and the time, never marks. */
function handedInEmails(ctx: Ctx, test: TestRow, courseTitle: string, at: Date): Notification[] {
  const me = ctx.user
  return [
    {
      to: me.email,
      locale: me.locale,
      subject: emailSubject('testHandedIn', me.locale, { courseTitle, testTitle: test.title }),
      react: createElement(TestHandedInEmail, {
        locale: me.locale,
        studentName: me.name,
        courseTitle,
        testTitle: test.title,
        handedInAt: at,
        url: appLinkBuilder('handIn')(`/t/${encodeURIComponent(test.code)}`),
        timeZone: config.timeZone,
      }),
    },
  ]
}

/** The course's tests with my status and (when visible) my quick result, newest first. */
export async function listMyTests(ctx: Ctx, courseId: string): Promise<MyTestItem[]> {
  requireRole(ctx, 'student')
  if (!isId(courseId) || !(await isOnCourseRoster(ctx.db, courseId, ctx.user.id))) {
    throw new AppError('FORBIDDEN', 'You do not have access to this course')
  }
  const tests = await ctx.db
    .select()
    .from(courseTest)
    .where(eq(courseTest.courseId, courseId))
    .orderBy(desc(courseTest.createdAt), desc(courseTest.id))
  if (tests.length === 0) return []
  const testIds = tests.map((t) => t.id)

  const [questionsByTest, attempts] = await Promise.all([
    loadQuestionsByTest(ctx.db, testIds),
    ctx.db
      .select()
      .from(testAttempt)
      .where(and(inArray(testAttempt.testId, testIds), eq(testAttempt.studentId, ctx.user.id))),
  ])
  const attemptByTest = new Map(attempts.map((a) => [a.testId, a]))
  const answers =
    attempts.length === 0
      ? []
      : await ctx.db
          .select({
            attemptId: testAnswer.attemptId,
            questionId: testAnswer.questionId,
            optionId: testAnswer.optionId,
            text: testAnswer.text,
            mark: testAnswer.mark,
          })
          .from(testAnswer)
          .where(
            inArray(
              testAnswer.attemptId,
              attempts.map((a) => a.id),
            ),
          )
  const answersByAttempt = new Map<string, Map<string, ScoringAnswer>>()
  for (const a of answers) {
    const map = answersByAttempt.get(a.attemptId) ?? new Map<string, ScoringAnswer>()
    map.set(a.questionId, a)
    answersByAttempt.set(a.attemptId, map)
  }

  const at = now()
  return tests.map((t) => {
    const questions = questionsByTest.get(t.id) ?? []
    const hasShort = questions.some((q) => q.kind === 'short')
    const phase = testPhase(t, at)
    const attempt = attemptByTest.get(t.id) ?? null
    let myStatus: MyTestItem['myStatus'] = 'not_joined'
    if (attempt) {
      if (attempt.closedReason === 'handed_in') myStatus = 'handed_in'
      else if (phase === 'ended') myStatus = 'handed_in'
      else if (attempt.closedReason === 'left') myStatus = 'ended_left'
      else myStatus = 'working'
    }
    const visible = attempt !== null && phase !== 'not_started' && resultVisible(t, attempt, hasShort, phase, at)
    return {
      testId: t.id,
      code: t.code,
      title: t.title,
      state: testState({ ...t, hasShort }, at),
      myStatus,
      result: visible ? quickResult(questions, answersByAttempt.get(attempt.id) ?? new Map()) : null,
    }
  })
}
