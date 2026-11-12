import { and, eq } from 'drizzle-orm'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
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
import { createSchool, setSchoolLocation } from '@/server/schools/service'
import { createClass, joinClassAsLecturer, joinClassAsStudent } from '@/server/classes/service'
import { createCourse, setRosterAdjustment } from '@/server/courses/service'
import { sendPush } from '@/server/push/send'
import { codeForSlot } from './code'
import { loadStatusMatrix } from './matrix'
import {
  closeWindow,
  createSession,
  deleteSession,
  getLiveWindow,
  getSession,
  openWindow,
  setAttendanceOverride,
} from './sessions'

vi.mock('@/server/push/send', () => {
  const sendPush = vi.fn(async (items: unknown[]) => ({ sent: 0, skipped: items.length, failed: 0, removed: 0 }))
  return {
    sendPush,
    queuePush: vi.fn(async (_context: string, build: () => Promise<unknown[]>) => {
      await sendPush(await build())
    }),
  }
})

const MIN = 60_000

describe('attendance sessions', () => {
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

  /**
   * A course with two enrolled students (Alice, Bob) and a colleague sharing the class.
   * The clock starts a minute ahead of real time, so rows the database stamps with its own
   * now() (class joined_at, adjustment created_at) are before every session.
   */
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

  async function windowSecret(windowId: string) {
    const [row] = await db.select({ secret: attendanceWindow.secret }).from(attendanceWindow).where(eq(attendanceWindow.id, windowId))
    return row.secret
  }

  it('opening the same window kind twice pushes once', async () => {
    const { lecturer, algo } = await setup()
    const push = vi.mocked(sendPush)
    push.mockClear()
    const session = await createSession(lecturer, algo.id, { requireOnCampus: false })
    await openWindow(lecturer, session.id, 'start')
    await expect(openWindow(lecturer, session.id, 'start')).rejects.toMatchObject({ code: 'CONFLICT' })
    expect(push).toHaveBeenCalledTimes(1)
    const items = push.mock.calls[0][0] as { userId: string; payload: { url: string; kind: string } }[]
    expect(items).toHaveLength(2)
    expect(items.every((i) => i.payload.url === '/check-in' && i.payload.kind === 'checkInOpened')).toBe(true)
  })

  it('owner creates a session; a colleague sharing the class gets FORBIDDEN on every function', async () => {
    const { lecturer, colleague, algo, alice } = await setup()
    const session = await createSession(lecturer, algo.id, { requireOnCampus: false })
    expect(session).toEqual({
      id: expect.any(String),
      courseId: algo.id,
      createdAt: clock,
      requireOnCampus: false,
      windows: [],
    })
    const live = await openWindow(lecturer, session.id, 'start')

    const forbidden = [
      () => createSession(colleague, algo.id, { requireOnCampus: false }),
      () => getSession(colleague, session.id),
      () => openWindow(colleague, session.id, 'end'),
      () => closeWindow(colleague, live.windowId),
      () => getLiveWindow(colleague, live.windowId),
      () => setAttendanceOverride(colleague, session.id, alice.user.id, 'present'),
      () => deleteSession(colleague, session.id),
      // Nonexistent ids look exactly like someone else's.
      () => createSession(lecturer, 'no-such-course', { requireOnCampus: false }),
      () => getSession(lecturer, 'no-such-session'),
      () => openWindow(lecturer, 'no-such-session', 'end'),
      () => closeWindow(lecturer, 'no-such-window'),
      () => getLiveWindow(lecturer, 'no-such-window'),
      () => setAttendanceOverride(lecturer, 'no-such-session', alice.user.id, 'present'),
      () => deleteSession(lecturer, 'no-such-session'),
    ]
    for (const call of forbidden) await expect(call()).rejects.toMatchObject({ code: 'FORBIDDEN' })

    // Nothing changed: the window is still open, the session still there.
    expect((await getLiveWindow(lecturer, live.windowId)).open).toBe(true)
    expect((await getSession(lecturer, session.id)).session.windows).toHaveLength(1)
  })

  it('a student gets FORBIDDEN on every lecturer function', async () => {
    const { lecturer, algo, alice } = await setup()
    const session = await createSession(lecturer, algo.id, { requireOnCampus: false })
    const live = await openWindow(lecturer, session.id, 'start')
    const calls = [
      () => createSession(alice, algo.id, { requireOnCampus: false }),
      () => getSession(alice, session.id),
      () => openWindow(alice, session.id, 'end'),
      () => closeWindow(alice, live.windowId),
      () => getLiveWindow(alice, live.windowId),
      () => setAttendanceOverride(alice, session.id, alice.user.id, 'present'),
      () => deleteSession(alice, session.id),
    ]
    for (const call of calls) await expect(call()).rejects.toMatchObject({ code: 'FORBIDDEN' })
  })

  it('lecturer functions require a verified email', async () => {
    setConfigForTests({ requireEmailVerification: true })
    const lecturer = await lecturerCtx({ emailVerified: false })
    await expect(createSession(lecturer, 'x', { requireOnCampus: false })).rejects.toMatchObject({
      code: 'EMAIL_UNVERIFIED',
    })
    await expect(getSession(lecturer, 'x')).rejects.toMatchObject({ code: 'EMAIL_UNVERIFIED' })
    await expect(getLiveWindow(lecturer, 'x')).rejects.toMatchObject({ code: 'EMAIL_UNVERIFIED' })
  })

  it('requireOnCampus on a school without coordinates is VALIDATION no_campus_location', async () => {
    const { lecturer, sch, algo } = await setup()
    await expect(createSession(lecturer, algo.id, { requireOnCampus: true })).rejects.toMatchObject({
      code: 'VALIDATION',
      details: { reason: 'no_campus_location' },
    })
    expect(await db.select().from(attendanceSession)).toEqual([])

    await setSchoolLocation(lecturer, sch.id, { latitude: 4.15, longitude: 9.29 })
    const session = await createSession(lecturer, algo.id, { requireOnCampus: true })
    expect(session.requireOnCampus).toBe(true)
  })

  it('openWindow returns the current code, 6 chars, and roster size; code changes after 60 s', async () => {
    const { lecturer, algo } = await setup()
    const session = await createSession(lecturer, algo.id, { requireOnCampus: false })
    const openedAt = clock
    const live = await openWindow(lecturer, session.id, 'start')
    expect(live).toEqual({
      windowId: expect.any(String),
      sessionId: session.id,
      kind: 'start',
      open: true,
      code: expect.stringMatching(/^[A-Z2-9]{6}$/),
      codeExpiresInSeconds: 60,
      closesAt: new Date(openedAt.getTime() + 15 * MIN),
      checkedInCount: 0,
      rosterSize: 2,
    })
    // The secret never leaves the server.
    expect(JSON.stringify(live)).not.toContain(await windowSecret(live.windowId))
    expect(live.code).toBe(codeForSlot(await windowSecret(live.windowId), 0))

    advance(30_000)
    const later = await getLiveWindow(lecturer, live.windowId)
    expect(later.code).toBe(live.code)
    expect(later.codeExpiresInSeconds).toBe(30)

    advance(30_000)
    const rotated = await getLiveWindow(lecturer, live.windowId)
    expect(rotated.code).not.toBe(live.code)
    expect(rotated.code).toBe(codeForSlot(await windowSecret(live.windowId), 1))
    expect(rotated.codeExpiresInSeconds).toBe(60)

    const { session: summary } = await getSession(lecturer, session.id)
    expect(summary.windows).toEqual([
      {
        id: live.windowId,
        kind: 'start',
        openedAt,
        closesAt: new Date(openedAt.getTime() + 15 * MIN),
        open: true,
      },
    ])
  })

  it('opening start twice is CONFLICT already_opened', async () => {
    const { lecturer, algo } = await setup()
    const session = await createSession(lecturer, algo.id, { requireOnCampus: false })
    const live = await openWindow(lecturer, session.id, 'start')
    await expect(openWindow(lecturer, session.id, 'start')).rejects.toMatchObject({
      code: 'CONFLICT',
      details: { reason: 'already_opened' },
    })
    // Still a conflict once the first one is closed: a kind opens once per session.
    await closeWindow(lecturer, live.windowId)
    await expect(openWindow(lecturer, session.id, 'start')).rejects.toMatchObject({
      code: 'CONFLICT',
      details: { reason: 'already_opened' },
    })
    expect(await db.select().from(attendanceWindow)).toHaveLength(1)
  })

  it('a window can be opened up to 12 h after the session was created; later it is CONFLICT session_over', async () => {
    const { lecturer, algo } = await setup()
    const HOUR = 60 * MIN
    const recent = await createSession(lecturer, algo.id, { requireOnCampus: false })
    advance(11 * HOUR + 59 * MIN)
    const live = await openWindow(lecturer, recent.id, 'start')
    expect(live).toMatchObject({ kind: 'start', open: true })
    await closeWindow(lecturer, live.windowId)

    advance(2 * MIN) // 12 h 1 min after the session was created
    await expect(openWindow(lecturer, recent.id, 'end')).rejects.toMatchObject({
      code: 'CONFLICT',
      details: { reason: 'session_over' },
    })
    expect(await db.select().from(attendanceWindow)).toHaveLength(1)
  })

  it('rejects an unknown window kind', async () => {
    const { lecturer, algo } = await setup()
    const session = await createSession(lecturer, algo.id, { requireOnCampus: false })
    await expect(openWindow(lecturer, session.id, 'middle' as 'start')).rejects.toMatchObject({ code: 'VALIDATION' })
  })

  it('opening a window while another window of the same course is open is CONFLICT another_open', async () => {
    const { lecturer, cls, algo } = await setup()
    const first = await createSession(lecturer, algo.id, { requireOnCampus: false })
    const second = await createSession(lecturer, algo.id, { requireOnCampus: false })
    const live = await openWindow(lecturer, first.id, 'start')

    await expect(openWindow(lecturer, second.id, 'start')).rejects.toMatchObject({
      code: 'CONFLICT',
      details: { reason: 'another_open', windowId: live.windowId },
    })
    await expect(openWindow(lecturer, first.id, 'end')).rejects.toMatchObject({
      code: 'CONFLICT',
      details: { reason: 'another_open', windowId: live.windowId },
    })

    // Another course of the same class is independent.
    const dbs = await createCourse(lecturer, { classId: cls.id, title: 'Databases', semester: 1 })
    const other = await createSession(lecturer, dbs.id, { requireOnCampus: false })
    expect((await openWindow(lecturer, other.id, 'start')).open).toBe(true)

    // Once the first window is closed, the second session can open.
    await closeWindow(lecturer, live.windowId)
    expect((await openWindow(lecturer, second.id, 'start')).open).toBe(true)
  })

  it('a start window left open is closed 15 min later, and the end window can then be opened', async () => {
    const { lecturer, algo } = await setup()
    const session = await createSession(lecturer, algo.id, { requireOnCampus: false })
    const openedAt = clock
    const start = await openWindow(lecturer, session.id, 'start')

    advance(15 * MIN - 1000)
    expect((await getLiveWindow(lecturer, start.windowId)).open).toBe(true)
    await expect(openWindow(lecturer, session.id, 'end')).rejects.toMatchObject({
      code: 'CONFLICT',
      details: { reason: 'another_open' },
    })

    advance(1000)
    const expired = await getLiveWindow(lecturer, start.windowId)
    expect(expired).toMatchObject({
      open: false,
      code: null,
      codeExpiresInSeconds: null,
      closesAt: new Date(openedAt.getTime() + 15 * MIN),
    })
    const end = await openWindow(lecturer, session.id, 'end')
    expect(end).toMatchObject({ kind: 'end', open: true })

    // Closing the auto-closed window is a no-op: it keeps its natural close time.
    await closeWindow(lecturer, start.windowId)
    const [row] = await db.select().from(attendanceWindow).where(eq(attendanceWindow.id, start.windowId))
    expect(row.closedAt).toBeNull()
    expect((await getLiveWindow(lecturer, start.windowId)).closesAt).toEqual(new Date(openedAt.getTime() + 15 * MIN))
  })

  it('closeWindow stops it; getLiveWindow then reports open=false and code=null; closing again is a no-op', async () => {
    const { lecturer, algo } = await setup()
    const session = await createSession(lecturer, algo.id, { requireOnCampus: false })
    const live = await openWindow(lecturer, session.id, 'start')
    advance(2 * MIN)
    const closedAt = clock
    await closeWindow(lecturer, live.windowId)

    const after = await getLiveWindow(lecturer, live.windowId)
    expect(after).toMatchObject({ open: false, code: null, codeExpiresInSeconds: null, closesAt: closedAt })

    advance(MIN)
    await closeWindow(lecturer, live.windowId)
    expect((await getLiveWindow(lecturer, live.windowId)).closesAt).toEqual(closedAt)
    const { session: summary } = await getSession(lecturer, session.id)
    expect(summary.windows[0]).toMatchObject({ open: false, closesAt: closedAt })
  })

  it('getLiveWindow counts check-ins against the current roster size', async () => {
    const { lecturer, algo, alice, bob } = await setup()
    const outsider = await studentCtx()
    const session = await createSession(lecturer, algo.id, { requireOnCampus: false })
    const live = await openWindow(lecturer, session.id, 'start')
    await checkIn(live.windowId, alice.user.id)
    await checkIn(live.windowId, bob.user.id)
    await checkIn(live.windowId, outsider.user.id) // not on the roster: not counted
    expect(await getLiveWindow(lecturer, live.windowId)).toMatchObject({ checkedInCount: 2, rosterSize: 2 })

    await setRosterAdjustment(lecturer, algo.id, bob.user.id, 'exclude')
    expect(await getLiveWindow(lecturer, live.windowId)).toMatchObject({ checkedInCount: 1, rosterSize: 1 })
  })

  it('setAttendanceOverride sets, replaces and clears; a student not on the roster is VALIDATION', async () => {
    const { lecturer, algo, alice } = await setup()
    const session = await createSession(lecturer, algo.id, { requireOnCampus: false })
    const aliceState = async () =>
      (await getSession(lecturer, session.id)).students.find((s) => s.studentId === alice.user.id)!

    await setAttendanceOverride(lecturer, session.id, alice.user.id, 'present')
    expect(await aliceState()).toMatchObject({ override: 'present', status: 'present' })
    const [row] = await db
      .select()
      .from(attendanceOverride)
      .where(and(eq(attendanceOverride.sessionId, session.id), eq(attendanceOverride.studentId, alice.user.id)))
    expect(row).toMatchObject({ status: 'present', setBy: lecturer.user.id, setAt: clock })

    await setAttendanceOverride(lecturer, session.id, alice.user.id, 'absent')
    expect(await aliceState()).toMatchObject({ override: 'absent', status: 'absent' })
    expect(await db.select().from(attendanceOverride)).toHaveLength(1)

    await setAttendanceOverride(lecturer, session.id, alice.user.id, null)
    expect(await aliceState()).toMatchObject({ override: null, status: null })
    await setAttendanceOverride(lecturer, session.id, alice.user.id, null) // clearing again is fine
    expect(await db.select().from(attendanceOverride)).toEqual([])

    const outsider = await studentCtx()
    await expect(setAttendanceOverride(lecturer, session.id, outsider.user.id, 'present')).rejects.toMatchObject({
      code: 'VALIDATION',
    })
    await expect(
      setAttendanceOverride(lecturer, session.id, alice.user.id, 'excused' as 'present'),
    ).rejects.toMatchObject({ code: 'VALIDATION' })
    expect(await db.select().from(attendanceOverride)).toEqual([])
  })

  it('getSession computes statuses with the spec rule and overrides winning', async () => {
    const { lecturer, sch, cls, algo, alice, bob } = await setup()
    const carol = await studentCtx({ name: 'Carol' })
    const dave = await studentCtx({ name: 'Dave' })
    const erin = await studentCtx({ name: 'Erin' })
    const frank = await studentCtx({ name: 'Frank' })
    await joinClassAsStudent(carol, cls.studentCode!, 'UB3')
    await joinClassAsStudent(dave, cls.studentCode!, 'UB4')
    await joinClassAsStudent(erin, cls.studentCode!, 'UB5')
    // Frank is an included carry-over from another class at the school.
    const otherClass = await createClass(lecturer, { schoolId: sch.id, name: 'CS L2', academicYear: '2026/27' })
    await joinClassAsStudent(frank, otherClass.studentCode!, 'UB9')
    await setRosterAdjustment(lecturer, algo.id, frank.user.id, 'include')

    // A session before anyone opened a window: nothing to judge yet.
    const empty = await createSession(lecturer, algo.id, { requireOnCampus: false })
    expect((await getSession(lecturer, empty.id)).students.map((s) => s.status)).toEqual([
      null,
      null,
      null,
      null,
      null,
      null,
    ])

    advance(MIN) // sessions are listed in creation order
    const session = await createSession(lecturer, algo.id, { requireOnCampus: false })
    // Dave joined the class after the session was created: not enrolled for it.
    await db
      .update(classStudent)
      .set({ joinedAt: new Date(clock.getTime() + MIN) })
      .where(eq(classStudent.userId, dave.user.id))

    const start = await openWindow(lecturer, session.id, 'start')
    await checkIn(start.windowId, alice.user.id)
    await checkIn(start.windowId, bob.user.id)
    await checkIn(start.windowId, frank.user.id)
    await closeWindow(lecturer, start.windowId)
    const end = await openWindow(lecturer, session.id, 'end')
    await checkIn(end.windowId, alice.user.id)
    await closeWindow(lecturer, end.windowId)
    await setAttendanceOverride(lecturer, session.id, erin.user.id, 'present')

    const view = await getSession(lecturer, session.id)
    expect(view.course).toEqual(algo)
    expect(view.session.windows.map((w) => w.kind)).toEqual(['start', 'end'])
    expect(view.students).toEqual([
      { studentId: alice.user.id, name: 'Alice', matricule: 'UB1', checkedStart: true, checkedEnd: true, override: null, status: 'present' },
      { studentId: bob.user.id, name: 'Bob', matricule: 'UB2', checkedStart: true, checkedEnd: false, override: null, status: 'partial' },
      { studentId: carol.user.id, name: 'Carol', matricule: 'UB3', checkedStart: false, checkedEnd: false, override: null, status: 'absent' },
      { studentId: dave.user.id, name: 'Dave', matricule: 'UB4', checkedStart: false, checkedEnd: false, override: null, status: 'not_enrolled' },
      { studentId: erin.user.id, name: 'Erin', matricule: 'UB5', checkedStart: false, checkedEnd: false, override: 'present', status: 'present' },
      { studentId: frank.user.id, name: 'Frank', matricule: 'UB9', checkedStart: true, checkedEnd: false, override: null, status: 'partial' },
    ])

    // An include made after a session does not enrol the student for it...
    await db
      .update(courseRosterAdjustment)
      .set({ createdAt: new Date(clock.getTime() + 2 * MIN) })
      .where(eq(courseRosterAdjustment.studentId, frank.user.id))
    const matrix = await loadStatusMatrix(db, algo.id, { studentId: frank.user.id })
    expect([...matrix.keys()]).toEqual([empty.id, session.id])
    expect(matrix.get(empty.id)!.get(frank.user.id)!.status).toBe('not_enrolled')
    // ...unless they checked in to it: a check-in proves enrolment.
    expect(matrix.get(session.id)!.get(frank.user.id)!.status).toBe('partial')
    expect([...matrix.get(session.id)!.keys()]).toEqual([frank.user.id])

    // With only the start window opened, the start check alone is present.
    advance(MIN)
    const third = await createSession(lecturer, algo.id, { requireOnCampus: false })
    const only = await openWindow(lecturer, third.id, 'start')
    await checkIn(only.windowId, bob.user.id)
    const thirdMatrix = await loadStatusMatrix(db, algo.id, { sessionId: third.id })
    expect([...thirdMatrix.keys()]).toEqual([third.id])
    expect(thirdMatrix.get(third.id)!.get(bob.user.id)!.status).toBe('present')
    expect(thirdMatrix.get(third.id)!.get(alice.user.id)!.status).toBe('absent')
  })

  it('deleteSession removes the session', async () => {
    const { lecturer, algo, alice } = await setup()
    const session = await createSession(lecturer, algo.id, { requireOnCampus: false })
    const live = await openWindow(lecturer, session.id, 'start')
    await checkIn(live.windowId, alice.user.id)
    await setAttendanceOverride(lecturer, session.id, alice.user.id, 'absent')

    await deleteSession(lecturer, session.id)
    await expect(getSession(lecturer, session.id)).rejects.toMatchObject({ code: 'FORBIDDEN' })
    expect(await db.select().from(attendanceSession)).toEqual([])
    expect(await db.select().from(attendanceWindow)).toEqual([])
    expect(await db.select().from(attendanceCheckIn)).toEqual([])
    expect(await db.select().from(attendanceOverride)).toEqual([])
    expect((await loadStatusMatrix(db, algo.id)).size).toBe(0)
  })
})
