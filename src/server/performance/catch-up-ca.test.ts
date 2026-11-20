import { eq } from 'drizzle-orm'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import type { Ctx } from '@/server/core/context'
import type { Db } from '@/server/db'
import { classStudent, courseTest } from '@/server/db/schema'
import { courseRosterQuery } from '@/server/courses/roster'
import { giveCatchUp } from '@/server/tests/authoring'
import { loadStoredQuestions } from '@/server/tests/queries'
import { createTestDb } from '@/test/db'
import { at, clearMarkingData, insertStartedTest, joinTest, putAnswer, setClock, setupCourse } from '@/test/marking-fixture'
import { loadCaInputs } from './inputs'

vi.mock('@/server/push/send', () => ({
  sendPush: vi.fn(async () => ({ sent: 0, skipped: 0, failed: 0, removed: 0 })),
  queuePush: vi.fn(async () => {}),
}))

/** The original's weight in the CA; each catch-up is set to another, which must never be used. */
const WEIGHT = 3

describe('CA with catch-up tests', () => {
  let db: Db

  beforeAll(async () => {
    db = await createTestDb()
  })
  afterEach(async () => {
    await clearMarkingData(db)
  })

  /**
   * An MCQ-only original test (T0, 30 minutes, weight 3, answers final from at(32)), with the
   * clock at(40): Alice answered it right (1), Bob wrong (0); Carol and Dave never joined. Every
   * student joined the class an hour before it.
   */
  async function ended() {
    const c = await setupCourse(db)
    await db.update(classStudent).set({ joinedAt: at(-60) }).where(eq(classStudent.classId, c.cls.id))
    const t = await insertStartedTest(db, c.lecturer, c.bio.id, { mcqOnly: true })
    await db.update(courseTest).set({ weight: WEIGHT }).where(eq(courseTest.id, t.test.id))
    const alice = await joinTest(db, t.test.id, c.alice)
    await putAnswer(db, alice.id, t.q1.id, { optionId: t.o1.id })
    const bob = await joinTest(db, t.test.id, c.bob)
    await putAnswer(db, bob.id, t.q1.id, { optionId: t.o2.id })
    setClock(at(40))
    return { ...c, ...t }
  }

  const missed = { for: 'missed', studentIds: [] }
  const picked = (...students: Ctx[]) => ({ for: 'picked', studentIds: students.map((s) => s.user.id) })

  /** Gives a catch-up of `originalId` and sets its own weight to 1 (the original's must count). */
  async function catchUp(lecturer: Ctx, originalId: string, input: unknown) {
    const cu = await giveCatchUp(lecturer, originalId, input, 'catch-up')
    await db.update(courseTest).set({ weight: 1 }).where(eq(courseTest.id, cu.id))
    return cu
  }

  /** Starts a catch-up at `when` for 30 minutes: answers final 2 minutes after its end. */
  async function start(testId: string, when = at(45)) {
    await db
      .update(courseTest)
      .set({ startedAt: when, deadlineAt: new Date(when.getTime() + 30 * 60_000) })
      .where(eq(courseTest.id, testId))
  }

  /** `student` joins the catch-up at(46) and, unless `answer` is null, answers its MCQ at(50). */
  async function sit(testId: string, student: Ctx, answer: 'right' | 'wrong' | null) {
    const attempt = await joinTest(db, testId, student, at(46))
    if (answer === null) return attempt
    const [mcq] = await loadStoredQuestions(db, testId)
    const option = mcq.options.find((o) => o.isCorrect === (answer === 'right'))!
    await putAnswer(db, attempt.id, mcq.id, { optionId: option.id }, at(50))
    return attempt
  }

  /** Each roster student's test lines in the CA, now. */
  async function lines(courseId: string) {
    const roster = await courseRosterQuery(db, { courseId })
    const { students } = await loadCaInputs(db, courseId, roster)
    return {
      of: (student: Ctx) => students.get(student.user.id)!.input.tests,
      started: [...students.values()][0]?.input.classStarted.tests,
    }
  }

  it('a missed student who sat the catch-up gets the catch-up ratio at the original weight', async () => {
    const o = await ended()
    const cu = await catchUp(o.lecturer, o.test.id, missed)
    await start(cu.id)
    await sit(cu.id, o.carol, 'right')
    setClock(at(80))

    const ca = await lines(o.bio.id)
    expect(ca.of(o.carol)).toEqual([{ weight: WEIGHT, ratio: 1 }])
    expect(ca.started).toBe(true)
  })

  it('students who sat the original are untouched by a catch-up', async () => {
    const o = await ended()
    const cu = await catchUp(o.lecturer, o.test.id, missed)

    // Not started yet.
    let ca = await lines(o.bio.id)
    expect(ca.of(o.alice)).toEqual([{ weight: WEIGHT, ratio: 1 }])
    expect(ca.of(o.bob)).toEqual([{ weight: WEIGHT, ratio: 0 }])

    // Running, then counting: Carol sat it right, Alice and Bob keep their original marks.
    await start(cu.id)
    await sit(cu.id, o.carol, 'right')
    setClock(at(60))
    ca = await lines(o.bio.id)
    expect(ca.of(o.alice)).toEqual([{ weight: WEIGHT, ratio: 1 }])
    expect(ca.of(o.bob)).toEqual([{ weight: WEIGHT, ratio: 0 }])

    setClock(at(80))
    ca = await lines(o.bio.id)
    expect(ca.of(o.alice)).toEqual([{ weight: WEIGHT, ratio: 1 }])
    expect(ca.of(o.bob)).toEqual([{ weight: WEIGHT, ratio: 0 }])
  })

  it('a missed student is left out until the catch-up counts, then 0 if they never sat it', async () => {
    const o = await ended()
    const cu = await catchUp(o.lecturer, o.test.id, missed)

    // Not started: Carol and Dave may still sit it, so the test is pending for them, not 0.
    let ca = await lines(o.bio.id)
    expect(ca.of(o.carol)).toEqual([])
    expect(ca.of(o.dave)).toEqual([])
    expect(ca.started).toBe(true)

    // Running: Carol sits it, Dave does not; still pending for both.
    await start(cu.id)
    await sit(cu.id, o.carol, 'right')
    setClock(at(60))
    ca = await lines(o.bio.id)
    expect(ca.of(o.carol)).toEqual([])
    expect(ca.of(o.dave)).toEqual([])

    // Counting: Carol has the catch-up mark, Dave never sat anything: 0 on the original.
    setClock(at(80))
    ca = await lines(o.bio.id)
    expect(ca.of(o.carol)).toEqual([{ weight: WEIGHT, ratio: 1 }])
    expect(ca.of(o.dave)).toEqual([{ weight: WEIGHT, ratio: 0 }])
  })

  it('a picked student who answered nothing keeps the original mark', async () => {
    const o = await ended()
    const cu = await catchUp(o.lecturer, o.test.id, picked(o.alice))
    await start(cu.id)
    // Alice opens the catch-up but never answers.
    await sit(cu.id, o.alice, null)

    // While the catch-up runs she may still answer: pending.
    setClock(at(60))
    expect((await lines(o.bio.id)).of(o.alice)).toEqual([])

    setClock(at(80))
    expect((await lines(o.bio.id)).of(o.alice)).toEqual([{ weight: WEIGHT, ratio: 1 }])
  })

  it('a picked student who sat it has the original mark replaced', async () => {
    const o = await ended()
    const cu = await catchUp(o.lecturer, o.test.id, picked(o.alice))
    await start(cu.id)
    // Right on the original (1), wrong on the catch-up (0).
    await sit(cu.id, o.alice, 'wrong')

    setClock(at(60))
    let ca = await lines(o.bio.id)
    // Her source does not count yet: left out. Carol was not picked: her 0 stands.
    expect(ca.of(o.alice)).toEqual([])
    expect(ca.of(o.carol)).toEqual([{ weight: WEIGHT, ratio: 0 }])

    setClock(at(80))
    ca = await lines(o.bio.id)
    expect(ca.of(o.alice)).toEqual([{ weight: WEIGHT, ratio: 0 }])
    expect(ca.of(o.bob)).toEqual([{ weight: WEIGHT, ratio: 0 }])
  })

  it('a catch-up never appears as its own test', async () => {
    const o = await ended()
    const first = await catchUp(o.lecturer, o.test.id, picked(o.carol))
    await start(first.id)
    await sit(first.id, o.carol, 'right')
    setClock(at(80))
    // A second catch-up, for Dave, not started.
    await catchUp(o.lecturer, o.test.id, picked(o.dave))

    const ca = await lines(o.bio.id)
    expect(ca.of(o.alice)).toEqual([{ weight: WEIGHT, ratio: 1 }])
    expect(ca.of(o.bob)).toEqual([{ weight: WEIGHT, ratio: 0 }])
    expect(ca.of(o.carol)).toEqual([{ weight: WEIGHT, ratio: 1 }])
    // Dave may still sit his: pending.
    expect(ca.of(o.dave)).toEqual([])
  })

  it('a student who joined after the original ended and sat no catch-up is left out', async () => {
    const o = await ended()
    // Carol, Dave and Erin join the class after the original ended (at(30)).
    const erin = await o.student('Erin', 'UB5')
    for (const late of [o.carol, o.dave, erin]) {
      await db.update(classStudent).set({ joinedAt: at(35) }).where(eq(classStudent.userId, late.user.id))
    }
    const cu = await catchUp(o.lecturer, o.test.id, picked(o.carol, o.dave))
    await start(cu.id)
    await sit(cu.id, o.carol, 'right')
    // Dave opens the catch-up and answers nothing: he took it, so the original counts (0).
    await sit(cu.id, o.dave, null)
    setClock(at(80))

    const ca = await lines(o.bio.id)
    expect(ca.of(o.carol)).toEqual([{ weight: WEIGHT, ratio: 1 }])
    expect(ca.of(o.dave)).toEqual([{ weight: WEIGHT, ratio: 0 }])
    // Erin was not picked and took nothing.
    expect(ca.of(erin)).toEqual([])
  })
})
