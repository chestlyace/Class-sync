import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Db } from '@/server/db'
import { setupNotes } from '@/server/notes/test-support'
import { createTestDb } from '@/test/db'
import { pushNotesAdded, pushTestStarted, pushTopicReleased, pushWindowOpened } from './course-events'
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
    await pushWindowOpened(db, fx.courseA, 'start', new Date('2026-11-12T08:15:00Z'))
    const list = items()
    expect(list.map((i) => i.userId).sort()).toEqual([fx.alice, fx.bob, fx.carol, fx.dave].map((s) => s.user.id).sort())
    for (const i of list) {
      expect(i.payload.url).toBe('/check-in')
      expect(i.payload.kind).toBe('checkInOpened')
      expect(i.payload.tag).toBe(`checkin-${fx.courseA}`)
    }
    await pushWindowOpened(db, fx.courseA, 'end', new Date('2026-11-12T09:15:00Z'))
    expect(items(1)[0].payload.kind).toBe('checkOutOpened')
  })

  it('test start links to the test page', async () => {
    await pushTestStarted(db, fx.courseA, { title: 'CA 1', code: 'ABC123' })
    expect(items()[0].payload).toMatchObject({ kind: 'testStarted', url: '/t/ABC123' })
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
