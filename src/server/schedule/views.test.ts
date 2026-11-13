import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { setNowForTests } from '@/server/core/clock'
import { config } from '@/server/core/config'
import { createClass } from '@/server/classes/service'
import { createCourse } from '@/server/courses/service'
import type { Db } from '@/server/db'
import { attendanceSession, attendanceWindow, classDateStatus, classExtra, classSlot } from '@/server/db/schema'
import { instantAt } from '@/server/lib/local-time'
import { createSchool } from '@/server/schools/service'
import { createTestDb } from '@/test/db'
import { setupCourse } from '@/test/marking-fixture'
import { getClassSitting, lecturerWeek, needsAnswer, startClassAttendance, studentWeek } from './views'

const tz = config.timeZone
// 2026-11-16 is a Monday; "today" is that day, 06:00 local unless a test moves the clock.
const MONDAY = '2026-11-16'
const local = (hh: number, mm = 0, date = MONDAY) => instantAt(date, hh * 60 + mm, tz)

let db: Db
let fx: Awaited<ReturnType<typeof setupCourse>>

async function seedSlot(courseId: string, over: Partial<typeof classSlot.$inferInsert> = {}) {
  const [slot] = await db
    .insert(classSlot)
    .values({
      courseId,
      weekday: 1,
      startMinute: 8 * 60,
      endMinute: 10 * 60,
      room: 'B2',
      startsOn: '2026-09-01',
      endsOn: '2026-12-31',
      createdBy: fx.lecturer.user.id,
      ...over,
    })
    .returning()
  return slot
}

/** A second school and class of the same lecturer, with a course Alice is not rostered on. */
async function secondCourse() {
  const sch = await createSchool(fx.lecturer, {
    name: 'Higher Institute',
    town: 'Douala',
  })
  const cls = await createClass(fx.lecturer, {
    schoolId: sch.id,
    name: 'Chemistry L2',
    academicYear: '2026/27',
  })
  return createCourse(fx.lecturer, {
    classId: cls.id,
    title: 'Organic chemistry',
    semester: 1,
  })
}

beforeEach(async () => {
  db = await createTestDb()
  fx = await setupCourse(db)
  setNowForTests(() => local(6))
}, 120_000)

afterEach(() => {
  setNowForTests(null)
})

describe('weeks', () => {
  it('lecturer week lists classes across schools with badges', async () => {
    const chem = await secondCourse()
    const bioSlot = await seedSlot(fx.bio.id)
    const chemSlot = await seedSlot(chem.id, {
      startMinute: 11 * 60,
      endMinute: 12 * 60,
      room: null,
    })
    await db.insert(classDateStatus).values({
      slotId: bioSlot.id,
      date: '2026-11-23',
      status: 'cancelled',
      setBy: fx.lecturer.user.id,
    })
    const [makeUp] = await db
      .insert(classExtra)
      .values({
        courseId: fx.bio.id,
        startsAt: local(14, 0, '2026-11-18'),
        endsAt: local(16, 0, '2026-11-18'),
        room: 'C4',
        replacesSlotId: bioSlot.id,
        replacesDate: '2026-11-23',
        createdBy: fx.lecturer.user.id,
      })
      .returning()

    const rows = await lecturerWeek(fx.lecturer, MONDAY)

    expect(rows.map((r) => [r.occurrence.key, r.courseTitle, r.schoolName, r.badge, r.replacesDate])).toEqual([
      [`slot:${bioSlot.id}:${MONDAY}`, 'Cell biology', 'University of Buea', null, null],
      [`slot:${chemSlot.id}:${MONDAY}`, 'Organic chemistry', 'Higher Institute', null, null],
      [`extra:${makeUp.id}`, 'Cell biology', 'University of Buea', 'makeUp', '2026-11-23'],
    ])
    expect(rows[0].className).toBe('Biology L1')

    const next = await lecturerWeek(fx.lecturer, '2026-11-23')
    expect(next.map((r) => [r.occurrence.key, r.badge])).toEqual([
      [`slot:${bioSlot.id}:2026-11-23`, 'cancelled'],
      [`slot:${chemSlot.id}:2026-11-23`, null],
    ])
    expect(next[0].canOpenCheckIn).toBe(false)

    await db.insert(classDateStatus).values({
      slotId: chemSlot.id,
      date: MONDAY,
      status: 'missed',
      setBy: fx.lecturer.user.id,
    })
    const again = await lecturerWeek(fx.lecturer, MONDAY)
    expect(again.map((r) => r.badge)).toEqual([null, 'missed', 'makeUp'])
  })

  it('canOpenCheckIn is true from 30 minutes before the start until the end, for lecturers only', async () => {
    await seedSlot(fx.bio.id)
    const at = async (when: Date) => {
      setNowForTests(() => when)
      return [
        (await lecturerWeek(fx.lecturer, MONDAY))[0].canOpenCheckIn,
        (await studentWeek(fx.alice, MONDAY))[0].canOpenCheckIn,
      ]
    }

    expect(await at(local(7, 29))).toEqual([false, false])
    expect(await at(local(7, 30))).toEqual([true, false])
    expect(await at(local(10, 0))).toEqual([true, false])
    expect(await at(local(10, 1))).toEqual([false, false])
  })

  it('student week shows only rostered courses', async () => {
    const chem = await secondCourse()
    const bioSlot = await seedSlot(fx.bio.id)
    await seedSlot(chem.id)

    const rows = await studentWeek(fx.alice, MONDAY)

    expect(rows.map((r) => r.occurrence.key)).toEqual([`slot:${bioSlot.id}:${MONDAY}`])
    expect(rows[0]).toMatchObject({
      courseTitle: 'Cell biology',
      canOpenCheckIn: false,
    })
  })
})

describe('needsAnswer', () => {
  it('lists an unanswered past sitting and drops it after 14 days', async () => {
    const slot = await seedSlot(fx.bio.id, { startsOn: MONDAY })
    setNowForTests(() => local(12))

    const listed = await needsAnswer(fx.lecturer)
    expect(listed.map((n) => [n.sitting.key, n.courseTitle])).toEqual([[`slot:${slot.id}:${MONDAY}`, 'Cell biology']])

    // Still listed 13 days later (the class ended at 10:00, so 14 days is Monday the 30th at 10:00).
    setNowForTests(() => local(9, 0, '2026-11-30'))
    expect((await needsAnswer(fx.lecturer)).map((n) => n.sitting.key)).toContain(`slot:${slot.id}:${MONDAY}`)

    setNowForTests(() => local(10, 1, '2026-11-30'))
    expect((await needsAnswer(fx.lecturer)).map((n) => n.sitting.key)).not.toContain(`slot:${slot.id}:${MONDAY}`)
  })

  it('skips sittings that are answered, in progress or have attendance, and lists the newest first', async () => {
    const slot = await seedSlot(fx.bio.id, { startsOn: MONDAY })
    setNowForTests(() => local(12, 0, '2026-11-23'))

    // Last Monday: has attendance. This Monday 08:00-10:00: marked missed. Plus an in-progress class.
    await db.insert(attendanceSession).values({
      courseId: fx.bio.id,
      requireOnCampus: false,
      createdBy: fx.lecturer.user.id,
      createdAt: local(8, 5),
    })
    await db.insert(classDateStatus).values({
      slotId: slot.id,
      date: '2026-11-23',
      status: 'missed',
      setBy: fx.lecturer.user.id,
    })
    const [ongoing] = await db
      .insert(classExtra)
      .values({
        courseId: fx.bio.id,
        startsAt: local(11, 0, '2026-11-23'),
        endsAt: local(13, 0, '2026-11-23'),
        createdBy: fx.lecturer.user.id,
      })
      .returning()
    const [earlier] = await db
      .insert(classExtra)
      .values({
        courseId: fx.bio.id,
        startsAt: local(14, 0, '2026-11-18'),
        endsAt: local(15, 0, '2026-11-18'),
        createdBy: fx.lecturer.user.id,
      })
      .returning()
    const [earliest] = await db
      .insert(classExtra)
      .values({
        courseId: fx.bio.id,
        startsAt: local(9, 0, '2026-11-17'),
        endsAt: local(10, 0, '2026-11-17'),
        createdBy: fx.lecturer.user.id,
      })
      .returning()

    const listed = await needsAnswer(fx.lecturer)

    expect(listed.map((n) => n.sitting.key)).toEqual([`extra:${earlier.id}`, `extra:${earliest.id}`])
    expect(listed.map((n) => n.sitting.key)).not.toContain(`extra:${ongoing.id}`)
  })
})

describe('one-tap check-in', () => {
  it('startClassAttendance opens check-in once and returns the same session on a second tap', async () => {
    const slot = await seedSlot(fx.bio.id)
    const key = `slot:${slot.id}:${MONDAY}`
    setNowForTests(() => local(8, 5))

    expect((await getClassSitting(fx.lecturer, key)).sessionId).toBeNull()

    const first = await startClassAttendance(fx.lecturer, key)
    setNowForTests(() => local(8, 10))
    const second = await startClassAttendance(fx.lecturer, key)

    expect(first).toEqual({
      courseId: fx.bio.id,
      sessionId: expect.any(String),
    })
    expect(second).toEqual(first)
    expect(await db.select().from(attendanceSession)).toHaveLength(1)
    const windows = await db.select().from(attendanceWindow)
    expect(windows).toHaveLength(1)
    expect(windows[0]).toMatchObject({
      sessionId: first.sessionId,
      kind: 'start',
    })

    const view = await getClassSitting(fx.lecturer, key)
    expect(view).toMatchObject({
      sessionId: first.sessionId,
      room: 'B2',
      course: { id: fx.bio.id, title: 'Cell biology' },
      sitting: { key, courseId: fx.bio.id },
    })
  })

  it('opens from 30 minutes before the start and refuses outside class time', async () => {
    const slot = await seedSlot(fx.bio.id)
    const key = `slot:${slot.id}:${MONDAY}`

    setNowForTests(() => local(7, 29))
    await expect(startClassAttendance(fx.lecturer, key)).rejects.toMatchObject({
      code: 'VALIDATION',
      details: { reason: 'outside_class_time' },
    })
    setNowForTests(() => local(10, 1))
    await expect(startClassAttendance(fx.lecturer, key)).rejects.toMatchObject({
      code: 'VALIDATION',
      details: { reason: 'outside_class_time' },
    })
    expect(await db.select().from(attendanceSession)).toEqual([])

    setNowForTests(() => local(7, 30))
    await expect(startClassAttendance(fx.lecturer, key)).resolves.toMatchObject({ courseId: fx.bio.id })
  })

  it('returns an existing session even outside class time, and ignores one from another day', async () => {
    const slot = await seedSlot(fx.bio.id)
    const key = `slot:${slot.id}:${MONDAY}`
    const [early] = await db
      .insert(attendanceSession)
      .values({
        courseId: fx.bio.id,
        requireOnCampus: false,
        createdBy: fx.lecturer.user.id,
        createdAt: local(7, 45),
      })
      .returning()
    await db.insert(attendanceSession).values({
      courseId: fx.bio.id,
      requireOnCampus: false,
      createdBy: fx.lecturer.user.id,
      createdAt: local(9, 0, '2026-11-15'),
    })

    setNowForTests(() => local(11))
    await expect(startClassAttendance(fx.lecturer, key)).resolves.toEqual({
      courseId: fx.bio.id,
      sessionId: early.id,
    })
  })

  it('is FORBIDDEN for other lecturers, students, unknown and cancelled sittings', async () => {
    const slot = await seedSlot(fx.bio.id)
    const key = `slot:${slot.id}:${MONDAY}`
    setNowForTests(() => local(8, 5))

    for (const who of [fx.colleague, fx.alice]) {
      await expect(startClassAttendance(who, key)).rejects.toMatchObject({
        code: 'FORBIDDEN',
      })
      await expect(getClassSitting(who, key)).rejects.toMatchObject({
        code: 'FORBIDDEN',
      })
    }
    for (const bad of ['nonsense', `slot:${crypto.randomUUID()}:${MONDAY}`, `extra:${crypto.randomUUID()}`]) {
      await expect(getClassSitting(fx.lecturer, bad)).rejects.toMatchObject({
        code: 'FORBIDDEN',
      })
    }

    await db.insert(classDateStatus).values({
      slotId: slot.id,
      date: MONDAY,
      status: 'cancelled',
      setBy: fx.lecturer.user.id,
    })
    await expect(startClassAttendance(fx.lecturer, key)).rejects.toMatchObject({
      code: 'FORBIDDEN',
    })
    await expect(getClassSitting(fx.lecturer, key)).rejects.toMatchObject({
      code: 'FORBIDDEN',
    })
    expect(await db.select().from(attendanceSession)).toEqual([])
  })
})
