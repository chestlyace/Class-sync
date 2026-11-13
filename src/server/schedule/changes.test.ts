import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { asc, eq } from 'drizzle-orm'
import { setNowForTests } from '@/server/core/clock'
import { config } from '@/server/core/config'
import { createClass } from '@/server/classes/service'
import { createCourse } from '@/server/courses/service'
import type { Db } from '@/server/db'
import { classDateStatus, classExtra, classSlot, pushSubscription } from '@/server/db/schema'
import { setEmailDbForTests } from '@/server/email/db'
import { setAfterResponseForTests } from '@/server/lib/after-response'
import { instantAt } from '@/server/lib/local-time'
import { setPushClientForTests } from '@/server/push/send'
import { createTestDb } from '@/test/db'
import { setupCourse } from '@/test/marking-fixture'
import { addMakeUp, answerSitting, cancelClass, undoCancel, type MakeUpInput } from './changes'
import { setScheduleQueueForTests, type NoticeMessage } from './queue'

const tz = config.timeZone
// 2026-11-16 is a Monday; "today" is that day, 06:00 local unless a test moves the clock.
const MONDAY = '2026-11-16'
const WEDNESDAY = '2026-11-18'
const local = (hh: number, mm = 0, date = MONDAY) => instantAt(date, hh * 60 + mm, tz)

let db: Db
let fx: Awaited<ReturnType<typeof setupCourse>>
let queued: NoticeMessage[]
let pushes: { endpoint: string; kind: string; tag: string }[]
let tasks: Promise<void>[]

const flush = async () => {
  while (tasks.length) await Promise.all(tasks.splice(0))
}

const makeUp = (over: Partial<MakeUpInput> = {}): MakeUpInput => ({
  date: WEDNESDAY,
  startMinute: 14 * 60,
  endMinute: 16 * 60,
  room: 'C4',
  requireOnCampus: false,
  ...over,
})

async function seedSlot(over: Partial<typeof classSlot.$inferInsert> = {}) {
  const [slot] = await db
    .insert(classSlot)
    .values({
      courseId: fx.bio.id,
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

const device = (userId: string, name: string) =>
  db.insert(pushSubscription).values({
    userId,
    endpoint: `https://push.example/${name}`,
    p256dh: 'p',
    auth: 'a',
    label: 'Chrome on Android',
  })

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
  pushes = []
  setPushClientForTests({
    async send(sub, body) {
      const { kind, tag } = JSON.parse(body)
      pushes.push({ endpoint: sub.endpoint, kind, tag })
    },
  })
  tasks = []
  setAfterResponseForTests((task) => {
    tasks.push(task())
  })
  setEmailDbForTests(db)
  await device(fx.alice.user.id, 'alice')
  await device(fx.bob.user.id, 'bob')
}, 120_000)

afterEach(async () => {
  await Promise.all(tasks)
  setScheduleQueueForTests(null)
  setPushClientForTests(null)
  setAfterResponseForTests(null)
  setEmailDbForTests(null)
  setNowForTests(null)
})

describe('date changes', () => {
  it('cancel pushes classCancelled to the roster', async () => {
    const slot = await seedSlot()

    await cancelClass(fx.lecturer, `slot:${slot.id}:${MONDAY}`)
    await flush()

    const [row] = await db.select().from(classDateStatus)
    expect(row).toMatchObject({
      slotId: slot.id,
      date: MONDAY,
      status: 'cancelled',
      setBy: fx.lecturer.user.id,
    })
    expect(pushes.map((p) => [p.endpoint, p.kind]).sort()).toEqual([
      ['https://push.example/alice', 'classCancelled'],
      ['https://push.example/bob', 'classCancelled'],
    ])
    // Today's class is gone, so nothing is left to remind about.
    expect(queued).toEqual([])
  })

  it('cancel with a make-up pushes one classMoved and nothing else', async () => {
    const slot = await seedSlot()

    await cancelClass(fx.lecturer, `slot:${slot.id}:${MONDAY}`, makeUp())
    await flush()

    const [status] = await db.select().from(classDateStatus)
    expect(status).toMatchObject({
      slotId: slot.id,
      date: MONDAY,
      status: 'cancelled',
    })
    const [extra] = await db.select().from(classExtra)
    expect(extra).toMatchObject({
      courseId: fx.bio.id,
      startsAt: local(14, 0, WEDNESDAY),
      endsAt: local(16, 0, WEDNESDAY),
      room: 'C4',
      replacesSlotId: slot.id,
      replacesDate: MONDAY,
      status: null,
    })
    expect(pushes.map((p) => p.kind)).toEqual(['classMoved', 'classMoved'])
  })

  it('cancelling a make-up with a new make-up links the new one to no slot', async () => {
    const slot = await seedSlot()
    const first = await addMakeUp(fx.lecturer, fx.bio.id, {
      ...makeUp(),
      replaces: `slot:${slot.id}:${MONDAY}`,
    })

    await cancelClass(fx.lecturer, first.key, makeUp({ date: '2026-11-19' }))

    const extras = await db.select().from(classExtra).orderBy(asc(classExtra.startsAt))
    expect(extras[0]).toMatchObject({
      status: 'cancelled',
      replacesSlotId: slot.id,
      replacesDate: MONDAY,
    })
    expect(extras[1]).toMatchObject({
      status: null,
      replacesSlotId: null,
      replacesDate: WEDNESDAY,
    })
  })

  it('past make-up sends nothing', async () => {
    setNowForTests(() => local(12))

    const occ = await addMakeUp(
      fx.lecturer,
      fx.bio.id,
      makeUp({ date: MONDAY, startMinute: 8 * 60, endMinute: 9 * 60 }),
    )
    await flush()

    expect(occ).toMatchObject({
      date: MONDAY,
      room: 'C4',
      status: null,
      courseId: fx.bio.id,
    })
    expect(occ.key).toMatch(/^extra:/)
    expect(await db.select().from(classExtra)).toHaveLength(1)
    expect(pushes).toEqual([])
    expect(queued).toEqual([])
  })

  it('cancel with a make-up in the past is rejected', async () => {
    const slot = await seedSlot()

    await expect(
      cancelClass(
        fx.lecturer,
        `slot:${slot.id}:${MONDAY}`,
        makeUp({ date: MONDAY, startMinute: 4 * 60, endMinute: 5 * 60 }),
      ),
    ).rejects.toMatchObject({ code: 'VALIDATION', details: { fields: ['date'] } })
    await flush()

    expect(await db.select().from(classDateStatus)).toEqual([])
    expect(await db.select().from(classExtra)).toEqual([])
    expect(pushes).toEqual([])
    expect(queued).toEqual([])
  })

  it('a make-up later today pushes classMakeUp and enqueues its notices', async () => {
    const occ = await addMakeUp(
      fx.lecturer,
      fx.bio.id,
      makeUp({ date: MONDAY, startMinute: 14 * 60, endMinute: 15 * 60 }),
    )
    await flush()

    expect(pushes.map((p) => p.kind)).toEqual(['classMakeUp', 'classMakeUp'])
    expect(queued.map((q) => [q.sittingKey, q.kind]).sort()).toEqual([
      [occ.key, 'missed-check'],
      [occ.key, 'reminder'],
    ])
  })

  it('undoCancel restores the class and re-enqueues today', async () => {
    const slot = await seedSlot()
    await db.insert(classDateStatus).values({
      slotId: slot.id,
      date: MONDAY,
      status: 'cancelled',
      setBy: fx.lecturer.user.id,
    })

    await undoCancel(fx.lecturer, `slot:${slot.id}:${MONDAY}`)
    await flush()

    expect(await db.select().from(classDateStatus)).toEqual([])
    expect(queued.map((q) => [q.sittingKey, q.kind]).sort()).toEqual([
      [`slot:${slot.id}:${MONDAY}`, 'missed-check'],
      [`slot:${slot.id}:${MONDAY}`, 'reminder'],
    ])
  })

  it('undoCancel tells students the class is back on', async () => {
    const slot = await seedSlot()
    const key = `slot:${slot.id}:${MONDAY}`
    await cancelClass(fx.lecturer, key)
    await flush()
    const cancelTag = pushes[0]!.tag
    expect(cancelTag).toBe(`class-${key}-classCancelled`)
    pushes = []

    await undoCancel(fx.lecturer, key)
    await flush()

    // One notification per student, replacing the cancellation on the device.
    expect(pushes.map((p) => [p.endpoint, p.kind, p.tag]).sort()).toEqual([
      ['https://push.example/alice', 'classReinstated', cancelTag],
      ['https://push.example/bob', 'classReinstated', cancelTag],
    ])
  })

  it('undoCancel clears the status of a cancelled extra and rejects a class that is not cancelled', async () => {
    const occ = await addMakeUp(fx.lecturer, fx.bio.id, makeUp())
    await expect(undoCancel(fx.lecturer, occ.key)).rejects.toMatchObject({
      code: 'VALIDATION',
    })

    await cancelClass(fx.lecturer, occ.key)
    const [cancelled] = await db.select().from(classExtra)
    expect(cancelled.status).toBe('cancelled')

    await undoCancel(fx.lecturer, occ.key)
    const [restored] = await db.select().from(classExtra)
    expect(restored.status).toBeNull()
  })

  it('answerSitting marks every class of a back-to-back sitting', async () => {
    const first = await seedSlot()
    const second = await seedSlot({ startMinute: 10 * 60, endMinute: 11 * 60 })
    const [extra] = await db
      .insert(classExtra)
      .values({
        courseId: fx.bio.id,
        startsAt: local(11, 15),
        endsAt: local(12),
        createdBy: fx.lecturer.user.id,
      })
      .returning()
    setNowForTests(() => local(13))

    await answerSitting(fx.lecturer, `slot:${first.id}:${MONDAY}`, 'missed')

    const statuses = await db.select().from(classDateStatus).orderBy(asc(classDateStatus.setAt))
    expect(statuses.map((s) => [s.slotId, s.date, s.status]).sort()).toEqual(
      [
        [first.id, MONDAY, 'missed'],
        [second.id, MONDAY, 'missed'],
      ].sort(),
    )
    const [after] = await db.select().from(classExtra).where(eq(classExtra.id, extra.id))
    expect(after.status).toBe('missed')

    // Answering again overwrites.
    await answerSitting(fx.lecturer, `slot:${first.id}:${MONDAY}`, 'taught')
    const again = await db.select().from(classDateStatus)
    expect(again.map((s) => s.status)).toEqual(['taught', 'taught'])
    const [extraAgain] = await db.select().from(classExtra).where(eq(classExtra.id, extra.id))
    expect(extraAgain.status).toBe('taught')
    await flush()
    expect(pushes).toEqual([])
  })

  it('cannot answer a sitting that has not ended', async () => {
    const slot = await seedSlot()
    setNowForTests(() => local(9))
    await expect(answerSitting(fx.lecturer, `slot:${slot.id}:${MONDAY}`, 'missed')).rejects.toMatchObject({
      code: 'VALIDATION',
    })
    expect(await db.select().from(classDateStatus)).toEqual([])
  })

  it('cannot cancel a class that already ended', async () => {
    const slot = await seedSlot()
    setNowForTests(() => local(12))
    await expect(cancelClass(fx.lecturer, `slot:${slot.id}:${MONDAY}`)).rejects.toMatchObject({ code: 'VALIDATION' })
    expect(await db.select().from(classDateStatus)).toEqual([])
  })

  it('cannot cancel a class that is already cancelled or answered', async () => {
    const slot = await seedSlot()
    await cancelClass(fx.lecturer, `slot:${slot.id}:${MONDAY}`)
    await expect(cancelClass(fx.lecturer, `slot:${slot.id}:${MONDAY}`)).rejects.toMatchObject({ code: 'VALIDATION' })
    // A rejected cancel with a make-up creates no make-up.
    await expect(cancelClass(fx.lecturer, `slot:${slot.id}:${MONDAY}`, makeUp())).rejects.toMatchObject({
      code: 'VALIDATION',
    })
    expect(await db.select().from(classExtra)).toEqual([])
  })

  it('a make-up replaces a date of the same course only', async () => {
    const cls = await createClass(fx.lecturer, {
      schoolId: fx.cls.schoolId,
      name: 'Physics L1',
      academicYear: '2026/27',
    })
    const other = await createCourse(fx.lecturer, {
      classId: cls.id,
      title: 'Physics',
      semester: 1,
    })
    const foreign = await seedSlot({ courseId: other.id })
    const own = await seedSlot()

    await expect(
      addMakeUp(fx.lecturer, fx.bio.id, {
        ...makeUp(),
        replaces: `slot:${foreign.id}:${MONDAY}`,
      }),
    ).rejects.toMatchObject({ code: 'VALIDATION' })
    await expect(addMakeUp(fx.lecturer, fx.bio.id, { ...makeUp(), replaces: 'nonsense' })).rejects.toMatchObject({
      code: 'VALIDATION',
    })
    // A date the slot does not meet on is not an occurrence.
    await expect(
      addMakeUp(fx.lecturer, fx.bio.id, {
        ...makeUp(),
        replaces: `slot:${own.id}:${WEDNESDAY}`,
      }),
    ).rejects.toMatchObject({ code: 'VALIDATION' })

    const occ = await addMakeUp(fx.lecturer, fx.bio.id, {
      ...makeUp(),
      replaces: `slot:${own.id}:${MONDAY}`,
    })
    expect(occ.source).toEqual({
      kind: 'extra',
      extraId: occ.key.slice('extra:'.length),
      replaces: { slotId: own.id, date: MONDAY },
    })
  })

  it('validates a make-up and the campus location', async () => {
    const bad = (over: Partial<MakeUpInput>) => addMakeUp(fx.lecturer, fx.bio.id, makeUp(over))
    await expect(bad({ startMinute: 600, endMinute: 600 })).rejects.toMatchObject({ code: 'VALIDATION' })
    await expect(bad({ endMinute: 1441 })).rejects.toMatchObject({
      code: 'VALIDATION',
    })
    await expect(bad({ date: '2026-02-30' })).rejects.toMatchObject({
      code: 'VALIDATION',
    })
    await expect(bad({ room: 'x'.repeat(61) })).rejects.toMatchObject({
      code: 'VALIDATION',
    })
    await expect(bad({ requireOnCampus: true })).rejects.toMatchObject({
      code: 'VALIDATION',
      details: { reason: 'no_campus_location' },
    })
    const blank = await bad({ room: '   ' })
    expect(blank.room).toBeNull()
    expect(await db.select().from(classExtra)).toHaveLength(1)
  })

  it('only the lecturer of the course can change its dates', async () => {
    const slot = await seedSlot()
    const key = `slot:${slot.id}:${MONDAY}`
    await expect(cancelClass(fx.colleague, key)).rejects.toMatchObject({
      code: 'FORBIDDEN',
    })
    await expect(cancelClass(fx.alice, key)).rejects.toMatchObject({
      code: 'FORBIDDEN',
    })
    await expect(cancelClass(fx.lecturer, 'nonsense')).rejects.toMatchObject({
      code: 'FORBIDDEN',
    })
    await expect(cancelClass(fx.lecturer, `slot:missing:${MONDAY}`)).rejects.toMatchObject({ code: 'FORBIDDEN' })
    await expect(cancelClass(fx.lecturer, `slot:${slot.id}:${WEDNESDAY}`)).rejects.toMatchObject({ code: 'FORBIDDEN' })
    await expect(addMakeUp(fx.colleague, fx.bio.id, makeUp())).rejects.toMatchObject({ code: 'FORBIDDEN' })
    setNowForTests(() => local(12))
    await expect(answerSitting(fx.colleague, key, 'missed')).rejects.toMatchObject({ code: 'FORBIDDEN' })
    await expect(answerSitting(fx.lecturer, `slot:missing:${MONDAY}`, 'missed')).rejects.toMatchObject({
      code: 'FORBIDDEN',
    })
    expect(await db.select().from(classDateStatus)).toEqual([])
  })
})
