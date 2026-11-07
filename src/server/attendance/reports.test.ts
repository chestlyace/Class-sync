import { eq } from 'drizzle-orm'
import { afterEach, beforeAll, describe, expect, it } from 'vitest'
import { config, setConfigForTests } from '@/server/core/config'
import { setNowForTests } from '@/server/core/clock'
import type { Db } from '@/server/db'
import {
  attendanceCheckIn,
  attendanceCodeFailure,
  attendanceOverride,
  attendanceSession,
  attendanceWindow,
  class_,
  classLecturer,
  classStudent,
  course,
  courseRosterAdjustment,
  school,
} from '@/server/db/schema'
import { createTestDb } from '@/test/db'
import { ctxFor, makeUser } from '@/test/factories'
import { createSchool } from '@/server/schools/service'
import { createClass, joinClassAsLecturer, joinClassAsStudent } from '@/server/classes/service'
import { createCourse, setRosterAdjustment } from '@/server/courses/service'
import { getAttendanceGrid, getMyAttendance } from './reports'
import { closeWindow, createSession, getSession, openWindow, setAttendanceOverride } from './sessions'

const MIN = 60_000

describe('attendance reports', () => {
  let db: Db
  const original = config.requireEmailVerification
  let clock: Date

  function setClock(at: Date) {
    clock = at
    setNowForTests(() => clock)
  }
  function advance(ms: number) {
    setClock(new Date(clock.getTime() + ms))
  }

  beforeAll(async () => {
    db = await createTestDb()
  })
  afterEach(async () => {
    setNowForTests(null)
    setConfigForTests({ requireEmailVerification: original })
    await db.delete(attendanceCodeFailure)
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
  })

  async function lecturerCtx(overrides = {}) {
    return ctxFor(db, await makeUser(db, { role: 'lecturer', ...overrides }))
  }
  async function studentCtx(overrides = {}) {
    return ctxFor(db, await makeUser(db, { role: 'student', ...overrides }))
  }

  /** A course with two enrolled students (Alice, Bob) and a colleague sharing the class. */
  async function setup() {
    setClock(new Date(Date.now() + MIN))
    const lecturer = await lecturerCtx({ name: 'Dr Owner' })
    const sch = await createSchool(lecturer, { name: 'University of Buea', town: 'Buea' })
    const cls = await createClass(lecturer, { schoolId: sch.id, name: 'CS L3', academicYear: '2026/27' })
    const colleague = await lecturerCtx({ name: 'Dr Colleague' })
    await joinClassAsLecturer(colleague, cls.lecturerCode!)
    const algo = await createCourse(lecturer, { classId: cls.id, title: 'Algorithms', semester: 1 })
    const alice = await studentCtx({ name: 'Alice' })
    const bob = await studentCtx({ name: 'Bob' })
    await joinClassAsStudent(alice, cls.studentCode!, 'UB1')
    await joinClassAsStudent(bob, cls.studentCode!, 'UB2')
    return { lecturer, colleague, sch, cls, algo, alice, bob }
  }

  async function checkIn(windowId: string, studentId: string) {
    await db.insert(attendanceCheckIn).values({ windowId, studentId })
  }

  /** A session with both windows opened (and closed), in the given order of creation. */
  async function heldSession(lecturer: Awaited<ReturnType<typeof lecturerCtx>>, courseId: string) {
    const session = await createSession(lecturer, courseId, { requireOnCampus: false })
    const start = await openWindow(lecturer, session.id, 'start')
    await closeWindow(lecturer, start.windowId)
    const end = await openWindow(lecturer, session.id, 'end')
    await closeWindow(lecturer, end.windowId)
    return { session, start, end }
  }

  it('grid lists every session and every current roster student with spec statuses and totals', async () => {
    const { lecturer, algo, alice, bob, cls } = await setup()
    const carol = await studentCtx({ name: 'Carol' })
    await joinClassAsStudent(carol, cls.studentCode!, 'UB3')

    const first = await heldSession(lecturer, algo.id)
    await checkIn(first.start.windowId, alice.user.id)
    await checkIn(first.end.windowId, alice.user.id)
    await checkIn(first.start.windowId, bob.user.id)

    advance(MIN)
    // Second session: only the start window opened, so one check is enough.
    const second = await createSession(lecturer, algo.id, { requireOnCampus: false })
    const only = await openWindow(lecturer, second.id, 'start')
    await checkIn(only.windowId, bob.user.id)

    const grid = await getAttendanceGrid(lecturer, algo.id)
    expect(grid.sessions).toEqual([
      { id: first.session.id, createdAt: first.session.createdAt, requireOnCampus: false, windowsOpened: 2 },
      { id: second.id, createdAt: second.createdAt, requireOnCampus: false, windowsOpened: 1 },
    ])
    expect(grid.rows).toEqual([
      {
        studentId: alice.user.id,
        name: 'Alice',
        matricule: 'UB1',
        statuses: { [first.session.id]: 'present', [second.id]: 'absent' },
        overridden: { [first.session.id]: false, [second.id]: false },
        totals: { present: 1, partial: 0, absent: 1 },
      },
      {
        studentId: bob.user.id,
        name: 'Bob',
        matricule: 'UB2',
        statuses: { [first.session.id]: 'partial', [second.id]: 'present' },
        overridden: { [first.session.id]: false, [second.id]: false },
        totals: { present: 1, partial: 1, absent: 0 },
      },
      {
        studentId: carol.user.id,
        name: 'Carol',
        matricule: 'UB3',
        statuses: { [first.session.id]: 'absent', [second.id]: 'absent' },
        overridden: { [first.session.id]: false, [second.id]: false },
        totals: { present: 0, partial: 0, absent: 2 },
      },
    ])
  })

  it('a course with no sessions has an empty grid with the roster rows', async () => {
    const { lecturer, algo, alice, bob } = await setup()
    const grid = await getAttendanceGrid(lecturer, algo.id)
    expect(grid.sessions).toEqual([])
    expect(grid.rows.map((r) => [r.studentId, r.statuses, r.overridden, r.totals])).toEqual([
      [alice.user.id, {}, {}, { present: 0, partial: 0, absent: 0 }],
      [bob.user.id, {}, {}, { present: 0, partial: 0, absent: 0 }],
    ])
  })

  it('a student who joined the class after a session shows not_enrolled there and it is not counted', async () => {
    const { lecturer, algo, alice, cls } = await setup()
    const dave = await studentCtx({ name: 'Dave' })
    await joinClassAsStudent(dave, cls.studentCode!, 'UB4')

    const first = await heldSession(lecturer, algo.id)
    advance(MIN)
    const second = await heldSession(lecturer, algo.id)
    // Dave joined between the two sessions.
    await db
      .update(classStudent)
      .set({ joinedAt: new Date(first.session.createdAt.getTime() + MIN / 2) })
      .where(eq(classStudent.userId, dave.user.id))
    await checkIn(second.start.windowId, dave.user.id)
    await checkIn(second.end.windowId, dave.user.id)
    await checkIn(first.start.windowId, alice.user.id)

    const grid = await getAttendanceGrid(lecturer, algo.id)
    const row = grid.rows.find((r) => r.studentId === dave.user.id)!
    expect(row.statuses).toEqual({ [first.session.id]: 'not_enrolled', [second.session.id]: 'present' })
    expect(row.totals).toEqual({ present: 1, partial: 0, absent: 0 })
    // The session still counts for Alice.
    expect(grid.rows.find((r) => r.studentId === alice.user.id)!.totals).toEqual({ present: 0, partial: 1, absent: 1 })
  })

  it('a late joiner who checked in to a session created before they joined is present there (a check-in proves enrolment)', async () => {
    const { lecturer, algo, cls } = await setup()
    const gina = await studentCtx({ name: 'Gina' })
    await joinClassAsStudent(gina, cls.studentCode!, 'UB5')

    const session = await createSession(lecturer, algo.id, { requireOnCampus: false })
    // Gina joined the class a little after the lecturer created the session...
    await db
      .update(classStudent)
      .set({ joinedAt: new Date(session.createdAt.getTime() + MIN / 2) })
      .where(eq(classStudent.userId, gina.user.id))
    // ...and then checked in to both windows.
    advance(MIN)
    const start = await openWindow(lecturer, session.id, 'start')
    await checkIn(start.windowId, gina.user.id)
    await closeWindow(lecturer, start.windowId)
    const end = await openWindow(lecturer, session.id, 'end')
    await checkIn(end.windowId, gina.user.id)
    await closeWindow(lecturer, end.windowId)

    const grid = await getAttendanceGrid(lecturer, algo.id)
    const row = grid.rows.find((r) => r.studentId === gina.user.id)!
    expect(row.statuses).toEqual({ [session.id]: 'present' })
    expect(row.totals).toEqual({ present: 1, partial: 0, absent: 0 })

    const view = await getSession(lecturer, session.id)
    expect(view.students.find((s) => s.studentId === gina.user.id)).toMatchObject({
      checkedStart: true,
      checkedEnd: true,
      status: 'present',
    })

    expect(await getMyAttendance(gina, algo.id)).toEqual({
      entries: [{ sessionId: session.id, createdAt: session.createdAt, status: 'present' }],
      totals: { present: 1, partial: 0, absent: 0 },
    })
  })

  it('an included student is enrolled from the include date', async () => {
    const { lecturer, algo, sch } = await setup()
    const frank = await studentCtx({ name: 'Frank' })
    const otherClass = await createClass(lecturer, { schoolId: sch.id, name: 'CS L2', academicYear: '2026/27' })
    await joinClassAsStudent(frank, otherClass.studentCode!, 'UB9')

    const before = await heldSession(lecturer, algo.id)
    await setRosterAdjustment(lecturer, algo.id, frank.user.id, 'include')
    await db
      .update(courseRosterAdjustment)
      .set({ createdAt: new Date(before.session.createdAt.getTime() + MIN / 2) })
      .where(eq(courseRosterAdjustment.studentId, frank.user.id))
    advance(MIN)
    const after = await heldSession(lecturer, algo.id)
    await checkIn(after.start.windowId, frank.user.id)

    const grid = await getAttendanceGrid(lecturer, algo.id)
    const row = grid.rows.find((r) => r.studentId === frank.user.id)!
    expect(row.statuses).toEqual({ [before.session.id]: 'not_enrolled', [after.session.id]: 'partial' })
    expect(row.totals).toEqual({ present: 0, partial: 1, absent: 0 })
  })

  it('a session with no window opened is null for everyone except overridden students', async () => {
    const { lecturer, algo, alice, bob } = await setup()
    const session = await createSession(lecturer, algo.id, { requireOnCampus: false })
    await setAttendanceOverride(lecturer, session.id, bob.user.id, 'present')

    const grid = await getAttendanceGrid(lecturer, algo.id)
    expect(grid.sessions).toEqual([
      { id: session.id, createdAt: session.createdAt, requireOnCampus: false, windowsOpened: 0 },
    ])
    const byId = new Map(grid.rows.map((r) => [r.studentId, r]))
    expect(byId.get(alice.user.id)!.statuses).toEqual({ [session.id]: null })
    expect(byId.get(alice.user.id)!.totals).toEqual({ present: 0, partial: 0, absent: 0 })
    expect(byId.get(bob.user.id)!.statuses).toEqual({ [session.id]: 'present' })
    expect(byId.get(bob.user.id)!.totals).toEqual({ present: 1, partial: 0, absent: 0 })
  })

  it('overrides are flagged in `overridden`', async () => {
    const { lecturer, algo, alice, bob } = await setup()
    const { session, start } = await heldSession(lecturer, algo.id)
    await checkIn(start.windowId, alice.user.id)
    await setAttendanceOverride(lecturer, session.id, alice.user.id, 'absent')
    await setAttendanceOverride(lecturer, session.id, bob.user.id, 'present')

    const grid = await getAttendanceGrid(lecturer, algo.id)
    const [a, b] = grid.rows
    expect(a.statuses[session.id]).toBe('absent')
    expect(a.overridden).toEqual({ [session.id]: true })
    expect(b.statuses[session.id]).toBe('present')
    expect(b.overridden).toEqual({ [session.id]: true })
  })

  it('colleague and student get FORBIDDEN on getAttendanceGrid', async () => {
    const { lecturer, colleague, algo, alice } = await setup()
    await createSession(lecturer, algo.id, { requireOnCampus: false })
    for (const ctx of [colleague, alice]) {
      await expect(getAttendanceGrid(ctx, algo.id)).rejects.toMatchObject({ code: 'FORBIDDEN' })
    }
    await expect(getAttendanceGrid(lecturer, 'no-such-course')).rejects.toMatchObject({ code: 'FORBIDDEN' })
  })

  it('getMyAttendance returns only my entries, newest first, with totals; a student not on the roster gets FORBIDDEN', async () => {
    const { lecturer, colleague, algo, alice, bob, cls } = await setup()
    const first = await heldSession(lecturer, algo.id)
    await checkIn(first.start.windowId, alice.user.id)
    await checkIn(first.end.windowId, alice.user.id)
    await checkIn(first.start.windowId, bob.user.id)
    advance(MIN)
    const second = await heldSession(lecturer, algo.id)
    await checkIn(second.start.windowId, alice.user.id)
    advance(MIN)
    const third = await createSession(lecturer, algo.id, { requireOnCampus: false })

    expect(await getMyAttendance(alice, algo.id)).toEqual({
      entries: [
        { sessionId: third.id, createdAt: third.createdAt, status: null },
        { sessionId: second.session.id, createdAt: second.session.createdAt, status: 'partial' },
        { sessionId: first.session.id, createdAt: first.session.createdAt, status: 'present' },
      ],
      totals: { present: 1, partial: 1, absent: 0 },
    })
    expect((await getMyAttendance(bob, algo.id)).entries.map((e) => e.status)).toEqual([null, 'absent', 'partial'])

    const outsider = await studentCtx({ name: 'Zed' })
    const other = await createClass(lecturer, {
      schoolId: (await db.select().from(class_).where(eq(class_.id, cls.id)))[0].schoolId,
      name: 'CS L2',
      academicYear: '2026/27',
    })
    await joinClassAsStudent(outsider, other.studentCode!, 'UB7')
    for (const ctx of [outsider, lecturer, colleague]) {
      await expect(getMyAttendance(ctx, algo.id)).rejects.toMatchObject({ code: 'FORBIDDEN' })
    }
    await expect(getMyAttendance(alice, 'no-such-course')).rejects.toMatchObject({ code: 'FORBIDDEN' })

    // Removed from the roster: no more access.
    await setRosterAdjustment(lecturer, algo.id, bob.user.id, 'exclude')
    await expect(getMyAttendance(bob, algo.id)).rejects.toMatchObject({ code: 'FORBIDDEN' })
  })
})
