import { eq } from 'drizzle-orm'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Ctx } from '@/server/core/context'
import type { Db } from '@/server/db'
import { courseTest } from '@/server/db/schema'
import type { PushItem } from '@/server/push/send'
import { sendPush } from '@/server/push/send'
import { createTestDb } from '@/test/db'
import { at, clearMarkingData, insertStartedTest, joinTest, putAnswer, setClock, setupCourse } from '@/test/marking-fixture'
import { giveCatchUp } from './authoring'
import { getMarkingQuestion } from './marking'
import { loadStoredQuestions } from './queries'
import { getLiveTest, getTestResults, startTest } from './run'

vi.mock('@/server/push/send', () => {
  const sendPush = vi.fn(async (items: unknown[]) => ({ sent: 0, skipped: items.length, failed: 0, removed: 0 }))
  return {
    sendPush,
    queuePush: vi.fn(async (_context: string, build: () => Promise<unknown[]>) => {
      await sendPush(await build())
    }),
  }
})

describe('running a catch-up', () => {
  let db: Db

  beforeAll(async () => {
    db = await createTestDb()
  })
  beforeEach(() => {
    vi.mocked(sendPush).mockClear()
  })
  afterEach(async () => {
    await clearMarkingData(db)
  })

  /**
   * An original test (T0, 30 minutes, ended by at(40), where the clock is set): Alice and Bob
   * joined it, Carol and Dave did not.
   */
  async function ended() {
    const c = await setupCourse(db)
    const t = await insertStartedTest(db, c.lecturer, c.bio.id)
    await joinTest(db, t.test.id, c.alice)
    await joinTest(db, t.test.id, c.bob)
    setClock(at(40))
    return { ...c, ...t }
  }

  const picked = (...students: Ctx[]) => ({ for: 'picked', studentIds: students.map((s) => s.user.id) })

  async function start(testId: string, when = at(45)) {
    await db
      .update(courseTest)
      .set({ startedAt: when, deadlineAt: new Date(when.getTime() + 30 * 60_000) })
      .where(eq(courseTest.id, testId))
  }

  /** Answers the catch-up's first question (the MCQ) correctly as `attemptId`. */
  async function answerMcq(testId: string, attemptId: string) {
    const [mcq] = await loadStoredQuestions(db, testId)
    const correct = mcq.options.find((o) => o.isCorrect)!
    await putAnswer(db, attemptId, mcq.id, { optionId: correct.id }, at(50))
  }

  it('live view of a picked catch-up lists only the picked students', async () => {
    const o = await ended()
    const cu = await giveCatchUp(o.lecturer, o.test.id, picked(o.carol, o.dave), 'catch-up')

    const live = await getLiveTest(o.lecturer, cu.id)
    expect(live.counts.roster).toBe(2)
    expect(live.rows.map((r) => r.studentId).sort()).toEqual([o.carol.user.id, o.dave.user.id].sort())

    // The original still lists everyone on the roster.
    const original = await getLiveTest(o.lecturer, o.test.id)
    expect(original.counts.roster).toBe(4)
  })

  it('results of an original show the catch-up mark beside the student', async () => {
    const o = await ended()
    const cu = await giveCatchUp(o.lecturer, o.test.id, picked(o.carol, o.dave), 'catch-up')
    await start(cu.id)
    const attempt = await joinTest(db, cu.id, o.carol, at(46))
    await answerMcq(cu.id, attempt.id)
    setClock(at(80))

    const original = await getTestResults(o.lecturer, o.test.id)
    const byId = new Map(original.rows.map((r) => [r.studentId, r]))
    expect(original.rows).toHaveLength(4)
    expect(byId.get(o.carol.user.id)?.catchUp).toMatchObject({
      testId: cu.id,
      title: cu.title,
      score: 2,
      outOf: 8,
    })
    // Alice sat the original only; Dave was picked but never opened the catch-up.
    expect(byId.get(o.alice.user.id)?.catchUp).toBeNull()
    expect(byId.get(o.dave.user.id)?.catchUp).toBeNull()
    expect(original.catchUps).toEqual([{ id: cu.id, title: cu.title, state: 'ended' }])

    // On the catch-up's own results: only its students, no nested catch-up.
    const own = await getTestResults(o.lecturer, cu.id)
    expect(own.rows.map((r) => r.studentId).sort()).toEqual([o.carol.user.id, o.dave.user.id].sort())
    expect(own.rows.every((r) => r.catchUp === null)).toBe(true)
    expect(own.catchUps).toEqual([])
    expect(own.rows.find((r) => r.studentId === o.carol.user.id)?.score).toBe(2)
  })

  it('results ignore a catch-up attempt with no answers', async () => {
    const o = await ended()
    const cu = await giveCatchUp(o.lecturer, o.test.id, picked(o.carol, o.dave), 'catch-up')
    await start(cu.id)
    // Carol answers; Dave only opens the link.
    const carolAttempt = await joinTest(db, cu.id, o.carol, at(46))
    await answerMcq(cu.id, carolAttempt.id)
    await joinTest(db, cu.id, o.dave, at(47))
    setClock(at(80))

    const { rows } = await getTestResults(o.lecturer, o.test.id)
    const byId = new Map(rows.map((r) => [r.studentId, r]))
    expect(byId.get(o.carol.user.id)?.catchUp).toMatchObject({ testId: cu.id })
    expect(byId.get(o.dave.user.id)?.catchUp).toBeNull()
  })

  it('starting a catch-up pushes only to eligible students', async () => {
    const o = await ended()
    const cu = await giveCatchUp(o.lecturer, o.test.id, picked(o.carol, o.dave), 'catch-up')
    setClock(at(45))
    vi.mocked(sendPush).mockClear()

    await startTest(o.lecturer, cu.id)

    const calls = vi.mocked(sendPush).mock.calls
    expect(calls).toHaveLength(1)
    const items = calls[0][0] as PushItem[]
    expect(items.map((i) => i.userId).sort()).toEqual([o.carol.user.id, o.dave.user.id].sort())
    expect(items[0].payload).toMatchObject({ kind: 'testStarted' })
  })

  it('marking of a catch-up counts blanks among eligible students only', async () => {
    const o = await ended()
    const cu = await giveCatchUp(o.lecturer, o.test.id, picked(o.carol, o.dave), 'catch-up')
    await start(cu.id)
    // Carol opened the catch-up and left every answer blank; Dave, picked, never opened it.
    await joinTest(db, cu.id, o.carol, at(46))
    setClock(at(80))

    const question = await getMarkingQuestion(o.lecturer, cu.id, null)
    expect(question.answers).toEqual([])
    // Not the four roster students, nor Dave: only Carol joined and left it blank.
    expect(question.blank).toBe(1)
  })
})
