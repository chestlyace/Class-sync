import { beforeAll, describe, expect, it } from 'vitest'
import { config } from '@/server/core/config'
import type { Db } from '@/server/db'
import {
  attendanceSession,
  attendanceWindow,
  class_,
  classDateStatus,
  classExtra,
  classSlot,
  course,
  school,
} from '@/server/db/schema'
import { instantAt } from '@/server/lib/local-time'
import { createTestDb } from '@/test/db'
import { makeUser } from '@/test/factories'
import { buildSittings } from './occurrences'
import { ATTENDANCE_LEAD_MS, loadOccurrences, loadSittingByKey, sittingsWithAttendance } from './queries'

const tz = config.timeZone
const MIN = 60_000

// 2026-11-16 is a Monday.
const MONDAY = '2026-11-16'

async function seed(db: Db) {
  const owner = await makeUser(db)
  const tag = crypto.randomUUID().slice(0, 8)
  const [s] = await db
    .insert(school)
    .values({ name: `Lycee ${tag}`, town: 'Douala', nameKey: `lycee ${tag}`, townKey: 'douala', createdBy: owner.id })
    .returning()
  const [cls] = await db
    .insert(class_)
    .values({
      schoolId: s.id,
      name: 'L1',
      academicYear: '2026/27',
      studentCode: `STU-${tag}`,
      lecturerCode: `LEC-${tag}`,
      createdBy: owner.id,
    })
    .returning()
  const mk = async (title: string) => {
    const [c] = await db
      .insert(course)
      .values({ classId: cls.id, lecturerId: owner.id, title, semester: 1 })
      .returning()
    return c
  }
  return { owner, courseA: await mk('Maths'), courseB: await mk('Physics') }
}

async function addSlot(
  db: Db,
  owner: { id: string },
  courseId: string,
  over: Partial<typeof classSlot.$inferInsert> = {},
) {
  const [slot] = await db
    .insert(classSlot)
    .values({
      courseId,
      weekday: 1,
      startMinute: 8 * 60,
      endMinute: 10 * 60,
      startsOn: '2026-09-01',
      endsOn: '2026-12-31',
      createdBy: owner.id,
      ...over,
    })
    .returning()
  return slot
}

describe('schedule queries', () => {
  let db: Db
  beforeAll(async () => {
    db = await createTestDb()
  })

  it('loads slots, statuses and extras of the given courses only', async () => {
    const { owner, courseA, courseB } = await seed(db)
    const slotA = await addSlot(db, owner, courseA.id)
    const slotB = await addSlot(db, owner, courseB.id)
    // A slot whose term ended before the range is not read.
    await addSlot(db, owner, courseA.id, { startsOn: '2026-01-01', endsOn: '2026-06-30' })
    await db.insert(classDateStatus).values([
      { slotId: slotA.id, date: MONDAY, status: 'cancelled', setBy: owner.id },
      { slotId: slotB.id, date: MONDAY, status: 'taught', setBy: owner.id },
    ])
    const [extraA] = await db
      .insert(classExtra)
      .values({
        courseId: courseA.id,
        startsAt: instantAt('2026-11-17', 14 * 60, tz),
        endsAt: instantAt('2026-11-17', 16 * 60, tz),
        createdBy: owner.id,
      })
      .returning()
    // Outside the range, and another course.
    await db.insert(classExtra).values([
      {
        courseId: courseA.id,
        startsAt: instantAt('2026-11-30', 14 * 60, tz),
        endsAt: instantAt('2026-11-30', 16 * 60, tz),
        createdBy: owner.id,
      },
      {
        courseId: courseB.id,
        startsAt: instantAt('2026-11-17', 14 * 60, tz),
        endsAt: instantAt('2026-11-17', 16 * 60, tz),
        createdBy: owner.id,
      },
    ])

    const occurrences = await loadOccurrences(db, [courseA.id], MONDAY, '2026-11-22')

    expect(occurrences.map((o) => o.key)).toEqual([`slot:${slotA.id}:${MONDAY}`, `extra:${extraA.id}`])
    expect(occurrences[0].status).toBe('cancelled')
    expect(occurrences.every((o) => o.courseId === courseA.id)).toBe(true)
    expect(await loadOccurrences(db, [], MONDAY, '2026-11-22')).toEqual([])
  })

  it('loadSittingByKey finds a sitting by its first occurrence key and returns null after it is cancelled', async () => {
    const { owner, courseA } = await seed(db)
    const first = await addSlot(db, owner, courseA.id)
    const second = await addSlot(db, owner, courseA.id, { startMinute: 10 * 60 + 15, endMinute: 12 * 60 })
    const key = `slot:${first.id}:${MONDAY}`

    const sitting = await loadSittingByKey(db, key)
    expect(sitting?.key).toBe(key)
    expect(sitting?.occurrences.map((o) => o.source)).toEqual([
      { kind: 'slot', slotId: first.id },
      { kind: 'slot', slotId: second.id },
    ])
    // The second class is part of the sitting, not a sitting of its own.
    expect(await loadSittingByKey(db, `slot:${second.id}:${MONDAY}`)).toBeNull()

    await db.insert(classDateStatus).values({ slotId: first.id, date: MONDAY, status: 'cancelled', setBy: owner.id })
    expect(await loadSittingByKey(db, key)).toBeNull()
    // The remaining class now leads its own sitting.
    expect((await loadSittingByKey(db, `slot:${second.id}:${MONDAY}`))?.key).toBe(`slot:${second.id}:${MONDAY}`)

    expect(await loadSittingByKey(db, 'garbage')).toBeNull()
    expect(await loadSittingByKey(db, `slot:${crypto.randomUUID()}:${MONDAY}`)).toBeNull()
    expect(await loadSittingByKey(db, `extra:${crypto.randomUUID()}`)).toBeNull()
  })

  it('loadSittingByKey resolves an extra key by its local date', async () => {
    const { owner, courseA } = await seed(db)
    const [extra] = await db
      .insert(classExtra)
      .values({
        courseId: courseA.id,
        startsAt: instantAt('2026-11-17', 14 * 60, tz),
        endsAt: instantAt('2026-11-17', 16 * 60, tz),
        createdBy: owner.id,
      })
      .returning()
    const sitting = await loadSittingByKey(db, `extra:${extra.id}`)
    expect(sitting?.date).toBe('2026-11-17')
  })

  describe('sittingsWithAttendance', () => {
    async function setup() {
      const { owner, courseA, courseB } = await seed(db)
      const slot = await addSlot(db, owner, courseA.id)
      const occurrences = await loadOccurrences(db, [courseA.id], MONDAY, MONDAY)
      const sittings = buildSittings(occurrences)
      expect(sittings).toHaveLength(1)
      const sitting = sittings[0]
      const session = async (courseId: string, createdAt: Date) => {
        const [s] = await db.insert(attendanceSession).values({ courseId, createdBy: owner.id, createdAt }).returning()
        return s
      }
      const window = async (sessionId: string, openedAt: Date) =>
        db.insert(attendanceWindow).values({
          sessionId,
          kind: 'start',
          secret: 'x',
          openedAt,
          openedBy: owner.id,
        })
      return { slot, sitting, courseB, session, window }
    }

    it('counts a window opened 20 minutes before start as attendance', async () => {
      const { sitting, session, window } = await setup()
      // Session created long before; only its window falls in the span.
      const s = await session(sitting.courseId, new Date(sitting.startsAt.getTime() - 3 * 60 * MIN))
      await window(s.id, new Date(sitting.startsAt.getTime() - 20 * MIN))
      expect([...(await sittingsWithAttendance(db, [sitting]))]).toEqual([sitting.key])
    })

    it('counts a session created in the span, with inclusive bounds', async () => {
      const { sitting, session } = await setup()
      await session(sitting.courseId, new Date(sitting.startsAt.getTime() - ATTENDANCE_LEAD_MS))
      expect(await sittingsWithAttendance(db, [sitting])).toEqual(new Set([sitting.key]))
    })

    it('ignores a window opened after the sitting ended', async () => {
      const { sitting, courseB, session, window } = await setup()
      const s = await session(sitting.courseId, new Date(sitting.startsAt.getTime() - 3 * 60 * MIN))
      await window(s.id, new Date(sitting.endsAt.getTime() + 1))
      // Too early (31 minutes before start), and on another course.
      const early = await session(sitting.courseId, new Date(sitting.startsAt.getTime() - 31 * MIN))
      await window(early.id, new Date(sitting.startsAt.getTime() - 31 * MIN))
      const other = await session(courseB.id, sitting.startsAt)
      await window(other.id, sitting.startsAt)
      expect((await sittingsWithAttendance(db, [sitting])).size).toBe(0)
      expect((await sittingsWithAttendance(db, [])).size).toBe(0)
    })
  })
})
