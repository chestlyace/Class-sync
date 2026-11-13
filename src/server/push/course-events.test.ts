import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Db } from '@/server/db'
import { setupNotes } from '@/server/notes/test-support'
import { createTestDb } from '@/test/db'
import { notificationPreference } from '@/server/db/schema'
import type { Occurrence, Sitting } from '@/server/schedule/occurrences'
import {
  pushClassCancelled,
  pushClassMakeUp,
  pushClassMissedQuestion,
  pushClassMoved,
  pushClassSoon,
  pushNotesAdded,
  pushTestStarted,
  pushTimetableChanged,
  pushTopicReleased,
  pushWindowOpened,
} from './course-events'
import type { PushItem } from './send'
import { sendPush } from './send'

vi.mock('./send', () => {
  const sendPush = vi.fn(async (items: unknown[]) => ({ sent: 0, skipped: items.length, failed: 0, removed: 0 }))
  return {
    sendPush,
    queuePush: vi.fn(async (_context: string, build: () => Promise<unknown[]>) => {
      try {
        await sendPush(await build())
      } catch {}
    }),
  }
})

const sent = vi.mocked(sendPush)
const items = (call = 0) => sent.mock.calls[call]?.[0] as PushItem[]

let db: Db
let fx: Awaited<ReturnType<typeof setupNotes>>

beforeEach(async () => {
  db = await createTestDb()
  fx = await setupNotes(db)
  sent.mockClear()
}, 120_000)

describe('course push events', () => {
  it('window push goes to every roster student with url /check-in', async () => {
    await pushWindowOpened(db, fx.courseA, { id: 'w-start', kind: 'start', closesAt: new Date('2026-11-12T08:15:00Z') })
    const list = items()
    expect(list.map((i) => i.userId).sort()).toEqual([fx.alice, fx.bob, fx.carol, fx.dave].map((s) => s.user.id).sort())
    for (const i of list) {
      expect(i.payload.url).toBe('/check-in')
      expect(i.payload.kind).toBe('checkInOpened')
      expect(i.payload.tag).toBe('checkin-w-start')
    }
    await pushWindowOpened(db, fx.courseA, { id: 'w-end', kind: 'end', closesAt: new Date('2026-11-12T09:15:00Z') })
    // Each window has its own tag: the check-out never silently replaces the check-in.
    expect(items(1)[0].payload).toMatchObject({ kind: 'checkOutOpened', tag: 'checkin-w-end' })
  })

  it('test start links to the test page, tagged per test', async () => {
    await pushTestStarted(db, fx.courseA, { id: 'test-1', title: 'CA 1', code: 'ABC123' })
    expect(items()[0].payload).toMatchObject({ kind: 'testStarted', url: '/t/ABC123', tag: 'test-test-1' })
  })

  it('test start encodes the code in the link', async () => {
    await pushTestStarted(db, fx.courseA, { id: 'test-2', title: 'CA 2', code: 'A/B?C' })
    expect(items()[0].payload.url).toBe('/t/A%2FB%3FC')
  })

  it('notes: three items in a row push once', async () => {
    const at = new Date('2026-11-12T08:00:00Z')
    await pushNotesAdded(db, fx.courseA, 'One', at)
    await pushNotesAdded(db, fx.courseA, 'Two', new Date(at.getTime() + 60_000))
    await pushNotesAdded(db, fx.courseA, 'Three', new Date(at.getTime() + 120_000))
    expect(sent).toHaveBeenCalledTimes(1)
    expect(items()[0].payload).toMatchObject({
      kind: 'notesAdded',
      url: `/courses/${fx.courseA}/notes`,
      tag: `notes-${fx.courseA}`,
    })
    await pushNotesAdded(db, fx.courseA, 'Later', new Date(at.getTime() + 31 * 60_000))
    expect(sent).toHaveBeenCalledTimes(2)
  })

  it('topic release pushes even inside the cooldown', async () => {
    const at = new Date('2026-11-12T08:00:00Z')
    await pushNotesAdded(db, fx.courseA, 'One', at)
    await pushTopicReleased(db, fx.courseA, 'Cells', new Date(at.getTime() + 60_000))
    expect(sent).toHaveBeenCalledTimes(2)
    expect(items(1)[0].payload).toMatchObject({ kind: 'topicReleased' })
    // The release restarted the window: a note right after stays quiet.
    await pushNotesAdded(db, fx.courseA, 'Two', new Date(at.getTime() + 120_000))
    expect(sent).toHaveBeenCalledTimes(2)
  })

  it('a failing cooldown never throws out of the call', async () => {
    const broken = Object.assign(Object.create(db), { insert: () => { throw new Error('boom') } }) as Db
    vi.spyOn(console, 'error').mockImplementation(() => {})
    await expect(pushNotesAdded(broken, fx.courseA, 'One', new Date())).resolves.toBeUndefined()
    await expect(pushTopicReleased(broken, fx.courseA, 'T', new Date())).resolves.toBeUndefined()
    // The notes claim failed: nothing pushed. The release still goes out.
    expect(sent).toHaveBeenCalledTimes(1)
    expect(items()[0].payload.kind).toBe('topicReleased')
    vi.restoreAllMocks()
  })
})

describe('class schedule push events', () => {
  const occ = (courseId: string, over: Partial<Occurrence> = {}): Occurrence => ({
    key: 'slot:s1:2026-11-10',
    courseId,
    date: '2026-11-10',
    startsAt: new Date('2026-11-10T07:00:00Z'),
    endsAt: new Date('2026-11-10T09:00:00Z'),
    room: 'B2',
    requireOnCampus: false,
    status: null,
    source: { kind: 'slot', slotId: 's1' },
    ...over,
  })
  const sitting = (courseId: string, o: Occurrence): Sitting => ({
    key: o.key,
    courseId,
    date: o.date,
    startsAt: o.startsAt,
    endsAt: o.endsAt,
    occurrences: [o],
    status: null,
  })

  it('pushClassSoon skips students who turned class reminders off but still pushes the lecturer', async () => {
    await db.insert(notificationPreference).values({ userId: fx.alice.user.id, classReminders: false })
    await pushClassSoon(db, sitting(fx.courseA, occ(fx.courseA)), 'B2')
    const list = items()
    const lecturer = list.filter((i) => i.userId === fx.lecturer.user.id)
    expect(lecturer).toHaveLength(1)
    expect(lecturer[0].payload).toMatchObject({
      kind: 'classSoonLecturer',
      url: '/schedule/class/slot%3As1%3A2026-11-10',
      tag: 'class-slot:s1:2026-11-10-classSoonLecturer',
    })
    const students = list.filter((i) => i.payload.kind === 'classSoon')
    expect(students.map((i) => i.userId).sort()).toEqual([fx.bob, fx.carol, fx.dave].map((s) => s.user.id).sort())
    for (const i of students) expect(i.payload).toMatchObject({ url: '/dashboard', tag: 'class-slot:s1:2026-11-10-classSoon' })
    expect(list.map((i) => i.userId)).not.toContain(fx.alice.user.id)
  })

  it('cancelled, moved and make-up go to roster students only', async () => {
    const from = occ(fx.courseA)
    const to = occ(fx.courseA, {
      key: 'extra:e1',
      date: '2026-11-12',
      startsAt: new Date('2026-11-12T13:30:00Z'),
      endsAt: new Date('2026-11-12T15:30:00Z'),
      source: { kind: 'extra', extraId: 'e1', replaces: { slotId: 's1', date: '2026-11-10' } },
    })
    const studentIds = [fx.alice, fx.bob, fx.carol, fx.dave].map((s) => s.user.id).sort()

    await pushClassCancelled(db, from)
    expect(items(0).map((i) => i.userId).sort()).toEqual(studentIds)
    expect(items(0)[0].payload).toMatchObject({ kind: 'classCancelled', url: '/dashboard', tag: 'class-slot:s1:2026-11-10-classCancelled' })
    expect(items(0)[0].payload.body).toBe('The class on Tue 10 Nov at 08:00 is cancelled.')

    await pushClassMoved(db, from, to)
    expect(items(1)[0].payload).toMatchObject({ kind: 'classMoved', tag: 'class-slot:s1:2026-11-10-classMoved' })
    expect(items(1)[0].payload.body).toBe('The class on Tue 10 Nov moved to Thu 12 Nov at 14:30.')

    await pushClassMakeUp(db, to)
    expect(items(2)[0].payload).toMatchObject({ kind: 'classMakeUp', tag: 'class-extra:e1-classMakeUp' })
    expect(items(2)[0].payload.body).toBe('Make-up class on Thu 12 Nov at 14:30 \u00b7 B2.')
  })

  it('pushClassMissedQuestion goes to the lecturer only, linking to /schedule', async () => {
    await pushClassMissedQuestion(db, sitting(fx.courseA, occ(fx.courseA)))
    expect(items()).toHaveLength(1)
    expect(items()[0].userId).toBe(fx.lecturer.user.id)
    expect(items()[0].payload).toMatchObject({
      kind: 'classMissedQuestion',
      url: '/schedule',
      tag: 'class-slot:s1:2026-11-10-classMissedQuestion',
    })
  })

  it('pushTimetableChanged pushes once within the cooldown', async () => {
    const at = new Date('2026-11-12T08:00:00Z')
    await pushTimetableChanged(db, fx.courseA, at)
    await pushTimetableChanged(db, fx.courseA, new Date(at.getTime() + 5 * 60_000))
    expect(sent).toHaveBeenCalledTimes(1)
    expect(items()[0].payload).toMatchObject({ kind: 'timetableChanged', url: '/dashboard', tag: `timetable-${fx.courseA}` })
    await pushTimetableChanged(db, fx.courseA, new Date(at.getTime() + 11 * 60_000))
    expect(sent).toHaveBeenCalledTimes(2)
  })
})
