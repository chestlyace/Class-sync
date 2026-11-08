import { PGlite } from '@electric-sql/pglite'
import { eq } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/pglite'
import { migrate } from 'drizzle-orm/pglite/migrator'
import path from 'node:path'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { setNowForTests } from '@/server/core/clock'
import type { Ctx } from '@/server/core/context'
import type { Db } from '@/server/db'
import * as schema from '@/server/db/schema'
import {
  assignment,
  attendanceCheckIn,
  attendanceOverride,
  attendanceSession,
  attendanceWindow,
  class_,
  classLecturer,
  classStudent,
  course,
  courseCaSettings,
  courseRosterAdjustment,
  participationEvent,
  school,
  submission,
  user,
} from '@/server/db/schema'
import { createClass, joinClassAsLecturer, joinClassAsStudent, removeStudentFromClass } from '@/server/classes/service'
import { createCourse, setRosterAdjustment } from '@/server/courses/service'
import { createSchool } from '@/server/schools/service'
import { closeWindow, createSession, openWindow } from '@/server/attendance/sessions'
import {
  createAssignment,
  gradeSubmission,
  publishAssignment,
  releaseGrades,
  type AssignmentInput,
} from '@/server/assignments/lecturer'
import { setAfterResponseForTests } from '@/server/lib/after-response'
import { ctxFor, makeUser } from '@/test/factories'
import { DEFAULT_SETTINGS } from './rules'
import { getCaSettings } from './inputs'
import { getCourseCa, getMyCa, type StudentCa } from './service'

const MIN = 60_000
const DAY = 24 * 60 * MIN

// Every statement the services send goes through this logger, so a test can count them.
let queryCount = 0

/** As `createTestDb`, with a query-counting logger. */
async function createCountingTestDb(): Promise<Db> {
  const client = new PGlite()
  const db = drizzle(client, {
    schema,
    logger: {
      logQuery: () => {
        queryCount++
      },
    },
  })
  await migrate(db, { migrationsFolder: path.resolve(process.cwd(), 'drizzle') })
  return db as unknown as Db
}

const paragraph = (text: string) => ({ type: 'paragraph', content: [{ type: 'text', text, styles: {} }], children: [] })

describe('CA service', () => {
  let db: Db
  let clock: Date

  function setClock(at: Date) {
    clock = at
    setNowForTests(() => clock)
  }
  function advance(ms: number) {
    setClock(new Date(clock.getTime() + ms))
  }

  beforeAll(async () => {
    db = await createCountingTestDb()
  })
  beforeEach(() => {
    // Publishing schedules notification emails: drop them.
    setAfterResponseForTests(() => {})
    vi.stubEnv('BETTER_AUTH_URL', 'https://clasync.test')
  })
  afterEach(async () => {
    setNowForTests(null)
    setAfterResponseForTests(null)
    vi.unstubAllEnvs()
    await db.delete(participationEvent)
    await db.delete(courseCaSettings)
    await db.delete(submission)
    await db.delete(assignment)
    await db.delete(attendanceOverride)
    await db.delete(attendanceCheckIn)
    await db.delete(attendanceWindow)
    await db.delete(attendanceSession)
    await db.delete(courseRosterAdjustment)
    await db.delete(course)
    await db.delete(classStudent)
    await db.delete(classLecturer)
    await db.delete(class_)
    await db.delete(school)
    await db.delete(user)
  })

  async function lecturerCtx(name: string) {
    return ctxFor(db, await makeUser(db, { role: 'lecturer', name }))
  }
  async function studentCtx(name: string) {
    return ctxFor(db, await makeUser(db, { role: 'student', name }))
  }

  /** A course with Alice and Bob on its roster and a colleague sharing the class. */
  async function setup() {
    setClock(new Date(Date.now() + MIN))
    const lecturer = await lecturerCtx('Dr Owner')
    const sch = await createSchool(lecturer, { name: 'University of Buea', town: 'Buea' })
    const cls = await createClass(lecturer, { schoolId: sch.id, name: 'CS L3', academicYear: '2026/27' })
    const colleague = await lecturerCtx('Dr Colleague')
    await joinClassAsLecturer(colleague, cls.lecturerCode!)
    const algo = await createCourse(lecturer, { classId: cls.id, title: 'Algorithms', semester: 1 })
    const alice = await studentCtx('Alice')
    const bob = await studentCtx('Bob')
    await joinClassAsStudent(alice, cls.studentCode!, 'UB1')
    await joinClassAsStudent(bob, cls.studentCode!, 'UB2')
    return { lecturer, colleague, sch, cls, algo, alice, bob }
  }

  async function addStudent(cls: { studentCode?: string | null }, name: string, matricule: string) {
    const s = await studentCtx(name)
    await joinClassAsStudent(s, cls.studentCode!, matricule)
    return s
  }

  async function checkIn(windowId: string, studentId: string) {
    await db.insert(attendanceCheckIn).values({ windowId, studentId })
  }

  /** A session with both windows opened and closed; each listed student checks in to the given windows. */
  async function heldSession(lecturer: Ctx, courseId: string, checks: [Ctx, 'both' | 'start' | 'none'][] = []) {
    const session = await createSession(lecturer, courseId, { requireOnCampus: false })
    const start = await openWindow(lecturer, session.id, 'start')
    for (const [who, what] of checks) if (what !== 'none') await checkIn(start.windowId, who.user.id)
    await closeWindow(lecturer, start.windowId)
    const end = await openWindow(lecturer, session.id, 'end')
    for (const [who, what] of checks) if (what === 'both') await checkIn(end.windowId, who.user.id)
    await closeWindow(lecturer, end.windowId)
    advance(MIN)
    return session
  }

  function assignmentInput(over: Partial<AssignmentInput> = {}): AssignmentInput {
    return {
      title: 'Sorting lab',
      instructions: [paragraph('Implement merge sort.')],
      dueAt: new Date(clock.getTime() + DAY),
      maxMark: 20,
      weight: 1,
      submissionMode: 'both',
      latePolicy: 'accept',
      attachmentIds: [],
      ...over,
    }
  }

  async function publishedAssignment(lecturer: Ctx, courseId: string, over: Partial<AssignmentInput> = {}) {
    const a = await createAssignment(lecturer, courseId, assignmentInput(over))
    await publishAssignment(lecturer, a.id)
    return a
  }

  /** A hand-in, graded when a mark is given. */
  async function handIn(
    lecturer: Ctx,
    student: Ctx,
    assignmentId: string,
    mark?: number,
  ): Promise<{ id: string; submittedAt: Date }> {
    const submittedAt = new Date(clock.getTime())
    const [row] = await db
      .insert(submission)
      .values({ assignmentId, studentId: student.user.id, submittedAt })
      .returning({ id: submission.id })
    if (mark !== undefined) {
      await gradeSubmission(lecturer, row.id, { mark, feedback: null, expectedSubmittedAt: submittedAt })
    }
    return { id: row.id, submittedAt }
  }

  async function tap(lecturer: Ctx, courseId: string, student: Ctx, delta: 1 | -1, times = 1) {
    for (let i = 0; i < times; i++) {
      await db.insert(participationEvent).values({ courseId, studentId: student.user.id, delta, createdBy: lecturer.user.id })
    }
  }

  const rowOf = (rows: StudentCa[], who: Ctx) => rows.find((r) => r.studentId === who.user.id)!
  const component = (row: Pick<StudentCa, 'result'>, key: string) => row.result.components.find((c) => c.key === key)

  it('a fresh course: default settings, every component not started, final 0 / 30, nobody slipping', async () => {
    const { lecturer, algo, alice, bob } = await setup()

    expect(await getCaSettings(db, algo.id)).toEqual(DEFAULT_SETTINGS)
    const { settings, rows } = await getCourseCa(lecturer, algo.id)
    expect(settings).toEqual(DEFAULT_SETTINGS)
    expect(rows.map((r) => r.studentId)).toEqual([alice.user.id, bob.user.id])
    for (const row of rows) {
      expect(row.result).toEqual({
        components: [
          { key: 'attendance', points: 5, ratio: null, score: null },
          { key: 'assignments', points: 20, ratio: null, score: null },
          { key: 'participation', points: 5, ratio: null, score: null },
        ],
        soFar: 0,
        soFarOutOf: 0,
        final: 0,
        total: 30,
      })
      expect(row).toMatchObject({ attendanceRatio: null, countedSessions: 0, missingWork: 0, slipping: false, rank: 1 })
    }
    expect(rowOf(rows, alice)).toMatchObject({ name: 'Alice', matricule: 'UB1' })

    const mine = await getMyCa(alice, algo.id)
    expect(mine).toEqual({ settings: DEFAULT_SETTINGS, result: rows[0].result, missingWork: 0 })
  })

  it("a late joiner's sessions from before they joined (not_enrolled) don't count", async () => {
    const { lecturer, algo, alice, cls } = await setup()
    const dave = await addStudent(cls, 'Dave', 'UB4')

    const first = await heldSession(lecturer, algo.id, [[alice, 'both']])
    const second = await heldSession(lecturer, algo.id, [[alice, 'both']])
    // Dave joined after the first two sessions, then attended the third.
    await db
      .update(classStudent)
      .set({ joinedAt: new Date(second.createdAt.getTime() + MIN / 2) })
      .where(eq(classStudent.userId, dave.user.id))
    await heldSession(lecturer, algo.id, [[alice, 'both'], [dave, 'both']])
    expect(first.createdAt.getTime()).toBeLessThan(second.createdAt.getTime())

    const { rows } = await getCourseCa(lecturer, algo.id)
    expect(rowOf(rows, dave)).toMatchObject({ countedSessions: 1, attendanceRatio: 1 })
    expect(component(rowOf(rows, dave), 'attendance')).toEqual({ key: 'attendance', points: 5, ratio: 1, score: 5 })
    expect(rowOf(rows, alice)).toMatchObject({ countedSessions: 3, attendanceRatio: 1 })
    expect((await getMyCa(dave, algo.id)).result.final).toBe(5)
  })

  it('only released grades count; no hand-in on a released assignment is 0 and missing work, as is one past due', async () => {
    const { lecturer, algo, alice, bob } = await setup()

    // Released, weight 1 / 20: Alice 15, Bob 10.
    const marked = await publishedAssignment(lecturer, algo.id, { title: 'Marked', maxMark: 20, weight: 1 })
    await handIn(lecturer, alice, marked.id, 15)
    await handIn(lecturer, bob, marked.id, 10)
    await releaseGrades(lecturer, marked.id)

    // Not released yet: Alice's 8 / 10 doesn't count.
    const pending = await publishedAssignment(lecturer, algo.id, { title: 'Pending', maxMark: 10, weight: 2 })
    await handIn(lecturer, alice, pending.id, 8)
    await handIn(lecturer, bob, pending.id)

    // Released: Alice never handed in (0, missing); Bob's hand-in was never graded (pending).
    const skipped = await publishedAssignment(lecturer, algo.id, { title: 'Skipped', weight: 1 })
    const bobsSkipped = await handIn(lecturer, bob, skipped.id)
    await releaseGrades(lecturer, skipped.id)

    // Published, unreleased, about to pass its deadline: Bob handed in, Alice didn't.
    const overdue = await publishedAssignment(lecturer, algo.id, { title: 'Overdue', weight: 1 })
    await handIn(lecturer, bob, overdue.id)

    // A draft past due never counts.
    await createAssignment(lecturer, algo.id, assignmentInput({ title: 'Draft' }))

    // Before the deadlines nothing unreleased is missing.
    let rows = (await getCourseCa(lecturer, algo.id)).rows
    expect(rowOf(rows, alice).missingWork).toBe(1)
    expect(rowOf(rows, bob).missingWork).toBe(0)

    advance(2 * DAY) // every deadline has passed; "Skipped" is both released and past due: counted once
    rows = (await getCourseCa(lecturer, algo.id)).rows

    // Alice: (15/20 + 0) / 2 = 0.375 → 7.5 of 20.
    expect(component(rowOf(rows, alice), 'assignments')).toEqual({
      key: 'assignments',
      points: 20,
      ratio: 0.375,
      score: 7.5,
    })
    expect(rowOf(rows, alice).missingWork).toBe(2) // Skipped + Overdue
    // Bob: the ungraded hand-in is left out → 10/20 = 0.5 → 10 of 20, and nothing is missing.
    expect(component(rowOf(rows, bob), 'assignments')).toMatchObject({ ratio: 0.5, score: 10 })
    expect(rowOf(rows, bob).missingWork).toBe(0)

    const mine = await getMyCa(alice, algo.id)
    expect(mine.missingWork).toBe(2)
    expect(mine.result).toEqual(rowOf(rows, alice).result)

    // Once graded, Bob's hand-in counts: (10/20 + 4/20) / 2 = 0.35 → 7 of 20.
    await gradeSubmission(lecturer, bobsSkipped.id, { mark: 4, feedback: null, expectedSubmittedAt: bobsSkipped.submittedAt })
    rows = (await getCourseCa(lecturer, algo.id)).rows
    expect(component(rowOf(rows, bob), 'assignments')).toMatchObject({ ratio: 0.35, score: 7 })
    expect(rowOf(rows, bob).missingWork).toBe(0)
  })

  it("assignments due before a student joined don't count against them, while a classmate's do", async () => {
    const { lecturer, algo, alice, cls } = await setup()
    const dave = await addStudent(cls, 'Dave', 'UB4')

    // Due before Dave joined: one released (Alice 10/20), one unreleased past due (nobody handed in).
    const early = await publishedAssignment(lecturer, algo.id, { title: 'Early' })
    await handIn(lecturer, alice, early.id, 10)
    await releaseGrades(lecturer, early.id)
    const earlyUnreleased = await publishedAssignment(lecturer, algo.id, { title: 'Early unreleased' })
    advance(2 * DAY)
    await db
      .update(classStudent)
      .set({ joinedAt: new Date(earlyUnreleased.dueAt.getTime() + MIN) })
      .where(eq(classStudent.userId, dave.user.id))

    let rows = (await getCourseCa(lecturer, algo.id)).rows
    expect(component(rowOf(rows, dave), 'assignments')).toMatchObject({ ratio: null, score: null })
    expect(rowOf(rows, dave).missingWork).toBe(0)
    expect(component(rowOf(rows, alice), 'assignments')).toMatchObject({ ratio: 0.5, score: 10 })
    expect(rowOf(rows, alice).missingWork).toBe(1) // Early unreleased
    expect((await getMyCa(dave, algo.id)).missingWork).toBe(0)

    // Due after Dave joined, released, nobody handed in: counts for both.
    const later = await publishedAssignment(lecturer, algo.id, { title: 'Later' })
    await releaseGrades(lecturer, later.id)
    rows = (await getCourseCa(lecturer, algo.id)).rows
    expect(component(rowOf(rows, dave), 'assignments')).toMatchObject({ ratio: 0, score: 0 })
    expect(rowOf(rows, dave).missingWork).toBe(1)
    expect(component(rowOf(rows, alice), 'assignments')).toMatchObject({ ratio: 0.25, score: 5 })
    expect(rowOf(rows, alice).missingWork).toBe(2)
  })

  it('graded work on an assignment due before a student joined counts; missing or pending work there does not', async () => {
    const { lecturer, algo, cls } = await setup()
    const erin = await addStudent(cls, 'Erin', 'UB5')
    const frank = await addStudent(cls, 'Frank', 'UB6')

    // Both due before Erin and Frank joined. Erin handed in both: one graded, one never graded.
    const early = await publishedAssignment(lecturer, algo.id, { title: 'Early', maxMark: 20, weight: 1 })
    await handIn(lecturer, erin, early.id, 16)
    await releaseGrades(lecturer, early.id)
    const ungraded = await publishedAssignment(lecturer, algo.id, { title: 'Ungraded', maxMark: 20, weight: 1 })
    await handIn(lecturer, erin, ungraded.id)
    await releaseGrades(lecturer, ungraded.id)
    advance(2 * DAY)
    for (const late of [erin, frank]) {
      await db
        .update(classStudent)
        .set({ joinedAt: new Date(ungraded.dueAt.getTime() + MIN) })
        .where(eq(classStudent.userId, late.user.id))
    }

    const { rows } = await getCourseCa(lecturer, algo.id)
    // Erin: only the graded hand-in counts → 16/20 = 0.8 → 16 of 20; nothing missing.
    expect(component(rowOf(rows, erin), 'assignments')).toMatchObject({ ratio: 0.8, score: 16 })
    expect(rowOf(rows, erin).missingWork).toBe(0)
    // Frank handed in nothing: not started, nothing missing.
    expect(component(rowOf(rows, frank), 'assignments')).toMatchObject({ ratio: null, score: null })
    expect(rowOf(rows, frank).missingWork).toBe(0)
    expect((await getMyCa(erin, algo.id)).result).toEqual(rowOf(rows, erin).result)
  })

  it('a student excluded from the course or removed from the class is left out and refused', async () => {
    const { lecturer, algo, alice, bob, cls } = await setup()
    const carol = await addStudent(cls, 'Carol', 'UB3')
    await heldSession(lecturer, algo.id, [[alice, 'both'], [bob, 'both'], [carol, 'both']])
    await tap(lecturer, algo.id, bob, 1)

    await setRosterAdjustment(lecturer, algo.id, bob.user.id, 'exclude')
    await removeStudentFromClass(lecturer, cls.id, carol.user.id)

    const { rows } = await getCourseCa(lecturer, algo.id)
    expect(rows.map((r) => r.studentId)).toEqual([alice.user.id])
    await expect(getMyCa(bob, algo.id)).rejects.toMatchObject({ code: 'FORBIDDEN' })
    await expect(getMyCa(carol, algo.id)).rejects.toMatchObject({ code: 'FORBIDDEN' })
    expect((await getMyCa(alice, algo.id)).result.final).toBeGreaterThan(0)
  })

  it('applies the participation net (floored at 0) against the course target and the stored settings', async () => {
    const { lecturer, algo, alice, bob, cls } = await setup()
    const carol = await addStudent(cls, 'Carol', 'UB3')
    const custom = {
      total: 20,
      attendancePoints: 5,
      assignmentPoints: 10,
      participationPoints: 5,
      testPoints: 0,
      participationTarget: 4,
    }
    await db.insert(courseCaSettings).values({ courseId: algo.id, ...custom, updatedBy: lecturer.user.id })

    await tap(lecturer, algo.id, alice, 1, 3)
    await tap(lecturer, algo.id, bob, 1)
    await tap(lecturer, algo.id, bob, -1, 2)

    expect(await getCaSettings(db, algo.id)).toEqual(custom)
    const { settings, rows } = await getCourseCa(lecturer, algo.id)
    expect(settings).toEqual(custom)
    // Alice: net 3 of 4 → 0.75 → 3.75 of 5.
    expect(component(rowOf(rows, alice), 'participation')).toEqual({
      key: 'participation',
      points: 5,
      ratio: 0.75,
      score: 3.75,
    })
    // Bob: net −1 → 0. Carol: no taps, but the class has participation → started at 0.
    expect(component(rowOf(rows, bob), 'participation')).toMatchObject({ ratio: 0, score: 0 })
    expect(component(rowOf(rows, carol), 'participation')).toMatchObject({ ratio: 0, score: 0 })
    expect(rowOf(rows, alice).result).toMatchObject({ soFar: 3.75, soFarOutOf: 5, final: 3.75, total: 20 })

    // More taps than the target cap at 1.
    await tap(lecturer, algo.id, alice, 1, 5)
    expect(component(await getMyCa(alice, algo.id), 'participation')).toMatchObject({ ratio: 1, score: 5 })
  })

  it('ranks by final (ties share a rank, then by name) and flags slipping at the boundaries', async () => {
    const { lecturer, algo, alice, bob, cls } = await setup()
    const carol = await addStudent(cls, 'Carol', 'UB3')
    const dave = await addStudent(cls, 'Dave', 'UB4')
    const erin = await addStudent(cls, 'Erin', 'UB5')

    await heldSession(lecturer, algo.id, [[alice, 'both'], [bob, 'both'], [carol, 'both']])
    const second = await heldSession(lecturer, algo.id, [[alice, 'both'], [bob, 'both'], [carol, 'both']])
    // Dave and Erin joined after the first two sessions.
    await db
      .update(classStudent)
      .set({ joinedAt: new Date(second.createdAt.getTime() + MIN / 2) })
      .where(eq(classStudent.userId, dave.user.id))
    await db
      .update(classStudent)
      .set({ joinedAt: new Date(second.createdAt.getTime() + MIN / 2) })
      .where(eq(classStudent.userId, erin.user.id))
    await heldSession(lecturer, algo.id, [[alice, 'both'], [bob, 'both'], [dave, 'both'], [erin, 'start']])
    await heldSession(lecturer, algo.id, [[alice, 'both']])

    const { rows } = await getCourseCa(lecturer, algo.id)
    const summary = rows.map((r) => [r.name, r.rank, r.attendanceRatio, r.countedSessions, r.result.final, r.slipping])
    expect(summary).toEqual([
      // 4 / 4 present.
      ['Alice', 1, 1, 4, 5, false],
      // 3 / 4 = 0.75: exactly at the attendance threshold → not slipping.
      ['Bob', 2, 0.75, 4, 3.75, false],
      // 2 / 4 = 0.5 with 4 sessions → slipping (CA so far exactly 50 % is not below it).
      ['Carol', 3, 0.5, 4, 2.5, true],
      // 1 / 2 = 0.5 but only 2 sessions, CA so far exactly 50 % → not slipping. Ties Carol's rank.
      ['Dave', 3, 0.5, 2, 2.5, false],
      // 0.5 / 2 = 0.25: CA so far below 50 % → slipping even with 2 sessions.
      ['Erin', 5, 0.25, 2, 1.25, true],
    ])
  })

  it('getCourseCa is the owner only: a colleague, a student or a nonexistent course get FORBIDDEN', async () => {
    const { lecturer, colleague, algo, alice } = await setup()
    await expect(getCourseCa(colleague, algo.id)).rejects.toMatchObject({ code: 'FORBIDDEN' })
    await expect(getCourseCa(alice, algo.id)).rejects.toMatchObject({ code: 'FORBIDDEN' })
    await expect(getCourseCa(lecturer, 'no-such-course')).rejects.toMatchObject({ code: 'FORBIDDEN' })
  })

  it("getMyCa returns only the caller's numbers and refuses lecturers and students off the roster", async () => {
    const { lecturer, colleague, algo, alice, bob, sch } = await setup()
    await heldSession(lecturer, algo.id, [[alice, 'both'], [bob, 'none']])
    await tap(lecturer, algo.id, bob, 1, 5)

    const { rows } = await getCourseCa(lecturer, algo.id)
    const mine = await getMyCa(alice, algo.id)
    expect(Object.keys(mine).sort()).toEqual(['missingWork', 'result', 'settings'])
    expect(mine.result).toEqual(rowOf(rows, alice).result)
    expect(mine.result).not.toEqual(rowOf(rows, bob).result)
    expect((await getMyCa(bob, algo.id)).result).toEqual(rowOf(rows, bob).result)

    // A student of another class at the same school, never included.
    const otherClass = await createClass(lecturer, { schoolId: sch.id, name: 'CS L2', academicYear: '2026/27' })
    const outsider = await addStudent(otherClass, 'Olga', 'UB9')
    await expect(getMyCa(outsider, algo.id)).rejects.toMatchObject({ code: 'FORBIDDEN' })
    await expect(getMyCa(lecturer, algo.id)).rejects.toMatchObject({ code: 'FORBIDDEN' })
    await expect(getMyCa(colleague, algo.id)).rejects.toMatchObject({ code: 'FORBIDDEN' })
    await expect(getMyCa(alice, 'no-such-course')).rejects.toMatchObject({ code: 'FORBIDDEN' })
  })

  it('loads a whole course with a fixed number of queries, however many students it has', async () => {
    const { lecturer, algo, alice, bob, cls } = await setup()
    const others = [
      await addStudent(cls, 'Carol', 'UB3'),
      await addStudent(cls, 'Dave', 'UB4'),
      await addStudent(cls, 'Erin', 'UB5'),
    ]
    await heldSession(lecturer, algo.id, [[alice, 'both'], [bob, 'start']])
    const a = await publishedAssignment(lecturer, algo.id)
    await handIn(lecturer, alice, a.id, 12)
    await releaseGrades(lecturer, a.id)
    await tap(lecturer, algo.id, alice, 1)

    async function countQueries(fn: () => Promise<unknown>) {
      const before = queryCount
      await fn()
      return queryCount - before
    }

    // Five students on the roster, two with data.
    const smallCourse = await countQueries(() => getCourseCa(lecturer, algo.id))
    const smallMine = await countQueries(() => getMyCa(alice, algo.id))

    // Give the other three check-ins, graded hand-ins and taps: no more queries.
    await heldSession(lecturer, algo.id, [[alice, 'both'], ...others.map((o): [Ctx, 'both'] => [o, 'both'])])
    const b = await publishedAssignment(lecturer, algo.id, { title: 'Second' })
    for (const o of others) {
      await handIn(lecturer, o, b.id, 10)
      await tap(lecturer, algo.id, o, 1, 2)
    }
    await releaseGrades(lecturer, b.id)
    for (let i = 0; i < 5; i++) await addStudent(cls, `Late ${i}`, `UB${20 + i}`)

    const { rows } = await getCourseCa(lecturer, algo.id)
    expect(rows).toHaveLength(10)
    expect(await countQueries(() => getCourseCa(lecturer, algo.id))).toBe(smallCourse)
    expect(await countQueries(() => getMyCa(alice, algo.id))).toBe(smallMine)
    expect(smallCourse).toBeLessThanOrEqual(15)
  })
})
