import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Db } from '@/server/db'
import { broadcast, broadcastRecipient, user } from '@/server/db/schema'
import { createTestDb } from '@/test/db'
import { makeUser } from '@/test/factories'
import { setBroadcastQueueForTests } from './queue'
import { requeueStaleBroadcasts } from './requeue'

type RowStatus = 'pending' | 'sending' | 'sent' | 'failed' | 'skipped'

describe('requeueStaleBroadcasts', () => {
  let db: Db
  let queued: string[]
  const at = new Date('2026-11-24T03:00:00Z')
  const minutesAgo = (m: number) => new Date(at.getTime() - m * 60_000)

  beforeAll(async () => {
    db = await createTestDb()
  })
  beforeEach(() => {
    queued = []
    setBroadcastQueueForTests(async (id) => {
      queued.push(id)
    })
  })
  afterEach(async () => {
    vi.restoreAllMocks()
    setBroadcastQueueForTests(null)
    await db.delete(broadcastRecipient)
    await db.delete(broadcast)
    await db.delete(user)
  })

  async function seed(opts: { createdAt: Date; status?: 'sending' | 'done'; rows: RowStatus[] }): Promise<string> {
    const admin = await makeUser(db)
    const [item] = await db
      .insert(broadcast)
      .values({
        adminId: admin.id,
        createdAt: opts.createdAt,
        audience: 'everyone',
        subjectEn: 'Exams moved',
        bodyEn: 'The exams moved to Monday.',
        subjectFr: 'Examens deplaces',
        bodyFr: 'Les examens passent au lundi.',
        status: opts.status ?? 'sending',
      })
      .returning()
    for (const status of opts.rows) {
      const person = await makeUser(db)
      await db
        .insert(broadcastRecipient)
        .values({ broadcastId: item!.id, userId: person.id, email: person.email, locale: 'en', status })
    }
    return item!.id
  }

  it('queues a sending broadcast older than 10 minutes that still has pending or sending rows', async () => {
    const pending = await seed({ createdAt: minutesAgo(60), rows: ['sent', 'pending'] })
    const stuck = await seed({ createdAt: minutesAgo(11), rows: ['sending', 'failed'] })

    expect(await requeueStaleBroadcasts(db, at)).toBe(2)
    expect(queued).toEqual([pending, stuck])
  })

  it('leaves recent, finished and fully handled broadcasts alone', async () => {
    await seed({ createdAt: minutesAgo(5), rows: ['pending'] })
    await seed({ createdAt: minutesAgo(60), status: 'done', rows: ['pending'] })
    await seed({ createdAt: minutesAgo(60), rows: ['sent', 'failed', 'skipped'] })

    expect(await requeueStaleBroadcasts(db, at)).toBe(0)
    expect(queued).toEqual([])
  })

  it('keeps going when one broadcast fails to queue, and logs it', async () => {
    const first = await seed({ createdAt: minutesAgo(30), rows: ['pending'] })
    const second = await seed({ createdAt: minutesAgo(20), rows: ['pending'] })
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {})
    setBroadcastQueueForTests(async (id) => {
      if (id === first) throw new Error('queue down')
      queued.push(id)
    })

    expect(await requeueStaleBroadcasts(db, at)).toBe(1)
    expect(queued).toEqual([second])
    expect(logged).toHaveBeenCalledTimes(1)
  })
})
