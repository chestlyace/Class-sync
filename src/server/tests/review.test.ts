import { eq } from 'drizzle-orm'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import type { Db } from '@/server/db'
import { courseTest } from '@/server/db/schema'
import { createTestDb } from '@/test/db'
import { ctxFor, makeUser } from '@/test/factories'
import { at, clearMarkingData, insertStartedTest, joinTest, putAnswer, setClock, setupCourse } from '@/test/marking-fixture'
import { getReviewAccess, getTestReview } from './review'

vi.mock('@/server/push/send', () => ({
  sendPush: vi.fn(async () => ({ sent: 0, skipped: 0, failed: 0, removed: 0 })),
  queuePush: vi.fn(async () => {}),
}))

describe('reviewing a released test', () => {
  let db: Db

  beforeAll(async () => {
    db = await createTestDb()
  })
  afterEach(async () => {
    await clearMarkingData(db)
  })

  async function release(testId: string) {
    await db.update(courseTest).set({ resultsReleasedAt: at(40) }).where(eq(courseTest.id, testId))
  }

  /** A test with short answers, released at(40): Alice answered everything, Bob only the MCQ (wrong). */
  async function released() {
    const c = await setupCourse(db)
    const t = await insertStartedTest(db, c.lecturer, c.bio.id)
    const a = await joinTest(db, t.test.id, c.alice)
    const b = await joinTest(db, t.test.id, c.bob)
    await putAnswer(db, a.id, t.q1.id, { optionId: t.o1.id })
    await putAnswer(db, a.id, t.q2!.id, { text: 'Water across a membrane', mark: 3.5, comment: 'Name the membrane.' })
    await putAnswer(db, a.id, t.q3!.id, { text: 'Heredity', mark: 2 })
    await putAnswer(db, b.id, t.q1.id, { optionId: t.o2.id })
    await release(t.test.id)
    setClock(at(41))
    return { ...c, ...t }
  }

  it('is open for an MCQ-only test once answers are final', async () => {
    const c = await setupCourse(db)
    const t = await insertStartedTest(db, c.lecturer, c.bio.id, { mcqOnly: true })
    await joinTest(db, t.test.id, c.alice)
    setClock(at(31)) // ended, not final yet
    expect(await getReviewAccess(c.alice, t.test.id)).toBe('waiting_results')
    setClock(at(33))
    expect(await getReviewAccess(c.alice, t.test.id)).toBe('open')
  })

  it('waits for the release when the test has short answers', async () => {
    const c = await setupCourse(db)
    const t = await insertStartedTest(db, c.lecturer, c.bio.id)
    setClock(at(40))
    expect(await getReviewAccess(c.alice, t.test.id)).toBe('waiting_results')
    await release(t.test.id)
    expect(await getReviewAccess(c.alice, t.test.id)).toBe('open')
  })

  it('waits for the other classes while a copy elsewhere is not started', async () => {
    const s = await released()
    await db.insert(courseTest).values({
      courseId: s.bio.id,
      code: 'COPY01',
      title: 'CA 1',
      durationMinutes: 30,
      defaultMark: 2,
      familyId: s.test.familyId,
      copiedFromId: s.test.id,
      createdBy: s.lecturer.user.id,
    })
    expect(await getReviewAccess(s.alice, s.test.id)).toBe('waiting_classes')
    await expect(getTestReview(s.alice, s.test.id)).rejects.toMatchObject({
      code: 'CONFLICT',
      details: { reason: 'waiting_classes' },
    })
  })

  it('is off when the lecturer switched review off, even after release', async () => {
    const s = await released()
    await db.update(courseTest).set({ studentsCanReview: false }).where(eq(courseTest.id, s.test.id))
    expect(await getReviewAccess(s.alice, s.test.id)).toBe('off')
    await expect(getTestReview(s.alice, s.test.id)).rejects.toMatchObject({ code: 'CONFLICT', details: { reason: 'off' } })
  })

  it('shows my pick, the correct option and the per-question marks', async () => {
    const s = await released()
    const review = await getTestReview(s.bob, s.test.id)
    expect(review).toMatchObject({ title: 'CA 1', courseTitle: 'Cell biology', joined: true, score: 0, outOf: 8, pending: 0 })
    const [q1] = review.questions
    expect(q1).toMatchObject({ number: 1, kind: 'mcq', prompt: 'Which organelle makes ATP?', outOf: 2, mark: 0, guide: null })
    expect(q1.options).toEqual([
      { id: s.o1.id, text: 'Mitochondrion', isCorrect: true, picked: false },
      { id: s.o2.id, text: 'Ribosome', isCorrect: false, picked: true },
    ])
  })

  it('shows my short answer, the guide, my mark and the comment', async () => {
    const s = await released()
    const review = await getTestReview(s.alice, s.test.id)
    expect(review.score).toBe(7.5)
    expect(review.questions[0]).toMatchObject({ mark: 2 })
    expect(review.questions[1]).toEqual({
      id: s.q2!.id,
      number: 2,
      kind: 'short',
      prompt: 'What is osmosis?',
      outOf: 4,
      mark: 3.5,
      comment: 'Name the membrane.',
      options: [],
      answerText: 'Water across a membrane',
      guide: 'Water moves across a membrane: 2 for water, 2 for membrane.',
    })
  })

  it("never returns another student's answers", async () => {
    const s = await released()
    const review = await getTestReview(s.bob, s.test.id)
    expect(review.questions[1]).toMatchObject({ answerText: null, mark: 0, comment: null })
    expect(review.questions[2]).toMatchObject({ answerText: null, mark: 0 })
    expect(JSON.stringify(review)).not.toContain('Water across a membrane')
    expect(JSON.stringify(review)).not.toContain('Name the membrane.')
  })

  it('shows a student who never joined every question with no answer', async () => {
    const s = await released()
    const review = await getTestReview(s.dave, s.test.id)
    expect(review.joined).toBe(false)
    expect(review.score).toBe(0)
    expect(review.questions.map((q) => q.answerText)).toEqual([null, null, null])
    expect(review.questions[0].options.every((o) => !o.picked)).toBe(true)
  })

  it('is FORBIDDEN off the roster, for a lecturer and for an unknown test', async () => {
    const s = await released()
    const outsider = ctxFor(db, await makeUser(db, { role: 'student', name: 'Eve' }))
    await expect(getReviewAccess(outsider, s.test.id)).rejects.toMatchObject({ code: 'FORBIDDEN' })
    await expect(getTestReview(outsider, s.test.id)).rejects.toMatchObject({ code: 'FORBIDDEN' })
    await expect(getTestReview(s.lecturer, s.test.id)).rejects.toMatchObject({ code: 'FORBIDDEN' })
    await expect(getTestReview(s.alice, crypto.randomUUID())).rejects.toMatchObject({ code: 'FORBIDDEN' })
  })

  it('is CONFLICT with the reason before the release', async () => {
    const c = await setupCourse(db)
    const t = await insertStartedTest(db, c.lecturer, c.bio.id)
    setClock(at(10))
    await expect(getTestReview(c.alice, t.test.id)).rejects.toMatchObject({
      code: 'CONFLICT',
      details: { reason: 'waiting_results' },
    })
  })
})
