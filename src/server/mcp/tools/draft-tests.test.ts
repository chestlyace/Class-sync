import { eq } from 'drizzle-orm'
import { afterEach, beforeAll, describe, expect, it } from 'vitest'
import type { Db } from '@/server/db'
import { courseTest, testQuestion } from '@/server/db/schema'
import { getTestForEdit } from '@/server/tests/authoring'
import { confirmMark, getMarkingQuestion, storeAssistantSuggestions } from '@/server/tests/marking'
import { createTestDb } from '@/test/db'
import {
  answerRow,
  at,
  clearMarkingData,
  insertStartedTest,
  joinTest,
  putAnswer,
  setClock,
  setupCourse,
} from '@/test/marking-fixture'
import { callTool, parseToolInput } from '@/test/mcp'

const questions = [
  {
    kind: 'mcq',
    prompt: 'Which organelle makes ATP?',
    options: [
      { text: 'Mitochondrion', correct: true },
      { text: 'Ribosome', correct: false },
    ],
  },
  { kind: 'short', prompt: 'What is osmosis?', mark: 4, guide: 'Water across a membrane.' },
]

describe('test draft tools', () => {
  let db: Db

  beforeAll(async () => {
    db = await createTestDb()
  })
  afterEach(async () => {
    await clearMarkingData(db)
  })

  it('create_test makes a not-started test with defaults', async () => {
    const fx = await setupCourse(db)
    const out = (await callTool('create_test', fx.lecturer, { courseId: fx.bio.id, title: 'CA 2', questions })) as Record<string, unknown>
    expect(out).toMatchObject({ state: 'not_started', questionCount: 2, totalMarks: 6, durationMinutes: 30 })
    const [row] = await db.select().from(courseTest).where(eq(courseTest.id, out.id as string))
    expect(row.startedAt).toBeNull()
    expect(row.shuffle).toBe(true)
  })

  it('create_test: the schema states the question rules; another lecturer is FORBIDDEN', async () => {
    const fx = await setupCourse(db)
    const twoCorrect = [{ ...questions[0], options: [{ text: 'A', correct: true }, { text: 'B', correct: true }] }]
    expect(parseToolInput('create_test', { courseId: 'c', title: 'T', questions: twoCorrect }).success).toBe(false)
    const oneOption = [{ ...questions[0], options: [{ text: 'A', correct: true }] }]
    expect(parseToolInput('create_test', { courseId: 'c', title: 'T', questions: oneOption }).success).toBe(false)
    expect(parseToolInput('create_test', { courseId: 'c', title: 'T', questions: [{ kind: 'short', prompt: 'P' }] }).success).toBe(false)
    expect(parseToolInput('create_test', { courseId: 'c', title: 'T', questions: [{ ...questions[1], mark: 1.1 }] }).success).toBe(false)
    expect(parseToolInput('create_test', { courseId: 'c', title: 'T', questions: [] }).success).toBe(false)
    await expect(callTool('create_test', fx.colleague, { courseId: fx.bio.id, title: 'CA 2', questions })).rejects.toMatchObject({
      code: 'FORBIDDEN',
    })
  })

  it('update_test changes the given settings and keeps or replaces the questions', async () => {
    const fx = await setupCourse(db)
    const { id } = (await callTool('create_test', fx.lecturer, { courseId: fx.bio.id, title: 'CA 2', questions })) as { id: string }
    let out = (await callTool('update_test', fx.lecturer, { testId: id, title: 'CA 2 (revised)', durationMinutes: 45 })) as Record<string, unknown>
    expect(out).toMatchObject({ title: 'CA 2 (revised)', durationMinutes: 45, questionCount: 2, state: 'not_started' })
    const kept = await getTestForEdit(fx.lecturer, id)
    expect(kept.input.questions.map((q) => q.kind)).toEqual(['mcq', 'short'])

    out = (await callTool('update_test', fx.lecturer, { testId: id, questions: [questions[1]] })) as Record<string, unknown>
    expect(out).toMatchObject({ questionCount: 1, totalMarks: 4 })
  })

  it('update_test refuses a started test (CONFLICT) and another lecturer (FORBIDDEN)', async () => {
    const fx = await setupCourse(db)
    const { test } = await insertStartedTest(db, fx.lecturer, fx.bio.id)
    await expect(callTool('update_test', fx.lecturer, { testId: test.id, title: 'Late edit' })).rejects.toMatchObject({
      code: 'CONFLICT',
      details: { reason: 'started' },
    })
    await expect(callTool('update_test', fx.colleague, { testId: test.id, title: 'Late edit' })).rejects.toMatchObject({
      code: 'FORBIDDEN',
    })
    const qs = await db.select().from(testQuestion).where(eq(testQuestion.testId, test.id))
    expect(qs).toHaveLength(3)
  })

  /** An ended test (answers final) with Alice, Bob and Carol's answers to q2. */
  async function endedTest() {
    const fx = await setupCourse(db)
    const t = await insertStartedTest(db, fx.lecturer, fx.bio.id)
    const [a, b, c] = [await joinTest(db, t.test.id, fx.alice), await joinTest(db, t.test.id, fx.bob), await joinTest(db, t.test.id, fx.carol)]
    await putAnswer(db, a.id, t.q2!.id, { text: 'Water crosses a membrane.' })
    await putAnswer(db, b.id, t.q2!.id, { text: 'Diffusion of water.', mark: 3 })
    await putAnswer(db, c.id, t.q2!.id, { text: '   ' })
    return { fx, ...t, a, b, c }
  }

  it('suggest_test_marks writes suggestions only, skips confirmed and blank answers, and the marking panel shows them', async () => {
    const { fx, test, q2, q1, a, b, c } = await endedTest()
    setClock(at(40))
    const out = (await callTool('suggest_test_marks', fx.lecturer, {
      testId: test.id,
      suggestions: [
        { attemptId: a.id, questionId: q2!.id, mark: 3.5, reason: 'Names water and membrane.' },
        { attemptId: b.id, questionId: q2!.id, mark: 1, reason: 'Vague.' },
        { attemptId: c.id, questionId: q2!.id, mark: 0, reason: 'Blank.' },
        { attemptId: a.id, questionId: q1.id, mark: 2, reason: 'MCQ.' },
      ],
    })) as { suggested: number; skipped: { attemptId: string; reason: string }[] }
    expect(out.suggested).toBe(1)
    expect(out.skipped).toEqual([
      { attemptId: b.id, questionId: q2!.id, reason: 'confirmed' },
      { attemptId: c.id, questionId: q2!.id, reason: 'blank' },
      { attemptId: a.id, questionId: q1.id, reason: 'no_answer' },
    ])

    const aRow = await answerRow(db, a.id, q2!.id)
    expect(aRow).toMatchObject({ mark: null, markedAt: null, suggestedMark: 3.5, suggestedReason: 'Names water and membrane.' })
    expect(aRow.suggestedAt).toEqual(at(40))
    const bRow = await answerRow(db, b.id, q2!.id)
    expect(bRow).toMatchObject({ mark: 3, suggestedMark: null })

    const panel = await getMarkingQuestion(fx.lecturer, test.id, q2!.id)
    expect(panel.answers.find((x) => x.attemptId === a.id)?.suggestion).toEqual({ mark: 3.5, reason: 'Names water and membrane.' })
    expect(panel.confirmed).toBe(1)
  })

  it('suggest_test_marks: not final → CONFLICT, other lecturer → FORBIDDEN, mark above the question → VALIDATION', async () => {
    const { fx, test, q2, a } = await endedTest()
    const one = (mark: number) => ({ testId: test.id, suggestions: [{ attemptId: a.id, questionId: q2!.id, mark, reason: 'R' }] })
    setClock(at(31))
    await expect(callTool('suggest_test_marks', fx.lecturer, one(2))).rejects.toMatchObject({
      code: 'CONFLICT',
      details: { reason: 'not_final' },
    })
    setClock(at(40))
    await expect(callTool('suggest_test_marks', fx.colleague, one(2))).rejects.toMatchObject({ code: 'FORBIDDEN' })
    await expect(callTool('suggest_test_marks', fx.lecturer, one(4.25))).rejects.toMatchObject({
      code: 'VALIDATION',
      details: { fields: ['mark'], index: 0 },
    })
    expect(parseToolInput('suggest_test_marks', one(1.3)).success).toBe(false)
    expect((await answerRow(db, a.id, q2!.id)).suggestedMark).toBeNull()
  })

  it('storeAssistantSuggestions never overwrites a mark confirmed in between and replaces an earlier suggestion', async () => {
    const { fx, test, q2, a } = await endedTest()
    setClock(at(40))
    await storeAssistantSuggestions(fx.lecturer, test.id, [{ attemptId: a.id, questionId: q2!.id, mark: 1, reason: 'First' }])
    await storeAssistantSuggestions(fx.lecturer, test.id, [{ attemptId: a.id, questionId: q2!.id, mark: 2, reason: 'Second' }])
    expect(await answerRow(db, a.id, q2!.id)).toMatchObject({ suggestedMark: 2, suggestedReason: 'Second', mark: null })

    await confirmMark(fx.lecturer, { attemptId: a.id, questionId: q2!.id, mark: 4, comment: null })
    const out = await storeAssistantSuggestions(fx.lecturer, test.id, [{ attemptId: a.id, questionId: q2!.id, mark: 0, reason: 'Late' }])
    expect(out).toEqual({ suggested: [], skipped: [{ attemptId: a.id, questionId: q2!.id, reason: 'confirmed' }] })
    expect((await answerRow(db, a.id, q2!.id)).mark).toBe(4)
  })

  it('storeAssistantSuggestions: an MCQ-only test is CONFLICT automatic', async () => {
    const fx = await setupCourse(db)
    const { test, q1 } = await insertStartedTest(db, fx.lecturer, fx.bio.id, { mcqOnly: true })
    setClock(at(40))
    await expect(
      storeAssistantSuggestions(fx.lecturer, test.id, [{ attemptId: 'x', questionId: q1.id, mark: 1, reason: 'R' }]),
    ).rejects.toMatchObject({ code: 'CONFLICT', details: { reason: 'automatic' } })
  })
})
