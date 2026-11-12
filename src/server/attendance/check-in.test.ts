import { eq } from 'drizzle-orm'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
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
import { createClass, joinClassAsStudent } from '@/server/classes/service'
import { createCourse, setRosterAdjustment } from '@/server/courses/service'
import { codeForSlot } from './code'
import { closeWindow, createSession, getCheckInLink, openWindow } from './sessions'
import { checkIn, checkInWithLink, getCheckInLinkTarget, listOpenCheckIns } from './check-in'
import { CHECK_IN_LINK_PARAM, signCheckInLink } from './link'

vi.mock('@/server/push/send', () => ({
  sendPush: vi.fn(async () => ({ sent: 0, skipped: 0, failed: 0, removed: 0 })),
  queuePush: vi.fn(async () => {}),
}))

const MIN = 60_000
const CAMPUS = { latitude: 4.15, longitude: 9.29 } // default radius: 500 m
const METRES_PER_DEGREE_LAT = 111_195

/** A fix `metres` due north of the campus centre. */
function north(metres: number, accuracy = 20) {
  return { latitude: CAMPUS.latitude + metres / METRES_PER_DEGREE_LAT, longitude: CAMPUS.longitude, accuracy }
}

describe('student check-in', () => {
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
    db = await createTestDb()
  })
  afterEach(async () => {
    setNowForTests(null)
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

  /** A course with two enrolled students (Alice, Bob), at a school with a campus location. */
  async function setup() {
    setClock(new Date(Date.now() + MIN))
    const lecturer = await lecturerCtx({ name: 'Dr Owner' })
    const sch = await createSchool(lecturer, { name: 'University of Buea', town: 'Buea' })
    await setSchoolLocation(lecturer, sch.id, CAMPUS)
    const cls = await createClass(lecturer, { schoolId: sch.id, name: 'CS L3', academicYear: '2026/27' })
    const algo = await createCourse(lecturer, { classId: cls.id, title: 'Algorithms', semester: 1 })
    const alice = await studentCtx({ name: 'Alice' })
    const bob = await studentCtx({ name: 'Bob' })
    await joinClassAsStudent(alice, cls.studentCode!, 'UB1')
    await joinClassAsStudent(bob, cls.studentCode!, 'UB2')
    return { lecturer, sch, cls, algo, alice, bob }
  }

  /** Opens a window and returns its id with a function giving the code of any slot. */
  async function open(lecturer: Awaited<ReturnType<typeof lecturerCtx>>, courseId: string, requireOnCampus = false) {
    const session = await createSession(lecturer, courseId, { requireOnCampus })
    const live = await openWindow(lecturer, session.id, 'start')
    const [row] = await db.select().from(attendanceWindow).where(eq(attendanceWindow.id, live.windowId))
    return { sessionId: session.id, windowId: live.windowId, code: live.code!, codeAt: (slot: number) => codeForSlot(row.secret, slot) }
  }

  async function checkInRows() {
    return db.select().from(attendanceCheckIn)
  }
  async function failures(windowId: string, studentId: string) {
    const rows = await db.select().from(attendanceCodeFailure).where(eq(attendanceCodeFailure.windowId, windowId))
    return rows.find((r) => r.studentId === studentId)?.failures ?? 0
  }

  it('a rostered student checks in with the current code', async () => {
    const { lecturer, algo, alice } = await setup()
    const w = await open(lecturer, algo.id)
    advance(20_000)
    await expect(checkIn(alice, w.windowId, { code: w.code.toLowerCase(), position: null })).resolves.toEqual({
      result: 'checked_in',
    })
    expect(await checkInRows()).toEqual([
      {
        windowId: w.windowId,
        studentId: alice.user.id,
        checkedInAt: clock,
        latitude: null,
        longitude: null,
        accuracyM: null,
      },
    ])
  })

  it('the previous code works 5 s after rotation, not 15 s after', async () => {
    const { lecturer, algo, alice, bob } = await setup()
    const w = await open(lecturer, algo.id)
    const first = w.codeAt(0)

    advance(65_000)
    expect(first).not.toBe(w.codeAt(1))
    await expect(checkIn(alice, w.windowId, { code: first, position: null })).resolves.toEqual({ result: 'checked_in' })

    advance(10_000)
    await expect(checkIn(bob, w.windowId, { code: first, position: null })).rejects.toMatchObject({
      code: 'VALIDATION',
      details: { reason: 'wrong_code' },
    })
    await expect(checkIn(bob, w.windowId, { code: w.codeAt(1), position: null })).resolves.toEqual({
      result: 'checked_in',
    })
  })

  it('checking in twice returns already_checked_in and keeps one row', async () => {
    const { lecturer, algo, alice } = await setup()
    const w = await open(lecturer, algo.id)
    await checkIn(alice, w.windowId, { code: w.code, position: null })
    const firstAt = clock

    advance(30_000)
    await expect(checkIn(alice, w.windowId, { code: w.code, position: null })).resolves.toEqual({
      result: 'already_checked_in',
    })
    // Even with a wrong code, and after the window closed.
    await expect(checkIn(alice, w.windowId, { code: 'WRONG1', position: null })).resolves.toEqual({
      result: 'already_checked_in',
    })
    await closeWindow(lecturer, w.windowId)
    await expect(checkIn(alice, w.windowId, { code: w.code, position: null })).resolves.toEqual({
      result: 'already_checked_in',
    })
    const rows = await checkInRows()
    expect(rows).toHaveLength(1)
    expect(rows[0].checkedInAt).toEqual(firstAt)
    expect(await failures(w.windowId, alice.user.id)).toBe(0)
  })

  it('wrong code is refused wrong_code; the 11th try is too_many_attempts even with the right code', async () => {
    const { lecturer, algo, alice, bob } = await setup()
    const w = await open(lecturer, algo.id)
    const wrong = w.code === 'AAAAAA' ? 'BBBBBB' : 'AAAAAA'

    for (let i = 1; i <= 10; i++) {
      await expect(checkIn(alice, w.windowId, { code: wrong, position: null })).rejects.toMatchObject({
        code: 'VALIDATION',
        details: { reason: 'wrong_code' },
      })
      expect(await failures(w.windowId, alice.user.id)).toBe(i)
    }
    await expect(checkIn(alice, w.windowId, { code: w.code, position: null })).rejects.toMatchObject({
      code: 'VALIDATION',
      details: { reason: 'too_many_attempts' },
    })
    expect(await failures(w.windowId, alice.user.id)).toBe(10)
    expect(await checkInRows()).toEqual([])

    // Strikes are per student: Bob is unaffected.
    await expect(checkIn(bob, w.windowId, { code: w.code, position: null })).resolves.toEqual({ result: 'checked_in' })
  })

  it('a closed or auto-closed window is refused closed', async () => {
    const { lecturer, cls, algo, alice, bob } = await setup()
    const closed = await open(lecturer, algo.id)
    await closeWindow(lecturer, closed.windowId)
    await expect(checkIn(alice, closed.windowId, { code: closed.code, position: null })).rejects.toMatchObject({
      code: 'VALIDATION',
      details: { reason: 'closed' },
    })

    const dbs = await createCourse(lecturer, { classId: cls.id, title: 'Databases', semester: 1 })
    const expiring = await open(lecturer, dbs.id)
    advance(15 * MIN - 1000)
    await expect(
      checkIn(alice, expiring.windowId, { code: expiring.codeAt(14), position: null }),
    ).resolves.toEqual({ result: 'checked_in' })
    advance(1000)
    await expect(
      checkIn(bob, expiring.windowId, { code: expiring.codeAt(15), position: null }),
    ).rejects.toMatchObject({ code: 'VALIDATION', details: { reason: 'closed' } })
    await expect(
      checkIn(bob, expiring.windowId, { code: expiring.codeAt(14), position: null }),
    ).rejects.toMatchObject({ code: 'VALIDATION', details: { reason: 'closed' } })

    expect(await checkInRows()).toHaveLength(1)
    expect(await db.select().from(attendanceCodeFailure)).toEqual([])
  })

  it('a student not on the roster (or excluded) gets FORBIDDEN; a lecturer gets FORBIDDEN', async () => {
    const { lecturer, algo, bob } = await setup()
    const outsider = await studentCtx()
    const w = await open(lecturer, algo.id)
    await setRosterAdjustment(lecturer, algo.id, bob.user.id, 'exclude')

    const calls = [
      () => checkIn(outsider, w.windowId, { code: w.code, position: null }),
      () => checkIn(bob, w.windowId, { code: w.code, position: null }),
      () => checkIn(lecturer, w.windowId, { code: w.code, position: null }),
      () => checkIn(outsider, 'no-such-window', { code: w.code, position: null }),
      () => listOpenCheckIns(lecturer),
    ]
    for (const call of calls) await expect(call()).rejects.toMatchObject({ code: 'FORBIDDEN' })
    // A wrong code from someone off the roster is not even counted.
    await expect(checkIn(bob, w.windowId, { code: 'WRONG1', position: null })).rejects.toMatchObject({
      code: 'FORBIDDEN',
    })
    expect(await checkInRows()).toEqual([])
    expect(await db.select().from(attendanceCodeFailure)).toEqual([])
  })

  it('location required: null → location_required, 1200 m accuracy → location_imprecise, 800 m away → off_campus; none count as wrong-code strikes', async () => {
    const { lecturer, algo, alice } = await setup()
    const w = await open(lecturer, algo.id, true)
    const attempts = [
      { position: null, reason: 'location_required' },
      { position: north(0, 1200), reason: 'location_imprecise' },
      { position: north(800, 20), reason: 'off_campus' },
    ]
    for (let round = 0; round < 4; round++) {
      for (const { position, reason } of attempts) {
        await expect(checkIn(alice, w.windowId, { code: w.code, position })).rejects.toMatchObject({
          code: 'VALIDATION',
          details: { reason },
        })
      }
    }
    expect(await db.select().from(attendanceCodeFailure)).toEqual([])
    expect(await checkInRows()).toEqual([])
    // 12 location refusals later, the right code from campus still works.
    await expect(checkIn(alice, w.windowId, { code: w.code, position: north(100) })).resolves.toEqual({
      result: 'checked_in',
    })
  })

  it('location required and on campus → checked_in with coordinates stored', async () => {
    const { lecturer, algo, alice } = await setup()
    const w = await open(lecturer, algo.id, true)
    const position = north(450, 30)
    await expect(checkIn(alice, w.windowId, { code: w.code, position })).resolves.toEqual({ result: 'checked_in' })
    expect(await checkInRows()).toEqual([
      {
        windowId: w.windowId,
        studentId: alice.user.id,
        checkedInAt: clock,
        latitude: position.latitude,
        longitude: position.longitude,
        accuracyM: 30,
      },
    ])
  })

  it('location not required → coordinates are not stored even if sent', async () => {
    const { lecturer, algo, alice } = await setup()
    const w = await open(lecturer, algo.id)
    // Far away, but the session does not ask for campus.
    await expect(checkIn(alice, w.windowId, { code: w.code, position: north(50_000) })).resolves.toEqual({
      result: 'checked_in',
    })
    const [row] = await checkInRows()
    expect(row).toMatchObject({ latitude: null, longitude: null, accuracyM: null })
  })

  it('a school that lost its coordinates after the session was created skips the campus check', async () => {
    const { lecturer, sch, algo, alice } = await setup()
    const w = await open(lecturer, algo.id, true)
    await db.update(school).set({ latitude: null, longitude: null }).where(eq(school.id, sch.id))
    await expect(checkIn(alice, w.windowId, { code: w.code, position: null })).resolves.toEqual({
      result: 'checked_in',
    })
  })

  it('a malformed position is VALIDATION on position', async () => {
    const { lecturer, algo, alice } = await setup()
    const w = await open(lecturer, algo.id)
    const bad = [
      { latitude: Number.NaN, longitude: 9.29, accuracy: 10 },
      { latitude: 4.15, longitude: Number.POSITIVE_INFINITY, accuracy: 10 },
      { latitude: 4.15, longitude: 9.29, accuracy: Number.NaN },
      { latitude: 91, longitude: 9.29, accuracy: 10 },
      { latitude: -91, longitude: 9.29, accuracy: 10 },
      { latitude: 4.15, longitude: 181, accuracy: 10 },
      { latitude: 4.15, longitude: -181, accuracy: 10 },
      { latitude: 4.15, longitude: 9.29, accuracy: -1 },
      { latitude: '4.15', longitude: 9.29, accuracy: 10 },
    ]
    for (const position of bad) {
      await expect(
        checkIn(alice, w.windowId, { code: w.code, position: position as never }),
      ).rejects.toMatchObject({ code: 'VALIDATION', details: { fields: ['position'] } })
    }
    expect(await checkInRows()).toEqual([])
  })

  it('listOpenCheckIns shows open windows of my courses only, with checkedIn flags, soonest closing first', async () => {
    const { lecturer, sch, cls, algo, alice, bob } = await setup()
    const dbs = await createCourse(lecturer, { classId: cls.id, title: 'Databases', semester: 1 })
    const net = await createCourse(lecturer, { classId: cls.id, title: 'Networks', semester: 1 })
    // A course of another class that Alice is not on.
    const otherClass = await createClass(lecturer, { schoolId: sch.id, name: 'CS L2', academicYear: '2026/27' })
    const other = await createCourse(lecturer, { classId: otherClass.id, title: 'Intro', semester: 1 })

    expect(await listOpenCheckIns(alice)).toEqual([])

    const algoW = await open(lecturer, algo.id, true)
    advance(2 * MIN)
    const dbsOpenedAt = clock
    const dbsW = await open(lecturer, dbs.id)
    const netW = await open(lecturer, net.id)
    await closeWindow(lecturer, netW.windowId)
    await open(lecturer, other.id)
    await checkIn(alice, dbsW.windowId, { code: dbsW.code, position: null })

    expect(await listOpenCheckIns(alice)).toEqual([
      {
        windowId: algoW.windowId,
        courseId: algo.id,
        courseTitle: 'Algorithms',
        kind: 'start',
        requireOnCampus: true,
        closesAt: new Date(dbsOpenedAt.getTime() - 2 * MIN + 15 * MIN),
        checkedIn: false,
      },
      {
        windowId: dbsW.windowId,
        courseId: dbs.id,
        courseTitle: 'Databases',
        kind: 'start',
        requireOnCampus: false,
        closesAt: new Date(dbsOpenedAt.getTime() + 15 * MIN),
        checkedIn: true,
      },
    ])
    expect((await listOpenCheckIns(bob)).map((w) => w.checkedIn)).toEqual([false, false])

    // Once the first window closes by itself it drops off the list.
    advance(13 * MIN)
    expect((await listOpenCheckIns(alice)).map((w) => w.windowId)).toEqual([dbsW.windowId])

    // An excluded student no longer sees the course.
    await setRosterAdjustment(lecturer, dbs.id, bob.user.id, 'exclude')
    expect(await listOpenCheckIns(bob)).toEqual([])
  })
  describe('check-in links', () => {
    beforeEach(() => vi.stubEnv('BETTER_AUTH_SECRET', 'test-secret-'.repeat(4)))
    afterEach(() => vi.unstubAllEnvs())

    /** The token inside the link the lecturer copies. */
    async function linkToken(lecturer: Awaited<ReturnType<typeof lecturerCtx>>, windowId: string) {
      const path = await getCheckInLink(lecturer, windowId)
      expect(path).not.toBeNull()
      return new URL(path!, 'https://clasync.test').searchParams.get(CHECK_IN_LINK_PARAM)!
    }

    it('the owner gets a link for an open window, without the code in it; others are FORBIDDEN', async () => {
      const { lecturer, algo, alice } = await setup()
      const w = await open(lecturer, algo.id)
      const path = await getCheckInLink(lecturer, w.windowId)
      expect(path).toMatch(/^\/check-in\?w=/)
      expect(path).not.toContain(w.code)
      const colleague = await lecturerCtx()
      await expect(getCheckInLink(colleague, w.windowId)).rejects.toMatchObject({ code: 'FORBIDDEN' })
      await expect(getCheckInLink(alice, w.windowId)).rejects.toMatchObject({ code: 'FORBIDDEN' })
      await closeWindow(lecturer, w.windowId)
      expect(await getCheckInLink(lecturer, w.windowId)).toBeNull()
    })

    it('a rostered student checks in with the link alone, once', async () => {
      const { lecturer, algo, alice } = await setup()
      const w = await open(lecturer, algo.id)
      const token = await linkToken(lecturer, w.windowId)
      await expect(getCheckInLinkTarget(alice, token)).resolves.toMatchObject({
        windowId: w.windowId,
        courseTitle: 'Algorithms',
        kind: 'start',
        open: true,
        checkedIn: false,
      })
      advance(5 * MIN) // codes have rotated five times: the link does not care
      await expect(checkInWithLink(alice, token, { position: null })).resolves.toEqual({ result: 'checked_in' })
      await expect(checkInWithLink(alice, token, { position: null })).resolves.toEqual({ result: 'already_checked_in' })
      expect(await checkInRows()).toHaveLength(1)
      await expect(getCheckInLinkTarget(alice, token)).resolves.toMatchObject({ checkedIn: true })
    })

    it('closed or expired windows are refused closed', async () => {
      const { lecturer, cls, algo, alice, bob } = await setup()
      const w = await open(lecturer, algo.id)
      const token = await linkToken(lecturer, w.windowId)
      await closeWindow(lecturer, w.windowId)
      await expect(checkInWithLink(alice, token, { position: null })).rejects.toMatchObject({
        code: 'VALIDATION',
        details: { reason: 'closed' },
      })
      await expect(getCheckInLinkTarget(alice, token)).resolves.toMatchObject({ open: false, checkedIn: false })

      const dbs = await createCourse(lecturer, { classId: cls.id, title: 'Databases', semester: 1 })
      const expiring = await open(lecturer, dbs.id)
      const later = await linkToken(lecturer, expiring.windowId)
      advance(15 * MIN)
      await expect(checkInWithLink(bob, later, { position: null })).rejects.toMatchObject({
        code: 'VALIDATION',
        details: { reason: 'closed' },
      })
      expect(await checkInRows()).toEqual([])
    })

    it('students off the roster, excluded students and lecturers are FORBIDDEN; nothing is recorded', async () => {
      const { lecturer, algo, bob } = await setup()
      const outsider = await studentCtx()
      const w = await open(lecturer, algo.id)
      const token = await linkToken(lecturer, w.windowId)
      await setRosterAdjustment(lecturer, algo.id, bob.user.id, 'exclude')
      for (const ctx of [outsider, bob, lecturer]) {
        await expect(checkInWithLink(ctx, token, { position: null })).rejects.toMatchObject({ code: 'FORBIDDEN' })
        await expect(getCheckInLinkTarget(ctx, token)).rejects.toMatchObject({ code: 'FORBIDDEN' })
      }
      expect(await checkInRows()).toEqual([])
    })

    it('a forged, tampered or other-window token is NOT_FOUND; a signed unknown window is FORBIDDEN', async () => {
      const { lecturer, cls, algo, alice } = await setup()
      const w = await open(lecturer, algo.id)
      const token = await linkToken(lecturer, w.windowId)
      const sig = token.split('.')[1]
      const dbs = await createCourse(lecturer, { classId: cls.id, title: 'Databases', semester: 1 })
      await closeWindow(lecturer, w.windowId)
      const other = await open(lecturer, dbs.id)
      for (const bad of [`${other.windowId}.${sig}`, `${w.windowId}.${'A'.repeat(22)}`, w.windowId, 'junk']) {
        await expect(checkInWithLink(alice, bad, { position: null })).rejects.toMatchObject({ code: 'NOT_FOUND' })
        await expect(getCheckInLinkTarget(alice, bad)).rejects.toMatchObject({ code: 'NOT_FOUND' })
      }
      const ghost = signCheckInLink('00000000-0000-4000-8000-000000000000')
      await expect(checkInWithLink(alice, ghost, { position: null })).rejects.toMatchObject({ code: 'FORBIDDEN' })
      expect(await checkInRows()).toEqual([])
      // Bad links are not wrong codes: no strikes.
      expect(await db.select().from(attendanceCodeFailure)).toEqual([])
    })

    it('a student locked out by wrong codes stays locked out with the link', async () => {
      const { lecturer, algo, alice } = await setup()
      const w = await open(lecturer, algo.id)
      const wrong = w.code === 'AAAAAA' ? 'BBBBBB' : 'AAAAAA'
      for (let i = 0; i < 10; i++) {
        await expect(checkIn(alice, w.windowId, { code: wrong, position: null })).rejects.toMatchObject({
          details: { reason: 'wrong_code' },
        })
      }
      const token = await linkToken(lecturer, w.windowId)
      await expect(checkInWithLink(alice, token, { position: null })).rejects.toMatchObject({
        code: 'VALIDATION',
        details: { reason: 'too_many_attempts' },
      })
      expect(await checkInRows()).toEqual([])
    })

    it('the campus rule still applies when the session requires it', async () => {
      const { lecturer, algo, alice } = await setup()
      const w = await open(lecturer, algo.id, true)
      const token = await linkToken(lecturer, w.windowId)
      await expect(getCheckInLinkTarget(alice, token)).resolves.toMatchObject({ requireOnCampus: true })
      await expect(checkInWithLink(alice, token, { position: null })).rejects.toMatchObject({
        details: { reason: 'location_required' },
      })
      await expect(checkInWithLink(alice, token, { position: north(800) })).rejects.toMatchObject({
        details: { reason: 'off_campus' },
      })
      await expect(checkInWithLink(alice, token, { position: north(100) })).resolves.toEqual({ result: 'checked_in' })
      const [row] = await checkInRows()
      expect(row.latitude).not.toBeNull()
    })
  })
})
