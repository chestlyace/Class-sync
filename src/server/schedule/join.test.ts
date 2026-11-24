import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { eq } from 'drizzle-orm'
import { setNowForTests } from '@/server/core/clock'
import { config } from '@/server/core/config'
import type { Db } from '@/server/db'
import { classDateStatus, classSlot, onlineClassJoin } from '@/server/db/schema'
import { instantAt } from '@/server/lib/local-time'
import { createTestDb } from '@/test/db'
import { ctxFor, makeUser } from '@/test/factories'
import { setupCourse } from '@/test/marking-fixture'
import { getSession } from '@/server/attendance/sessions'
import { joinOnlineClass } from './join'
import { startClassAttendance } from './views'

const tz = config.timeZone
const MONDAY = '2026-11-16'
const url = 'https://meet.google.com/abc-defg-hij'
const local = (hh: number, mm = 0) => instantAt(MONDAY, hh * 60 + mm, tz)

let db: Db
let fx: Awaited<ReturnType<typeof setupCourse>>
let slotId: string
let key: string

async function seedSlot(over: Partial<typeof classSlot.$inferInsert> = {}) {
  const [slot] = await db
    .insert(classSlot)
    .values({
      courseId: fx.bio.id,
      weekday: 1,
      startMinute: 8 * 60,
      endMinute: 10 * 60,
      room: 'B2',
      meetingUrl: url,
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
  const slot = await seedSlot()
  slotId = slot.id
  key = `slot:${slot.id}:${MONDAY}`
  setNowForTests(() => local(7, 50))
}, 120_000)

afterEach(() => {
  setNowForTests(null)
})

describe('joinOnlineClass', () => {
  it('lets the owner open their own link without recording a join', async () => {
    await expect(joinOnlineClass(fx.lecturer, key)).resolves.toEqual({ kind: 'redirect', url })
    expect(await db.select().from(onlineClassJoin)).toEqual([])
  })

  it('records the first tap for a rostered student and only updates the last one later', async () => {
    const first = local(7, 50)
    await expect(joinOnlineClass(fx.alice, key)).resolves.toEqual({ kind: 'redirect', url })
    const [row] = await db.select().from(onlineClassJoin)
    expect(row).toMatchObject({ occurrenceKey: key, studentId: fx.alice.user.id, firstJoinedAt: first, lastJoinedAt: first })

    const later = local(8, 5)
    setNowForTests(() => later)
    await expect(joinOnlineClass(fx.alice, key)).resolves.toEqual({ kind: 'redirect', url })
    const [again] = await db.select().from(onlineClassJoin)
    expect(again).toMatchObject({ firstJoinedAt: first, lastJoinedAt: later })
    expect(await db.select().from(onlineClassJoin)).toHaveLength(1)
  })

  it('refuses outsiders, cancelled classes and classes that are not online', async () => {
    const outsider = ctxFor(db, await makeUser(db, { role: 'student' }))
    await expect(joinOnlineClass(outsider, key)).rejects.toMatchObject({ code: 'NOT_FOUND' })
    await expect(joinOnlineClass(fx.colleague, key)).rejects.toMatchObject({ code: 'NOT_FOUND' })
    await expect(joinOnlineClass(fx.alice, 'nonsense')).rejects.toMatchObject({ code: 'NOT_FOUND' })
    await expect(joinOnlineClass(fx.alice, `slot:${slotId}:2026-11-17`)).rejects.toMatchObject({ code: 'NOT_FOUND' })

    await db.insert(classDateStatus).values({
      slotId,
      date: MONDAY,
      status: 'cancelled',
      setBy: fx.lecturer.user.id,
    })
    await expect(joinOnlineClass(fx.alice, key)).rejects.toMatchObject({ code: 'NOT_FOUND' })

    await db.delete(classDateStatus)
    await db.update(classSlot).set({ meetingUrl: null }).where(eq(classSlot.id, slotId))
    await expect(joinOnlineClass(fx.alice, key)).rejects.toMatchObject({ code: 'NOT_FOUND' })
    expect(await db.select().from(onlineClassJoin)).toEqual([])
  })

  it('redirects to the dashboard outside the join window, without recording a join', async () => {
    setNowForTests(() => local(7, 44))
    await expect(joinOnlineClass(fx.alice, key)).resolves.toEqual({ kind: 'notice', reason: 'notOpen' })
    setNowForTests(() => local(10, 1))
    await expect(joinOnlineClass(fx.alice, key)).resolves.toEqual({ kind: 'notice', reason: 'ended' })
    expect(await db.select().from(onlineClassJoin)).toEqual([])
  })

  it('the attendance page shows the join time as information only', async () => {
    await joinOnlineClass(fx.alice, key)
    const { sessionId } = await startClassAttendance(fx.lecturer, key)
    const view = await getSession(fx.lecturer, sessionId)

    expect(view.joinedOnline).toBe(true)
    expect(view.students.find((s) => s.studentId === fx.alice.user.id)).toMatchObject({
      joinedOnlineAt: local(7, 50),
    })
    expect(view.students.find((s) => s.studentId === fx.bob.user.id)).toMatchObject({ joinedOnlineAt: null })
  })
})
