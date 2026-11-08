import { eq } from 'drizzle-orm'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { setNowForTests } from '@/server/core/clock'
import type { Ctx } from '@/server/core/context'
import { AppError } from '@/server/core/errors'
import type { Db } from '@/server/db'
import { class_, classLecturer, classStudent, course, courseTest, school, testAttempt, user } from '@/server/db/schema'
import { createClass, joinClassAsLecturer, joinClassAsStudent } from '@/server/classes/service'
import { createCourse } from '@/server/courses/service'
import { createSchool } from '@/server/schools/service'
import { getTestForEdit } from '@/server/tests/authoring'
import { createTestDb } from '@/test/db'
import { ctxFor, makeUser } from '@/test/factories'
import type { EditorValues } from '@/app/(app)/courses/test-form'

let current: Ctx | null = null
vi.mock('@/server/auth/session', () => ({
  getCtx: async () => {
    if (!current) throw new AppError('UNAUTHENTICATED', 'Not signed in')
    return current
  },
}))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
vi.mock('next/navigation', () => ({
  redirect: (url: string) => {
    throw new Error(`NEXT_REDIRECT:${url}`)
  },
  unstable_rethrow: (err: unknown) => {
    if (err instanceof Error && err.message.startsWith('NEXT_REDIRECT:')) throw err
  },
}))

import {
  copyTestAction,
  deleteTestAction,
  endTestAction,
  getAttemptLogAction,
  getLiveTestAction,
  letBackInAction,
  saveTestAction,
  startTestAction,
} from '@/app/(app)/courses/test-actions'

const T0 = new Date('2026-11-09T08:00:00Z')

function editor(over: Partial<EditorValues> = {}): EditorValues {
  return {
    title: 'CA 1',
    durationMinutes: '30',
    defaultMark: '2',
    shuffle: true,
    maxExits: '3',
    maxAbsenceSeconds: '10',
    questions: [
      {
        key: 'a',
        kind: 'mcq',
        prompt: 'What is 2 + 2?',
        mark: '',
        options: [
          { key: 'o1', text: '3', correct: false },
          { key: 'o2', text: '4', correct: true },
        ],
        guide: '',
      },
      { key: 'b', kind: 'short', prompt: 'Define osmosis.', mark: '2,5', options: [], guide: 'Water across a membrane.' },
    ],
    ...over,
  }
}

describe('test actions', () => {
  let db: Db

  beforeAll(async () => {
    db = await createTestDb()
  })
  afterEach(async () => {
    current = null
    setNowForTests(null)
    await db.delete(testAttempt)
    await db.delete(courseTest)
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
    await joinClassAsStudent(alice, cls.studentCode!, 'UB1')
    current = lecturer
    return { lecturer, colleague, algo, networks, theirs, alice }
  }

  async function saved(courseId: string): Promise<string> {
    const result = await saveTestAction(courseId, null, editor())
    if (!result.ok) throw new Error(`save failed: ${result.code}`)
    return result.data.testId
  }

  it('saveTestAction creates a test from the editor text ("2,5", blank = default), then replaces it', async () => {
    const { lecturer, algo } = await setup()
    const testId = await saved(algo.id)

    const created = await getTestForEdit(lecturer, testId)
    expect(created.summary).toMatchObject({ courseId: algo.id, questionCount: 2, totalMarks: 4.5 })
    expect(created.input.questions.map((q) => q.mark)).toEqual([null, 2.5])

    const result = await saveTestAction(algo.id, testId, editor({ title: 'CA 1 (v2)', defaultMark: '1,5' }))
    expect(result).toEqual({ ok: true, data: { testId } })
    expect((await getTestForEdit(lecturer, testId)).summary).toMatchObject({ title: 'CA 1 (v2)', totalMarks: 4 })
  })

  it('saveTestAction passes the service\'s reason and question index through', async () => {
    const { algo } = await setup()
    const bad = editor()
    bad.questions[0] = { ...bad.questions[0], options: bad.questions[0].options.map((o) => ({ ...o, correct: true })) }
    expect(await saveTestAction(algo.id, null, bad)).toEqual({
      ok: false,
      code: 'VALIDATION',
      details: { reason: 'correct', question: 0 },
    })
    expect(await saveTestAction(algo.id, null, editor({ durationMinutes: 'soon' }))).toMatchObject({
      ok: false,
      details: { reason: 'duration' },
    })
  })

  it('every action refuses a missing or oversized id before calling a service', async () => {
    await setup()
    const long = 'x'.repeat(101)
    expect(await saveTestAction('', null, editor())).toMatchObject({ ok: false, code: 'VALIDATION', details: { fields: ['courseId'] } })
    expect(await saveTestAction('c', long, editor())).toMatchObject({ details: { fields: ['testId'] } })
    expect(await startTestAction('')).toMatchObject({ code: 'VALIDATION' })
    expect(await endTestAction(long)).toMatchObject({ code: 'VALIDATION' })
    expect(await letBackInAction(undefined as unknown as string)).toMatchObject({ details: { fields: ['attemptId'] } })
    expect(await getLiveTestAction('')).toMatchObject({ code: 'VALIDATION' })
    expect(await getAttemptLogAction('')).toMatchObject({ code: 'VALIDATION' })
    expect(await deleteTestAction('')).toMatchObject({ code: 'VALIDATION' })
    expect(await copyTestAction('t', '')).toMatchObject({ details: { fields: ['courseId'] } })
  })

  it('copyTestAction opens the copy\'s edit page; into a colleague\'s course it is FORBIDDEN', async () => {
    const { algo, networks, theirs } = await setup()
    const testId = await saved(algo.id)
    await expect(copyTestAction(testId, networks.id)).rejects.toThrow(
      new RegExp(`^NEXT_REDIRECT:/courses/${networks.id}/tests/[^/]+/edit\\?copied=1$`),
    )
    expect(await copyTestAction(testId, theirs.id)).toMatchObject({ ok: false, code: 'FORBIDDEN' })
  })

  it('deleteTestAction goes back to the list; a colleague gets FORBIDDEN', async () => {
    const { lecturer, colleague, algo } = await setup()
    const testId = await saved(algo.id)
    current = colleague
    expect(await deleteTestAction(testId)).toMatchObject({ ok: false, code: 'FORBIDDEN' })
    current = lecturer
    await expect(deleteTestAction(testId)).rejects.toThrow(`NEXT_REDIRECT:/courses/${algo.id}/tests`)
    expect(await db.select().from(courseTest).where(eq(courseTest.id, testId))).toEqual([])
  })

  it('start, live view with ISO dates, let back in, log, end', async () => {
    const { algo, alice } = await setup()
    const testId = await saved(algo.id)
    setNowForTests(() => T0)
    expect(await startTestAction(testId)).toEqual({ ok: true, data: null })

    const [attempt] = await db
      .insert(testAttempt)
      .values({
        testId,
        studentId: alice.user.id,
        seed: 's',
        deviceId: 'd',
        deviceSeenAt: T0,
        joinedAt: T0,
        closedAt: new Date(T0.getTime() + 60_000),
        closedReason: 'left',
      })
      .returning()
    setNowForTests(() => new Date(T0.getTime() + 120_000))

    const live = await getLiveTestAction(testId)
    expect(live).toMatchObject({
      ok: true,
      data: {
        phase: 'running',
        endsAt: new Date(T0.getTime() + 30 * 60_000).toISOString(),
        serverNow: new Date(T0.getTime() + 120_000).toISOString(),
        counts: { roster: 1, joined: 1, endedLeaving: 1 },
        rows: [{ name: 'Alice', status: 'ended', attemptId: attempt.id }],
      },
    })

    expect(await letBackInAction(attempt.id)).toEqual({ ok: true, data: null })
    const log = await getAttemptLogAction(attempt.id)
    expect(log).toEqual({
      ok: true,
      data: [{ at: new Date(T0.getTime() + 120_000).toISOString(), kind: 'reopened', exitNumber: null, awayMs: null }],
    })

    expect(await endTestAction(testId)).toEqual({ ok: true, data: null })
    expect(await getLiveTestAction(testId)).toMatchObject({ ok: true, data: { phase: 'ended' } })
    expect(await letBackInAction(attempt.id)).toMatchObject({ ok: false, code: 'CONFLICT' })
  })

  it('a student gets FORBIDDEN from the lecturer actions', async () => {
    const { algo, alice } = await setup()
    const testId = await saved(algo.id)
    current = alice
    expect(await getLiveTestAction(testId)).toMatchObject({ ok: false, code: 'FORBIDDEN' })
    expect(await startTestAction(testId)).toMatchObject({ ok: false, code: 'FORBIDDEN' })
    expect(await saveTestAction(algo.id, null, editor())).toMatchObject({ ok: false, code: 'FORBIDDEN' })
  })
})
