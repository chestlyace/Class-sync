import { eq } from 'drizzle-orm'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { config, setConfigForTests } from '@/server/core/config'
import { setNowForTests } from '@/server/core/clock'
import type { Db } from '@/server/db'
import { class_, classLecturer, classStudent, course, courseRosterAdjustment, participationEvent, school } from '@/server/db/schema'
import { createTestDb } from '@/test/db'
import { ctxFor, makeUser } from '@/test/factories'
import { createSchool } from '@/server/schools/service'
import { createClass, joinClassAsLecturer, joinClassAsStudent } from '@/server/classes/service'
import { createCourse, setRosterAdjustment } from '@/server/courses/service'
import { listParticipationToday, tapParticipation, undoLastTap } from './participation'
import { updateCaSettings } from './settings'

vi.mock('@/server/push/send', () => ({
  sendPush: vi.fn(async () => ({ sent: 0, skipped: 0, failed: 0, removed: 0 })),
  queuePush: vi.fn(async () => {}),
}))

const MIN = 60_000

describe('participation taps', () => {
  let db: Db
  const originalZone = config.timeZone
  let clock: Date

  function setClock(at: Date) {
    clock = at
    setNowForTests(() => clock)
  }

  beforeAll(async () => {
    db = await createTestDb()
  })
  afterEach(async () => {
    setNowForTests(null)
    setConfigForTests({ timeZone: originalZone })
    await db.delete(participationEvent)
    await db.delete(courseRosterAdjustment)
    await db.delete(course)
    await db.delete(classStudent)
    await db.delete(classLecturer)
    await db.delete(class_)
    await db.delete(school)
  })

  async function setup() {
    setClock(new Date('2026-11-08T12:00:00Z'))
    const lecturer = ctxFor(db, await makeUser(db, { role: 'lecturer' }))
    const sch = await createSchool(lecturer, { name: 'University of Buea', town: 'Buea' })
    const cls = await createClass(lecturer, { schoolId: sch.id, name: 'CS L3', academicYear: '2026/27' })
    const colleague = ctxFor(db, await makeUser(db, { role: 'lecturer' }))
    await joinClassAsLecturer(colleague, cls.lecturerCode!)
    const algo = await createCourse(lecturer, { classId: cls.id, title: 'Algorithms', semester: 1 })
    const alice = ctxFor(db, await makeUser(db, { role: 'student', name: 'Alice' }))
    const bob = ctxFor(db, await makeUser(db, { role: 'student', name: 'Bob' }))
    await joinClassAsStudent(alice, cls.studentCode!, 'UB1')
    await joinClassAsStudent(bob, cls.studentCode!, 'UB2')
    return { lecturer, colleague, alice, bob, algo, cls }
  }

  const events = (courseId: string) =>
    db.select().from(participationEvent).where(eq(participationEvent.courseId, courseId))

  it('two quick +1 taps are two events and net 2', async () => {
    const { lecturer, alice, algo } = await setup()
    expect(await tapParticipation(lecturer, algo.id, alice.user.id, 1)).toEqual({ net: 1 })
    expect(await tapParticipation(lecturer, algo.id, alice.user.id, 1)).toEqual({ net: 2 })
    const rows = await events(algo.id)
    expect(rows).toHaveLength(2)
    expect(rows[0]).toMatchObject({ studentId: alice.user.id, createdBy: lecturer.user.id, delta: 1, createdAt: clock })
  })

  it('does not floor the net: it can go negative', async () => {
    const { lecturer, alice, algo } = await setup()
    expect(await tapParticipation(lecturer, algo.id, alice.user.id, -1)).toEqual({ net: -1 })
    expect(await tapParticipation(lecturer, algo.id, alice.user.id, -1)).toEqual({ net: -2 })
  })

  it('refuses a student who is not on the roster, and a delta other than 1 or -1', async () => {
    const { lecturer, alice, algo } = await setup()
    const outsider = ctxFor(db, await makeUser(db, { role: 'student' }))
    await expect(tapParticipation(lecturer, algo.id, outsider.user.id, 1)).rejects.toMatchObject({
      code: 'VALIDATION',
      details: { fields: ['studentId'] },
    })
    await expect(tapParticipation(lecturer, algo.id, 'missing', 1)).rejects.toMatchObject({ code: 'VALIDATION' })
    await expect(tapParticipation(lecturer, algo.id, lecturer.user.id, 1)).rejects.toMatchObject({ code: 'VALIDATION' })
    for (const delta of [0, 2, -2, 1.5, NaN]) {
      await expect(tapParticipation(lecturer, algo.id, alice.user.id, delta as 1)).rejects.toMatchObject({
        code: 'VALIDATION',
      })
    }
    // Excluded from the course: no longer on the roster.
    await setRosterAdjustment(lecturer, algo.id, alice.user.id, 'exclude')
    await expect(tapParticipation(lecturer, algo.id, alice.user.id, 1)).rejects.toMatchObject({ code: 'VALIDATION' })
    expect(await events(algo.id)).toHaveLength(0)
  })

  it('is owner only: colleague, student and a missing course are FORBIDDEN', async () => {
    const { lecturer, colleague, alice, bob, algo } = await setup()
    await tapParticipation(lecturer, algo.id, alice.user.id, 1)
    for (const ctx of [colleague, alice, bob]) {
      await expect(tapParticipation(ctx, algo.id, alice.user.id, 1)).rejects.toMatchObject({ code: 'FORBIDDEN' })
      await expect(undoLastTap(ctx, algo.id)).rejects.toMatchObject({ code: 'FORBIDDEN' })
      await expect(listParticipationToday(ctx, algo.id)).rejects.toMatchObject({ code: 'FORBIDDEN' })
    }
    await expect(tapParticipation(lecturer, 'missing', alice.user.id, 1)).rejects.toMatchObject({ code: 'FORBIDDEN' })
    expect(await events(algo.id)).toHaveLength(1)
  })

  it('undo removes only the caller\'s latest tap from the last 10 minutes', async () => {
    const { lecturer, colleague, alice, bob, algo } = await setup()
    const start = clock.getTime()
    setClock(new Date(start - 11 * MIN))
    await tapParticipation(lecturer, algo.id, alice.user.id, 1) // too old to undo
    setClock(new Date(start - 5 * MIN))
    await tapParticipation(lecturer, algo.id, alice.user.id, 1)
    setClock(new Date(start - 2 * MIN))
    await tapParticipation(lecturer, algo.id, bob.user.id, 1)
    // A colleague's later event must never be touched by the caller's undo.
    await db.insert(participationEvent).values({
      courseId: algo.id,
      studentId: bob.user.id,
      delta: 1,
      createdBy: colleague.user.id,
      createdAt: new Date(start - MIN),
    })
    setClock(new Date(start))

    expect(await undoLastTap(lecturer, algo.id)).toEqual({ studentId: bob.user.id, net: 1, delta: 1, today: true })
    expect(await undoLastTap(lecturer, algo.id)).toEqual({ studentId: alice.user.id, net: 1, delta: 1, today: true })
    // What is left for the caller is 11 minutes old; the colleague's event is not theirs.
    expect(await undoLastTap(lecturer, algo.id)).toBeNull()
    expect(await events(algo.id)).toHaveLength(2)
  })

  it('undo reports the removed delta and whether it was today, across local midnight', async () => {
    const { lecturer, alice, algo } = await setup()
    // Africa/Douala is UTC+1: local midnight of 2026-11-09 is 2026-11-08T23:00Z.
    setClock(new Date('2026-11-08T22:57:00Z')) // Nov 8 locally
    await tapParticipation(lecturer, algo.id, alice.user.id, -1)
    setClock(new Date('2026-11-08T22:58:00Z'))
    await tapParticipation(lecturer, algo.id, alice.user.id, 1)
    setClock(new Date('2026-11-08T23:02:00Z')) // Nov 9 locally: both taps were yesterday
    expect(await undoLastTap(lecturer, algo.id)).toEqual({ studentId: alice.user.id, net: -1, delta: 1, today: false })
    await tapParticipation(lecturer, algo.id, alice.user.id, 1) // today
    expect(await undoLastTap(lecturer, algo.id)).toEqual({ studentId: alice.user.id, net: -1, delta: 1, today: true })
    expect(await undoLastTap(lecturer, algo.id)).toEqual({ studentId: alice.user.id, net: 0, delta: -1, today: false })
  })

  it('undo is null when there is nothing to undo', async () => {
    const { lecturer, algo } = await setup()
    expect(await undoLastTap(lecturer, algo.id)).toBeNull()
  })

  it('undo only touches the given course', async () => {
    const { lecturer, alice, algo, cls } = await setup()
    const other = await createCourse(lecturer, { classId: cls.id, title: 'Databases', semester: 1 })
    await tapParticipation(lecturer, algo.id, alice.user.id, 1)
    expect(await undoLastTap(lecturer, other.id)).toBeNull()
    expect(await events(algo.id)).toHaveLength(1)
  })

  it('two undos at once remove two different events, never the same one twice', async () => {
    const { lecturer, alice, algo } = await setup()
    for (let i = 0; i < 3; i++) {
      setClock(new Date(clock.getTime() + 1000))
      await tapParticipation(lecturer, algo.id, alice.user.id, 1)
    }
    const results = await Promise.all([undoLastTap(lecturer, algo.id), undoLastTap(lecturer, algo.id)])
    expect(results.every((r) => r !== null)).toBe(true)
    expect(await events(algo.id)).toHaveLength(1)
  })

  it('lists the roster in order with today and net, counting today from local midnight', async () => {
    const { lecturer, alice, bob, algo } = await setup()
    // Africa/Douala is UTC+1: local midnight of 2026-11-09 is 2026-11-08T23:00Z.
    setClock(new Date('2026-11-08T22:50:00Z')) // still Nov 8 locally
    await tapParticipation(lecturer, algo.id, alice.user.id, 1)
    await tapParticipation(lecturer, algo.id, alice.user.id, 1)
    setClock(new Date('2026-11-08T23:10:00Z')) // Nov 9 locally
    await tapParticipation(lecturer, algo.id, alice.user.id, 1)
    await tapParticipation(lecturer, algo.id, bob.user.id, -1)
    setClock(new Date('2026-11-08T23:30:00Z'))

    expect((await listParticipationToday(lecturer, algo.id)).rows).toEqual([
      { studentId: alice.user.id, name: 'Alice', matricule: 'UB1', today: 1, net: 3 },
      { studentId: bob.user.id, name: 'Bob', matricule: 'UB2', today: -1, net: -1 },
    ])

    // In UTC, midnight is 2026-11-08T00:00Z, so every event above is today.
    setConfigForTests({ timeZone: 'UTC' })
    const utc = await listParticipationToday(lecturer, algo.id)
    expect(utc.rows.map((r) => r.today)).toEqual([3, -1])
  })

  it('returns the participation target and points: defaults, then the saved settings', async () => {
    const { lecturer, algo } = await setup()
    expect(await listParticipationToday(lecturer, algo.id)).toMatchObject({ target: 5, points: 5 })
    await updateCaSettings(lecturer, algo.id, {
      total: 30,
      attendancePoints: 10,
      assignmentPoints: 20,
      participationPoints: 0,
      testPoints: 0,
      participationTarget: 8,
    })
    expect(await listParticipationToday(lecturer, algo.id)).toMatchObject({ target: 8, points: 0 })
  })

  it('lists students with no taps as zero and leaves off students no longer on the roster', async () => {
    const { lecturer, alice, bob, algo } = await setup()
    await tapParticipation(lecturer, algo.id, bob.user.id, 1)
    expect((await listParticipationToday(lecturer, algo.id)).rows).toEqual([
      { studentId: alice.user.id, name: 'Alice', matricule: 'UB1', today: 0, net: 0 },
      { studentId: bob.user.id, name: 'Bob', matricule: 'UB2', today: 1, net: 1 },
    ])
    await setRosterAdjustment(lecturer, algo.id, bob.user.id, 'exclude')
    expect((await listParticipationToday(lecturer, algo.id)).rows.map((r) => r.studentId)).toEqual([alice.user.id])
  })
})
