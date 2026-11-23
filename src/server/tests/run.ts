import { and, asc, eq, getTableColumns, gt, isNull, sql } from 'drizzle-orm'
import { now } from '@/server/core/clock'
import type { Ctx } from '@/server/core/context'
import { AppError } from '@/server/core/errors'
import { requireRole } from '@/server/core/guards'
import { courseRosterQuery } from '@/server/courses/roster'
import { requireCourseOwner } from '@/server/courses/service'
import type { Db } from '@/server/db'
import { courseTest, testAnswer, testAttempt, testExit, testLog, testQuestion } from '@/server/db/schema'
import { pushTestStarted } from '@/server/push/course-events'
import { queueWhatsApp, WHATSAPP_FALLBACK_DELAY_MS } from '@/server/whatsapp/trigger'
import { summarizeTest, type TestSummary } from './authoring'
import { eligibleStudents, onlyEligible, satAttempts } from './catch-up'
import { endsAt, testPhase, testState, type TestPhase, type TestState } from './phase'
import { requireOwnedTest, type TestRow } from './queries'
import { loadTestScores } from './scores'

type CloseReason = 'handed_in' | 'left'

export type LiveStatus = 'not_joined' | 'waiting' | 'working' | 'away' | 'ended' | 'handed_in'

/** `exits` counts every exit of the attempt (for the log); the leaving rule uses `exitsSinceReopen`. */
export type LiveRow = {
  studentId: string
  name: string
  matricule: string | null
  attemptId: string | null
  status: LiveStatus
  answered: number
  exits: number
}

/** `counts.working` includes students who are away; joined = waiting + working + handedIn + endedLeaving. */
export type LiveTest = {
  testId: string
  courseId: string
  code: string
  title: string
  phase: TestPhase
  endsAt: Date | null
  serverNow: Date
  questionCount: number
  counts: { roster: number; joined: number; working: number; handedIn: number; endedLeaving: number }
  rows: LiveRow[]
}

export type LogEntry = {
  at: Date
  kind: 'exit' | 'ended_left' | 'reopened' | 'handed_in'
  exitNumber: number | null
  awayMs: number | null
}

export type ResultRow = {
  studentId: string
  name: string
  matricule: string | null
  status: LiveStatus
  score: number
  outOf: number
  pendingShort: number
  /** On an original's results: the catch-up this student sat (the latest one); null otherwise, and always on a catch-up's own results. */
  catchUp: { testId: string; title: string; score: number; outOf: number; pendingShort: number } | null
}

function forbidden(): never {
  throw new AppError('FORBIDDEN', 'Only the lecturer of this course can do this')
}

function conflict(reason: string, message: string): never {
  throw new AppError('CONFLICT', message, { reason })
}

/** Owner-only lookup of an attempt, through its test's course. Nonexistent is FORBIDDEN too. */
async function requireOwnedAttempt(
  ctx: Ctx,
  attemptId: string,
): Promise<{ attempt: typeof testAttempt.$inferSelect; test: TestRow }> {
  requireRole(ctx, 'lecturer')
  if (typeof attemptId !== 'string' || attemptId.length === 0) forbidden()
  const [found] = await ctx.db
    .select({ attempt: testAttempt, test: courseTest })
    .from(testAttempt)
    .innerJoin(courseTest, eq(courseTest.id, testAttempt.testId))
    .where(eq(testAttempt.id, attemptId))
  if (!found) forbidden()
  await requireCourseOwner(ctx, found.test.courseId)
  return found
}

type AttemptState = {
  id: string
  studentId: string
  closedReason: CloseReason | null
  answered: number
  exits: number
  openExit: boolean
}

/** Every attempt of the test with its answer and exit counts. One query, however many attempts. */
async function loadAttemptStates(db: Db, testId: string): Promise<Map<string, AttemptState>> {
  const rows = await db
    .select({
      id: testAttempt.id,
      studentId: testAttempt.studentId,
      closedReason: testAttempt.closedReason,
      // Drizzle prints columns unqualified in a single-table select, so the correlated subqueries
      // spell out their aliases and the outer table: a bare "id" would bind to the inner table
      // the day it gets an id column.
      // An answer counts once it has an option or some non-blank text.
      answered: sql<number>`(select count(*)::int from ${testAnswer} as ans
        where ans.attempt_id = ${testAttempt}.id
          and (ans.option_id is not null or ans.text ~ '\\S'))`,
      exits: sql<number>`(select count(*)::int from ${testExit} as ex where ex.attempt_id = ${testAttempt}.id)`,
      openExit: sql<boolean>`exists (select 1 from ${testExit} as ex
        where ex.attempt_id = ${testAttempt}.id and ex.returned_at is null)`,
    })
    .from(testAttempt)
    .where(eq(testAttempt.testId, testId))
  return new Map(rows.map((r) => [r.studentId, r]))
}

/**
 * A student's status. Closed attempts keep their reason; an open attempt reads waiting before
 * Start, away with an exit not yet returned from, and handed in once the test has ended (derived,
 * never stored, so answers in the grace still count).
 */
function liveStatus(phase: TestPhase, attempt: AttemptState | undefined): LiveStatus {
  if (!attempt) return 'not_joined'
  if (attempt.closedReason === 'left') return 'ended'
  if (attempt.closedReason === 'handed_in') return 'handed_in'
  if (phase === 'not_started') return 'waiting'
  if (phase === 'ended') return 'handed_in'
  return attempt.openExit ? 'away' : 'working'
}

/** Start: the deadline is fixed once, at now + duration. Starting again changes nothing. */
export async function startTest(ctx: Ctx, testId: string): Promise<TestSummary> {
  await requireOwnedTest(ctx, testId)
  const at = now()
  const [started] = await ctx.db
    .update(courseTest)
    .set({
      startedAt: at,
      deadlineAt: sql`${at.toISOString()}::timestamptz + make_interval(mins => ${courseTest.durationMinutes})`,
      updatedAt: at,
    })
    .where(and(eq(courseTest.id, testId), isNull(courseTest.startedAt)))
    .returning()
  // Already started (a double click, or a retry): the first Start stands.
  const row = started ?? (await ctx.db.select().from(courseTest).where(eq(courseTest.id, testId)))[0]
  // Deleted after the owner check: the same answer as any missing test.
  if (!row) forbidden()
  // Only the first Start announces the test.
  if (started) {
    // A catch-up announces itself only to the students who may sit it. They are worked out while
    // the push is prepared (from the roster it loads), where a failure is logged, not thrown.
    const eligibleOf =
      row.catchUpOfId === null ? undefined : (studentIds: string[]) => eligibleStudents(ctx.db, row, studentIds)
    await pushTestStarted(ctx.db, row.courseId, { id: row.id, title: row.title, code: row.code }, eligibleOf)
    queueWhatsApp({ kind: 'testStarted', testId: row.id }, new Date(at.getTime() + WHATSAPP_FALLBACK_DELAY_MS))
  }
  return summarizeTest(ctx.db, row)
}

/** Ends the test for everyone now. Before Start → CONFLICT not_started; once ended, a no-op. */
export async function endTestForEveryone(ctx: Ctx, testId: string): Promise<void> {
  const { test: row } = await requireOwnedTest(ctx, testId)
  const at = now()
  if (testPhase(row, at) === 'not_started') conflict('not_started', 'The test has not started')
  // Only while running: not already ended, deadline not yet passed. Attempts are left as they are.
  await ctx.db
    .update(courseTest)
    .set({ endedAt: at, updatedAt: at })
    .where(and(eq(courseTest.id, testId), isNull(courseTest.endedAt), gt(courseTest.deadlineAt, at)))
}

/**
 * The live view: every roster student with their status (a catch-up: every roster student who
 * may sit it). A fixed number of queries.
 */
export async function getLiveTest(ctx: Ctx, testId: string): Promise<LiveTest> {
  const { test: row } = await requireOwnedTest(ctx, testId)
  const at = now()
  const phase = testPhase(row, at)
  const [fullRoster, [questions], attempts] = await Promise.all([
    courseRosterQuery(ctx.db, { courseId: row.courseId }),
    ctx.db
      .select({ count: sql<number>`count(*)::int` })
      .from(testQuestion)
      .where(eq(testQuestion.testId, testId)),
    loadAttemptStates(ctx.db, testId),
  ])
  const roster = await onlyEligible(ctx.db, row, fullRoster)

  const counts = { roster: roster.length, joined: 0, working: 0, handedIn: 0, endedLeaving: 0 }
  const rows: LiveRow[] = roster.map((student) => {
    const attempt = attempts.get(student.studentId)
    const status = liveStatus(phase, attempt)
    if (attempt) counts.joined += 1
    if (status === 'working' || status === 'away') counts.working += 1
    else if (status === 'handed_in') counts.handedIn += 1
    else if (status === 'ended') counts.endedLeaving += 1
    return {
      studentId: student.studentId,
      name: student.name,
      matricule: student.matricule,
      attemptId: attempt?.id ?? null,
      status,
      answered: attempt?.answered ?? 0,
      exits: attempt?.exits ?? 0,
    }
  })

  return {
    testId: row.id,
    courseId: row.courseId,
    code: row.code,
    title: row.title,
    phase,
    endsAt: endsAt(row),
    serverNow: at,
    questionCount: questions?.count ?? 0,
    counts,
    rows,
  }
}

/**
 * Lets a student ended for leaving back in: same answers, same deadline, exit counter reset. Any
 * exit still open is closed now, and the reopening is logged with who did it.
 */
export async function letBackIn(ctx: Ctx, attemptId: string): Promise<void> {
  const { attempt, test } = await requireOwnedAttempt(ctx, attemptId)
  if (attempt.closedReason !== 'left') conflict('not_ended', 'This student was not ended for leaving')
  const at = now()
  if (testPhase(test, at) !== 'running') conflict('test_over', 'The test is over')

  await ctx.db.transaction(async (tx) => {
    // Again inside the transaction: the test may have been ended since the check above.
    const [current] = await tx.select().from(courseTest).where(eq(courseTest.id, test.id))
    if (!current || testPhase(current, at) !== 'running') conflict('test_over', 'The test is over')
    const reopened = await tx
      .update(testAttempt)
      .set({ closedAt: null, closedReason: null, exitsSinceReopen: 0 })
      .where(and(eq(testAttempt.id, attemptId), eq(testAttempt.closedReason, 'left')))
      .returning({ id: testAttempt.id })
    // Someone let them back in a moment ago.
    if (reopened.length === 0) conflict('not_ended', 'This student was not ended for leaving')
    await tx
      .update(testExit)
      .set({ returnedAt: at })
      .where(and(eq(testExit.attemptId, attemptId), isNull(testExit.returnedAt)))
    await tx.insert(testLog).values({ attemptId, kind: 'reopened', at, byUserId: ctx.user.id })
  })
}

/** Exits, endings, reopenings and the hand-in of one attempt, oldest first. */
export async function getAttemptLog(ctx: Ctx, attemptId: string): Promise<LogEntry[]> {
  await requireOwnedAttempt(ctx, attemptId)
  const [exits, logs] = await Promise.all([
    ctx.db
      .select({ at: testExit.firstReportedAt, exitNumber: testExit.exitNumber, awayMs: testExit.awayMs })
      .from(testExit)
      .where(eq(testExit.attemptId, attemptId))
      .orderBy(asc(testExit.firstReportedAt), asc(testExit.exitNumber)),
    ctx.db
      .select({ at: testLog.at, kind: testLog.kind })
      .from(testLog)
      .where(eq(testLog.attemptId, attemptId))
      .orderBy(asc(testLog.at), asc(testLog.id)),
  ])
  const entries: LogEntry[] = [
    ...exits.map((e) => ({ at: e.at, kind: 'exit' as const, exitNumber: e.exitNumber, awayMs: e.awayMs })),
    ...logs.map((l) => ({ at: l.at, kind: l.kind, exitNumber: null, awayMs: null })),
  ]
  // Stable: at the same instant an exit comes before the ending it caused.
  return entries.sort((a, b) => a.at.getTime() - b.at.getTime())
}

export type CatchUpRef = { id: string; title: string; state: TestState }

/**
 * Every roster student's score once the test has ended (CONFLICT not_ended before); a catch-up
 * lists only the students who may sit it. An original also carries each catch-up of it, and per
 * student the catch-up they sat (an attempt with at least one answer; the latest if several).
 */
export async function getTestResults(
  ctx: Ctx,
  testId: string,
): Promise<{ test: TestSummary; rows: ResultRow[]; pending: number; catchUps: CatchUpRef[] }> {
  const { test: row } = await requireOwnedTest(ctx, testId)
  const at = now()
  const phase = testPhase(row, at)
  if (phase !== 'ended') conflict('not_ended', 'The test has not ended')

  const isCatchUp = row.catchUpOfId !== null
  const [summary, fullRoster, attempts, catchUpRows] = await Promise.all([
    summarizeTest(ctx.db, row),
    courseRosterQuery(ctx.db, { courseId: row.courseId }),
    loadAttemptStates(ctx.db, testId),
    isCatchUp
      ? []
      : ctx.db
          .select({
            ...getTableColumns(courseTest),
            // Aliased, with the outer table spelled out: a bare "id" would bind to the inner table.
            hasShort: sql<boolean>`exists (select 1 from ${testQuestion} as tq
              where tq.test_id = ${courseTest}.id and tq.kind = 'short')`,
          })
          .from(courseTest)
          .where(eq(courseTest.catchUpOfId, testId))
          .orderBy(asc(courseTest.createdAt), asc(courseTest.id)),
  ])
  const roster = await onlyEligible(ctx.db, row, fullRoster)
  const studentIds = roster.map((r) => r.studentId)
  const catchUpIds = catchUpRows.map((c) => c.id)
  // The original's scores and its catch-ups' come from the same two queries.
  const [allScores, sat] = await Promise.all([
    loadTestScores(ctx.db, [testId, ...catchUpIds], studentIds),
    satAttempts(ctx.db, catchUpIds),
  ])
  const scores = allScores.get(testId)!
  const catchUpTitles = new Map(catchUpRows.map((c) => [c.id, c.title]))

  /** The catch-up this student sat: the one whose attempt joined latest. */
  function catchUpOf(studentId: string): ResultRow['catchUp'] {
    let latest: { testId: string; joinedAt: Date } | null = null
    for (const id of catchUpIds) {
      const joinedAt = sat.get(id)?.get(studentId)?.joinedAt
      if (joinedAt && (!latest || joinedAt.getTime() > latest.joinedAt.getTime())) latest = { testId: id, joinedAt }
    }
    if (!latest) return null
    const score = allScores.get(latest.testId)?.get(studentId)
    if (!score) return null
    return {
      testId: latest.testId,
      title: catchUpTitles.get(latest.testId) ?? '',
      score: score.score,
      outOf: score.outOf,
      pendingShort: score.pendingShort,
    }
  }

  let pending = 0
  const rows: ResultRow[] = roster.map((student) => {
    const score = scores.get(student.studentId)!
    pending += score.pendingShort
    return {
      studentId: student.studentId,
      name: student.name,
      matricule: student.matricule,
      status: liveStatus(phase, attempts.get(student.studentId)),
      score: score.score,
      outOf: score.outOf,
      pendingShort: score.pendingShort,
      catchUp: catchUpOf(student.studentId),
    }
  })
  const catchUps = catchUpRows.map((c) => ({
    id: c.id,
    title: c.title,
    state: testState(c, at),
  }))
  return { test: summary, rows, pending, catchUps }
}
