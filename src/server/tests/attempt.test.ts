import { and, asc, eq } from 'drizzle-orm'
import { afterEach, beforeAll, describe, expect, it } from 'vitest'
import { createClass, joinClassAsStudent } from '@/server/classes/service'
import { setNowForTests } from '@/server/core/clock'
import type { Ctx } from '@/server/core/context'
import { createCourse } from '@/server/courses/service'
import type { Db } from '@/server/db'
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
} from '@/server/db/schema'
import { createSchool } from '@/server/schools/service'
import { createTestDb } from '@/test/db'
import { ctxFor, makeUser } from '@/test/factories'
import {
  handIn,
  listMyTests,
  openTest,
  resolveTestLink,
  syncAttempt,
  type AnswerInput,
  type ExitReport,
} from './attempt'
import { orderFor } from './paper'

const SEC = 1000
const MIN = 60 * SEC
const BASE = new Date('2026-11-09T07:50:00Z')
const START = new Date('2026-11-09T08:00:00Z')
const DEADLINE = new Date(START.getTime() + 30 * MIN)
const after = (base: Date, ms: number) => new Date(base.getTime() + ms)

type MadeQuestion = { id: string; kind: 'mcq' | 'short'; options: { id: string; correct: boolean }[] }
type MadeTest = { id: string; code: string; questions: MadeQuestion[] }

describe('taking a test (student services)', () => {
  let db: Db
  let clock: Date

  function setClock(at: Date) {
    clock = at
    setNowForTests(() => clock)
  }

  beforeAll(async () => {
    db = await createTestDb()
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
  })

  async function setup() {
    setClock(BASE)
    const lecturer = ctxFor(db, await makeUser(db, { role: 'lecturer', name: 'Dr Owner' }))
    const colleague = ctxFor(db, await makeUser(db, { role: 'lecturer', name: 'Dr Other' }))
    const sch = await createSchool(lecturer, { name: 'University of Buea', town: 'Buea' })
    const cls = await createClass(lecturer, { schoolId: sch.id, name: 'CS L3', academicYear: '2026/27' })
    const algo = await createCourse(lecturer, { classId: cls.id, title: 'Algorithms', semester: 1 })
    const alice = ctxFor(db, await makeUser(db, { role: 'student', name: 'Alice' }))
    const bob = ctxFor(db, await makeUser(db, { role: 'student', name: 'Bob' }))
    const outsider = ctxFor(db, await makeUser(db, { role: 'student', name: 'Olga' }))
    await joinClassAsStudent(alice, cls.studentCode!, 'UB1')
    await joinClassAsStudent(bob, cls.studentCode!, 'UB2')
    return { lecturer, colleague, algo, alice, bob, outsider }
  }

  let codeCounter = 0
  /** A fresh well-formed test code (join alphabet, no I/O/0/1). */
  function nextCode(): string {
    codeCounter += 1
    const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
    let n = codeCounter
    let suffix = ''
    for (let i = 0; i < 3; i++) {
      suffix = alphabet[n % 32] + suffix
      n = Math.floor(n / 32)
    }
    return `TST${suffix}`
  }

  /**
   * Inserts a test directly: `mcq` multiple-choice questions (3 options, the 2nd correct, mark 2
   * except the first which overrides to 3) then `short` short-answer questions (default mark 2).
   */
  async function makeTest(
    courseId: string,
    by: Ctx,
    over: Partial<{ mcq: number; short: number; shuffle: boolean; maxExits: number; maxAbsenceSeconds: number; title: string; createdAt: Date }> = {},
  ): Promise<MadeTest> {
    const code = nextCode()
    const [t] = await db
      .insert(courseTest)
      .values({
        courseId,
        code,
        title: over.title ?? 'CA 1',
        durationMinutes: 30,
        defaultMark: 2,
        shuffle: over.shuffle ?? true,
        maxExits: over.maxExits ?? 3,
        maxAbsenceSeconds: over.maxAbsenceSeconds ?? 10,
        createdBy: by.user.id,
        createdAt: over.createdAt ?? BASE,
      })
      .returning({ id: courseTest.id })
    const questions: MadeQuestion[] = []
    const mcq = over.mcq ?? 3
    const short = over.short ?? 0
    for (let i = 0; i < mcq + short; i++) {
      const kind = i < mcq ? 'mcq' : 'short'
      const [q] = await db
        .insert(testQuestion)
        .values({
          testId: t.id,
          position: i,
          kind,
          prompt: `Question ${i + 1}`,
          mark: i === 0 ? 3 : null,
          guide: kind === 'short' ? 'secret guide' : null,
        })
        .returning({ id: testQuestion.id })
      const options: MadeQuestion['options'] = []
      if (kind === 'mcq') {
        for (let j = 0; j < 3; j++) {
          const [o] = await db
            .insert(testOption)
            .values({ questionId: q.id, position: j, text: `Option ${j + 1}`, isCorrect: j === 1 })
            .returning({ id: testOption.id })
          options.push({ id: o.id, correct: j === 1 })
        }
      }
      questions.push({ id: q.id, kind, options })
    }
    return { id: t.id, code, questions }
  }

  async function start(testId: string, at = START) {
    await db
      .update(courseTest)
      .set({ startedAt: at, deadlineAt: after(at, 30 * MIN) })
      .where(eq(courseTest.id, testId))
  }

  async function endForEveryone(testId: string, at: Date) {
    await db.update(courseTest).set({ endedAt: at }).where(eq(courseTest.id, testId))
  }

  const right = (q: MadeQuestion) => q.options.find((o) => o.correct)!.id
  const wrong = (q: MadeQuestion) => q.options.find((o) => !o.correct)!.id
  const mcqAnswer = (q: MadeQuestion, optionId: string | null, rev = 1): AnswerInput => ({
    questionId: q.id,
    optionId,
    text: null,
    rev,
  })
  const shortAnswer = (q: MadeQuestion, text: string, rev = 1): AnswerInput => ({
    questionId: q.id,
    optionId: null,
    text,
    rev,
  })
  const sync = (who: Ctx, attemptId: string, answers: AnswerInput[] = [], exits: ExitReport[] = [], deviceId = 'dev-A') =>
    syncAttempt(who, attemptId, { deviceId, answers, exits })
  /** A sync from a device that holds no paper yet: asks for the paper and the saved answers. */
  const syncWithPaper = (who: Ctx, attemptId: string) => syncAttempt(who, attemptId, { deviceId: 'dev-A', answers: [], exits: [], withPaper: true })

  async function storedAnswers(attemptId: string) {
    return db
      .select({ questionId: testAnswer.questionId, optionId: testAnswer.optionId, text: testAnswer.text, rev: testAnswer.rev })
      .from(testAnswer)
      .where(eq(testAnswer.attemptId, attemptId))
  }

  async function attemptRow(attemptId: string) {
    const [row] = await db.select().from(testAttempt).where(eq(testAttempt.id, attemptId))
    return row
  }

  async function logKinds(attemptId: string) {
    const rows = await db.select({ kind: testLog.kind }).from(testLog).where(eq(testLog.attemptId, attemptId)).orderBy(asc(testLog.at))
    return rows.map((r) => r.kind)
  }

  /** Opens the test at START + 1 min (after Start) and returns the attempt id. */
  async function joinRunning(who: Ctx, t: MadeTest, deviceId = 'dev-A') {
    setClock(after(START, MIN))
    const view = await openTest(who, t.code, deviceId)
    expect(view.stage).toBe('answering')
    return view.attemptId!
  }

  it('a rostered student opening the link before Start waits: stage waiting, no paper, info with the rule', async () => {
    const { lecturer, algo, alice } = await setup()
    const t = await makeTest(algo.id, lecturer, { mcq: 2, short: 1, maxExits: 4, maxAbsenceSeconds: 15 })

    const view = await openTest(alice, t.code, 'dev-A')
    expect(view.stage).toBe('waiting')
    expect(view.attemptId).toEqual(expect.any(String))
    expect(view.paper).toBeNull()
    expect(view.endsAt).toBeNull()
    expect(view.serverNow).toEqual(BASE)
    expect(view.result).toBeNull()
    expect(view.awaitingRelease).toBe(false)
    expect(view.saved).toEqual([])
    expect(view.exitsSoFar).toBe(0)
    expect(view.info).toEqual({
      title: 'CA 1',
      courseTitle: 'Algorithms',
      durationMinutes: 30,
      questionCount: 3,
      totalMarks: 7, // 3 + 2 + 2
      rule: { maxExits: 4, maxAbsenceSeconds: 15 },
      hasShort: true,
    })
    // Opening again (same device) keeps the one attempt.
    const again = await openTest(alice, t.code.toLowerCase(), 'dev-A')
    expect(again.attemptId).toBe(view.attemptId)
    expect(await db.select().from(testAttempt).where(eq(testAttempt.testId, t.id))).toHaveLength(1)
  })

  it('unknown code, malformed code, a student off the roster and another lecturer all get FORBIDDEN not_your_course', async () => {
    const { lecturer, colleague, algo, outsider, alice } = await setup()
    const t = await makeTest(algo.id, lecturer)
    const notYours = { code: 'FORBIDDEN', details: { reason: 'not_your_course' } }

    await expect(openTest(alice, 'ZZZZZZ', 'dev-A')).rejects.toMatchObject(notYours)
    await expect(openTest(alice, 'abc', 'dev-A')).rejects.toMatchObject(notYours)
    await expect(openTest(alice, 'O0I1O0', 'dev-A')).rejects.toMatchObject(notYours)
    await expect(openTest(outsider, t.code, 'dev-A')).rejects.toMatchObject(notYours)
    await expect(openTest(colleague, t.code, 'dev-A')).rejects.toMatchObject(notYours)
    await expect(openTest(lecturer, t.code, 'dev-A')).rejects.toMatchObject(notYours)

    await expect(resolveTestLink(alice, 'ZZZZZZ')).rejects.toMatchObject(notYours)
    await expect(resolveTestLink(alice, 'abc')).rejects.toMatchObject(notYours)
    await expect(resolveTestLink(outsider, t.code)).rejects.toMatchObject(notYours)
    await expect(resolveTestLink(colleague, t.code)).rejects.toMatchObject(notYours)

    // Identical in every case: same message, same details.
    const errors = await Promise.all(
      [resolveTestLink(alice, 'ZZZZZZ'), resolveTestLink(outsider, t.code), resolveTestLink(colleague, t.code)].map((p) =>
        p.catch((e: unknown) => e),
      ),
    )
    const shapes = errors.map((e) => {
      const err = e as { code: string; message: string; details: unknown }
      return { code: err.code, message: err.message, details: err.details }
    })
    expect(shapes[1]).toEqual(shapes[0])
    expect(shapes[2]).toEqual(shapes[0])
    expect(await db.select().from(testAttempt)).toHaveLength(0)
  })

  it('resolveTestLink tells the owner apart', async () => {
    const { lecturer, algo, alice } = await setup()
    const t = await makeTest(algo.id, lecturer)
    expect(await resolveTestLink(lecturer, t.code)).toEqual({ role: 'owner', courseId: algo.id, testId: t.id })
    expect(await resolveTestLink(alice, t.code)).toEqual({ role: 'student', testId: t.id })
    expect(await resolveTestLink(alice, ` ${t.code.slice(0, 3)}-${t.code.slice(3).toLowerCase()} `)).toEqual({
      role: 'student',
      testId: t.id,
    })
    // Resolving never creates an attempt.
    expect(await db.select().from(testAttempt)).toHaveLength(0)
  })

  it("after Start the paper comes in this student's shuffled order, the same on every call, without correct flags or guides", async () => {
    const { lecturer, algo, alice } = await setup()
    const t = await makeTest(algo.id, lecturer, { mcq: 6, short: 2 })
    await openTest(alice, t.code, 'dev-A')
    await start(t.id)
    const attemptId = await joinRunning(alice, t)
    const { seed } = await attemptRow(attemptId)

    const first = await openTest(alice, t.code, 'dev-A')
    const ids = t.questions.map((q) => q.id)
    expect(first.paper!.map((q) => q.id)).toEqual(orderFor(seed, ids))
    for (const pq of first.paper!) {
      const made = t.questions.find((q) => q.id === pq.id)!
      expect(pq.options.map((o) => o.id)).toEqual(
        made.kind === 'mcq' ? orderFor(`${seed}:${made.id}`, made.options.map((o) => o.id)) : [],
      )
      expect(Object.keys(pq).sort()).toEqual(['id', 'kind', 'mark', 'options', 'prompt'])
      for (const o of pq.options) expect(Object.keys(o).sort()).toEqual(['id', 'text'])
    }
    expect(JSON.stringify(first.paper)).not.toContain('secret guide')
    expect(first.paper!.find((q) => q.id === t.questions[0].id)!.mark).toBe(3)
    expect(first.paper!.find((q) => q.id === t.questions[1].id)!.mark).toBe(2)

    const second = await syncWithPaper(alice, attemptId)
    expect(second.paper).toEqual(first.paper)
    const third = await openTest(alice, t.code, 'dev-A')
    expect(third.paper).toEqual(first.paper)
  })

  it('a sync leaves out the paper and the saved answers unless the device asks for them (data on phones)', async () => {
    const { lecturer, algo, alice } = await setup()
    const t = await makeTest(algo.id, lecturer, { mcq: 3, short: 1 })
    const [q1] = t.questions
    const waiting = await openTest(alice, t.code, 'dev-A')
    // Waiting: no paper yet; the device asks on every sync, and gets none before Start.
    const beforeStart = await syncWithPaper(alice, waiting.attemptId!)
    expect(beforeStart).toMatchObject({ stage: 'waiting', paper: null, saved: [] })
    await start(t.id)
    const attemptId = await joinRunning(alice, t)

    const lean = await sync(alice, attemptId, [mcqAnswer(q1, right(q1))])
    expect(lean.stage).toBe('answering')
    expect(lean).not.toHaveProperty('paper')
    expect(lean).not.toHaveProperty('saved')
    expect(lean.acceptedRevs).toEqual({ [q1.id]: 1 })
    expect(JSON.stringify(lean).length).toBeLessThan(1000)

    const asked = await syncWithPaper(alice, attemptId)
    expect(asked.paper!.map((q) => q.id).sort()).toEqual(t.questions.map((q) => q.id).sort())
    expect(asked.saved).toEqual([{ questionId: q1.id, optionId: right(q1), text: null, rev: 1 }])
  })

  it("shuffle off keeps the lecturer's order", async () => {
    const { lecturer, algo, alice } = await setup()
    const t = await makeTest(algo.id, lecturer, { mcq: 6, short: 1, shuffle: false })
    await start(t.id)
    const attemptId = await joinRunning(alice, t)
    const view = await syncWithPaper(alice, attemptId)
    expect(view.paper!.map((q) => q.id)).toEqual(t.questions.map((q) => q.id))
    expect(view.paper!.map((q) => q.prompt)).toEqual(t.questions.map((_, i) => `Question ${i + 1}`))
    for (const pq of view.paper!) {
      const made = t.questions.find((q) => q.id === pq.id)!
      expect(pq.options.map((o) => o.id)).toEqual(made.options.map((o) => o.id))
    }
  })

  it('a late joiner gets the same endsAt as everyone', async () => {
    const { lecturer, algo, alice, bob } = await setup()
    const t = await makeTest(algo.id, lecturer)
    await start(t.id)
    setClock(after(START, MIN))
    const early = await openTest(alice, t.code, 'dev-A')
    setClock(after(START, 20 * MIN))
    const late = await openTest(bob, t.code, 'dev-B')
    expect(early.endsAt).toEqual(DEADLINE)
    expect(late.endsAt).toEqual(DEADLINE)
    expect(late.stage).toBe('answering')
    expect(late.serverNow).toEqual(after(START, 20 * MIN))
  })

  it('answers are saved; a lower rev arriving later does not overwrite a higher one', async () => {
    const { lecturer, algo, alice } = await setup()
    const t = await makeTest(algo.id, lecturer, { mcq: 2, short: 1 })
    const [q1, q2, q3] = t.questions
    await start(t.id)
    const attemptId = await joinRunning(alice, t)

    const v1 = await sync(alice, attemptId, [mcqAnswer(q1, wrong(q1), 2), shortAnswer(q3, 'osmosis', 1)])
    expect(v1.acceptedRevs).toEqual({ [q1.id]: 2, [q3.id]: 1 })

    // rev 1 of q1 was delayed and arrives after rev 2: ignored, but acknowledged.
    const v2 = await sync(alice, attemptId, [mcqAnswer(q1, right(q1), 1), mcqAnswer(q2, right(q2), 1)])
    expect(v2.acceptedRevs).toEqual({ [q1.id]: 1, [q2.id]: 1 })
    const stored = await storedAnswers(attemptId)
    expect(stored).toHaveLength(3)
    expect(stored.find((a) => a.questionId === q1.id)).toEqual({ questionId: q1.id, optionId: wrong(q1), text: null, rev: 2 })

    // A higher rev replaces it; the same rev again changes nothing.
    await sync(alice, attemptId, [shortAnswer(q3, 'diffusion', 2)])
    await sync(alice, attemptId, [shortAnswer(q3, 'other', 2)])
    const view = await syncWithPaper(alice, attemptId)
    expect(view.saved).toEqual(
      expect.arrayContaining([
        { questionId: q1.id, optionId: wrong(q1), text: null, rev: 2 },
        { questionId: q2.id, optionId: right(q2), text: null, rev: 1 },
        { questionId: q3.id, optionId: null, text: 'diffusion', rev: 2 },
      ]),
    )
    expect(view.saved).toHaveLength(3)

    // Duplicates within one call keep the highest rev.
    await sync(alice, attemptId, [mcqAnswer(q2, wrong(q2), 3), mcqAnswer(q2, right(q2), 2)])
    expect((await storedAnswers(attemptId)).find((a) => a.questionId === q2.id)).toMatchObject({ optionId: wrong(q2), rev: 3 })
  })

  it('answers received 90 s after the deadline count; 3 min after are dropped', async () => {
    const { lecturer, algo, alice } = await setup()
    const t = await makeTest(algo.id, lecturer, { mcq: 4 })
    const [q1, q2, q3, q4] = t.questions
    await start(t.id)
    const attemptId = await joinRunning(alice, t)

    // Three answers given offline before the deadline arrive 90 s after it.
    setClock(after(DEADLINE, 90 * SEC))
    const late = await sync(alice, attemptId, [mcqAnswer(q1, right(q1)), mcqAnswer(q2, right(q2)), mcqAnswer(q3, wrong(q3))])
    expect(late.acceptedRevs).toEqual({ [q1.id]: 1, [q2.id]: 1, [q3.id]: 1 })
    expect(late.stage).toBe('over')
    expect(late.paper).toBeUndefined()

    // One more arrives 3 min after the end: dropped silently.
    setClock(after(DEADLINE, 3 * MIN))
    const tooLate = await sync(alice, attemptId, [mcqAnswer(q4, right(q4)), mcqAnswer(q1, wrong(q1), 2)])
    expect(tooLate.acceptedRevs).toEqual({})
    expect(tooLate.stage).toBe('over')
    const stored = await storedAnswers(attemptId)
    expect(stored.map((a) => a.questionId).sort()).toEqual([q1.id, q2.id, q3.id].sort())
    expect(stored.find((a) => a.questionId === q1.id)!.rev).toBe(1)

    // The ending for everyone is derived: nothing is stored as handed in, and the list says handed in.
    const row = await attemptRow(attemptId)
    expect(row.closedAt).toBeNull()
    expect(row.closedReason).toBeNull()
    expect((await listMyTests(alice, algo.id))[0].myStatus).toBe('handed_in')
  })

  it('an option from another question is VALIDATION', async () => {
    const { lecturer, algo, alice } = await setup()
    const t = await makeTest(algo.id, lecturer, { mcq: 2, short: 1 })
    const [q1, q2, q3] = t.questions
    await start(t.id)
    const attemptId = await joinRunning(alice, t)
    const validation = { code: 'VALIDATION', details: { fields: ['answers'] } }

    await expect(sync(alice, attemptId, [mcqAnswer(q1, right(q1)), mcqAnswer(q2, right(q1))])).rejects.toMatchObject(validation)
    // Text on an MCQ, an option on a short answer, text over the limit, an unknown question.
    await expect(sync(alice, attemptId, [{ questionId: q1.id, optionId: null, text: 'b', rev: 1 }])).rejects.toMatchObject(validation)
    await expect(sync(alice, attemptId, [{ questionId: q3.id, optionId: right(q1), text: null, rev: 1 }])).rejects.toMatchObject(validation)
    await expect(sync(alice, attemptId, [shortAnswer(q3, 'x'.repeat(1001))])).rejects.toMatchObject(validation)
    await expect(sync(alice, attemptId, [{ questionId: 'nope', optionId: null, text: null, rev: 1 }])).rejects.toMatchObject(validation)
    await expect(sync(alice, attemptId, [mcqAnswer(q1, right(q1), 0)])).rejects.toMatchObject(validation)
    await expect(handIn(alice, attemptId, { deviceId: 'dev-A', answers: [mcqAnswer(q2, right(q1))] })).rejects.toMatchObject(validation)
    expect(await storedAnswers(attemptId)).toEqual([])
    expect((await attemptRow(attemptId)).closedAt).toBeNull()

    // Exactly the limit is fine.
    await sync(alice, attemptId, [shortAnswer(q3, 'x'.repeat(1000))])
    expect(await storedAnswers(attemptId)).toHaveLength(1)
  })

  it('the 3rd exit ends the attempt; answers sent in the same call still count', async () => {
    const { lecturer, algo, alice } = await setup()
    const t = await makeTest(algo.id, lecturer)
    const [q1, q2] = t.questions
    await start(t.id)
    const attemptId = await joinRunning(alice, t)

    const one = await sync(alice, attemptId, [], [
      { exitId: 'e1', phase: 'left', awayMs: null },
      { exitId: 'e1', phase: 'back', awayMs: 2000 },
    ])
    expect(one.exitsSoFar).toBe(1)
    expect(one.stage).toBe('answering')
    const two = await sync(alice, attemptId, [], [{ exitId: 'e2', phase: 'left', awayMs: null }])
    expect(two.exitsSoFar).toBe(2)
    expect(two.stage).toBe('answering')

    setClock(after(START, 5 * MIN))
    const three = await sync(alice, attemptId, [mcqAnswer(q1, right(q1)), mcqAnswer(q2, right(q2))], [
      { exitId: 'e2', phase: 'back', awayMs: 3000 },
      { exitId: 'e3', phase: 'left', awayMs: null },
    ])
    expect(three.stage).toBe('ended_left')
    expect(three.exitsSoFar).toBe(3)
    expect(three.paper).toBeUndefined()
    expect(three.acceptedRevs).toEqual({ [q1.id]: 1, [q2.id]: 1 })
    expect(await storedAnswers(attemptId)).toHaveLength(2)
    const row = await attemptRow(attemptId)
    expect(row.closedReason).toBe('left')
    expect(row.closedAt).toEqual(after(START, 5 * MIN))
    expect(await logKinds(attemptId)).toEqual(['ended_left'])

    // Exits after the ending are not counted; answers within 2 min of it still are.
    setClock(after(START, 6 * MIN))
    const later = await sync(alice, attemptId, [mcqAnswer(t.questions[2], right(t.questions[2]))], [{ exitId: 'e4', phase: 'left', awayMs: null }])
    expect(later.exitsSoFar).toBe(3)
    expect(later.acceptedRevs).toEqual({ [t.questions[2].id]: 1 })
    expect(await db.select().from(testExit).where(eq(testExit.attemptId, attemptId))).toHaveLength(3)
    expect(await logKinds(attemptId)).toEqual(['ended_left'])
    setClock(after(START, 7 * MIN + SEC))
    const tooLate = await sync(alice, attemptId, [mcqAnswer(q1, wrong(q1), 2)])
    expect(tooLate.acceptedRevs).toEqual({})
  })

  it('a back report with awayMs over S ends the attempt; exactly S does not', async () => {
    const { lecturer, algo, alice } = await setup()
    const t = await makeTest(algo.id, lecturer, { maxAbsenceSeconds: 10 })
    await start(t.id)
    const attemptId = await joinRunning(alice, t)

    const exact = await sync(alice, attemptId, [], [
      { exitId: 'e1', phase: 'left', awayMs: null },
      { exitId: 'e1', phase: 'back', awayMs: 10_000 },
    ])
    expect(exact.stage).toBe('answering')
    expect(exact.exitsSoFar).toBe(1)

    await sync(alice, attemptId, [], [{ exitId: 'e2', phase: 'left', awayMs: null }])
    const over = await sync(alice, attemptId, [], [{ exitId: 'e2', phase: 'back', awayMs: 10_001 }])
    expect(over.stage).toBe('ended_left')
    expect(over.exitsSoFar).toBe(2)
    const [e2] = await db
      .select()
      .from(testExit)
      .where(and(eq(testExit.attemptId, attemptId), eq(testExit.exitId, 'e2')))
    expect(e2).toMatchObject({ exitNumber: 2, awayMs: 10_001 })
    expect(e2.returnedAt).toEqual(clock)
    expect(await logKinds(attemptId)).toEqual(['ended_left'])
  })

  it('a back report for an exit whose left never arrived counts the exit once', async () => {
    const { lecturer, algo, alice } = await setup()
    const t = await makeTest(algo.id, lecturer, { maxAbsenceSeconds: 10 })
    await start(t.id)
    const attemptId = await joinRunning(alice, t)

    // Closed tab reopened 5 s later: only the back report arrives.
    const back = await sync(alice, attemptId, [], [{ exitId: 'closed-tab', phase: 'back', awayMs: 5000 }])
    expect(back.exitsSoFar).toBe(1)
    expect(back.stage).toBe('answering')
    // The queued left report turns up afterwards: still one exit.
    const late = await sync(alice, attemptId, [], [{ exitId: 'closed-tab', phase: 'left', awayMs: null }])
    expect(late.exitsSoFar).toBe(1)
    const exits = await db.select().from(testExit).where(eq(testExit.attemptId, attemptId))
    expect(exits).toHaveLength(1)
    expect(exits[0]).toMatchObject({ exitNumber: 1, awayMs: 5000 })

    // Reopened 5 minutes later: the absence is judged and ends the attempt.
    const longAway = await sync(alice, attemptId, [], [{ exitId: 'closed-again', phase: 'back', awayMs: 5 * MIN }])
    expect(longAway.stage).toBe('ended_left')
    expect(longAway.exitsSoFar).toBe(2)
  })

  it('the same exit reported twice counts once', async () => {
    const { lecturer, algo, alice } = await setup()
    const t = await makeTest(algo.id, lecturer)
    await start(t.id)
    const attemptId = await joinRunning(alice, t)

    await sync(alice, attemptId, [], [{ exitId: 'e1', phase: 'left', awayMs: null }])
    const retried = await sync(alice, attemptId, [], [
      { exitId: 'e1', phase: 'left', awayMs: null },
      { exitId: 'e1', phase: 'left', awayMs: null },
    ])
    expect(retried.exitsSoFar).toBe(1)
    await sync(alice, attemptId, [], [{ exitId: 'e1', phase: 'back', awayMs: 2000 }])
    // A retried back with another length does not change the first one.
    const again = await sync(alice, attemptId, [], [{ exitId: 'e1', phase: 'back', awayMs: 60_000 }])
    expect(again.exitsSoFar).toBe(1)
    expect(again.stage).toBe('answering')
    const exits = await db.select().from(testExit).where(eq(testExit.attemptId, attemptId))
    expect(exits).toHaveLength(1)
    expect(exits[0].awayMs).toBe(2000)
  })

  it('after being let back in, a late back for an exit settled by the reopening is not judged again', async () => {
    const { lecturer, algo, alice } = await setup()
    const t = await makeTest(algo.id, lecturer, { maxExits: 2, maxAbsenceSeconds: 10 })
    await start(t.id)
    const attemptId = await joinRunning(alice, t)
    await sync(alice, attemptId, [], [{ exitId: 'e1', phase: 'left', awayMs: null }])
    const ended = await sync(alice, attemptId, [], [{ exitId: 'e2', phase: 'left', awayMs: null }])
    expect(ended.stage).toBe('ended_left')

    // What letBackIn does (run.ts): reopen, reset the counter, stamp open exits as returned (awayMs null).
    setClock(after(START, 3 * MIN))
    await db
      .update(testAttempt)
      .set({ closedAt: null, closedReason: null, exitsSinceReopen: 0 })
      .where(eq(testAttempt.id, attemptId))
    await db.update(testExit).set({ returnedAt: clock }).where(eq(testExit.attemptId, attemptId))
    await db.insert(testLog).values({ attemptId, kind: 'reopened', at: clock, byUserId: lecturer.user.id })

    // The device's queued reports for those exits arrive late, one with a long absence.
    setClock(after(START, 4 * MIN))
    const view = await sync(alice, attemptId, [], [
      { exitId: 'e1', phase: 'back', awayMs: 2000 },
      { exitId: 'e2', phase: 'back', awayMs: 5 * MIN },
      { exitId: 'e2', phase: 'left', awayMs: null },
    ])
    expect(view.stage).toBe('answering')
    expect(view.exitsSoFar).toBe(0)
    const exits = await db.select().from(testExit).where(eq(testExit.attemptId, attemptId)).orderBy(asc(testExit.exitNumber))
    expect(exits.map((e) => e.awayMs)).toEqual([null, null])
    expect(exits.map((e) => e.returnedAt)).toEqual([after(START, 3 * MIN), after(START, 3 * MIN)])
    expect(await logKinds(attemptId)).toEqual(['ended_left', 'reopened'])

    // A new exit after the reopening counts from 1 and keeps the log's numbering.
    const next = await sync(alice, attemptId, [], [{ exitId: 'e3', phase: 'left', awayMs: null }])
    expect(next.exitsSoFar).toBe(1)
    expect(next.stage).toBe('answering')
    const [e3] = await db.select().from(testExit).where(and(eq(testExit.attemptId, attemptId), eq(testExit.exitId, 'e3')))
    expect(e3.exitNumber).toBe(3)
  })

  it('exits before Start or after the end are not counted', async () => {
    const { lecturer, algo, alice } = await setup()
    const t = await makeTest(algo.id, lecturer)
    const waiting = await openTest(alice, t.code, 'dev-A')
    const before = await sync(alice, waiting.attemptId!, [], [{ exitId: 'w1', phase: 'left', awayMs: null }])
    expect(before.exitsSoFar).toBe(0)
    expect(before.stage).toBe('waiting')
    await start(t.id)
    setClock(after(DEADLINE, 30 * SEC))
    const afterEnd = await sync(alice, waiting.attemptId!, [], [{ exitId: 'x1', phase: 'back', awayMs: 99_000 }])
    expect(afterEnd.exitsSoFar).toBe(0)
    expect(afterEnd.stage).toBe('over')
    expect(await db.select().from(testExit)).toHaveLength(0)
  })

  it('a second device within 60 s is CONFLICT open_elsewhere and its answers are not saved; after 60 s of silence it takes over', async () => {
    const { lecturer, algo, alice } = await setup()
    const t = await makeTest(algo.id, lecturer)
    const [q1, q2] = t.questions
    await start(t.id)
    const attemptId = await joinRunning(alice, t, 'phone-1')
    await sync(alice, attemptId, [mcqAnswer(q1, right(q1), 1)], [], 'phone-1')

    const elsewhere = { code: 'CONFLICT', details: { reason: 'open_elsewhere' } }
    setClock(after(clock, 59 * SEC))
    await expect(openTest(alice, t.code, 'phone-2')).rejects.toMatchObject(elsewhere)
    await expect(sync(alice, attemptId, [mcqAnswer(q1, wrong(q1), 9), mcqAnswer(q2, right(q2))], [], 'phone-2')).rejects.toMatchObject(elsewhere)
    await expect(handIn(alice, attemptId, { deviceId: 'phone-2', answers: [] })).rejects.toMatchObject(elsewhere)
    expect(await storedAnswers(attemptId)).toEqual([{ questionId: q1.id, optionId: right(q1), text: null, rev: 1 }])
    expect((await attemptRow(attemptId)).closedAt).toBeNull()

    // The first phone keeps syncing, which keeps it active.
    await sync(alice, attemptId, [], [], 'phone-1')
    const seenAt = clock
    setClock(after(seenAt, 30 * SEC))
    await expect(sync(alice, attemptId, [], [], 'phone-2')).rejects.toMatchObject(elsewhere)

    // After 60 s of silence the second phone takes over, starting from the server's copy.
    setClock(after(seenAt, 60 * SEC))
    const takeover = await openTest(alice, t.code, 'phone-2')
    expect(takeover.attemptId).toBe(attemptId)
    expect(takeover.saved).toEqual([{ questionId: q1.id, optionId: right(q1), text: null, rev: 1 }])
    expect((await attemptRow(attemptId)).deviceId).toBe('phone-2')
    // Now the first phone is the one refused.
    await expect(sync(alice, attemptId, [mcqAnswer(q2, wrong(q2))], [], 'phone-1')).rejects.toMatchObject(elsewhere)
    expect(await storedAnswers(attemptId)).toHaveLength(1)
  })

  it('handIn saves the answers and closes; calling it again changes nothing', async () => {
    const { lecturer, algo, alice } = await setup()
    const t = await makeTest(algo.id, lecturer)
    const [q1, q2, q3] = t.questions
    await start(t.id)
    const attemptId = await joinRunning(alice, t)
    await sync(alice, attemptId, [mcqAnswer(q1, right(q1))])

    setClock(after(START, 10 * MIN))
    const view = await handIn(alice, attemptId, { deviceId: 'dev-A', answers: [mcqAnswer(q2, right(q2)), mcqAnswer(q3, wrong(q3))] })
    expect(view.stage).toBe('handed_in')
    expect(view.paper).toBeNull()
    expect(view.saved).toHaveLength(3)
    const row = await attemptRow(attemptId)
    expect(row.closedReason).toBe('handed_in')
    expect(row.closedAt).toEqual(after(START, 10 * MIN))
    expect(await logKinds(attemptId)).toEqual(['handed_in'])

    setClock(after(START, 11 * MIN))
    const again = await handIn(alice, attemptId, { deviceId: 'dev-A', answers: [mcqAnswer(q3, right(q3), 2)] })
    expect(again.stage).toBe('handed_in')
    expect((await attemptRow(attemptId)).closedAt).toEqual(after(START, 10 * MIN))
    expect((await storedAnswers(attemptId)).find((a) => a.questionId === q3.id)!.optionId).toBe(wrong(q3))
    expect(await logKinds(attemptId)).toEqual(['handed_in'])
    // A sync after the hand-in saves nothing either.
    const synced = await sync(alice, attemptId, [mcqAnswer(q3, right(q3), 3)])
    expect(synced.acceptedRevs).toEqual({})
    expect(synced.stage).toBe('handed_in')
  })

  it('handIn before Start is CONFLICT not_started; after the end it saves within the grace without storing a hand-in', async () => {
    const { lecturer, algo, alice } = await setup()
    const t = await makeTest(algo.id, lecturer)
    const [q1] = t.questions
    const waiting = await openTest(alice, t.code, 'dev-A')
    await expect(handIn(alice, waiting.attemptId!, { deviceId: 'dev-A', answers: [] })).rejects.toMatchObject({
      code: 'CONFLICT',
      details: { reason: 'not_started' },
    })
    await start(t.id)
    setClock(after(DEADLINE, 30 * SEC))
    const view = await handIn(alice, waiting.attemptId!, { deviceId: 'dev-A', answers: [mcqAnswer(q1, right(q1))] })
    expect(view.stage).toBe('over')
    expect(view.saved).toHaveLength(1)
    expect((await attemptRow(waiting.attemptId!)).closedReason).toBeNull()
    expect(await logKinds(waiting.attemptId!)).toEqual([])
  })

  it('after the end a student with no attempt sees over and no attempt is created', async () => {
    const { lecturer, algo, alice } = await setup()
    const t = await makeTest(algo.id, lecturer)
    await start(t.id)
    await endForEveryone(t.id, after(START, 5 * MIN))
    setClock(after(START, 6 * MIN))
    const view = await openTest(alice, t.code, 'dev-A')
    expect(view).toMatchObject({ attemptId: null, stage: 'over', paper: null, saved: [], result: null, awaitingRelease: false })
    expect(view.endsAt).toEqual(after(START, 5 * MIN))
    expect(await db.select().from(testAttempt)).toHaveLength(0)
  })

  it("another student's attempt is FORBIDDEN on syncAttempt and handIn", async () => {
    const { lecturer, algo, alice, bob } = await setup()
    const t = await makeTest(algo.id, lecturer)
    await start(t.id)
    const attemptId = await joinRunning(alice, t)
    await expect(sync(bob, attemptId)).rejects.toMatchObject({ code: 'FORBIDDEN' })
    await expect(handIn(bob, attemptId, { deviceId: 'dev-A', answers: [] })).rejects.toMatchObject({ code: 'FORBIDDEN' })
    await expect(sync(lecturer, attemptId)).rejects.toMatchObject({ code: 'FORBIDDEN' })
    await expect(sync(alice, 'no-such-attempt')).rejects.toMatchObject({ code: 'FORBIDDEN' })
  })

  it('MCQ-only: result shown at once after hand-in; for ended_left only after the test ends for everyone', async () => {
    const { lecturer, algo, alice, bob } = await setup()
    const t = await makeTest(algo.id, lecturer, { mcq: 3, maxExits: 1 })
    const [q1, q2, q3] = t.questions
    await start(t.id)
    const aliceAttempt = await joinRunning(alice, t, 'dev-A')
    const bobAttempt = await joinRunning(bob, t, 'dev-B')

    // Alice hands in: 2 of 3 right (marks 3 + 2 of 7).
    const handed = await handIn(alice, aliceAttempt, {
      deviceId: 'dev-A',
      answers: [mcqAnswer(q1, right(q1)), mcqAnswer(q2, right(q2)), mcqAnswer(q3, wrong(q3))],
    })
    expect(handed.result).toEqual({ score: 5, outOf: 7, mcqCorrect: 2, mcqCount: 3 })
    expect(handed.awaitingRelease).toBe(false)

    // Bob leaves once (N = 1) and is ended: no result while the test runs.
    const ended = await sync(bob, bobAttempt, [mcqAnswer(q1, right(q1))], [{ exitId: 'b1', phase: 'left', awayMs: null }], 'dev-B')
    expect(ended.stage).toBe('ended_left')
    expect(ended.result).toBeNull()
    expect((await listMyTests(bob, algo.id))[0]).toMatchObject({ myStatus: 'ended_left', result: null })

    // Once the test ends for everyone, Bob sees his total.
    setClock(DEADLINE)
    const over = await sync(bob, bobAttempt, [], [], 'dev-B')
    expect(over.stage).toBe('over')
    expect(over.result).toEqual({ score: 3, outOf: 7, mcqCorrect: 1, mcqCount: 3 })
  })

  it('MCQ-only: a working student sees no total while the grace is open, then the total including the grace answers', async () => {
    const { lecturer, algo, alice } = await setup()
    const t = await makeTest(algo.id, lecturer, { mcq: 2 })
    const [q1, q2] = t.questions
    await start(t.id)
    const attemptId = await joinRunning(alice, t)
    const running = await sync(alice, attemptId, [mcqAnswer(q1, right(q1))])
    expect(running.result).toBeNull()

    // The test has ended but answers are still accepted: no total anywhere (it would be an oracle).
    setClock(after(DEADLINE, 10 * SEC))
    const atEnd = await sync(alice, attemptId)
    expect(atEnd.stage).toBe('over')
    expect(atEnd.result).toBeNull()
    setClock(after(DEADLINE, 60 * SEC))
    const graced = await sync(alice, attemptId, [mcqAnswer(q2, right(q2))])
    expect(graced.acceptedRevs).toEqual({ [q2.id]: 1 })
    expect(graced.result).toBeNull()
    expect((await openTest(alice, t.code, 'dev-A')).result).toBeNull()
    expect((await handIn(alice, attemptId, { deviceId: 'dev-A', answers: [] })).result).toBeNull()
    expect((await listMyTests(alice, algo.id))[0]).toMatchObject({ state: 'ended', result: null })

    // Once the answers are final, the total includes the grace answer.
    setClock(after(DEADLINE, 2 * MIN))
    const total = { score: 5, outOf: 5, mcqCorrect: 2, mcqCount: 2 }
    expect((await sync(alice, attemptId)).result).toEqual(total)
    expect((await openTest(alice, t.code, 'dev-A')).result).toEqual(total)
    expect((await listMyTests(alice, algo.id))[0].result).toEqual(total)
  })

  it('MCQ-only: the total cannot be used to probe answers in the grace (higher revs during it show nothing)', async () => {
    const { lecturer, algo, alice } = await setup()
    const t = await makeTest(algo.id, lecturer, { mcq: 2 })
    const [q1, q2] = t.questions
    await start(t.id)
    const attemptId = await joinRunning(alice, t)
    await sync(alice, attemptId, [mcqAnswer(q1, wrong(q1)), mcqAnswer(q2, wrong(q2))])

    setClock(after(DEADLINE, 30 * SEC))
    for (const [i, o] of q1.options.entries()) {
      const probe = await sync(alice, attemptId, [mcqAnswer(q1, o.id, 2 + i)])
      expect(probe.acceptedRevs).toEqual({ [q1.id]: 2 + i })
      expect(probe.result).toBeNull()
    }
  })

  it('ended for leaving near the end: the total waits until both the test has ended and its own grace is over', async () => {
    const { lecturer, algo, alice } = await setup()
    const t = await makeTest(algo.id, lecturer, { mcq: 2, maxExits: 1 })
    const [q1, q2] = t.questions
    await start(t.id)
    const attemptId = await joinRunning(alice, t)

    // Ended for leaving 30 s before the deadline: answers count until DEADLINE + 90 s.
    setClock(after(DEADLINE, -30 * SEC))
    const ended = await sync(alice, attemptId, [mcqAnswer(q1, right(q1))], [{ exitId: 'a1', phase: 'left', awayMs: null }])
    expect(ended.stage).toBe('ended_left')
    expect(ended.result).toBeNull()

    setClock(after(DEADLINE, 10 * SEC))
    const graced = await sync(alice, attemptId, [mcqAnswer(q2, right(q2))])
    expect(graced.acceptedRevs).toEqual({ [q2.id]: 1 })
    expect(graced.stage).toBe('over')
    expect(graced.result).toBeNull()
    expect((await listMyTests(alice, algo.id))[0].result).toBeNull()

    setClock(after(DEADLINE, 90 * SEC))
    const final = await sync(alice, attemptId)
    expect(final.result).toEqual({ score: 5, outOf: 5, mcqCorrect: 2, mcqCount: 2 })
    expect((await listMyTests(alice, algo.id))[0].result).toEqual({ score: 5, outOf: 5, mcqCorrect: 2, mcqCount: 2 })
  })

  it('a student removed from the roster mid-test is FORBIDDEN on syncAttempt and handIn', async () => {
    const { lecturer, algo, alice } = await setup()
    const t = await makeTest(algo.id, lecturer)
    const [q1] = t.questions
    await start(t.id)
    const attemptId = await joinRunning(alice, t)
    await sync(alice, attemptId, [mcqAnswer(q1, right(q1))])

    await db.insert(courseRosterAdjustment).values({ courseId: algo.id, studentId: alice.user.id, kind: 'exclude', createdBy: lecturer.user.id })
    await expect(sync(alice, attemptId, [mcqAnswer(q1, wrong(q1), 2)])).rejects.toMatchObject({ code: 'FORBIDDEN' })
    await expect(handIn(alice, attemptId, { deviceId: 'dev-A', answers: [] })).rejects.toMatchObject({ code: 'FORBIDDEN' })
    expect(await storedAnswers(attemptId)).toEqual([{ questionId: q1.id, optionId: right(q1), text: null, rev: 1 }])
    expect((await attemptRow(attemptId)).closedAt).toBeNull()
  })

  it('a higher rev with the same content keeps a mark and suggestion; a changed answer clears them', async () => {
    const { lecturer, algo, alice } = await setup()
    const t = await makeTest(algo.id, lecturer, { mcq: 1, short: 1 })
    const [q1, q2] = t.questions
    await start(t.id)
    const attemptId = await joinRunning(alice, t)
    await sync(alice, attemptId, [mcqAnswer(q1, right(q1)), shortAnswer(q2, 'osmosis')])

    const marked = {
      mark: 1.5,
      comment: 'good',
      markedBy: lecturer.user.id,
      markedAt: clock,
      suggestedMark: 1,
      suggestedReason: 'close',
      suggestedAt: clock,
    }
    await db.update(testAnswer).set(marked).where(eq(testAnswer.attemptId, attemptId))
    const marksOf = async (questionId: string) => {
      const [row] = await db
        .select()
        .from(testAnswer)
        .where(and(eq(testAnswer.attemptId, attemptId), eq(testAnswer.questionId, questionId)))
      return row
    }

    // Re-sent with a higher rev but unchanged: the rev moves, the marks stay.
    await sync(alice, attemptId, [mcqAnswer(q1, right(q1), 2), shortAnswer(q2, 'osmosis', 2)])
    expect(await marksOf(q1.id)).toMatchObject({ rev: 2, ...marked })
    expect(await marksOf(q2.id)).toMatchObject({ rev: 2, ...marked })

    // A changed option or text clears them (null counts as a change too).
    await sync(alice, attemptId, [mcqAnswer(q1, null, 3), shortAnswer(q2, 'diffusion', 3)])
    const cleared = {
      mark: null,
      comment: null,
      markedBy: null,
      markedAt: null,
      suggestedMark: null,
      suggestedReason: null,
      suggestedAt: null,
    }
    expect(await marksOf(q1.id)).toMatchObject({ rev: 3, optionId: null, ...cleared })
    expect(await marksOf(q2.id)).toMatchObject({ rev: 3, text: 'diffusion', ...cleared })
  })

  it('a reported absence is capped at how long the test has been running', async () => {
    const { lecturer, algo, alice } = await setup()
    const t = await makeTest(algo.id, lecturer, { maxAbsenceSeconds: 90 })
    await start(t.id)
    const attemptId = await joinRunning(alice, t)

    // One minute into the test, the device claims 10 minutes away: at most 60 s counts.
    const view = await sync(alice, attemptId, [], [{ exitId: 'e1', phase: 'back', awayMs: 10 * MIN }])
    expect(view.stage).toBe('answering')
    const [e1] = await db.select().from(testExit).where(eq(testExit.attemptId, attemptId))
    expect(e1.awayMs).toBe(MIN)

    // The same cap on a back arriving after its left.
    await sync(alice, attemptId, [], [{ exitId: 'e2', phase: 'left', awayMs: null }])
    setClock(after(START, 2 * MIN))
    await sync(alice, attemptId, [], [{ exitId: 'e2', phase: 'back', awayMs: 20 * MIN }])
    const [e2] = await db
      .select()
      .from(testExit)
      .where(and(eq(testExit.attemptId, attemptId), eq(testExit.exitId, 'e2')))
    expect(e2.awayMs).toBe(2 * MIN)
  })

  it('a test with short answers shows awaitingRelease and no result', async () => {
    const { lecturer, algo, alice } = await setup()
    const t = await makeTest(algo.id, lecturer, { mcq: 1, short: 1 })
    const [q1, q2] = t.questions
    await start(t.id)
    const attemptId = await joinRunning(alice, t)
    const working = await sync(alice, attemptId)
    expect(working.awaitingRelease).toBe(false)

    const handed = await handIn(alice, attemptId, { deviceId: 'dev-A', answers: [mcqAnswer(q1, right(q1)), shortAnswer(q2, 'osmosis')] })
    expect(handed.stage).toBe('handed_in')
    expect(handed.result).toBeNull()
    expect(handed.awaitingRelease).toBe(true)

    setClock(after(DEADLINE, 5 * MIN))
    const ended = await openTest(alice, t.code, 'dev-A')
    expect(ended.result).toBeNull()
    expect(ended.awaitingRelease).toBe(true)
    expect((await listMyTests(alice, algo.id))[0]).toMatchObject({ state: 'ended', result: null })

    // After marking and release: the result, and no longer awaiting.
    await db
      .update(testAnswer)
      .set({ mark: 1.5, markedBy: lecturer.user.id, markedAt: clock })
      .where(and(eq(testAnswer.attemptId, attemptId), eq(testAnswer.questionId, q2.id)))
    await db.update(courseTest).set({ resultsReleasedAt: clock }).where(eq(courseTest.id, t.id))
    const released = await openTest(alice, t.code, 'dev-A')
    expect(released.awaitingRelease).toBe(false)
    expect(released.result).toEqual({ score: 4.5, outOf: 5, mcqCorrect: 1, mcqCount: 1 })
  })

  it("listMyTests lists the course's tests with my status; another student's results never appear", async () => {
    const { lecturer, colleague, algo, alice, bob, outsider } = await setup()
    const notStarted = await makeTest(algo.id, lecturer, { title: 'Quiz 3', createdAt: after(BASE, 3 * MIN) })
    const running = await makeTest(algo.id, lecturer, { title: 'Quiz 2', createdAt: after(BASE, 2 * MIN) })
    const done = await makeTest(algo.id, lecturer, { title: 'Quiz 1', createdAt: after(BASE, MIN), mcq: 2 })
    await start(done.id, after(START, -40 * MIN))
    await start(running.id)

    // Bob takes and hands in Quiz 1 (all right) before it ended.
    setClock(after(START, -35 * MIN))
    const bobView = await openTest(bob, done.code, 'dev-B')
    await handIn(bob, bobView.attemptId!, {
      deviceId: 'dev-B',
      answers: done.questions.map((q) => mcqAnswer(q, right(q))),
    })

    setClock(after(START, MIN))
    const aliceRunning = await openTest(alice, running.code, 'dev-A')
    expect(aliceRunning.stage).toBe('answering')

    const list = await listMyTests(alice, algo.id)
    expect(list.map((i) => i.title)).toEqual(['Quiz 3', 'Quiz 2', 'Quiz 1'])
    expect(list[0]).toEqual({ testId: notStarted.id, code: notStarted.code, title: 'Quiz 3', state: 'not_started', myStatus: 'not_joined', result: null })
    expect(list[1]).toMatchObject({ testId: running.id, state: 'running', myStatus: 'working', result: null })
    expect(list[2]).toMatchObject({ testId: done.id, state: 'released', myStatus: 'not_joined', result: null })

    const bobList = await listMyTests(bob, algo.id)
    expect(bobList[2]).toMatchObject({ myStatus: 'handed_in', result: { score: 5, outOf: 5, mcqCorrect: 2, mcqCount: 2 } })

    await expect(listMyTests(outsider, algo.id)).rejects.toMatchObject({ code: 'FORBIDDEN' })
    await expect(listMyTests(colleague, algo.id)).rejects.toMatchObject({ code: 'FORBIDDEN' })
  })
})
