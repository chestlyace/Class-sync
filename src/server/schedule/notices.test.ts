import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { eq } from 'drizzle-orm'
import { setNowForTests } from '@/server/core/clock'
import { config } from '@/server/core/config'
import type { Db } from '@/server/db'
import { attendanceSession, classSlot, courseRosterAdjustment, pushSubscription } from '@/server/db/schema'
import { setEmailDbForTests } from '@/server/email/db'
import { setAfterResponseForTests } from '@/server/lib/after-response'
import { instantAt } from '@/server/lib/local-time'
import { setPushClientForTests } from '@/server/push/send'
import { setupCourse } from '@/test/marking-fixture'
import { createTestDb } from '@/test/db'
import { enqueueCourseDay, enqueueToday, handleNotice } from './notices'
import { setScheduleQueueForTests, type NoticeMessage } from './queue'

const tz = config.timeZone
// 2026-11-16 is a Monday.
const MONDAY = '2026-11-16'
const local = (hh: number, mm = 0) => instantAt(MONDAY, hh * 60 + mm, tz)

let db: Db
let fx: Awaited<ReturnType<typeof setupCourse>>
let slotId: string
let queued: { message: NoticeMessage; deliverAt: Date }[]
let pushes: { endpoint: string; body: string }[]
let tasks: Promise<void>[]

/** Waits for every push queued through runAfterResponse. */
const flush = async () => {
  while (tasks.length) await Promise.all(tasks.splice(0))
}

beforeEach(async () => {
  db = await createTestDb()
  fx = await setupCourse(db)
  // Monday 08:00-10:00 local, all term.
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
    })
    .returning()
  slotId = slot.id

  queued = []
  setScheduleQueueForTests({
    async send(message, deliverAt) {
      queued.push({ message, deliverAt })
    },
  })
  pushes = []
  setPushClientForTests({
    async send(sub, body) {
      pushes.push({ endpoint: sub.endpoint, body })
    },
  })
  tasks = []
  setAfterResponseForTests((task) => {
    tasks.push(task())
  })
  setEmailDbForTests(db)
}, 120_000)

afterEach(() => {
  setScheduleQueueForTests(null)
  setPushClientForTests(null)
  setAfterResponseForTests(null)
  setEmailDbForTests(null)
  setNowForTests(null)
})

const device = async (userId: string, name: string) =>
  db.insert(pushSubscription).values({
    userId,
    endpoint: `https://push.example/${name}`,
    p256dh: 'p',
    auth: 'a',
    label: 'Chrome on Android',
  })

describe('class notices', () => {
  it('enqueues a reminder and a missed-check for a future sitting', async () => {
    const at = local(6)
    setNowForTests(() => at)
    expect(await enqueueToday(db, at)).toEqual({ sittings: 1 })

    const key = `slot:${slotId}:${MONDAY}`
    expect(queued).toHaveLength(2)
    const reminder = queued.find((q) => q.message.kind === 'reminder')!
    const missed = queued.find((q) => q.message.kind === 'missed-check')!
    expect(reminder.message).toEqual({ sittingKey: key, kind: 'reminder', expectedAt: local(8).toISOString() })
    expect(reminder.deliverAt.getTime()).toBe(local(7, 45).getTime())
    expect(missed.message).toEqual({ sittingKey: key, kind: 'missed-check', expectedAt: local(10).toISOString() })
    expect(missed.deliverAt.getTime()).toBe(local(10, 10).getTime())
  })

  it('enqueueToday reports a failed load', async () => {
    const broken = Object.assign(Object.create(db), {
      selectDistinct: () => {
        throw new Error('db down')
      },
    }) as Db
    await expect(enqueueToday(broken, local(6))).rejects.toThrow('db down')
    expect(queued).toEqual([])
  })

  it('enqueues only the missed-check once the reminder time passed', async () => {
    const at = local(7, 50)
    setNowForTests(() => at)
    await enqueueCourseDay(db, fx.bio.id, MONDAY, at)
    expect(queued.map((q) => q.message.kind)).toEqual(['missed-check'])

    // Another day than today: nothing.
    queued = []
    await enqueueCourseDay(db, fx.bio.id, '2026-11-23', at)
    expect(queued).toEqual([])
  })

  it('drops a reminder whose sitting moved', async () => {
    const message: NoticeMessage = {
      sittingKey: `slot:${slotId}:${MONDAY}`,
      kind: 'reminder',
      expectedAt: local(8).toISOString(),
    }
    await db.update(classSlot).set({ startMinute: 9 * 60 }).where(eq(classSlot.id, slotId))
    await device(fx.lecturer.user.id, 'lecturer')
    expect(await handleNotice(db, message)).toBe('skipped')
    await flush()
    expect(pushes).toEqual([])
  })

  it('sends once under redelivery', async () => {
    await device(fx.lecturer.user.id, 'lecturer')
    await device(fx.alice.user.id, 'alice-phone')
    await device(fx.alice.user.id, 'alice-laptop')
    const message: NoticeMessage = {
      sittingKey: `slot:${slotId}:${MONDAY}`,
      kind: 'reminder',
      expectedAt: local(8).toISOString(),
    }
    expect(await handleNotice(db, message)).toBe('sent')
    expect(await handleNotice(db, message)).toBe('skipped')
    await flush()
    expect(pushes.map((p) => p.endpoint).sort()).toEqual(
      ['https://push.example/alice-laptop', 'https://push.example/alice-phone', 'https://push.example/lecturer'].sort(),
    )
    const lecturerPush = JSON.parse(pushes.find((p) => p.endpoint.endsWith('/lecturer'))!.body)
    expect(lecturerPush.kind).toBe('classSoonLecturer')
  })

  it('reads the roster at send time', async () => {
    const at = local(6)
    setNowForTests(() => at)
    await enqueueCourseDay(db, fx.bio.id, MONDAY, at)
    const reminder = queued.find((q) => q.message.kind === 'reminder')!.message

    await device(fx.alice.user.id, 'alice')
    await device(fx.bob.user.id, 'bob')
    // Alice leaves the course's roster after the reminder was queued.
    await db
      .insert(courseRosterAdjustment)
      .values({ courseId: fx.bio.id, studentId: fx.alice.user.id, kind: 'exclude', createdBy: fx.lecturer.user.id })

    expect(await handleNotice(db, reminder)).toBe('sent')
    await flush()
    expect(pushes.map((p) => p.endpoint)).toEqual(['https://push.example/bob'])
  })

  it('missed-check skips a sitting that had attendance', async () => {
    await device(fx.lecturer.user.id, 'lecturer')
    const message: NoticeMessage = {
      sittingKey: `slot:${slotId}:${MONDAY}`,
      kind: 'missed-check',
      expectedAt: local(10).toISOString(),
    }
    await db.insert(attendanceSession).values({ courseId: fx.bio.id, createdBy: fx.lecturer.user.id, createdAt: local(8, 5) })
    expect(await handleNotice(db, message)).toBe('skipped')
    await flush()
    expect(pushes).toEqual([])

    // Without attendance the lecturer is asked.
    await db.delete(attendanceSession)
    expect(await handleNotice(db, message)).toBe('sent')
    await flush()
    expect(pushes).toHaveLength(1)
    expect(JSON.parse(pushes[0].body).kind).toBe('classMissedQuestion')
  })
})
