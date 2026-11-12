import { PGlite } from '@electric-sql/pglite'
import { eq } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/pglite'
import { migrate } from 'drizzle-orm/pglite/migrator'
import path from 'node:path'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { setNowForTests } from '@/server/core/clock'
import type { Ctx } from '@/server/core/context'
import type { Db } from '@/server/db'
import * as schema from '@/server/db/schema'
import {
  class_,
  classLecturer,
  classStudent,
  course,
  courseRosterAdjustment,
  courseTest,
  school,
  testAnswer,
  testAttempt,
  testExit,
  testLog,
  testOption,
  testQuestion,
  user,
} from '@/server/db/schema'
import { createClass, joinClassAsLecturer, joinClassAsStudent } from '@/server/classes/service'
import { createCourse, setRosterAdjustment } from '@/server/courses/service'
import { createSchool } from '@/server/schools/service'
import { ctxFor, makeUser } from '@/test/factories'
import { racing } from '@/test/race'
import {
  endTestForEveryone,
  getAttemptLog,
  getLiveTest,
  getTestResults,
  letBackIn,
  startTest,
} from './run'
import { sendPush } from '@/server/push/send'
import { loadTestScores } from './scores'

vi.mock('@/server/push/send', () => {
  const sendPush = vi.fn(async (items: unknown[]) => ({ sent: 0, skipped: items.length, failed: 0, removed: 0 }))
  return {
    sendPush,
    queuePush: vi.fn(async (_context: string, build: () => Promise<unknown[]>) => {
      await sendPush(await build())
    }),
  }
})

const MIN = 60_000
/** Statements per call; a change here should be deliberate. */
const LIVE_QUERIES = 5
const SCORE_QUERIES = 2
const T0 = new Date('2026-11-09T08:00:00Z')
const at = (minutes: number) => new Date(T0.getTime() + minutes * MIN)

// Every statement goes through this logger, so a test can count them (and read the last ones).
let queryCount = 0
let recentQueries: string[] = []

async function createCountingTestDb(): Promise<Db> {
  const client = new PGlite()
  const db = drizzle(client, {
    schema,
    logger: {
      logQuery: (query: string) => {
        queryCount++
        recentQueries = [...recentQueries.slice(-19), query]
      },
    },
  })
  await migrate(db, { migrationsFolder: path.resolve(process.cwd(), 'drizzle') })
  return db as unknown as Db
}

async function countQueries(fn: () => Promise<unknown>): Promise<number> {
  const before = queryCount
  await fn()
  return queryCount - before
}

function setClock(when: Date) {
  setNowForTests(() => when)
}

/** A 6-char code; uniqueness is all that matters here. */
const newCode = () => crypto.randomUUID().replace(/-/g, '').slice(0, 6).toUpperCase()

describe('running a test (lecturer)', () => {
  let db: Db

  beforeAll(async () => {
    db = await createCountingTestDb()
  })
  afterEach(async () => {
    setNowForTests(null)
    await db.delete(courseTest)
    await db.delete(courseRosterAdjustment)
    await db.delete(course)
    await db.delete(classStudent)
    await db.delete(classLecturer)
    await db.delete(class_)
    await db.delete(school)
    await db.delete(user)
  })

  async function setup() {
    const lecturer = ctxFor(db, await makeUser(db, { role: 'lecturer', name: 'Dr Owner' }))
    const sch = await createSchool(lecturer, { name: 'University of Buea', town: 'Buea' })
    const cls = await createClass(lecturer, { schoolId: sch.id, name: 'CS L3', academicYear: '2026/27' })
    const colleague = ctxFor(db, await makeUser(db, { role: 'lecturer', name: 'Dr Colleague' }))
    await joinClassAsLecturer(colleague, cls.lecturerCode!)
    const algo = await createCourse(lecturer, { classId: cls.id, title: 'Algorithms', semester: 1 })
    const student = async (name: string, matricule: string) => {
      const s = ctxFor(db, await makeUser(db, { role: 'student', name }))
      await joinClassAsStudent(s, cls.studentCode!, matricule)
      return s
    }
    const alice = await student('Alice', 'UB1')
    const bob = await student('Bob', 'UB2')
    const carol = await student('Carol', 'UB3')
    const dave = await student('Dave', 'UB4')
    const erin = await student('Erin', 'UB5')
    return { lecturer, colleague, algo, cls, student, alice, bob, carol, dave, erin }
  }

  /**
   * Inserts a test directly (authoring is another task). q1: MCQ at the default mark 2, correct o1;
   * q2: MCQ mark 3, correct o4; q3 (unless mcqOnly): short answer mark 4. Total 9 (5 when MCQ-only).
   */
  async function insertTest(lecturer: Ctx, courseId: string, opts: { mcqOnly?: boolean; title?: string } = {}) {
    const [t] = await db
      .insert(courseTest)
      .values({
        courseId,
        code: newCode(),
        title: opts.title ?? 'CA 1',
        durationMinutes: 30,
        defaultMark: 2,
        createdBy: lecturer.user.id,
      })
      .returning()
    const [q1, q2] = await db
      .insert(testQuestion)
      .values([
        { testId: t.id, position: 0, kind: 'mcq', prompt: 'Which sort is stable?', mark: null },
        { testId: t.id, position: 1, kind: 'mcq', prompt: 'Cost of binary search?', mark: 3 },
      ])
      .returning()
    const [o1, o2, o3, o4] = await db
      .insert(testOption)
      .values([
        { questionId: q1.id, position: 0, text: 'Merge sort', isCorrect: true },
        { questionId: q1.id, position: 1, text: 'Quick sort', isCorrect: false },
        { questionId: q2.id, position: 0, text: 'O(n)', isCorrect: false },
        { questionId: q2.id, position: 1, text: 'O(log n)', isCorrect: true },
      ])
      .returning()
    let q3: typeof q1 | null = null
    if (!opts.mcqOnly) {
      ;[q3] = await db
        .insert(testQuestion)
        .values({ testId: t.id, position: 2, kind: 'short', prompt: 'Define a heap.', mark: 4, guide: 'A tree with the heap property.' })
        .returning()
    }
    return { test: t, q1, q2, q3, o1, o2, o3, o4 }
  }

  async function join(testId: string, student: Ctx, joinedAt: Date) {
    const [a] = await db
      .insert(testAttempt)
      .values({
        testId,
        studentId: student.user.id,
        seed: crypto.randomUUID(),
        deviceId: crypto.randomUUID(),
        deviceSeenAt: joinedAt,
        joinedAt,
      })
      .returning()
    return a
  }

  async function answer(
    attemptId: string,
    questionId: string,
    value: { optionId?: string; text?: string; mark?: number },
    receivedAt: Date,
  ) {
    await db.insert(testAnswer).values({
      attemptId,
      questionId,
      optionId: value.optionId ?? null,
      text: value.text ?? null,
      mark: value.mark ?? null,
      rev: 1,
      receivedAt,
    })
  }

  async function exit(attemptId: string, exitNumber: number, leftAt: Date, back: { awayMs: number; at: Date } | null) {
    await db.insert(testExit).values({
      attemptId,
      exitId: crypto.randomUUID(),
      exitNumber,
      firstReportedAt: leftAt,
      awayMs: back?.awayMs ?? null,
      returnedAt: back?.at ?? null,
    })
  }

  async function close(attemptId: string, reason: 'left' | 'handed_in', when: Date, exitsSinceReopen = 0) {
    await db
      .update(testAttempt)
      .set({ closedAt: when, closedReason: reason, exitsSinceReopen })
      .where(eq(testAttempt.id, attemptId))
    await db.insert(testLog).values({ attemptId, kind: reason === 'left' ? 'ended_left' : 'handed_in', at: when })
  }

  async function testRow(testId: string) {
    const [row] = await db.select().from(courseTest).where(eq(courseTest.id, testId))
    return row
  }

  it('startTest fixes the deadline at start + duration', async () => {
    const { lecturer, algo, alice } = await setup()
    const { test } = await insertTest(lecturer, algo.id)
    setClock(at(-5))
    await join(test.id, alice, at(-5))

    setClock(T0)
    const summary = await startTest(lecturer, test.id)
    expect(summary).toMatchObject({
      id: test.id,
      courseId: algo.id,
      code: test.code,
      title: 'CA 1',
      state: 'running',
      questionCount: 3,
      totalMarks: 9,
      hasShort: true,
      durationMinutes: 30,
      startedAt: T0,
      endsAt: at(30),
      joined: 1,
    })
    const row = await testRow(test.id)
    expect(row.startedAt).toEqual(T0)
    expect(row.deadlineAt).toEqual(at(30))
    expect(row.endedAt).toBeNull()
  })

  it('starting a started test pushes nothing', async () => {
    const { lecturer, algo } = await setup()
    const { test } = await insertTest(lecturer, algo.id)
    const push = vi.mocked(sendPush)
    push.mockClear()
    setClock(T0)
    await startTest(lecturer, test.id)
    expect(push).toHaveBeenCalledTimes(1)
    expect((push.mock.calls[0][0] as { payload: { url: string } }[])[0].payload.url).toBe(`/t/${test.code}`)
    await startTest(lecturer, test.id)
    expect(push).toHaveBeenCalledTimes(1)
  })

  it('starting twice keeps the first deadline', async () => {
    const { lecturer, algo } = await setup()
    const { test } = await insertTest(lecturer, algo.id)

    setClock(T0)
    // A double click: both requests race; one wins, the other changes nothing.
    const [a, b] = await Promise.all([startTest(lecturer, test.id), startTest(lecturer, test.id)])
    expect(a.endsAt).toEqual(at(30))
    expect(b.endsAt).toEqual(at(30))

    // Start pressed again after a timeout, a minute later.
    setClock(at(1))
    const again = await startTest(lecturer, test.id)
    expect(again).toMatchObject({ state: 'running', startedAt: T0, endsAt: at(30) })
    const row = await testRow(test.id)
    expect(row.startedAt).toEqual(T0)
    expect(row.deadlineAt).toEqual(at(30))
  })

  it('endTestForEveryone before Start is CONFLICT not_started; twice is a no-op; endsAt is the end time', async () => {
    const { lecturer, algo, alice } = await setup()
    const { test } = await insertTest(lecturer, algo.id)

    setClock(T0)
    await expect(endTestForEveryone(lecturer, test.id)).rejects.toMatchObject({
      code: 'CONFLICT',
      details: { reason: 'not_started' },
    })
    expect((await testRow(test.id)).endedAt).toBeNull()

    await startTest(lecturer, test.id)
    const attempt = await join(test.id, alice, at(1))

    setClock(at(10))
    await endTestForEveryone(lecturer, test.id)
    expect((await testRow(test.id)).endedAt).toEqual(at(10))

    setClock(at(12))
    await endTestForEveryone(lecturer, test.id)
    expect((await testRow(test.id)).endedAt).toEqual(at(10))

    const live = await getLiveTest(lecturer, test.id)
    expect(live.phase).toBe('ended')
    expect(live.endsAt).toEqual(at(10))

    // Ending for everyone never closes the attempts: handed in is derived from the end, so
    // answers in the 2-minute grace are still accepted.
    const [stored] = await db.select().from(testAttempt).where(eq(testAttempt.id, attempt.id))
    expect(stored.closedAt).toBeNull()
    expect(stored.closedReason).toBeNull()
  })

  it('endTestForEveryone after the deadline has passed changes nothing', async () => {
    const { lecturer, algo } = await setup()
    const { test } = await insertTest(lecturer, algo.id)
    setClock(T0)
    await startTest(lecturer, test.id)

    setClock(at(31))
    await endTestForEveryone(lecturer, test.id)
    const row = await testRow(test.id)
    expect(row.endedAt).toBeNull()
    expect((await getLiveTest(lecturer, test.id)).endsAt).toEqual(at(30))
  })

  it('getLiveTest: not_joined, waiting before Start, working, away with an open exit, ended, handed_in; counts add up', async () => {
    const { lecturer, algo, alice, bob, carol, dave, erin } = await setup()
    const q = await insertTest(lecturer, algo.id)
    const testId = q.test.id

    // Before Start: Alice is waiting, everyone else has not joined.
    setClock(at(-5))
    const aAlice = await join(testId, alice, at(-5))
    const before = await getLiveTest(lecturer, testId)
    expect(before).toMatchObject({
      testId,
      courseId: algo.id,
      code: q.test.code,
      title: 'CA 1',
      phase: 'not_started',
      endsAt: null,
      serverNow: at(-5),
      questionCount: 3,
      counts: { roster: 5, joined: 1, working: 0, handedIn: 0, endedLeaving: 0 },
    })
    expect(before.rows.map((r) => [r.name, r.status])).toEqual([
      ['Alice', 'waiting'],
      ['Bob', 'not_joined'],
      ['Carol', 'not_joined'],
      ['Dave', 'not_joined'],
      ['Erin', 'not_joined'],
    ])
    expect(before.rows[1]).toMatchObject({ attemptId: null, answered: 0, exits: 0, matricule: 'UB2' })

    setClock(T0)
    await startTest(lecturer, testId)
    // Alice works: an MCQ and a short answer count as answered; a blank short answer does not.
    await answer(aAlice.id, q.q1.id, { optionId: q.o1.id }, at(1))
    await answer(aAlice.id, q.q3!.id, { text: 'A tree' }, at(2))
    // Bob is away: one exit he came back from, one still open.
    const aBob = await join(testId, bob, at(1))
    await answer(aBob.id, q.q3!.id, { text: '   ' }, at(2))
    await exit(aBob.id, 1, at(2), { awayMs: 3000, at: at(2) })
    await exit(aBob.id, 2, at(3), null)
    // Carol was ended for leaving; Dave handed in; Erin never joined.
    const aCarol = await join(testId, carol, at(1))
    await exit(aCarol.id, 1, at(4), { awayMs: 15_000, at: at(4) })
    await close(aCarol.id, 'left', at(4), 1)
    const aDave = await join(testId, dave, at(1))
    await answer(aDave.id, q.q2.id, { optionId: q.o4.id }, at(5))
    await close(aDave.id, 'handed_in', at(6))

    setClock(at(7))
    const live = await getLiveTest(lecturer, testId)
    expect(live).toMatchObject({
      phase: 'running',
      endsAt: at(30),
      serverNow: at(7),
      counts: { roster: 5, joined: 4, working: 2, handedIn: 1, endedLeaving: 1 },
    })
    expect(live.rows).toEqual([
      { studentId: alice.user.id, name: 'Alice', matricule: 'UB1', attemptId: aAlice.id, status: 'working', answered: 2, exits: 0 },
      { studentId: bob.user.id, name: 'Bob', matricule: 'UB2', attemptId: aBob.id, status: 'away', answered: 0, exits: 2 },
      { studentId: carol.user.id, name: 'Carol', matricule: 'UB3', attemptId: aCarol.id, status: 'ended', answered: 0, exits: 1 },
      { studentId: dave.user.id, name: 'Dave', matricule: 'UB4', attemptId: aDave.id, status: 'handed_in', answered: 1, exits: 0 },
      { studentId: erin.user.id, name: 'Erin', matricule: 'UB5', attemptId: null, status: 'not_joined', answered: 0, exits: 0 },
    ])
    const { counts } = live
    const notJoined = live.rows.filter((r) => r.status === 'not_joined').length
    expect(notJoined + counts.joined).toBe(counts.roster)
    expect(counts.working + counts.handedIn + counts.endedLeaving).toBe(counts.joined)
  })

  it('getLiveTest uses a fixed number of queries, however many students joined', async () => {
    const { lecturer, algo, alice, student } = await setup()
    const q = await insertTest(lecturer, algo.id)
    setClock(T0)
    await startTest(lecturer, q.test.id)
    await join(q.test.id, alice, at(1))
    const small = await countQueries(() => getLiveTest(lecturer, q.test.id))
    // Owner check (test, course), then roster, question count and attempt states.
    expect(small).toBe(LIVE_QUERIES)
    // The correlated subqueries name the outer attempt explicitly, never a bare "id".
    const attemptsQuery = recentQueries.find((q) => q.includes('from "test_exit"'))
    expect(attemptsQuery).toMatch(/attempt_id = "test_attempt"\.("id"|id)/)
    expect(attemptsQuery).not.toMatch(/= "id"/)

    for (let i = 0; i < 4; i++) {
      const s = await student(`Late ${i}`, `UB${10 + i}`)
      const a = await join(q.test.id, s, at(2))
      await answer(a.id, q.q1.id, { optionId: q.o1.id }, at(3))
      await exit(a.id, 1, at(3), null)
    }
    const live = await getLiveTest(lecturer, q.test.id)
    expect(live.rows).toHaveLength(9)
    expect(await countQueries(() => getLiveTest(lecturer, q.test.id))).toBe(small)
  })

  it('a student taken off the roster is absent from the live view and the results, though their attempt stays', async () => {
    const { lecturer, algo, alice, bob } = await setup()
    const q = await insertTest(lecturer, algo.id, { mcqOnly: true })
    setClock(T0)
    await startTest(lecturer, q.test.id)
    const aAlice = await join(q.test.id, alice, at(1))
    const aBob = await join(q.test.id, bob, at(1))
    await answer(aAlice.id, q.q1.id, { optionId: q.o1.id }, at(2))
    await answer(aBob.id, q.q1.id, { optionId: q.o1.id }, at(2))
    await setRosterAdjustment(lecturer, algo.id, bob.user.id, 'exclude')

    const live = await getLiveTest(lecturer, q.test.id)
    expect(live.rows.map((r) => r.studentId)).not.toContain(bob.user.id)
    expect(live.counts).toMatchObject({ roster: 4, joined: 1, working: 1 })

    setClock(at(33))
    const results = await getTestResults(lecturer, q.test.id)
    expect(results.rows.map((r) => r.studentId)).not.toContain(bob.user.id)
    expect(results.rows).toHaveLength(4)
    expect(results.rows.find((r) => r.studentId === alice.user.id)).toMatchObject({ score: 2 })
    const [kept] = await db.select().from(testAttempt).where(eq(testAttempt.id, aBob.id))
    expect(kept).toBeDefined()
  })

  it('startTest on a test deleted after the owner check is FORBIDDEN', async () => {
    const { lecturer, algo } = await setup()
    const q = await insertTest(lecturer, algo.id)
    setClock(T0)
    const raced = racing(lecturer, 'update', () => db.delete(courseTest).where(eq(courseTest.id, q.test.id)))
    await expect(startTest(raced, q.test.id)).rejects.toMatchObject({ code: 'FORBIDDEN' })
  })

  it('after the deadline, a working student reads handed_in', async () => {
    const { lecturer, algo, alice, bob, carol } = await setup()
    const q = await insertTest(lecturer, algo.id)
    setClock(T0)
    await startTest(lecturer, q.test.id)
    const aAlice = await join(q.test.id, alice, at(1))
    const aBob = await join(q.test.id, bob, at(1))
    await exit(aBob.id, 1, at(29), null)
    const aCarol = await join(q.test.id, carol, at(1))
    await close(aCarol.id, 'left', at(5), 3)

    setClock(at(30))
    const live = await getLiveTest(lecturer, q.test.id)
    expect(live.phase).toBe('ended')
    expect(live.rows.slice(0, 3).map((r) => r.status)).toEqual(['handed_in', 'handed_in', 'ended'])
    expect(live.counts).toMatchObject({ joined: 3, working: 0, handedIn: 2, endedLeaving: 1 })

    // Nothing is stored: the attempt stays open, so the grace still applies.
    const [stored] = await db.select().from(testAttempt).where(eq(testAttempt.id, aAlice.id))
    expect(stored.closedReason).toBeNull()
  })

  it('letBackIn reopens an ended-for-leaving attempt with the exit counter at 0 and logs reopened', async () => {
    const { lecturer, algo, carol } = await setup()
    const q = await insertTest(lecturer, algo.id)
    setClock(T0)
    await startTest(lecturer, q.test.id)
    const a = await join(q.test.id, carol, at(1))
    await answer(a.id, q.q1.id, { optionId: q.o2.id }, at(2))
    await exit(a.id, 1, at(2), { awayMs: 2000, at: at(2) })
    await exit(a.id, 2, at(3), { awayMs: 2000, at: at(3) })
    await exit(a.id, 3, at(4), null) // the 3rd exit ended the attempt; she never came back
    await close(a.id, 'left', at(4), 3)

    setClock(at(6))
    await letBackIn(lecturer, a.id)

    const [stored] = await db.select().from(testAttempt).where(eq(testAttempt.id, a.id))
    expect(stored).toMatchObject({ closedAt: null, closedReason: null, exitsSinceReopen: 0 })
    const exits = await db.select().from(testExit).where(eq(testExit.attemptId, a.id))
    expect(exits).toHaveLength(3)
    expect(exits.find((e) => e.exitNumber === 3)?.returnedAt).toEqual(at(6))
    expect(exits.find((e) => e.exitNumber === 1)?.returnedAt).toEqual(at(2))
    const logs = await db.select().from(testLog).where(eq(testLog.attemptId, a.id))
    expect(logs.map((l) => [l.kind, l.at, l.byUserId])).toEqual(
      expect.arrayContaining([
        ['ended_left', at(4), null],
        ['reopened', at(6), lecturer.user.id],
      ]),
    )
    // Same answers, same deadline.
    const answers = await db.select().from(testAnswer).where(eq(testAnswer.attemptId, a.id))
    expect(answers).toHaveLength(1)
    const live = await getLiveTest(lecturer, q.test.id)
    expect(live.endsAt).toEqual(at(30))
    expect(live.rows.find((r) => r.attemptId === a.id)).toMatchObject({ status: 'working', exits: 3, answered: 1 })
  })

  it('letBackIn on a working attempt is CONFLICT not_ended; after the test ended is CONFLICT test_over', async () => {
    const { lecturer, algo, alice, bob, carol } = await setup()
    const q = await insertTest(lecturer, algo.id)
    setClock(T0)
    await startTest(lecturer, q.test.id)
    const working = await join(q.test.id, alice, at(1))
    const handedIn = await join(q.test.id, bob, at(1))
    await close(handedIn.id, 'handed_in', at(3))
    const left = await join(q.test.id, carol, at(1))
    await close(left.id, 'left', at(4), 3)

    setClock(at(5))
    await expect(letBackIn(lecturer, working.id)).rejects.toMatchObject({
      code: 'CONFLICT',
      details: { reason: 'not_ended' },
    })
    await expect(letBackIn(lecturer, handedIn.id)).rejects.toMatchObject({
      code: 'CONFLICT',
      details: { reason: 'not_ended' },
    })

    setClock(at(8))
    await endTestForEveryone(lecturer, q.test.id)
    await expect(letBackIn(lecturer, left.id)).rejects.toMatchObject({
      code: 'CONFLICT',
      details: { reason: 'test_over' },
    })
    const [stored] = await db.select().from(testAttempt).where(eq(testAttempt.id, left.id))
    expect(stored.closedReason).toBe('left')
  })

  it('letBackIn after the deadline passed is CONFLICT test_over', async () => {
    const { lecturer, algo, carol } = await setup()
    const q = await insertTest(lecturer, algo.id)
    setClock(T0)
    await startTest(lecturer, q.test.id)
    const left = await join(q.test.id, carol, at(1))
    await close(left.id, 'left', at(4), 3)
    setClock(at(30))
    await expect(letBackIn(lecturer, left.id)).rejects.toMatchObject({
      code: 'CONFLICT',
      details: { reason: 'test_over' },
    })
  })

  it('letBackIn re-checks inside its transaction that the test is still running', async () => {
    const { lecturer, algo, carol } = await setup()
    const q = await insertTest(lecturer, algo.id)
    setClock(T0)
    await startTest(lecturer, q.test.id)
    const left = await join(q.test.id, carol, at(1))
    await close(left.id, 'left', at(4), 3)

    setClock(at(8))
    // The lecturer ends the test in another tab after this call's first check.
    const raced = racing(lecturer, 'transaction', () => endTestForEveryone(lecturer, q.test.id))
    await expect(letBackIn(raced, left.id)).rejects.toMatchObject({
      code: 'CONFLICT',
      details: { reason: 'test_over' },
    })
    const [stored] = await db.select().from(testAttempt).where(eq(testAttempt.id, left.id))
    expect(stored.closedReason).toBe('left')
    const logs = await db.select().from(testLog).where(eq(testLog.attemptId, left.id))
    expect(logs.map((l) => l.kind)).toEqual(['ended_left'])
  })

  it('getAttemptLog lists exits, ending and reopening in order', async () => {
    const { lecturer, algo, carol } = await setup()
    const q = await insertTest(lecturer, algo.id)
    setClock(T0)
    await startTest(lecturer, q.test.id)
    const a = await join(q.test.id, carol, at(1))
    await exit(a.id, 1, at(2), { awayMs: 4000, at: at(2) })
    // The absence that ends the attempt is logged at the same moment as the exit itself.
    await exit(a.id, 2, at(3), { awayMs: 12_000, at: at(3) })
    await close(a.id, 'left', at(3), 2)
    setClock(at(5))
    await letBackIn(lecturer, a.id)
    await exit(a.id, 3, at(6), null)
    await close(a.id, 'handed_in', at(9))

    setClock(at(10))
    expect(await getAttemptLog(lecturer, a.id)).toEqual([
      { at: at(2), kind: 'exit', exitNumber: 1, awayMs: 4000 },
      { at: at(3), kind: 'exit', exitNumber: 2, awayMs: 12_000 },
      { at: at(3), kind: 'ended_left', exitNumber: null, awayMs: null },
      { at: at(5), kind: 'reopened', exitNumber: null, awayMs: null },
      { at: at(6), kind: 'exit', exitNumber: 3, awayMs: null },
      { at: at(9), kind: 'handed_in', exitNumber: null, awayMs: null },
    ])
  })

  it('getTestResults: MCQ scored automatically, never-joined scores 0, pending short answers counted', async () => {
    const { lecturer, algo, alice, bob, carol, dave, erin } = await setup()
    const q = await insertTest(lecturer, algo.id)
    setClock(at(-1))
    await expect(getTestResults(lecturer, q.test.id)).rejects.toMatchObject({
      code: 'CONFLICT',
      details: { reason: 'not_ended' },
    })
    setClock(T0)
    await startTest(lecturer, q.test.id)

    // Alice: q1 right (2), q2 wrong, a real short answer not yet marked → pending.
    const aAlice = await join(q.test.id, alice, at(1))
    await answer(aAlice.id, q.q1.id, { optionId: q.o1.id }, at(2))
    await answer(aAlice.id, q.q2.id, { optionId: q.o3.id }, at(2))
    await answer(aAlice.id, q.q3!.id, { text: 'A tree' }, at(3))
    // Bob: both MCQs right (5), a blank short answer → 0 with nothing pending; handed in.
    const aBob = await join(q.test.id, bob, at(1))
    await answer(aBob.id, q.q1.id, { optionId: q.o1.id }, at(2))
    await answer(aBob.id, q.q2.id, { optionId: q.o4.id }, at(2))
    await answer(aBob.id, q.q3!.id, { text: '  ' }, at(2))
    await close(aBob.id, 'handed_in', at(4))
    // Carol never joined. Dave: q2 right (3), short answer marked 3.5; ended for leaving.
    const aDave = await join(q.test.id, dave, at(1))
    await answer(aDave.id, q.q2.id, { optionId: q.o4.id }, at(2))
    await answer(aDave.id, q.q3!.id, { text: 'A complete binary tree', mark: 3.5 }, at(2))
    await close(aDave.id, 'left', at(5), 3)
    // Erin joined and answered nothing.
    await join(q.test.id, erin, at(1))

    setClock(at(29))
    await expect(getTestResults(lecturer, q.test.id)).rejects.toMatchObject({
      code: 'CONFLICT',
      details: { reason: 'not_ended' },
    })

    setClock(at(30))
    const results = await getTestResults(lecturer, q.test.id)
    expect(results.test).toMatchObject({ id: q.test.id, state: 'ended', totalMarks: 9, hasShort: true, joined: 4 })
    expect(results.pending).toBe(1)
    expect(results.rows).toEqual([
      { studentId: alice.user.id, name: 'Alice', matricule: 'UB1', status: 'handed_in', score: 2, outOf: 9, pendingShort: 1 },
      { studentId: bob.user.id, name: 'Bob', matricule: 'UB2', status: 'handed_in', score: 5, outOf: 9, pendingShort: 0 },
      { studentId: carol.user.id, name: 'Carol', matricule: 'UB3', status: 'not_joined', score: 0, outOf: 9, pendingShort: 0 },
      { studentId: dave.user.id, name: 'Dave', matricule: 'UB4', status: 'ended', score: 6.5, outOf: 9, pendingShort: 0 },
      { studentId: erin.user.id, name: 'Erin', matricule: 'UB5', status: 'handed_in', score: 0, outOf: 9, pendingShort: 0 },
    ])
  })

  it('an MCQ-only test is released once answers are final and its scores follow answers received in the grace', async () => {
    const { lecturer, algo, alice } = await setup()
    const q = await insertTest(lecturer, algo.id, { mcqOnly: true })
    setClock(T0)
    await startTest(lecturer, q.test.id)
    const a = await join(q.test.id, alice, at(1))
    await answer(a.id, q.q1.id, { optionId: q.o1.id }, at(2))

    setClock(at(30))
    const first = await getTestResults(lecturer, q.test.id)
    expect(first.test.state).toBe('ended')
    expect(first.rows[0]).toMatchObject({ score: 2, outOf: 5 })

    // An answer stuck on a weak connection arrives 90 s after the end (accepted by the student service).
    setClock(at(31.5))
    await answer(a.id, q.q2.id, { optionId: q.o4.id }, at(31.5))
    const graced = await getTestResults(lecturer, q.test.id)
    expect(graced.test.state).toBe('ended')
    expect(graced.rows[0]).toMatchObject({ score: 5, outOf: 5 })

    // Released when the answers are final, the moment the student sees it and the CA counts it.
    setClock(at(32))
    expect((await getTestResults(lecturer, q.test.id)).test.state).toBe('released')
  })

  it('loadTestScores: every test × student, 0 without an attempt, a fixed number of queries', async () => {
    const { lecturer, algo, alice, bob, student } = await setup()
    const one = await insertTest(lecturer, algo.id, { title: 'CA 1' })
    const two = await insertTest(lecturer, algo.id, { mcqOnly: true, title: 'Quiz' })
    setClock(T0)
    const a1 = await join(one.test.id, alice, at(1))
    await answer(a1.id, one.q1.id, { optionId: one.o1.id }, at(2))
    await answer(a1.id, one.q3!.id, { text: 'heap', mark: 1.25 }, at(2))
    const a2 = await join(two.test.id, bob, at(1))
    await answer(a2.id, two.q2.id, { optionId: two.o4.id }, at(2))

    const ids = [alice.user.id, bob.user.id]
    let scores = new Map<string, Map<string, unknown>>()
    const small = await countQueries(async () => {
      scores = await loadTestScores(db, [one.test.id, two.test.id], ids)
    })
    expect(small).toBe(SCORE_QUERIES)
    expect(scores.get(one.test.id)?.get(alice.user.id)).toMatchObject({
      score: 3.25,
      outOf: 9,
      mcqCorrect: 1,
      mcqCount: 2,
      pendingShort: 0,
    })
    expect(scores.get(one.test.id)?.get(bob.user.id)).toMatchObject({ score: 0, outOf: 9, pendingShort: 0 })
    expect(scores.get(two.test.id)?.get(alice.user.id)).toMatchObject({ score: 0, outOf: 5 })
    expect(scores.get(two.test.id)?.get(bob.user.id)).toMatchObject({ score: 3, outOf: 5, mcqCorrect: 1 })

    // More students with answers: the same number of queries.
    const more = [alice.user.id, bob.user.id]
    for (let i = 0; i < 4; i++) {
      const s = await student(`More ${i}`, `UB${30 + i}`)
      more.push(s.user.id)
      const a = await join(one.test.id, s, at(1))
      await answer(a.id, one.q1.id, { optionId: one.o2.id }, at(2))
      await answer(a.id, one.q2.id, { optionId: one.o4.id }, at(2))
    }
    expect(await countQueries(() => loadTestScores(db, [one.test.id, two.test.id], more))).toBe(small)
    const all = await loadTestScores(db, [one.test.id, two.test.id], more)
    expect(all.get(one.test.id)?.size).toBe(6)
    expect(all.get(one.test.id)?.get(more[5])).toMatchObject({ score: 3 })

    // Nothing to load: no queries at all.
    expect(await countQueries(() => loadTestScores(db, [], more))).toBe(0)
    expect((await loadTestScores(db, [one.test.id], [])).get(one.test.id)?.size).toBe(0)
  })

  it('a colleague and a student get FORBIDDEN on every function', async () => {
    const { lecturer, colleague, algo, alice, carol } = await setup()
    const q = await insertTest(lecturer, algo.id)
    setClock(T0)
    await startTest(lecturer, q.test.id)
    const left = await join(q.test.id, carol, at(1))
    await close(left.id, 'left', at(2), 3)

    setClock(at(3))
    for (const who of [colleague, alice]) {
      await expect(startTest(who, q.test.id)).rejects.toMatchObject({ code: 'FORBIDDEN' })
      await expect(endTestForEveryone(who, q.test.id)).rejects.toMatchObject({ code: 'FORBIDDEN' })
      await expect(getLiveTest(who, q.test.id)).rejects.toMatchObject({ code: 'FORBIDDEN' })
      await expect(letBackIn(who, left.id)).rejects.toMatchObject({ code: 'FORBIDDEN' })
      await expect(getAttemptLog(who, left.id)).rejects.toMatchObject({ code: 'FORBIDDEN' })
      await expect(getTestResults(who, q.test.id)).rejects.toMatchObject({ code: 'FORBIDDEN' })
    }
    // No such test or attempt reads the same as "not yours".
    await expect(startTest(lecturer, 'no-such-test')).rejects.toMatchObject({ code: 'FORBIDDEN' })
    await expect(endTestForEveryone(lecturer, 'no-such-test')).rejects.toMatchObject({ code: 'FORBIDDEN' })
    await expect(getLiveTest(lecturer, 'no-such-test')).rejects.toMatchObject({ code: 'FORBIDDEN' })
    await expect(getTestResults(lecturer, 'no-such-test')).rejects.toMatchObject({ code: 'FORBIDDEN' })
    await expect(letBackIn(lecturer, 'no-such-attempt')).rejects.toMatchObject({ code: 'FORBIDDEN' })
    await expect(getAttemptLog(lecturer, 'no-such-attempt')).rejects.toMatchObject({ code: 'FORBIDDEN' })

    // Nothing changed.
    const [stored] = await db.select().from(testAttempt).where(eq(testAttempt.id, left.id))
    expect(stored.closedReason).toBe('left')
    expect((await testRow(q.test.id)).endedAt).toBeNull()
  })
})
