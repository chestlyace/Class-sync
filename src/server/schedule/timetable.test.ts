import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { asc, eq } from 'drizzle-orm'
import { setNowForTests } from '@/server/core/clock'
import { config } from '@/server/core/config'
import { createClass } from '@/server/classes/service'
import { createCourse } from '@/server/courses/service'
import type { Db } from '@/server/db'
import { classDateStatus, classSlot } from '@/server/db/schema'
import { setAfterResponseForTests } from '@/server/lib/after-response'
import { instantAt } from '@/server/lib/local-time'
import { setPushClientForTests } from '@/server/push/send'
import { createSchool } from '@/server/schools/service'
import { createTestDb } from '@/test/db'
import { setupCourse } from '@/test/marking-fixture'
import { createSlot, listSlots, removeSlot, updateSlot, type SlotInput } from './timetable'
import { setScheduleQueueForTests, type NoticeMessage } from './queue'

const tz = config.timeZone
// 2026-11-16 is a Monday; "today" is that day at 06:00 local.
const MONDAY = '2026-11-16'
const local = (hh: number, mm = 0) => instantAt(MONDAY, hh * 60 + mm, tz)

let db: Db
let fx: Awaited<ReturnType<typeof setupCourse>>
let queued: NoticeMessage[]
let tasks: Promise<void>[]

const input = (over: Partial<SlotInput> = {}): SlotInput => ({
  weekday: 1,
  startMinute: 8 * 60,
  endMinute: 10 * 60,
  room: 'B2',
  requireOnCampus: false,
  startsOn: '2026-09-01',
  endsOn: '2026-12-31',
  ...over,
})

/** Inserts a slot directly, bypassing the service. */
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

beforeEach(async () => {
  db = await createTestDb()
  fx = await setupCourse(db)
  setNowForTests(() => local(6))
  queued = []
  setScheduleQueueForTests({
    async send(message) {
      queued.push(message)
    },
  })
  setPushClientForTests({ async send() {} })
  tasks = []
  setAfterResponseForTests((task) => {
    tasks.push(task())
  })
}, 120_000)

afterEach(async () => {
  await Promise.all(tasks)
  setScheduleQueueForTests(null)
  setPushClientForTests(null)
  setAfterResponseForTests(null)
  setNowForTests(null)
})

describe('timetable service', () => {
  it("creates a slot and reports an overlap with another school's course", async () => {
    const other = await createSchool(fx.lecturer, { name: 'Lycee Bilingue', town: 'Douala' })
    const otherClass = await createClass(fx.lecturer, { schoolId: other.id, name: 'Form 5', academicYear: '2026/27' })
    const physics = await createCourse(fx.lecturer, { classId: otherClass.id, title: 'Physics', semester: 1 })
    await seedSlot(physics.id, { startMinute: 9 * 60, endMinute: 11 * 60 })
    // Same hours on another weekday, and an adjacent slot: neither overlaps.
    await seedSlot(physics.id, { weekday: 2 })
    await seedSlot(physics.id, { startMinute: 10 * 60, endMinute: 11 * 60 })

    const { slot, overlaps } = await createSlot(fx.lecturer, fx.bio.id, input({ room: '  B2  ' }))

    expect(slot).toMatchObject({ courseId: fx.bio.id, weekday: 1, room: 'B2', startsOn: '2026-09-01' })
    expect(overlaps).toEqual([
      {
        courseId: physics.id,
        courseTitle: 'Physics',
        className: 'Form 5',
        schoolName: 'Lycee Bilingue',
        weekday: 1,
        startMinute: 9 * 60,
        endMinute: 11 * 60,
      },
    ])
    expect(await listSlots(fx.lecturer, fx.bio.id)).toEqual([slot])
  })

  it('editing a slot with past dates ends it yesterday and starts a new one today', async () => {
    const old = await seedSlot(fx.bio.id)
    await db.insert(classDateStatus).values([
      { slotId: old.id, date: '2026-11-09', status: 'cancelled', setBy: fx.lecturer.user.id },
      { slotId: old.id, date: MONDAY, status: 'cancelled', setBy: fx.lecturer.user.id },
      { slotId: old.id, date: '2026-11-23', status: 'cancelled', setBy: fx.lecturer.user.id },
    ])

    const { slot } = await updateSlot(fx.lecturer, old.id, input({ room: 'C4' }))

    expect(slot.id).not.toBe(old.id)
    expect(slot).toMatchObject({ room: 'C4', startsOn: MONDAY, endsOn: '2026-12-31' })
    const [ended] = await db.select().from(classSlot).where(eq(classSlot.id, old.id))
    expect(ended).toMatchObject({ room: 'B2', startsOn: '2026-09-01', endsOn: '2026-11-15' })
    const statuses = await db.select().from(classDateStatus).orderBy(asc(classDateStatus.date))
    expect(statuses.map((s) => [s.slotId, s.date])).toEqual([
      [old.id, '2026-11-09'],
      [slot.id, MONDAY],
      [slot.id, '2026-11-23'],
    ])
    // The ended part is not offered any more.
    expect((await listSlots(fx.lecturer, fx.bio.id)).map((s) => s.id)).toEqual([slot.id])
  })

  it('a weekday change drops the later statuses and a new term must still contain today', async () => {
    const old = await seedSlot(fx.bio.id)
    await db.insert(classDateStatus).values([
      { slotId: old.id, date: '2026-11-09', status: 'cancelled', setBy: fx.lecturer.user.id },
      { slotId: old.id, date: '2026-11-23', status: 'cancelled', setBy: fx.lecturer.user.id },
    ])

    await expect(updateSlot(fx.lecturer, old.id, input({ endsOn: '2026-11-10' }))).rejects.toMatchObject({
      code: 'VALIDATION',
      details: { fields: ['endsOn'] },
    })
    expect(await db.select().from(classSlot)).toHaveLength(1)

    const { slot } = await updateSlot(fx.lecturer, old.id, input({ weekday: 3 }))

    expect(slot.weekday).toBe(3)
    const statuses = await db.select().from(classDateStatus)
    expect(statuses.map((s) => [s.slotId, s.date])).toEqual([[old.id, '2026-11-09']])
  })

  it('edits a slot that has not started yet in place', async () => {
    const future = await seedSlot(fx.bio.id, { startsOn: '2026-11-23' })

    const { slot } = await updateSlot(fx.lecturer, future.id, input({ startsOn: '2026-11-30', room: null }))

    expect(slot).toMatchObject({ id: future.id, startsOn: '2026-11-30', room: null })
    expect(await db.select().from(classSlot)).toHaveLength(1)
  })

  it('removing a slot with past dates keeps its history', async () => {
    const slot = await seedSlot(fx.bio.id)
    await db.insert(classDateStatus).values([
      { slotId: slot.id, date: '2026-11-09', status: 'taught', setBy: fx.lecturer.user.id },
      { slotId: slot.id, date: MONDAY, status: 'cancelled', setBy: fx.lecturer.user.id },
      { slotId: slot.id, date: '2026-11-23', status: 'cancelled', setBy: fx.lecturer.user.id },
    ])

    await removeSlot(fx.lecturer, slot.id)

    const [row] = await db.select().from(classSlot).where(eq(classSlot.id, slot.id))
    expect(row.endsOn).toBe('2026-11-15')
    expect((await db.select().from(classDateStatus)).map((s) => s.date)).toEqual(['2026-11-09'])
    expect(await listSlots(fx.lecturer, fx.bio.id)).toEqual([])

    // A slot that already ended is left alone; one that never started is deleted.
    await removeSlot(fx.lecturer, slot.id)
    expect((await db.select().from(classSlot).where(eq(classSlot.id, slot.id)))[0].endsOn).toBe('2026-11-15')
    const future = await seedSlot(fx.bio.id, { startsOn: '2026-11-23' })
    await removeSlot(fx.lecturer, future.id)
    expect(await db.select().from(classSlot).where(eq(classSlot.id, future.id))).toEqual([])
  })

  it('rejects a slot that ends before it starts', async () => {
    await expect(
      createSlot(fx.lecturer, fx.bio.id, input({ startMinute: 10 * 60, endMinute: 8 * 60 })),
    ).rejects.toMatchObject({ code: 'VALIDATION', details: { fields: ['endMinute'] } })
    await expect(
      createSlot(fx.lecturer, fx.bio.id, input({ startsOn: '2026-12-31', endsOn: '2026-09-01' })),
    ).rejects.toMatchObject({ code: 'VALIDATION', details: { fields: ['endsOn'] } })
    await expect(createSlot(fx.lecturer, fx.bio.id, input({ weekday: 8 }))).rejects.toMatchObject({
      code: 'VALIDATION',
      details: { fields: ['weekday'] },
    })
    await expect(createSlot(fx.lecturer, fx.bio.id, input({ endsOn: '2028-01-01' }))).rejects.toMatchObject({
      code: 'VALIDATION',
      details: { fields: ['endsOn'] },
    })
    await expect(createSlot(fx.lecturer, fx.bio.id, input({ room: 'x'.repeat(61) }))).rejects.toMatchObject({
      code: 'VALIDATION',
      details: { fields: ['room'] },
    })
    expect(await db.select().from(classSlot)).toEqual([])
  })

  it('requireOnCampus needs a school location', async () => {
    await expect(createSlot(fx.lecturer, fx.bio.id, input({ requireOnCampus: true }))).rejects.toMatchObject({
      code: 'VALIDATION',
      details: { reason: 'no_campus_location' },
    })
  })

  it('another lecturer gets FORBIDDEN', async () => {
    const slot = await seedSlot(fx.bio.id)

    await expect(listSlots(fx.colleague, fx.bio.id)).rejects.toMatchObject({ code: 'FORBIDDEN' })
    await expect(createSlot(fx.colleague, fx.bio.id, input())).rejects.toMatchObject({ code: 'FORBIDDEN' })
    await expect(updateSlot(fx.colleague, slot.id, input())).rejects.toMatchObject({ code: 'FORBIDDEN' })
    await expect(removeSlot(fx.colleague, slot.id)).rejects.toMatchObject({ code: 'FORBIDDEN' })
    await expect(removeSlot(fx.lecturer, 'no-such-slot')).rejects.toMatchObject({ code: 'FORBIDDEN' })
    expect(await db.select().from(classSlot)).toHaveLength(1)
  })

  it("a change today enqueues today's sitting", async () => {
    const { slot } = await createSlot(fx.lecturer, fx.bio.id, input())

    const key = `slot:${slot.id}:${MONDAY}`
    expect(queued.map((m) => [m.sittingKey, m.kind]).sort()).toEqual([
      [key, 'missed-check'],
      [key, 'reminder'],
    ])
  })
})
