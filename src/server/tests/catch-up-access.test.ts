import { and, eq } from 'drizzle-orm'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import type { Ctx } from '@/server/core/context'
import type { Db } from '@/server/db'
import { courseTest, testCatchUpStudent } from '@/server/db/schema'
import { createTestDb } from '@/test/db'
import { at, clearMarkingData, insertStartedTest, joinTest, setClock, setupCourse } from '@/test/marking-fixture'
import { handIn, listMyTests, openTest, resolveTestLink, syncAttempt } from './attempt'
import { giveCatchUp } from './authoring'
import { getMyTestResult } from './results'
import { getReviewAccess, getTestPracticePaper, getTestReview } from './review'

vi.mock('@/server/push/send', () => ({
  sendPush: vi.fn(async () => ({ sent: 0, skipped: 0, failed: 0, removed: 0 })),
  queuePush: vi.fn(async () => {}),
}))

const notYourCourse = { code: 'FORBIDDEN', details: { reason: 'not_your_course' } }

describe('who may open a catch-up', () => {
  let db: Db

  beforeAll(async () => {
    db = await createTestDb()
  })
  afterEach(async () => {
    await clearMarkingData(db)
  })

  /**
   * An original test with short answers (T0, 30 minutes, ended, clock at(40)): Alice and Bob
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

  const missed = { for: 'missed', studentIds: [] }
  const picked = (...students: Ctx[]) => ({ for: 'picked', studentIds: students.map((s) => s.user.id) })

  async function start(testId: string, when = at(45)) {
    await db
      .update(courseTest)
      .set({ startedAt: when, deadlineAt: new Date(when.getTime() + 30 * 60_000) })
      .where(eq(courseTest.id, testId))
  }

  it('openTest refuses an ineligible student with not_your_course', async () => {
    const o = await ended()
    const cu = await giveCatchUp(o.lecturer, o.test.id, picked(o.carol), 'catch-up')

    await expect(openTest(o.alice, cu.code, 'dev-A')).rejects.toMatchObject(notYourCourse)
    await expect(openTest(o.dave, cu.code, 'dev-A')).rejects.toMatchObject(notYourCourse)
    expect(await openTest(o.carol, cu.code, 'dev-A')).toMatchObject({ stage: 'waiting' })
  })

  it('resolveTestLink refuses an ineligible student', async () => {
    const o = await ended()
    const cu = await giveCatchUp(o.lecturer, o.test.id, missed, 'catch-up')

    await expect(resolveTestLink(o.alice, cu.code)).rejects.toMatchObject(notYourCourse)
    await expect(resolveTestLink(o.carol, cu.code)).resolves.toEqual({ role: 'student', testId: cu.id })
    // The owner's view of the link is unchanged.
    await expect(resolveTestLink(o.lecturer, cu.code)).resolves.toMatchObject({ role: 'owner', testId: cu.id })
  })

  /** Carol is picked and has opened the catch-up (a waiting attempt); then she is taken off the list. */
  async function pickedThenRemoved() {
    const o = await ended()
    const cu = await giveCatchUp(o.lecturer, o.test.id, picked(o.carol, o.dave), 'catch-up')
    const view = await openTest(o.carol, cu.code, 'dev-A')
    const attemptId = view.attemptId!
    await expect(syncAttempt(o.carol, attemptId, { deviceId: 'dev-A', answers: [], exits: [] })).resolves.toBeTruthy()
    // Removed with the attempt row still there (the service would delete the waiting attempt too).
    await db
      .delete(testCatchUpStudent)
      .where(and(eq(testCatchUpStudent.testId, cu.id), eq(testCatchUpStudent.studentId, o.carol.user.id)))
    return { o, cu, attemptId }
  }

  it('sync and hand-in refuse a student removed before Start', async () => {
    const { o, attemptId } = await pickedThenRemoved()

    // Not started: the attempt gives no hold, so the refusal comes before hand-in's not_started check.
    const refused = { code: 'FORBIDDEN' }
    await expect(syncAttempt(o.carol, attemptId, { deviceId: 'dev-A', answers: [], exits: [] })).rejects.toMatchObject(
      refused,
    )
    await expect(handIn(o.carol, attemptId, { deviceId: 'dev-A', answers: [] })).rejects.toMatchObject(refused)
  })

  it('a picked student with an attempt keeps access after Start even if removed from the list', async () => {
    const { o, cu, attemptId } = await pickedThenRemoved()
    await start(cu.id)
    setClock(at(46))

    await expect(syncAttempt(o.carol, attemptId, { deviceId: 'dev-A', answers: [], exits: [] })).resolves.toBeTruthy()
    await expect(openTest(o.carol, cu.code, 'dev-A')).resolves.toMatchObject({ stage: 'answering' })
    await expect(resolveTestLink(o.carol, cu.code)).resolves.toEqual({ role: 'student', testId: cu.id })
  })

  it('a student who sat catch-up 1 cannot open catch-up 2', async () => {
    const o = await ended()
    const first = await giveCatchUp(o.lecturer, o.test.id, missed, 'catch-up 1')
    await start(first.id)
    await joinTest(db, first.id, o.carol, at(46))
    setClock(at(80))
    const second = await giveCatchUp(o.lecturer, o.test.id, missed, 'catch-up 2')

    await expect(openTest(o.carol, second.code, 'dev-A')).rejects.toMatchObject(notYourCourse)
    await expect(resolveTestLink(o.carol, second.code)).rejects.toMatchObject(notYourCourse)
    // Dave sat neither: he may still sit the second one.
    expect(await openTest(o.dave, second.code, 'dev-A')).toMatchObject({ stage: 'waiting' })
  })

  it('listMyTests hides a catch-up from those who sat the original and marks it isCatchUp for the rest', async () => {
    const o = await ended()
    const cu = await giveCatchUp(o.lecturer, o.test.id, missed, 'catch-up')

    const forAlice = await listMyTests(o.alice, o.bio.id)
    expect(forAlice.map((t) => t.testId)).toEqual([o.test.id])
    expect(forAlice[0].isCatchUp).toBe(false)

    const forCarol = await listMyTests(o.carol, o.bio.id)
    expect(forCarol.map((t) => t.testId).sort()).toEqual([o.test.id, cu.id].sort())
    expect(Object.fromEntries(forCarol.map((t) => [t.testId, t.isCatchUp]))).toEqual({
      [o.test.id]: false,
      [cu.id]: true,
    })
  })

  it('getMyTestResult and review refuse an ineligible student', async () => {
    const o = await ended()
    const cu = await giveCatchUp(o.lecturer, o.test.id, picked(o.carol), 'catch-up')
    await start(cu.id)
    // Both released, so the family hold does not get in the way of the picked student.
    await db.update(courseTest).set({ resultsReleasedAt: at(80) }).where(eq(courseTest.id, cu.id))
    await db.update(courseTest).set({ resultsReleasedAt: at(40) }).where(eq(courseTest.id, o.test.id))
    setClock(at(81))

    const refused = { code: 'FORBIDDEN' }
    await expect(getMyTestResult(o.alice, cu.id)).rejects.toMatchObject(refused)
    await expect(getReviewAccess(o.alice, cu.id)).rejects.toMatchObject(refused)
    await expect(getTestReview(o.alice, cu.id)).rejects.toMatchObject(refused)
    await expect(getTestPracticePaper(o.alice, cu.id)).rejects.toMatchObject(refused)
    // A picked student is not refused.
    await expect(getReviewAccess(o.carol, cu.id)).resolves.toBe('open')
  })

  it('review of the original closes while a catch-up is unreleased', async () => {
    const o = await ended()
    await db.update(courseTest).set({ resultsReleasedAt: at(40) }).where(eq(courseTest.id, o.test.id))
    setClock(at(41))
    expect(await getReviewAccess(o.alice, o.test.id)).toBe('open')

    const cu = await giveCatchUp(o.lecturer, o.test.id, missed, 'catch-up')
    expect(await getReviewAccess(o.alice, o.test.id)).toBe('waiting_classes')

    await start(cu.id)
    await db.update(courseTest).set({ resultsReleasedAt: at(80) }).where(eq(courseTest.id, cu.id))
    setClock(at(81))
    expect(await getReviewAccess(o.alice, o.test.id)).toBe('open')
  })
})
