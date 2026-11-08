import { eq } from 'drizzle-orm'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { setNowForTests } from '@/server/core/clock'
import { createClass } from '@/server/classes/service'
import { createCourse } from '@/server/courses/service'
import type { Db } from '@/server/db'
import { courseTest, courseTopic, revisionGroup, revisionOption, revisionQuestion } from '@/server/db/schema'
import { createSchool } from '@/server/schools/service'
import { copyTest, deleteTest } from '@/server/tests/authoring'
import { createTestDb } from '@/test/db'
import { ctxFor, makeUser } from '@/test/factories'
import { at, insertStartedTest, setClock, setupCourse } from '@/test/marking-fixture'
import {
  addPracticeQuestion,
  deletePracticeGroup,
  deletePracticeQuestion,
  getPracticeForLecturer,
  importTestQuestions,
  movePracticeQuestion,
  updatePracticeQuestion,
} from './authoring'

const mcq = {
  kind: 'mcq',
  prompt: 'What is 2 + 2?',
  options: [
    { text: '3', isCorrect: false },
    { text: '4', isCorrect: true },
  ],
  explanation: 'Basic sums.',
}
const short = { kind: 'short', prompt: 'Define osmosis.', guide: 'Water across a membrane.' }

describe('practice authoring', () => {
  let db: Db

  beforeEach(async () => {
    db = await createTestDb()
  })
  afterEach(() => setNowForTests(null))

  async function setup() {
    const base = await setupCourse(db)
    const [topic] = await db.insert(courseTopic).values({ courseId: base.bio.id, title: 'Cells', position: 0 }).returning()
    return { ...base, topic }
  }

  it('adds MCQ and short questions; the written-here group is first and reuses one group', async () => {
    const { lecturer, topic, bio } = await setup()
    await addPracticeQuestion(lecturer, topic.id, mcq)
    await addPracticeQuestion(lecturer, topic.id, short)
    setClock(at(40))
    const { test } = await insertStartedTest(db, lecturer, bio.id)
    await importTestQuestions(lecturer, topic.id, test.id)
    // A third question written later still lands in the first group.
    await addPracticeQuestion(lecturer, topic.id, short)

    const page = await getPracticeForLecturer(lecturer, topic.id)
    expect(page.topic).toEqual({ id: topic.id, title: 'Cells', hidden: false })
    expect(page.groups).toHaveLength(2)
    expect(page.groups[0].source).toBeNull()
    expect(page.groups[0].held).toBeNull()
    expect(page.groups[0].questions.map((q) => q.kind)).toEqual(['mcq', 'short', 'short'])
    const first = page.groups[0].questions[0]
    expect(first.explanation).toBe('Basic sums.')
    expect(first.options.map((o) => [o.text, o.isCorrect])).toEqual([
      ['3', false],
      ['4', true],
    ])
    expect(page.groups[0].questions[1]).toMatchObject({ guide: 'Water across a membrane.', options: [] })
  })

  it('rejects invalid input naming the fields, and past 200 questions', async () => {
    const { lecturer, topic } = await setup()
    await expect(addPracticeQuestion(lecturer, topic.id, { kind: 'short', prompt: 'x', guide: ' ' })).rejects.toMatchObject({
      code: 'VALIDATION',
      details: { fields: ['guide'] },
    })
    const [group] = await db.insert(revisionGroup).values({ courseId: topic.courseId, topicId: topic.id, position: 0 }).returning()
    await db
      .insert(revisionQuestion)
      .values(Array.from({ length: 200 }, (_, i) => ({ groupId: group.id, position: i, kind: 'short' as const, prompt: `q${i}`, guide: 'g' })))
    await expect(addPracticeQuestion(lecturer, topic.id, short)).rejects.toMatchObject({
      code: 'CONFLICT',
      details: { reason: 'too_many' },
    })
  })

  it('updates, moves and deletes questions, and deletes a group', async () => {
    const { lecturer, topic } = await setup()
    const a = await addPracticeQuestion(lecturer, topic.id, short)
    const b = await addPracticeQuestion(lecturer, topic.id, mcq)
    await movePracticeQuestion(lecturer, b.id, 'up')
    await movePracticeQuestion(lecturer, b.id, 'up') // already first: no change
    let page = await getPracticeForLecturer(lecturer, topic.id)
    expect(page.groups[0].questions.map((q) => q.id)).toEqual([b.id, a.id])

    await updatePracticeQuestion(lecturer, b.id, { ...short, prompt: 'Now short' })
    page = await getPracticeForLecturer(lecturer, topic.id)
    expect(page.groups[0].questions[0]).toMatchObject({ kind: 'short', prompt: 'Now short', options: [], explanation: null })
    expect(await db.select().from(revisionOption)).toHaveLength(0)

    await deletePracticeQuestion(lecturer, a.id)
    page = await getPracticeForLecturer(lecturer, topic.id)
    expect(page.groups[0].questions).toHaveLength(1)
    await deletePracticeGroup(lecturer, page.groups[0].id)
    expect((await getPracticeForLecturer(lecturer, topic.id)).groups).toEqual([])
    expect(await db.select().from(revisionQuestion)).toHaveLength(0)
  })

  it('keeps practice to the owner: colleagues, students and missing ids are FORBIDDEN', async () => {
    const { lecturer, colleague, alice, topic } = await setup()
    const q = await addPracticeQuestion(lecturer, topic.id, short)
    for (const who of [colleague, alice]) {
      await expect(getPracticeForLecturer(who, topic.id)).rejects.toMatchObject({ code: 'FORBIDDEN' })
      await expect(addPracticeQuestion(who, topic.id, short)).rejects.toMatchObject({ code: 'FORBIDDEN' })
      await expect(updatePracticeQuestion(who, q.id, short)).rejects.toMatchObject({ code: 'FORBIDDEN' })
      await expect(deletePracticeQuestion(who, q.id)).rejects.toMatchObject({ code: 'FORBIDDEN' })
      await expect(movePracticeQuestion(who, q.id, 'down')).rejects.toMatchObject({ code: 'FORBIDDEN' })
    }
    await expect(getPracticeForLecturer(lecturer, 'nope')).rejects.toMatchObject({ code: 'FORBIDDEN' })
    await expect(deletePracticeGroup(lecturer, 'nope')).rejects.toMatchObject({ code: 'FORBIDDEN' })
  })

  describe('importing a finished test', () => {
    it('copies prompts, options, guides and drops marks; held until results are released', async () => {
      const { lecturer, topic, bio } = await setup()
      const { test } = await insertStartedTest(db, lecturer, bio.id)
      setClock(at(40))

      const before = await getPracticeForLecturer(lecturer, topic.id)
      expect(before.importable).toEqual([{ id: test.id, title: 'CA 1', endedAt: at(30) }])

      const res = await importTestQuestions(lecturer, topic.id, test.id)
      expect(res.count).toBe(3)
      const page = await getPracticeForLecturer(lecturer, topic.id)
      expect(page.importable).toEqual([])
      const [group] = page.groups
      expect(group.id).toBe(res.groupId)
      expect(group.source).toEqual({ testId: test.id, title: 'CA 1' })
      expect(group.held).toEqual({ testTitle: 'CA 1', schoolName: 'University of Buea', className: 'Biology L1' })
      expect(group.questions.map((q) => q.prompt)).toEqual(['Which organelle makes ATP?', 'What is osmosis?', 'Name a function of DNA.'])
      expect(group.questions[0].options.map((o) => [o.text, o.isCorrect])).toEqual([
        ['Mitochondrion', true],
        ['Ribosome', false],
      ])
      expect(group.questions[1].guide).toBe('Water moves across a membrane: 2 for water, 2 for membrane.')
      expect(group.questions[1]).not.toHaveProperty('mark')
      expect(group.questions.every((q) => q.explanation === null)).toBe(true)

      await db.update(courseTest).set({ resultsReleasedAt: at(41) }).where(eq(courseTest.id, test.id))
      expect((await getPracticeForLecturer(lecturer, topic.id)).groups[0].held).toBeNull()
    })

    it('refuses a second import, a running test, and another course\'s test', async () => {
      const { lecturer, topic, bio } = await setup()
      const { test } = await insertStartedTest(db, lecturer, bio.id)
      const running = await insertStartedTest(db, lecturer, bio.id)

      setClock(at(10))
      await expect(importTestQuestions(lecturer, topic.id, running.test.id)).rejects.toMatchObject({
        code: 'CONFLICT',
        details: { reason: 'not_ended' },
      })

      setClock(at(40))
      await importTestQuestions(lecturer, topic.id, test.id)
      await expect(importTestQuestions(lecturer, topic.id, test.id)).rejects.toMatchObject({
        code: 'CONFLICT',
        details: { reason: 'already_imported' },
      })

      const other = await createCourse(lecturer, { classId: bio.classId, title: 'Other', semester: 1 })
      const foreign = await insertStartedTest(db, lecturer, other.id)
      await expect(importTestQuestions(lecturer, topic.id, foreign.test.id)).rejects.toMatchObject({ code: 'FORBIDDEN' })
      await expect(importTestQuestions(lecturer, topic.id, 'nope')).rejects.toMatchObject({ code: 'FORBIDDEN' })
    })

    it('is held again when the test is copied to another school, until that copy is released or deleted', async () => {
      const { lecturer, topic, bio } = await setup()
      const { test } = await insertStartedTest(db, lecturer, bio.id)
      await db.update(courseTest).set({ resultsReleasedAt: at(35) }).where(eq(courseTest.id, test.id))
      setClock(at(40))
      await importTestQuestions(lecturer, topic.id, test.id)
      expect((await getPracticeForLecturer(lecturer, topic.id)).groups[0].held).toBeNull()

      const schoolB = await createSchool(lecturer, { name: 'Lycee Bilingue', town: 'Douala' })
      const classB = await createClass(lecturer, { schoolId: schoolB.id, name: 'Terminale C', academicYear: '2026/27' })
      const courseB = await createCourse(lecturer, { classId: classB.id, title: 'Biology B', semester: 1 })
      const copy = await copyTest(lecturer, test.id, courseB.id)

      expect((await getPracticeForLecturer(lecturer, topic.id)).groups[0].held).toMatchObject({
        schoolName: 'Lycee Bilingue',
        className: 'Terminale C',
      })
      await deleteTest(lecturer, copy.id)
      expect((await getPracticeForLecturer(lecturer, topic.id)).groups[0].held).toBeNull()
    })
  })

  it('does not let a stranger lecturer touch it', async () => {
    const { topic } = await setup()
    const stranger = ctxFor(db, await makeUser(db, { role: 'lecturer' }))
    await expect(getPracticeForLecturer(stranger, topic.id)).rejects.toMatchObject({ code: 'FORBIDDEN' })
  })
})
