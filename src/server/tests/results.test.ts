import { and, eq } from 'drizzle-orm'
import type { ReactElement } from 'react'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Db } from '@/server/db'
import { testAnswer } from '@/server/db/schema'
import { setResendClientFactoryForTests, type NotifyClient } from '@/server/email/notify'
import { setAfterResponseForTests } from '@/server/lib/after-response'
import { createTestDb } from '@/test/db'
import { ctxFor, makeUser } from '@/test/factories'
import {
  at,
  clearMarkingData,
  insertStartedTest,
  joinTest,
  putAnswer,
  setClock,
  setupCourse,
  testRowOf,
} from '@/test/marking-fixture'
import { fakeSuggester } from './ai/fake'
import { setMarkSuggesterForTests } from './ai/suggester'
import { confirmMark, getMarkingQuestion, suggestMarks } from './marking'
import { getMyTestResult, releaseResults } from './results'

type Sent = { from: string; to: string; subject: string; react: ReactElement<{ url: string; locale: string; studentName: string }> }

describe('releasing test results', () => {
  let db: Db
  let tasks: Array<() => Promise<void>>
  let sent: Sent[]

  beforeAll(async () => {
    db = await createTestDb()
  })
  beforeEach(() => {
    tasks = []
    sent = []
    setAfterResponseForTests((task) => {
      tasks.push(task)
    })
    const client: NotifyClient = {
      batch: {
        send: async (payload) => {
          sent.push(...(payload as Sent[]))
          return { error: null }
        },
      },
    }
    setResendClientFactoryForTests(() => client)
    vi.stubEnv('RESEND_API_KEY', 're_test')
    vi.stubEnv('BETTER_AUTH_URL', 'https://clasync.test/')
  })
  afterEach(async () => {
    setAfterResponseForTests(null)
    setResendClientFactoryForTests(null)
    setMarkSuggesterForTests(undefined)
    vi.unstubAllEnvs()
    await clearMarkingData(db)
  })

  async function flush() {
    const pending = tasks.splice(0)
    for (const task of pending) await task()
  }

  /**
   * Alice: MCQ right, q2 and q3 answered. Bob: MCQ wrong, q2 blank, q3 answered. Carol: q2
   * answered only. Dave never joins.
   */
  async function scenario() {
    const c = await setupCourse(db)
    tasks.splice(0) // the class-join confirmations of the setup; these tests are about result emails
    const t = await insertStartedTest(db, c.lecturer, c.bio.id)
    const q2 = t.q2!
    const q3 = t.q3!
    const a = await joinTest(db, t.test.id, c.alice)
    const b = await joinTest(db, t.test.id, c.bob)
    const k = await joinTest(db, t.test.id, c.carol)
    await putAnswer(db, a.id, t.q1.id, { optionId: t.o1.id })
    await putAnswer(db, a.id, q2.id, { text: 'Water moving across a membrane' })
    await putAnswer(db, a.id, q3.id, { text: 'It stores genetic information' })
    await putAnswer(db, b.id, t.q1.id, { optionId: t.o2.id })
    await putAnswer(db, b.id, q2.id, { text: '  ' })
    await putAnswer(db, b.id, q3.id, { text: 'Makes proteins' })
    await putAnswer(db, k.id, q2.id, { text: 'No idea' })
    setClock(at(40))
    return { ...c, ...t, q2, q3, attempts: { alice: a, bob: b, carol: k } }
  }

  type Scenario = Awaited<ReturnType<typeof scenario>>

  async function confirmAll(s: Scenario) {
    await confirmMark(s.lecturer, { attemptId: s.attempts.alice.id, questionId: s.q2.id, mark: 3.5, comment: 'Name the membrane.' })
    await confirmMark(s.lecturer, { attemptId: s.attempts.carol.id, questionId: s.q2.id, mark: 0, comment: null })
    await confirmMark(s.lecturer, { attemptId: s.attempts.alice.id, questionId: s.q3.id, mark: 2, comment: null })
    await confirmMark(s.lecturer, { attemptId: s.attempts.bob.id, questionId: s.q3.id, mark: 0.5, comment: 'Not quite.' })
  }

  it('releaseResults is CONFLICT unmarked with the count while any real answer is unconfirmed', async () => {
    const s = await scenario()
    await confirmMark(s.lecturer, { attemptId: s.attempts.alice.id, questionId: s.q2.id, mark: 3, comment: null })
    // A suggestion is not a confirmation.
    setMarkSuggesterForTests(fakeSuggester)
    await suggestMarks(s.lecturer, s.q3.id)

    await expect(releaseResults(s.lecturer, s.test.id)).rejects.toMatchObject({
      code: 'CONFLICT',
      details: { reason: 'unmarked', count: 3 },
    })
    expect((await testRowOf(db, s.test.id)).resultsReleasedAt).toBeNull()
    expect(tasks).toHaveLength(0)
  })

  it('an MCQ-only test is released by itself', async () => {
    const c = await setupCourse(db)
    const t = await insertStartedTest(db, c.lecturer, c.bio.id, { mcqOnly: true })
    await joinTest(db, t.test.id, c.alice)
    setClock(at(40))
    await expect(releaseResults(c.lecturer, t.test.id)).rejects.toMatchObject({
      code: 'CONFLICT',
      details: { reason: 'automatic' },
    })
    await expect(getMyTestResult(c.alice, t.test.id)).rejects.toMatchObject({
      code: 'CONFLICT',
      details: { reason: 'automatic' },
    })
  })

  it('releaseResults releases when only blank answers and never-joined students are left, and emails each student with an attempt once', async () => {
    const s = await scenario()
    await confirmAll(s)

    expect(await releaseResults(s.lecturer, s.test.id)).toEqual({ released: 3 })
    expect((await testRowOf(db, s.test.id)).resultsReleasedAt).toEqual(at(40))
    expect(sent).toHaveLength(0) // only after the response
    await flush()

    expect(sent.map((m) => m.to).sort()).toEqual([s.alice.user.email, s.bob.user.email, s.carol.user.email].sort())
    const url = `https://clasync.test/t/${s.test.code}`
    for (const m of sent) expect(m.react.props.url).toBe(url)
    const toBob = sent.find((m) => m.to === s.bob.user.email)!
    expect(toBob.react.props.locale).toBe('fr')
    expect(toBob.subject).toContain('Cell biology')
    expect(toBob.subject).toContain('CA 1')
    expect(toBob.subject).toMatch(/résultat/i)
    expect(sent.find((m) => m.to === s.alice.user.email)!.subject).toMatch(/result/i)

    // Later calls change nothing and email nobody.
    setClock(at(50))
    expect(await releaseResults(s.lecturer, s.test.id)).toEqual({ released: 3 })
    await flush()
    expect(sent).toHaveLength(3)
    expect((await testRowOf(db, s.test.id)).resultsReleasedAt).toEqual(at(40))
  })

  it('a send failure never fails the release', async () => {
    const s = await scenario()
    await confirmAll(s)
    setResendClientFactoryForTests(() => {
      throw new Error('down')
    })
    vi.spyOn(console, 'error').mockImplementation(() => {})
    expect(await releaseResults(s.lecturer, s.test.id)).toEqual({ released: 3 })
    await flush()
    expect((await testRowOf(db, s.test.id)).resultsReleasedAt).toEqual(at(40))
    vi.restoreAllMocks()
  })

  it('a mark changed after release shows in getMyTestResult and sends no email', async () => {
    const s = await scenario()
    await confirmAll(s)
    await releaseResults(s.lecturer, s.test.id)
    await flush()
    expect((await getMyTestResult(s.bob, s.test.id)).score).toBe(0.5)

    setClock(at(60))
    await confirmMark(s.lecturer, { attemptId: s.attempts.bob.id, questionId: s.q3.id, mark: 1.75, comment: 'Re-marked.' })
    await flush()
    const bob = await getMyTestResult(s.bob, s.test.id)
    expect(bob.score).toBe(1.75)
    expect(bob.questions[1]).toMatchObject({ mark: 1.75, comment: 'Re-marked.' })
    expect(sent).toHaveLength(3)
  })

  it('an unconfirmed real answer after release reads as pending, never as 0', async () => {
    const s = await scenario()
    await confirmAll(s)
    await releaseResults(s.lecturer, s.test.id)
    // E.g. a student back on the roster after the release: their real answer has no mark yet.
    await db
      .update(testAnswer)
      .set({ mark: null, comment: null })
      .where(and(eq(testAnswer.attemptId, s.attempts.alice.id), eq(testAnswer.questionId, s.q2.id)))

    const alice = await getMyTestResult(s.alice, s.test.id)
    expect(alice).toMatchObject({ score: 4, outOf: 8, pending: 1 })
    expect(alice.questions[0]).toEqual({
      number: 2,
      prompt: 'What is osmosis?',
      mark: null,
      outOf: 4,
      comment: null,
    })
    // A blank answer is still a plain 0.
    expect((await getMyTestResult(s.bob, s.test.id)).questions[0]).toMatchObject({ mark: 0 })
  })

  it('getMyTestResult before release is CONFLICT not_released; it shows marks and comments but no options', async () => {
    const s = await scenario()
    await expect(getMyTestResult(s.alice, s.test.id)).rejects.toMatchObject({
      code: 'CONFLICT',
      details: { reason: 'not_released' },
    })
    await confirmAll(s)
    await expect(getMyTestResult(s.alice, s.test.id)).rejects.toMatchObject({ details: { reason: 'not_released' } })
    await releaseResults(s.lecturer, s.test.id)

    const alice = await getMyTestResult(s.alice, s.test.id)
    expect(alice).toEqual({
      title: 'CA 1',
      courseTitle: 'Cell biology',
      joined: true,
      score: 7.5,
      outOf: 8,
      pending: 0,
      // Multiple choice only as a total, so a mark per question can't give the key away.
      mcq: { score: 2, outOf: 2, count: 1 },
      questions: [
        { number: 2, prompt: 'What is osmosis?', mark: 3.5, outOf: 4, comment: 'Name the membrane.' },
        { number: 3, prompt: 'Name a function of DNA.', mark: 2, outOf: 2, comment: null },
      ],
    })
    // No MCQ prompt or per-question MCQ mark, no options, no correct answer, no guide.
    const text = JSON.stringify(alice)
    for (const hidden of ['Which organelle', 'Mitochondrion', 'Ribosome', 'membrane: 2', 'genetic information.', 'option', 'correct', '"kind"']) {
      expect(text).not.toContain(hidden)
    }

    expect(await getMyTestResult(s.bob, s.test.id)).toMatchObject({
      score: 0.5,
      mcq: { score: 0, outOf: 2, count: 1 },
      questions: [{ mark: 0, comment: null }, { mark: 0.5, comment: 'Not quite.' }],
    })
    // Dave never joined: every mark 0.
    expect(await getMyTestResult(s.dave, s.test.id)).toMatchObject({
      joined: false,
      score: 0,
      outOf: 8,
      mcq: { score: 0, outOf: 2, count: 1 },
      questions: [{ mark: 0 }, { mark: 0 }],
    })
  })

  it('a colleague and a student get FORBIDDEN on every lecturer function; a student cannot read another student\'s result', async () => {
    const s = await scenario()
    setMarkSuggesterForTests(fakeSuggester)
    const outsider = ctxFor(db, await makeUser(db, { role: 'student', name: 'Outsider' }))
    const otherLecturer = ctxFor(db, await makeUser(db, { role: 'lecturer', name: 'Dr Elsewhere' }))
    const confirm = { attemptId: s.attempts.alice.id, questionId: s.q2.id, mark: 4, comment: null }

    for (const who of [s.colleague, otherLecturer, s.alice]) {
      await expect(getMarkingQuestion(who, s.test.id, null)).rejects.toMatchObject({ code: 'FORBIDDEN' })
      await expect(suggestMarks(who, s.q2.id)).rejects.toMatchObject({ code: 'FORBIDDEN' })
      await expect(confirmMark(who, confirm)).rejects.toMatchObject({ code: 'FORBIDDEN' })
      await expect(releaseResults(who, s.test.id)).rejects.toMatchObject({ code: 'FORBIDDEN' })
    }
    for (const call of [
      () => getMarkingQuestion(s.lecturer, 'nope', null),
      () => suggestMarks(s.lecturer, 'nope'),
      () => confirmMark(s.lecturer, { ...confirm, attemptId: 'nope' }),
      () => confirmMark(s.lecturer, { ...confirm, questionId: 'nope' }),
      () => releaseResults(s.lecturer, 'nope'),
      () => getMyTestResult(s.alice, 'nope'),
    ]) {
      await expect(call()).rejects.toMatchObject({ code: 'FORBIDDEN' })
    }
    // An attempt of another test cannot be marked through this test's question.
    const other = await insertStartedTest(db, s.lecturer, s.bio.id)
    const elsewhere = await joinTest(db, other.test.id, s.alice)
    await putAnswer(db, elsewhere.id, other.q2!.id, { text: 'Water' })
    await expect(confirmMark(s.lecturer, { ...confirm, attemptId: elsewhere.id })).rejects.toMatchObject({ code: 'FORBIDDEN' })

    await confirmAll(s)
    await releaseResults(s.lecturer, s.test.id)
    // Only rostered students read a result, and only their own (there is no way to name another).
    await expect(getMyTestResult(outsider, s.test.id)).rejects.toMatchObject({ code: 'FORBIDDEN' })
    await expect(getMyTestResult(s.lecturer, s.test.id)).rejects.toMatchObject({ code: 'FORBIDDEN' })
    await expect(getMyTestResult(s.colleague, s.test.id)).rejects.toMatchObject({ code: 'FORBIDDEN' })
    expect((await getMyTestResult(s.carol, s.test.id)).questions[0]).toMatchObject({ mark: 0, comment: null })

    // Nothing changed through the refused calls.
    const [row] = await db
      .select()
      .from(testAnswer)
      .where(and(eq(testAnswer.attemptId, s.attempts.alice.id), eq(testAnswer.questionId, s.q2.id)))
    expect(row.mark).toBe(3.5)
  })
})
