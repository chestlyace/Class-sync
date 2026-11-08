import { eq } from 'drizzle-orm'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { setNowForTests } from '@/server/core/clock'
import { createClass } from '@/server/classes/service'
import { createCourse } from '@/server/courses/service'
import type { Db } from '@/server/db'
import { courseTest } from '@/server/db/schema'
import { createSchool } from '@/server/schools/service'
import { copyTest, createTest, deleteTest } from '@/server/tests/authoring'
import type { TestInput } from '@/server/tests/rules'
import { createTestDb } from '@/test/db'
import { at, setClock, setupCourse } from '@/test/marking-fixture'
import { familyHolds } from './hold'

const mcqOnly: TestInput = {
  title: 'CA 1',
  durationMinutes: 30,
  defaultMark: 2,
  shuffle: true,
  maxExits: 3,
  maxAbsenceSeconds: 10,
  weight: 1,
  questions: [
    {
      kind: 'mcq',
      prompt: 'What is 2 + 2?',
      mark: null,
      options: [
        { text: '3', correct: false },
        { text: '4', correct: true },
      ],
    },
  ],
}

const withShort: TestInput = {
  ...mcqOnly,
  questions: [...mcqOnly.questions, { kind: 'short', prompt: 'Define osmosis.', mark: 4, guide: 'Water across a membrane.' }],
}

describe('familyHolds', () => {
  let db: Db

  beforeEach(async () => {
    db = await createTestDb()
  })
  afterEach(() => setNowForTests(null))

  async function setup() {
    const { lecturer, bio } = await setupCourse(db)
    const schoolB = await createSchool(lecturer, { name: 'Lycee Bilingue', town: 'Douala' })
    const classB = await createClass(lecturer, { schoolId: schoolB.id, name: 'Terminale C', academicYear: '2026/27' })
    const courseB = await createCourse(lecturer, { classId: classB.id, title: 'Biology B', semester: 1 })
    return { lecturer, bio, courseB }
  }

  const familyOf = async (testId: string) => {
    const [row] = await db.select().from(courseTest).where(eq(courseTest.id, testId))
    return row.familyId
  }

  /** Starts a test at T0 for 30 minutes, as Start does. */
  const run = (testId: string) =>
    db.update(courseTest).set({ startedAt: at(0), deadlineAt: at(30) }).where(eq(courseTest.id, testId))

  it('holds an MCQ-only family until the copy elsewhere is released', async () => {
    const { lecturer, bio, courseB } = await setup()
    const original = await createTest(lecturer, bio.id, mcqOnly)
    await run(original.id)
    const family = await familyOf(original.id)

    // Alone, once its answers are final, the family is released.
    expect((await familyHolds(db, [family], at(40))).size).toBe(0)

    const copy = await copyTest(lecturer, original.id, courseB.id)
    expect(await familyOf(copy.id)).toBe(family)

    const held = await familyHolds(db, [family], at(40))
    expect(held.get(family)).toEqual({ testTitle: 'CA 1', schoolName: 'Lycee Bilingue', className: 'Terminale C' })

    // The copy runs 100 to 130 minutes in; ended, answers not final yet: still held.
    await db.update(courseTest).set({ startedAt: at(100), deadlineAt: at(130) }).where(eq(courseTest.id, copy.id))
    expect((await familyHolds(db, [family], at(131))).has(family)).toBe(true)
    expect((await familyHolds(db, [family], new Date(at(130).getTime() + 60_000))).has(family)).toBe(true)
    expect((await familyHolds(db, [family], new Date(at(130).getTime() + 121_000))).has(family)).toBe(false)
  })

  it('holds a short-answer family after its end until the results are released', async () => {
    const { lecturer, bio, courseB } = await setup()
    const original = await createTest(lecturer, bio.id, withShort)
    await run(original.id)
    const family = await familyOf(original.id)
    expect((await familyHolds(db, [family], at(60))).has(family)).toBe(true)
    await db.update(courseTest).set({ resultsReleasedAt: at(61) }).where(eq(courseTest.id, original.id))
    expect((await familyHolds(db, [family], at(62))).has(family)).toBe(false)

    // A not-yet-run copy in another course holds it again.
    const copy = await copyTest(lecturer, original.id, courseB.id)
    expect((await familyHolds(db, [family], at(62))).get(family)?.className).toBe('Terminale C')
    await deleteTest(lecturer, copy.id)
    expect((await familyHolds(db, [family], at(62))).has(family)).toBe(false)
  })

  it('names the first unreleased test by creation time and ignores other families', async () => {
    const { lecturer, bio, courseB } = await setup()
    setClock(at(-10))
    const a = await createTest(lecturer, bio.id, mcqOnly)
    const other = await createTest(lecturer, bio.id, { ...mcqOnly, title: 'Unrelated' })
    await run(a.id)
    setClock(at(41))
    await copyTest(lecturer, a.id, courseB.id)
    setClock(at(42))
    await copyTest(lecturer, a.id, bio.id)
    const family = await familyOf(a.id)
    const otherFamily = await familyOf(other.id)

    const held = await familyHolds(db, [family, otherFamily], at(50))
    // The original is released; of the two unrun copies the earlier one is named.
    expect(held.get(family)).toEqual({ testTitle: 'CA 1', schoolName: 'Lycee Bilingue', className: 'Terminale C' })
    expect(held.get(otherFamily)).toMatchObject({ testTitle: 'Unrelated', className: 'Biology L1' })
    expect(held.size).toBe(2)
    // With no ids there is nothing to ask.
    expect((await familyHolds(db, [], at(50))).size).toBe(0)
  })
})
