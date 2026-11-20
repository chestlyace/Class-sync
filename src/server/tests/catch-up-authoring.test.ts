import { eq } from 'drizzle-orm'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import type { Ctx } from '@/server/core/context'
import type { Db } from '@/server/db'
import { courseTest, testAttempt, testCatchUpStudent } from '@/server/db/schema'
import { setRosterAdjustment } from '@/server/courses/service'
import { createTestDb } from '@/test/db'
import { ctxFor, makeUser } from '@/test/factories'
import {
  at,
  clearMarkingData,
  insertStartedTest,
  joinTest,
  setClock,
  setupCourse,
  testRowOf,
} from '@/test/marking-fixture'
import { racing } from '@/test/race'
import {
  copyTest,
  getCatchUpOptions,
  getCatchUpStudents,
  getTestForEdit,
  giveCatchUp,
  listCourseTests,
  setCatchUpStudents,
  updateTest,
} from './authoring'
import { loadStoredQuestions } from './queries'

vi.mock('@/server/push/send', () => ({
  sendPush: vi.fn(async () => ({ sent: 0, skipped: 0, failed: 0, removed: 0 })),
  queuePush: vi.fn(async () => {}),
}))

async function expectAppError(promise: Promise<unknown>, code: string, details?: Record<string, unknown>) {
  const err = await promise.then(
    () => null,
    (e: unknown) => e,
  )
  expect(err, `expected ${code}`).toMatchObject({ code })
  if (details) expect((err as { details?: unknown }).details).toEqual(details)
}

describe('giving and editing a catch-up', () => {
  let db: Db

  beforeAll(async () => {
    db = await createTestDb()
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

  async function start(testId: string, when = at(45)) {
    await db
      .update(courseTest)
      .set({ startedAt: when, deadlineAt: new Date(when.getTime() + 30 * 60_000) })
      .where(eq(courseTest.id, testId))
  }

  async function pickedIds(testId: string) {
    const rows = await db.select().from(testCatchUpStudent).where(eq(testCatchUpStudent.testId, testId))
    return rows.map((r) => r.studentId).sort()
  }

  async function attemptHolders(testId: string) {
    const rows = await db.select().from(testAttempt).where(eq(testAttempt.testId, testId))
    return rows.map((r) => r.studentId).sort()
  }

  async function testCount() {
    return (await db.select({ id: courseTest.id }).from(courseTest)).length
  }

  const ids = (...students: Ctx[]) => students.map((s) => s.user.id).sort()
  const picked = (...students: Ctx[]) => ({ for: 'picked', studentIds: students.map((s) => s.user.id) })
  const missed = { for: 'missed', studentIds: [] }

  it('getCatchUpOptions labels each student by their attempt on the original', async () => {
    const c = await setupCourse(db)
    const t = await insertStartedTest(db, c.lecturer, c.bio.id)
    const close = async (student: Ctx, closedReason: 'handed_in' | 'left') => {
      const a = await joinTest(db, t.test.id, student)
      await db.update(testAttempt).set({ closedReason, closedAt: at(20) }).where(eq(testAttempt.id, a.id))
    }
    await close(c.alice, 'handed_in')
    await close(c.bob, 'left')
    await joinTest(db, t.test.id, c.carol) // never closed: the connection dropped
    setClock(at(40))

    const options = await getCatchUpOptions(c.lecturer, t.test.id)
    const statusOf = Object.fromEntries(options.students.map((s) => [s.name, s.status]))
    expect(statusOf).toEqual({
      Alice: 'handed_in',
      Bob: 'left_early',
      Carol: 'not_handed_in',
      Dave: 'not_joined',
    })
    expect(options.students.find((s) => s.name === 'Dave')).toMatchObject({
      studentId: c.dave.user.id,
      matricule: 'UB4',
    })
    expect(options.missedCount).toBe(1)
    expect(options.original).toMatchObject({ id: t.test.id, state: 'ended', catchUpOf: null })
    // Short answers not released yet: nobody has seen the answers.
    expect(options.answersMayBeOut).toBe(false)

    await db.update(courseTest).set({ resultsReleasedAt: at(50) }).where(eq(courseTest.id, t.test.id))
    expect((await getCatchUpOptions(c.lecturer, t.test.id)).answersMayBeOut).toBe(true)
    await db.update(courseTest).set({ studentsCanReview: false }).where(eq(courseTest.id, t.test.id))
    expect((await getCatchUpOptions(c.lecturer, t.test.id)).answersMayBeOut).toBe(false)

    await expectAppError(getCatchUpOptions(c.colleague, t.test.id), 'FORBIDDEN')
    await expectAppError(getCatchUpOptions(c.alice, t.test.id), 'FORBIDDEN')
  })

  it('getCatchUpOptions for an existing catch-up does not count its own attempts against missed', async () => {
    const o = await ended()
    // Carol and Dave missed the original. Carol sits the "missed" catch-up; Dave a picked one.
    const cu = await giveCatchUp(o.lecturer, o.test.id, missed, 'catch-up')
    const other = await giveCatchUp(o.lecturer, o.test.id, picked(o.dave), 'catch-up')
    await start(cu.id, at(45))
    await start(other.id, at(45))
    await joinTest(db, cu.id, o.carol, at(46))
    await joinTest(db, other.id, o.dave, at(46))
    setClock(at(50))

    // A new catch-up: both have sat one, so nobody is left who missed it.
    expect((await getCatchUpOptions(o.lecturer, o.test.id)).missedCount).toBe(0)
    // This catch-up's edit page: Carol's own attempt does not count against her; Dave's on the
    // other catch-up still does.
    expect((await getCatchUpOptions(o.lecturer, o.test.id, cu.id)).missedCount).toBe(1)
    expect((await getCatchUpOptions(o.lecturer, o.test.id, other.id)).missedCount).toBe(1)

    // Only a catch-up of this test.
    await expectAppError(getCatchUpOptions(o.lecturer, o.test.id, o.test.id), 'VALIDATION', {
      fields: ['forCatchUpId'],
    })
  })

  it('giveCatchUp refuses a running test and a catch-up', async () => {
    const o = await ended()

    setClock(at(10))
    await expectAppError(getCatchUpOptions(o.lecturer, o.test.id), 'CONFLICT', { reason: 'not_ended' })
    await expectAppError(giveCatchUp(o.lecturer, o.test.id, missed, 'catch-up'), 'CONFLICT', { reason: 'not_ended' })
    expect(await testCount()).toBe(1)

    // Ended now; a catch-up of it cannot have a catch-up of its own, even once it has ended too.
    setClock(at(40))
    const cu = await giveCatchUp(o.lecturer, o.test.id, missed, 'catch-up')
    await start(cu.id, at(45))
    setClock(at(90))
    await expectAppError(getCatchUpOptions(o.lecturer, cu.id), 'CONFLICT', { reason: 'is_catch_up' })
    await expectAppError(giveCatchUp(o.lecturer, cu.id, missed, 'catch-up'), 'CONFLICT', { reason: 'is_catch_up' })
    expect(await testCount()).toBe(2)

    // A test not started yet has not ended either.
    const fresh = await copyTest(o.lecturer, o.test.id, o.bio.id)
    await expectAppError(giveCatchUp(o.lecturer, fresh.id, missed, 'catch-up'), 'CONFLICT', { reason: 'not_ended' })

    await expectAppError(giveCatchUp(o.colleague, o.test.id, missed, 'catch-up'), 'FORBIDDEN')
    expect(await testCount()).toBe(3)
  })

  it('giveCatchUp copies questions into the same family with the original weight', async () => {
    const o = await ended()
    await db.update(courseTest).set({ weight: 3, studentsCanReview: false }).where(eq(courseTest.id, o.test.id))

    const cu = await giveCatchUp(o.lecturer, o.test.id, picked(o.dave, o.dave), 'catch-up')
    expect(cu).toMatchObject({
      courseId: o.bio.id,
      title: 'CA 1 (catch-up)',
      state: 'not_started',
      questionCount: 3,
      totalMarks: 8,
      hasShort: true,
      startedAt: null,
      joined: 0,
      studentsCanReview: false,
      catchUpOf: { id: o.test.id, title: 'CA 1' },
      catchUpFor: 'picked',
      pickedCount: 1,
    })
    expect(cu.code).not.toBe(o.test.code)

    const original = await testRowOf(db, o.test.id)
    const row = await testRowOf(db, cu.id)
    expect(row).toMatchObject({
      familyId: original.familyId,
      copiedFromId: o.test.id,
      catchUpOfId: o.test.id,
      catchUpFor: 'picked',
      weight: 3,
      durationMinutes: original.durationMinutes,
      defaultMark: original.defaultMark,
      shuffle: original.shuffle,
      maxExits: original.maxExits,
      maxAbsenceSeconds: original.maxAbsenceSeconds,
      createdBy: o.lecturer.user.id,
    })
    const strip = (qs: Awaited<ReturnType<typeof loadStoredQuestions>>) =>
      qs.map(({ kind, prompt, mark, guide, options }) => ({
        kind,
        prompt,
        mark,
        guide,
        options: options.map(({ text, isCorrect }) => ({ text, isCorrect })),
      }))
    expect(strip(await loadStoredQuestions(db, cu.id))).toEqual(strip(await loadStoredQuestions(db, o.test.id)))
    const [pick] = await db.select().from(testCatchUpStudent).where(eq(testCatchUpStudent.testId, cu.id))
    expect(pick).toMatchObject({ studentId: o.dave.user.id, addedBy: o.lecturer.user.id })
    expect(await pickedIds(cu.id)).toEqual(ids(o.dave))

    const forMissed = await giveCatchUp(o.lecturer, o.test.id, missed, 'rattrapage')
    expect(forMissed).toMatchObject({ title: 'CA 1 (rattrapage)', catchUpFor: 'missed', pickedCount: null })
    expect(await pickedIds(forMissed.id)).toEqual([])
  })

  it('giveCatchUp shortens a long original title to fit the suffix', async () => {
    const o = await ended()
    // 199 characters: with " (rattrapage)" it would be 212, over the 200 limit.
    const long = 'Word '.repeat(40).trim()
    await db.update(courseTest).set({ title: long }).where(eq(courseTest.id, o.test.id))

    const cu = await giveCatchUp(o.lecturer, o.test.id, missed, 'rattrapage')
    // Cut at the last space before the limit, then the suffix.
    expect(cu.title).toBe(`${'Word '.repeat(37).trim()} (rattrapage)`)
    expect(cu.title.length).toBeLessThanOrEqual(200)
    expect(cu.catchUpOf).toEqual({ id: o.test.id, title: long })

    // A title with no space to cut at is cut at the limit.
    const word = 'x'.repeat(200)
    await db.update(courseTest).set({ title: word }).where(eq(courseTest.id, o.test.id))
    const other = await giveCatchUp(o.lecturer, o.test.id, picked(o.carol), 'catch-up')
    expect(other.title).toBe(`${'x'.repeat(189)} (catch-up)`)
    expect(other.title.length).toBe(200)
  })

  it('giveCatchUp missed refuses when everyone sat it', async () => {
    const o = await ended()
    await joinTest(db, o.test.id, o.carol)
    // Dave missed it, then sat a catch-up of it: nobody is left who missed it.
    const first = await giveCatchUp(o.lecturer, o.test.id, missed, 'catch-up')
    await start(first.id, at(45))
    await joinTest(db, first.id, o.dave, at(46))
    setClock(at(90))

    expect((await getCatchUpOptions(o.lecturer, o.test.id)).missedCount).toBe(0)
    await expectAppError(giveCatchUp(o.lecturer, o.test.id, missed, 'catch-up'), 'VALIDATION', {
      reason: 'nobody_missed',
    })
    expect(await testCount()).toBe(2)

    // "Only these students" stays available.
    const forPicked = await giveCatchUp(o.lecturer, o.test.id, picked(o.alice), 'catch-up')
    expect(forPicked).toMatchObject({ catchUpFor: 'picked', pickedCount: 1 })
  })

  it('giveCatchUp picked refuses an empty list and an off-roster id', async () => {
    const o = await ended()
    const stranger = ctxFor(db, await makeUser(db, { role: 'student', name: 'Stranger' }))

    await expectAppError(giveCatchUp(o.lecturer, o.test.id, picked(), 'catch-up'), 'VALIDATION', {
      fields: ['studentIds'],
    })
    await expectAppError(giveCatchUp(o.lecturer, o.test.id, picked(o.carol, stranger), 'catch-up'), 'VALIDATION', {
      fields: ['studentIds'],
    })
    await expectAppError(giveCatchUp(o.lecturer, o.test.id, { for: 'some' }, 'catch-up'), 'VALIDATION', {
      fields: ['for'],
    })
    await expectAppError(giveCatchUp(o.lecturer, o.test.id, picked(o.carol), '  '), 'VALIDATION', {
      fields: ['titleSuffix'],
    })
    expect(await testCount()).toBe(1)
  })

  it('setCatchUpStudents before Start deletes the waiting attempt of a removed student', async () => {
    const o = await ended()
    const cu = await giveCatchUp(o.lecturer, o.test.id, picked(o.alice, o.carol), 'catch-up')
    // Opening the link before Start makes a waiting attempt.
    await joinTest(db, cu.id, o.alice, at(41))
    await joinTest(db, cu.id, o.carol, at(41))

    const one = await setCatchUpStudents(o.lecturer, cu.id, picked(o.carol, o.bob))
    expect(one).toMatchObject({ catchUpFor: 'picked', pickedCount: 2 })
    expect(await pickedIds(cu.id)).toEqual(ids(o.carol, o.bob))
    expect(await attemptHolders(cu.id)).toEqual(ids(o.carol))

    // Switching to "everyone who missed it": Bob sat the original, Carol did not.
    await joinTest(db, cu.id, o.bob, at(42))
    const two = await setCatchUpStudents(o.lecturer, cu.id, missed)
    expect(two).toMatchObject({ catchUpFor: 'missed', pickedCount: null })
    expect(await pickedIds(cu.id)).toEqual([])
    expect(await attemptHolders(cu.id)).toEqual(ids(o.carol))
    expect((await testRowOf(db, cu.id)).catchUpFor).toBe('missed')

    await expectAppError(setCatchUpStudents(o.lecturer, cu.id, picked()), 'VALIDATION', { fields: ['studentIds'] })
    await expectAppError(setCatchUpStudents(o.colleague, cu.id, missed), 'FORBIDDEN')
    await expectAppError(setCatchUpStudents(o.lecturer, o.test.id, missed), 'CONFLICT', { reason: 'not_catch_up' })
  })

  it('setCatchUpStudents after Start adds, removes students without an attempt, and refuses removing one with an attempt', async () => {
    const o = await ended()
    const cu = await giveCatchUp(o.lecturer, o.test.id, picked(o.carol), 'catch-up')
    await start(cu.id, at(45))
    await joinTest(db, cu.id, o.carol, at(46))
    setClock(at(50))

    const added = await setCatchUpStudents(o.lecturer, cu.id, picked(o.carol, o.dave))
    expect(added).toMatchObject({ catchUpFor: 'picked', pickedCount: 2, state: 'running' })
    expect(await pickedIds(cu.id)).toEqual(ids(o.carol, o.dave))
    // Sending the same list again changes nothing.
    await setCatchUpStudents(o.lecturer, cu.id, picked(o.dave, o.carol))
    expect(await pickedIds(cu.id)).toEqual(ids(o.carol, o.dave))

    // Dave never opened it: he can be taken off, and added back.
    const removed = await setCatchUpStudents(o.lecturer, cu.id, picked(o.carol))
    expect(removed).toMatchObject({ pickedCount: 1 })
    expect(await pickedIds(cu.id)).toEqual(ids(o.carol))
    await setCatchUpStudents(o.lecturer, cu.id, picked(o.carol, o.dave))
    expect(await pickedIds(cu.id)).toEqual(ids(o.carol, o.dave))

    // Carol has an attempt: taking her off is refused, and nothing else changes with it
    // (neither Dave's removal nor Alice's addition).
    await expectAppError(setCatchUpStudents(o.lecturer, cu.id, picked(o.dave)), 'CONFLICT', { reason: 'started' })
    await expectAppError(setCatchUpStudents(o.lecturer, cu.id, picked(o.alice)), 'CONFLICT', { reason: 'started' })
    await expectAppError(setCatchUpStudents(o.lecturer, cu.id, missed), 'CONFLICT', { reason: 'started' })
    expect(await pickedIds(cu.id)).toEqual(ids(o.carol, o.dave))
    expect(await attemptHolders(cu.id)).toEqual(ids(o.carol))
    expect((await testRowOf(db, cu.id)).catchUpFor).toBe('picked')
  })

  it('setCatchUpStudents racing Start', async () => {
    const o = await ended()
    const cu = await giveCatchUp(o.lecturer, o.test.id, picked(o.alice, o.carol), 'catch-up')
    await joinTest(db, cu.id, o.alice, at(41))

    // Start commits between the check (not started) and the write: nothing changes.
    await expectAppError(
      setCatchUpStudents(
        racing(o.lecturer, 'transaction', () => start(cu.id)),
        cu.id,
        picked(o.carol),
      ),
      'CONFLICT',
      { reason: 'started' },
    )
    expect(await pickedIds(cu.id)).toEqual(ids(o.alice, o.carol))
    expect(await attemptHolders(cu.id)).toEqual(ids(o.alice))
    expect((await testRowOf(db, cu.id)).catchUpFor).toBe('picked')

    // Deleted in between is FORBIDDEN, as for any missing test.
    const other = await giveCatchUp(o.lecturer, o.test.id, missed, 'catch-up')
    const gone = async () => db.delete(courseTest).where(eq(courseTest.id, other.id))
    await expectAppError(
      setCatchUpStudents(racing(o.lecturer, 'transaction', gone), other.id, picked(o.carol)),
      'FORBIDDEN',
    )
  })

  it('getCatchUpStudents returns the picked ids to the owner only', async () => {
    const o = await ended()
    const cu = await giveCatchUp(o.lecturer, o.test.id, picked(o.carol, o.dave), 'catch-up')
    const before = await getCatchUpStudents(o.lecturer, cu.id)
    expect(before.studentIds.sort()).toEqual(ids(o.carol, o.dave))
    expect(before.withAttempt).toEqual([])
    // Which picked students have an attempt on it (the edit form keeps them ticked after Start).
    await start(cu.id, at(45))
    await joinTest(db, cu.id, o.carol, at(46))
    const after = await getCatchUpStudents(o.lecturer, cu.id)
    expect(after.studentIds.sort()).toEqual(ids(o.carol, o.dave))
    expect(after.withAttempt).toEqual(ids(o.carol))

    const forMissed = await giveCatchUp(o.lecturer, o.test.id, missed, 'catch-up')
    expect(await getCatchUpStudents(o.lecturer, forMissed.id)).toEqual({ studentIds: [], withAttempt: [] })

    await expectAppError(getCatchUpStudents(o.colleague, cu.id), 'FORBIDDEN')
    await expectAppError(getCatchUpStudents(o.alice, cu.id), 'FORBIDDEN')
    await expectAppError(getCatchUpStudents(o.lecturer, o.test.id), 'CONFLICT', { reason: 'not_catch_up' })
  })

  it('updateTest on a catch-up keeps the original weight', async () => {
    const o = await ended()
    await db.update(courseTest).set({ weight: 3 }).where(eq(courseTest.id, o.test.id))
    const cu = await giveCatchUp(o.lecturer, o.test.id, missed, 'catch-up')

    const { input } = await getTestForEdit(o.lecturer, cu.id)
    expect(input.weight).toBe(3)
    const updated = await updateTest(o.lecturer, cu.id, { ...input, title: 'CA 1 resit', weight: 10 })
    expect(updated).toMatchObject({ title: 'CA 1 resit', catchUpOf: { id: o.test.id, title: 'CA 1' } })
    expect(await testRowOf(db, cu.id)).toMatchObject({ title: 'CA 1 resit', weight: 3 })

    // An ordinary test still takes the input weight.
    const copy = await copyTest(o.lecturer, o.test.id, o.bio.id)
    const copyInput = (await getTestForEdit(o.lecturer, copy.id)).input
    await updateTest(o.lecturer, copy.id, { ...copyInput, weight: 10 })
    expect((await testRowOf(db, copy.id)).weight).toBe(10)
  })

  it('copyTest of a catch-up is an ordinary test', async () => {
    const o = await ended()
    const cu = await giveCatchUp(o.lecturer, o.test.id, picked(o.carol), 'catch-up')

    const copy = await copyTest(o.lecturer, cu.id, o.bio.id)
    expect(copy).toMatchObject({
      title: 'CA 1 (catch-up)',
      state: 'not_started',
      catchUpOf: null,
      catchUpFor: null,
      pickedCount: null,
    })
    expect(await testRowOf(db, copy.id)).toMatchObject({ catchUpOfId: null, catchUpFor: null, copiedFromId: cu.id })
    expect(await pickedIds(copy.id)).toEqual([])
  })

  it('listCourseTests shows catchUpOf, pickedCount and missedCount', async () => {
    const o = await ended()
    const forMissed = await giveCatchUp(o.lecturer, o.test.id, missed, 'catch-up')
    const forPicked = await giveCatchUp(o.lecturer, o.test.id, picked(o.carol, o.dave), 'catch-up')

    const byId = new Map((await listCourseTests(o.lecturer, o.bio.id)).map((t) => [t.id, t]))
    expect(byId.size).toBe(3)
    expect(byId.get(o.test.id)).toMatchObject({ catchUpOf: null, catchUpFor: null, pickedCount: null, missedCount: null })
    // Carol and Dave missed the original.
    expect(byId.get(forMissed.id)).toMatchObject({
      catchUpOf: { id: o.test.id, title: 'CA 1' },
      catchUpFor: 'missed',
      pickedCount: null,
      missedCount: 2,
    })
    expect(byId.get(forPicked.id)).toMatchObject({
      catchUpOf: { id: o.test.id, title: 'CA 1' },
      catchUpFor: 'picked',
      pickedCount: 2,
      missedCount: null,
    })

    // Like `joined`, a picked student taken off the roster no longer counts.
    await setRosterAdjustment(o.lecturer, o.bio.id, o.dave.user.id, 'exclude')
    const after = new Map((await listCourseTests(o.lecturer, o.bio.id)).map((t) => [t.id, t]))
    expect(after.get(forPicked.id)?.pickedCount).toBe(1)
    expect(after.get(forMissed.id)?.missedCount).toBe(1)
  })
})
