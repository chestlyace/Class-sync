import { eq } from 'drizzle-orm'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { setNowForTests } from '@/server/core/clock'
import type { Db } from '@/server/db'
import { courseTest, courseTopic, revisionOutcome } from '@/server/db/schema'
import { createTestDb } from '@/test/db'
import { ctxFor, makeUser } from '@/test/factories'
import { at, insertStartedTest, setClock, setupCourse } from '@/test/marking-fixture'
import { addPracticeQuestion, getPracticeForLecturer, importTestQuestions } from './authoring'
import { getPracticePaper, recordPracticeOutcomes } from './practice'

const written = { kind: 'short', prompt: 'Define osmosis.', guide: 'Water across a membrane.' }

describe('practice paper and outcomes', () => {
  let db: Db

  beforeEach(async () => {
    db = await createTestDb()
  })
  afterEach(() => setNowForTests(null))

  /** A topic with one written question and one imported (held) test, ended at T0+40. */
  async function setup() {
    const base = await setupCourse(db)
    const [topic] = await db.insert(courseTopic).values({ courseId: base.bio.id, title: 'Cells', position: 0 }).returning()
    const mine = await addPracticeQuestion(base.lecturer, topic.id, written)
    const { test } = await insertStartedTest(db, base.lecturer, base.bio.id)
    setClock(at(40))
    await importTestQuestions(base.lecturer, topic.id, test.id)
    const page = await getPracticeForLecturer(base.lecturer, topic.id)
    const heldQuestion = page.groups[1].questions[0]
    return { ...base, topic, test, mine, heldQuestion }
  }

  const release = (testId: string) => db.update(courseTest).set({ resultsReleasedAt: at(41) }).where(eq(courseTest.id, testId))

  it('leaves held groups out of the student paper until released', async () => {
    const { alice, bio, topic, test, mine } = await setup()
    const paper = await getPracticePaper(alice, bio.id, topic.id)
    expect(paper.topic).toEqual({ id: topic.id, title: 'Cells' })
    expect(paper.questions.map((q) => q.id)).toEqual([mine.id])
    expect(paper.outcomes).toEqual({})

    await release(test.id)
    expect((await getPracticePaper(alice, bio.id, topic.id)).questions).toHaveLength(4)
  })

  it('gives the owner the same shape as a preview, held groups left out, no outcomes', async () => {
    const { lecturer, bio, topic, mine } = await setup()
    const paper = await getPracticePaper(lecturer, bio.id, topic.id)
    expect(paper.questions.map((q) => q.id)).toEqual([mine.id])
    expect(paper.questions[0].guide).toBe('Water across a membrane.')
    expect(paper.outcomes).toEqual({})
  })

  it('refuses a hidden topic, a stranger, a colleague and a topic of another course', async () => {
    const { alice, colleague, bio, topic } = await setup()
    await db.update(courseTopic).set({ hidden: true }).where(eq(courseTopic.id, topic.id))
    await expect(getPracticePaper(alice, bio.id, topic.id)).rejects.toMatchObject({ code: 'FORBIDDEN' })
    await db.update(courseTopic).set({ hidden: false }).where(eq(courseTopic.id, topic.id))

    const outsider = ctxFor(db, await makeUser(db, { role: 'student' }))
    await expect(getPracticePaper(outsider, bio.id, topic.id)).rejects.toMatchObject({ code: 'FORBIDDEN' })
    await expect(getPracticePaper(colleague, bio.id, topic.id)).rejects.toMatchObject({ code: 'FORBIDDEN' })
    await expect(getPracticePaper(alice, bio.id, 'nope')).rejects.toMatchObject({ code: 'FORBIDDEN' })
    await expect(getPracticePaper(alice, 'nope', topic.id)).rejects.toMatchObject({ code: 'FORBIDDEN' })
  })

  it('keeps the latest of two outcomes for a question and shows them back privately', async () => {
    const { alice, bob, bio, topic, mine } = await setup()
    expect(await recordPracticeOutcomes(alice, bio.id, [{ questionId: mine.id, correct: false }])).toEqual({ saved: 1 })
    setClock(at(50))
    await recordPracticeOutcomes(alice, bio.id, [{ questionId: mine.id, correct: true }])
    expect((await getPracticePaper(alice, bio.id, topic.id)).outcomes).toEqual({ [mine.id]: true })
    // Last entry wins within one call, too.
    await recordPracticeOutcomes(alice, bio.id, [
      { questionId: mine.id, correct: true },
      { questionId: mine.id, correct: false },
    ])
    expect((await getPracticePaper(alice, bio.id, topic.id)).outcomes).toEqual({ [mine.id]: false })
    // Bob sees nothing of Alice's.
    expect((await getPracticePaper(bob, bio.id, topic.id)).outcomes).toEqual({})
    const rows = await db.select().from(revisionOutcome)
    expect(rows).toHaveLength(1)
    expect(rows[0].answeredAt).toEqual(at(50))
  })

  it('skips a held question while saving the others', async () => {
    const { alice, bio, mine, heldQuestion } = await setup()
    const res = await recordPracticeOutcomes(alice, bio.id, [
      { questionId: heldQuestion.id, correct: true },
      { questionId: mine.id, correct: true },
      { questionId: 'unknown', correct: true },
    ])
    expect(res).toEqual({ saved: 1 })
    expect((await db.select().from(revisionOutcome)).map((r) => r.questionId)).toEqual([mine.id])
  })

  it('skips questions of a topic that became hidden', async () => {
    const { alice, bio, topic, mine } = await setup()
    await db.update(courseTopic).set({ hidden: true }).where(eq(courseTopic.id, topic.id))
    expect(await recordPracticeOutcomes(alice, bio.id, [{ questionId: mine.id, correct: true }])).toEqual({ saved: 0 })
  })

  it('records for rostered students only, at most 200 per call', async () => {
    const { lecturer, colleague, alice, bio, mine } = await setup()
    for (const who of [lecturer, colleague, ctxFor(db, await makeUser(db, { role: 'student' }))]) {
      await expect(recordPracticeOutcomes(who, bio.id, [{ questionId: mine.id, correct: true }])).rejects.toMatchObject({
        code: 'FORBIDDEN',
      })
    }
    const many = Array.from({ length: 201 }, () => ({ questionId: mine.id, correct: true }))
    await expect(recordPracticeOutcomes(alice, bio.id, many)).rejects.toMatchObject({ code: 'VALIDATION' })
    await expect(recordPracticeOutcomes(alice, bio.id, [{ questionId: mine.id, correct: 'yes' as never }])).rejects.toMatchObject({
      code: 'VALIDATION',
    })
  })
})
