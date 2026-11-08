import { eq } from 'drizzle-orm'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { setNowForTests } from '@/server/core/clock'
import type { Ctx } from '@/server/core/context'
import type { Db } from '@/server/db'
import {
  class_,
  classLecturer,
  classStudent,
  course,
  courseRosterAdjustment,
  courseTest,
  school,
  testAttempt,
  testOption,
  testQuestion,
  user,
} from '@/server/db/schema'
import { createClass, joinClassAsLecturer, joinClassAsStudent } from '@/server/classes/service'
import { generateJoinCode, JOIN_CODE_ALPHABET } from '@/server/classes/join-code'
import { createCourse, setRosterAdjustment } from '@/server/courses/service'
import { createSchool } from '@/server/schools/service'
import { createTestDb } from '@/test/db'
import { ctxFor, makeUser } from '@/test/factories'
import {
  copyTest,
  createTest,
  deleteTest,
  getTestForEdit,
  listCourseTests,
  updateTest,
} from './authoring'
import { loadQuestions, requireOwnedTest } from './queries'
import type { TestInput } from './rules'

vi.mock('@/server/classes/join-code', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/server/classes/join-code')>()
  return { ...actual, generateJoinCode: vi.fn(actual.generateJoinCode) }
})

const MINUTE = 60_000
const generateCode = vi.mocked(generateJoinCode)

/** A 3-question test: two MCQs (one on the default mark) and a short answer worth 4. */
function validInput(over: Partial<TestInput> = {}): TestInput {
  return {
    title: 'CA 1',
    durationMinutes: 30,
    defaultMark: 2,
    shuffle: true,
    maxExits: 3,
    maxAbsenceSeconds: 10,
    questions: [
      {
        kind: 'mcq',
        prompt: 'What is 2 + 2?',
        mark: null,
        options: [
          { text: '3', correct: false },
          { text: '4', correct: true },
          { text: '5', correct: false },
        ],
      },
      { kind: 'short', prompt: 'Define osmosis.', mark: 4, guide: 'Water across a membrane.' },
      {
        kind: 'mcq',
        prompt: 'Largest planet?',
        mark: 1.5,
        options: [
          { text: 'Jupiter', correct: true },
          { text: 'Mars', correct: false },
        ],
      },
    ],
    ...over,
  }
}

function withoutIds<T extends { id: string }>(items: T[]): Omit<T, 'id'>[] {
  return items.map((item) => {
    const copy: Partial<T> = { ...item }
    delete copy.id
    return copy as Omit<T, 'id'>
  })
}

async function expectAppError(promise: Promise<unknown>, code: string, details?: Record<string, unknown>) {
  const err = await promise.then(
    () => null,
    (e: unknown) => e,
  )
  expect(err, `expected ${code}`).toMatchObject({ code })
  if (details) expect((err as { details?: unknown }).details).toEqual(details)
}

describe('test authoring services', () => {
  let db: Db

  beforeAll(async () => {
    db = await createTestDb()
  })
  afterEach(async () => {
    setNowForTests(null)
    await db.delete(testAttempt)
    await db.delete(courseTest)
    await db.delete(courseRosterAdjustment)
    await db.delete(course)
    await db.delete(classStudent)
    await db.delete(classLecturer)
    await db.delete(class_)
    await db.delete(school)
    await db.delete(user)
  })

  async function setup() {
    const lecturer = ctxFor(db, await makeUser(db, { role: 'lecturer', name: 'Dr Owner' }))
    const sch = await createSchool(lecturer, { name: 'University of Buea', town: 'Buea' })
    const cls = await createClass(lecturer, { schoolId: sch.id, name: 'CS L3', academicYear: '2026/27' })
    const colleague = ctxFor(db, await makeUser(db, { role: 'lecturer', name: 'Dr Colleague' }))
    await joinClassAsLecturer(colleague, cls.lecturerCode!)
    const algo = await createCourse(lecturer, { classId: cls.id, title: 'Algorithms', semester: 1 })
    const networks = await createCourse(lecturer, { classId: cls.id, title: 'Networks', semester: 1 })
    const theirs = await createCourse(colleague, { classId: cls.id, title: 'Databases', semester: 1 })
    const alice = ctxFor(db, await makeUser(db, { role: 'student', name: 'Alice' }))
    const bob = ctxFor(db, await makeUser(db, { role: 'student', name: 'Bob' }))
    await joinClassAsStudent(alice, cls.studentCode!, 'UB1')
    await joinClassAsStudent(bob, cls.studentCode!, 'UB2')
    return { lecturer, colleague, algo, networks, theirs, alice, bob }
  }

  async function start(testId: string, at = new Date()) {
    await db
      .update(courseTest)
      .set({ startedAt: at, deadlineAt: new Date(at.getTime() + 30 * MINUTE) })
      .where(eq(courseTest.id, testId))
  }

  async function join(testId: string, student: Ctx) {
    await db.insert(testAttempt).values({
      testId,
      studentId: student.user.id,
      seed: crypto.randomUUID(),
      deviceId: crypto.randomUUID(),
      deviceSeenAt: new Date(),
    })
  }

  async function countRows() {
    const [tests, questions, options] = await Promise.all([
      db.select({ id: courseTest.id }).from(courseTest),
      db.select({ id: testQuestion.id }).from(testQuestion),
      db.select({ id: testOption.id }).from(testOption),
    ])
    return { tests: tests.length, questions: questions.length, options: options.length }
  }

  it('owner creates a test: 6-char code from the join alphabet, state not_started, total = sum of marks', async () => {
    const { lecturer, algo } = await setup()
    const summary = await createTest(lecturer, algo.id, validInput())

    expect(summary.code).toHaveLength(6)
    expect([...summary.code].every((ch) => JOIN_CODE_ALPHABET.includes(ch))).toBe(true)
    expect(summary).toMatchObject({
      courseId: algo.id,
      title: 'CA 1',
      state: 'not_started',
      questionCount: 3,
      totalMarks: 7.5, // 2 (default) + 4 + 1.5
      hasShort: true,
      durationMinutes: 30,
      startedAt: null,
      endsAt: null,
      joined: 0,
    })

    const [row] = await db.select().from(courseTest).where(eq(courseTest.id, summary.id))
    expect(row).toMatchObject({ createdBy: lecturer.user.id, copiedFromId: null, shuffle: true, defaultMark: 2 })
    expect(await countRows()).toEqual({ tests: 1, questions: 3, options: 5 })

    const second = await createTest(lecturer, algo.id, validInput({ title: 'CA 2' }))
    expect(second.code).not.toBe(summary.code)
    expect(await requireOwnedTest(lecturer, second.id)).toMatchObject({ test: { id: second.id }, course: { id: algo.id } })
  })

  it('a code already taken is retried with a new one, and five collisions in a row give up', async () => {
    const { lecturer, algo } = await setup()
    const first = await createTest(lecturer, algo.id, validInput())

    generateCode.mockReturnValueOnce(first.code).mockReturnValueOnce(first.code)
    const second = await createTest(lecturer, algo.id, validInput())
    expect(second.code).not.toBe(first.code)
    expect(await countRows()).toEqual({ tests: 2, questions: 6, options: 10 })

    for (let i = 0; i < 5; i++) generateCode.mockReturnValueOnce(first.code)
    await expect(createTest(lecturer, algo.id, validInput())).rejects.toThrow('Could not generate a unique test code')
    expect(await countRows()).toEqual({ tests: 2, questions: 6, options: 10 })
  })

  it('invalid input is VALIDATION with the reason and question index, nothing stored', async () => {
    const { lecturer, algo } = await setup()
    const twoCorrect = validInput()
    twoCorrect.questions[2] = {
      kind: 'mcq',
      prompt: 'Largest planet?',
      mark: null,
      options: [
        { text: 'Jupiter', correct: true },
        { text: 'Saturn', correct: true },
      ],
    }
    await expectAppError(createTest(lecturer, algo.id, twoCorrect), 'VALIDATION', { reason: 'correct', question: 2 })
    await expectAppError(createTest(lecturer, algo.id, validInput({ title: '  ' })), 'VALIDATION', { reason: 'title' })
    await expectAppError(createTest(lecturer, algo.id, { title: 'x' }), 'VALIDATION', { reason: 'shape' })
    await expectAppError(createTest(lecturer, algo.id, null), 'VALIDATION', { reason: 'shape' })
    expect(await countRows()).toEqual({ tests: 0, questions: 0, options: 0 })
  })

  it('a colleague sharing the class and a student get FORBIDDEN on every function', async () => {
    const { lecturer, colleague, alice, algo, theirs } = await setup()
    const test = await createTest(lecturer, algo.id, validInput())

    for (const outsider of [colleague, alice]) {
      await expectAppError(createTest(outsider, algo.id, validInput()), 'FORBIDDEN')
      await expectAppError(updateTest(outsider, test.id, validInput({ title: 'Hijacked' })), 'FORBIDDEN')
      await expectAppError(getTestForEdit(outsider, test.id), 'FORBIDDEN')
      await expectAppError(listCourseTests(outsider, algo.id), 'FORBIDDEN')
      await expectAppError(copyTest(outsider, test.id, theirs.id), 'FORBIDDEN')
      await expectAppError(deleteTest(outsider, test.id), 'FORBIDDEN')
      await expectAppError(requireOwnedTest(outsider, test.id), 'FORBIDDEN')
    }
    // A test id that does not exist is FORBIDDEN too, not NOT_FOUND.
    await expectAppError(getTestForEdit(lecturer, crypto.randomUUID()), 'FORBIDDEN')
    await expectAppError(deleteTest(lecturer, ''), 'FORBIDDEN')

    const [row] = await db.select().from(courseTest).where(eq(courseTest.id, test.id))
    expect(row.title).toBe('CA 1')
    expect(await countRows()).toEqual({ tests: 1, questions: 3, options: 5 })
  })

  it('updateTest replaces questions and settings before Start', async () => {
    const { lecturer, algo } = await setup()
    const test = await createTest(lecturer, algo.id, validInput())
    const before = await getTestForEdit(lecturer, test.id)

    const updated = await updateTest(lecturer, test.id, {
      title: '  CA 1 (revised)  ',
      durationMinutes: 45,
      defaultMark: 3,
      shuffle: false,
      maxExits: 5,
      maxAbsenceSeconds: 20,
      questions: [
        {
          kind: 'mcq',
          prompt: 'Capital of Cameroon?',
          mark: null,
          options: [
            { text: 'Douala', correct: false },
            { text: 'Yaoundé', correct: true },
          ],
        },
        {
          kind: 'mcq',
          prompt: 'Boiling point of water at sea level?',
          mark: null,
          options: [
            { text: '90 °C', correct: false },
            { text: '100 °C', correct: true },
          ],
        },
      ],
    })

    expect(updated).toMatchObject({
      id: test.id,
      code: test.code,
      title: 'CA 1 (revised)',
      questionCount: 2,
      totalMarks: 6,
      hasShort: false,
      durationMinutes: 45,
      state: 'not_started',
    })
    const edit = await getTestForEdit(lecturer, test.id)
    expect(edit.input).toMatchObject({
      title: 'CA 1 (revised)',
      durationMinutes: 45,
      defaultMark: 3,
      shuffle: false,
      maxExits: 5,
      maxAbsenceSeconds: 20,
    })
    expect(edit.input.questions.map((q) => q.prompt)).toEqual([
      'Capital of Cameroon?',
      'Boiling point of water at sea level?',
    ])
    // Old questions (and their options) are gone, not left behind.
    const oldIds = before.input.questions.map((q) => q.id)
    expect(edit.input.questions.some((q) => oldIds.includes(q.id))).toBe(false)
    expect(await countRows()).toEqual({ tests: 1, questions: 2, options: 4 })

    await expectAppError(updateTest(lecturer, test.id, validInput({ durationMinutes: 0 })), 'VALIDATION', {
      reason: 'duration',
    })
    expect((await getTestForEdit(lecturer, test.id)).input.durationMinutes).toBe(45)
  })

  it('updateTest after Start is CONFLICT started and changes nothing', async () => {
    const { lecturer, algo } = await setup()
    const test = await createTest(lecturer, algo.id, validInput())
    const before = await getTestForEdit(lecturer, test.id)
    await start(test.id)

    await expectAppError(updateTest(lecturer, test.id, validInput({ title: 'Changed', durationMinutes: 60 })), 'CONFLICT', {
      reason: 'started',
    })

    const after = await getTestForEdit(lecturer, test.id)
    expect(after.input).toEqual(before.input)
    expect(after.summary.state).toBe('running')
    expect(await countRows()).toEqual({ tests: 1, questions: 3, options: 5 })
  })

  it('getTestForEdit returns guides and correct flags in position order', async () => {
    const { lecturer, algo } = await setup()
    const test = await createTest(lecturer, algo.id, validInput())
    const edit = await getTestForEdit(lecturer, test.id)

    expect(edit.summary).toMatchObject({ id: test.id, code: test.code, totalMarks: 7.5 })
    const { questions, ...settings } = edit.input
    expect(settings).toEqual({
      title: 'CA 1',
      durationMinutes: 30,
      defaultMark: 2,
      shuffle: true,
      maxExits: 3,
      maxAbsenceSeconds: 10,
    })
    // Same shape as the input, with an id per question; mark stays null where the default applies.
    expect(questions.every((q) => typeof q.id === 'string' && q.id.length > 0)).toBe(true)
    expect(withoutIds(questions)).toEqual(validInput().questions)

    const loaded = await loadQuestions(db, test.id)
    expect(loaded.map((q) => [q.position, q.kind, q.mark])).toEqual([
      [0, 'mcq', 2],
      [1, 'short', 4],
      [2, 'mcq', 1.5],
    ])
    expect(loaded[1].guide).toBe('Water across a membrane.')
    expect(loaded[0].options.map((o) => [o.position, o.text, o.isCorrect])).toEqual([
      [0, '3', false],
      [1, '4', true],
      [2, '5', false],
    ])
    expect(loaded.map((q) => q.id)).toEqual(questions.map((q) => q.id))
  })

  it('listCourseTests lists only this course, newest first, with joined counts', async () => {
    const { lecturer, algo, networks, alice, bob } = await setup()
    const t0 = new Date('2026-11-01T08:00:00Z')
    setNowForTests(() => t0)
    const first = await createTest(lecturer, algo.id, validInput({ title: 'First' }))
    setNowForTests(() => new Date(t0.getTime() + MINUTE))
    const second = await createTest(lecturer, algo.id, validInput({ title: 'Second' }))
    setNowForTests(() => new Date(t0.getTime() + 2 * MINUTE))
    await createTest(lecturer, networks.id, validInput({ title: 'Elsewhere' }))
    setNowForTests(null)

    await join(first.id, alice)
    await join(first.id, bob)
    await join(second.id, alice)
    await start(first.id, new Date(Date.now() - MINUTE))

    const list = await listCourseTests(lecturer, algo.id)
    expect(list.map((t) => [t.title, t.joined, t.state])).toEqual([
      ['Second', 1, 'not_started'],
      ['First', 2, 'running'],
    ])
    expect(list[1].startedAt).toBeInstanceOf(Date)
    expect(list[1].endsAt?.getTime()).toBe(list[1].startedAt!.getTime() + 30 * MINUTE)
    expect(list[1]).toMatchObject({ questionCount: 3, totalMarks: 7.5, hasShort: true })

    expect(await listCourseTests(lecturer, networks.id)).toHaveLength(1)
    const empty = await createCourse(lecturer, { classId: algo.classId, title: 'Empty', semester: 2 })
    expect(await listCourseTests(lecturer, empty.id)).toEqual([])
  })

  it('joined counts only students on the current roster, as the live view does', async () => {
    const { lecturer, algo, alice, bob } = await setup()
    const test = await createTest(lecturer, algo.id, validInput())
    await join(test.id, alice)
    await join(test.id, bob)
    // Bob is taken off this course's roster after opening the test: his attempt stays, uncounted.
    await setRosterAdjustment(lecturer, algo.id, bob.user.id, 'exclude')

    const [listed] = await listCourseTests(lecturer, algo.id)
    expect(listed.joined).toBe(1)
    expect((await getTestForEdit(lecturer, test.id)).summary.joined).toBe(1)
  })

  it('copyTest into another course I own gives an independent not_started test with a new code', async () => {
    const { lecturer, algo, networks, alice } = await setup()
    const original = await createTest(lecturer, algo.id, validInput())
    await join(original.id, alice)
    await start(original.id)

    const copy = await copyTest(lecturer, original.id, networks.id)
    expect(copy.id).not.toBe(original.id)
    expect(copy.code).not.toBe(original.code)
    expect(copy).toMatchObject({
      courseId: networks.id,
      title: 'CA 1',
      state: 'not_started',
      questionCount: 3,
      totalMarks: 7.5,
      hasShort: true,
      startedAt: null,
      endsAt: null,
      joined: 0,
    })
    const [row] = await db.select().from(courseTest).where(eq(courseTest.id, copy.id))
    expect(row).toMatchObject({
      copiedFromId: original.id,
      createdBy: lecturer.user.id,
      startedAt: null,
      deadlineAt: null,
      endedAt: null,
      resultsReleasedAt: null,
    })

    const originalEdit = await getTestForEdit(lecturer, original.id)
    const copyEdit = await getTestForEdit(lecturer, copy.id)
    expect(withoutIds(copyEdit.input.questions)).toEqual(withoutIds(originalEdit.input.questions))
    expect(copyEdit.input.questions.some((q) => originalEdit.input.questions.some((o) => o.id === q.id))).toBe(false)

    // Editing the copy leaves the original unchanged.
    await updateTest(lecturer, copy.id, validInput({ title: 'Copy edited', questions: validInput().questions.slice(0, 1) }))
    expect(await getTestForEdit(lecturer, original.id)).toEqual(originalEdit)

    // Copying into the same course is allowed too.
    const again = await copyTest(lecturer, original.id, algo.id)
    expect(again).toMatchObject({ courseId: algo.id, state: 'not_started' })
  })

  it("copyTest into a colleague's course is FORBIDDEN", async () => {
    const { lecturer, algo, theirs } = await setup()
    const test = await createTest(lecturer, algo.id, validInput())
    await expectAppError(copyTest(lecturer, test.id, theirs.id), 'FORBIDDEN')
    await expectAppError(copyTest(lecturer, test.id, crypto.randomUUID()), 'FORBIDDEN')
    expect(await countRows()).toEqual({ tests: 1, questions: 3, options: 5 })
  })

  it('deleteTest works before Start and is CONFLICT started after', async () => {
    const { lecturer, algo, alice } = await setup()
    const draft = await createTest(lecturer, algo.id, validInput())
    await join(draft.id, alice)
    await deleteTest(lecturer, draft.id)
    expect(await countRows()).toEqual({ tests: 0, questions: 0, options: 0 })
    await expectAppError(deleteTest(lecturer, draft.id), 'FORBIDDEN')

    const started = await createTest(lecturer, algo.id, validInput())
    await start(started.id)
    await expectAppError(deleteTest(lecturer, started.id), 'CONFLICT', { reason: 'started' })
    expect(await countRows()).toEqual({ tests: 1, questions: 3, options: 5 })
  })
})
