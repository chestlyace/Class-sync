import { eq } from 'drizzle-orm'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Db } from '@/server/db'
import { opsEvent, pushSubscription, user } from '@/server/db/schema'
import { setEmailDbForTests } from '@/server/email/db'
import { setAfterResponseForTests } from '@/server/lib/after-response'
import { createTestDb } from '@/test/db'
import { makeUser } from '@/test/factories'
import type { PushPayload } from './payload'
import { queuePush, sendPush, setPushClientForTests, type PushClient } from './send'

let db: Db
beforeAll(async () => {
  db = await createTestDb()
})
beforeEach(async () => {
  await db.delete(opsEvent)
  await db.delete(pushSubscription)
})
afterEach(() => {
  setPushClientForTests(null)
  setAfterResponseForTests(null)
  setEmailDbForTests(null)
  vi.unstubAllEnvs()
  vi.restoreAllMocks()
})
afterAll(() => setPushClientForTests(null))

const payload = (kind: PushPayload['kind'] = 'notesAdded'): PushPayload => ({
  title: 'Course',
  body: 'Body',
  url: '/x',
  tag: kind,
  kind,
})

async function device(userId: string, endpoint: string) {
  await db.insert(pushSubscription).values({ userId, endpoint, p256dh: 'p', auth: 'a', label: 'Chrome on Windows' })
}

function fakeClient(impl?: (endpoint: string) => Promise<void>) {
  const send = vi.fn<PushClient['send']>(async (sub) => impl?.(sub.endpoint))
  setPushClientForTests({ send })
  return send
}

describe('sendPush', () => {
  it('sends to every device of each user', async () => {
    const a = await makeUser(db)
    const b = await makeUser(db)
    await device(a.id, 'https://push.example/a1')
    await device(a.id, 'https://push.example/a2')
    await device(b.id, 'https://push.example/b1')
    const send = fakeClient()
    const result = await sendPush(
      [
        { userId: a.id, payload: payload() },
        { userId: b.id, payload: payload() },
      ],
      db,
    )
    expect(result).toEqual({ sent: 3, skipped: 0, failed: 0, removed: 0 })
    expect(send).toHaveBeenCalledTimes(3)
    expect(send.mock.calls[0][1]).toBe(JSON.stringify(payload()))
    const [row] = await db.select().from(pushSubscription).where(eq(pushSubscription.endpoint, 'https://push.example/a1'))
    expect(row.lastSuccessAt).not.toBeNull()
    expect(row.failureCount).toBe(0)
  })

  it('skips everything without VAPID keys and never throws', async () => {
    vi.stubEnv('NEXT_PUBLIC_VAPID_PUBLIC_KEY', '')
    vi.stubEnv('VAPID_PRIVATE_KEY', '')
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const u = await makeUser(db)
    await device(u.id, 'https://push.example/x')
    await expect(sendPush([{ userId: u.id, payload: payload() }], db)).resolves.toEqual({
      sent: 0,
      skipped: 1,
      failed: 0,
      removed: 0,
    })
    expect(warn).toHaveBeenCalledTimes(1)
    expect(JSON.stringify(warn.mock.calls)).toContain('1')
    expect(await db.select().from(opsEvent)).toHaveLength(0)
  })

  it('drops suspended users', async () => {
    const a = await makeUser(db)
    const s = await makeUser(db)
    await db.update(user).set({ suspendedAt: new Date() }).where(eq(user.id, s.id))
    await device(a.id, 'https://push.example/a')
    await device(s.id, 'https://push.example/s')
    const send = fakeClient()
    const result = await sendPush(
      [
        { userId: a.id, payload: payload() },
        { userId: s.id, payload: payload() },
      ],
      db,
    )
    expect(result.sent).toBe(1)
    expect(result.skipped).toBe(1)
    expect(send).toHaveBeenCalledTimes(1)
    expect(send.mock.calls[0][0].endpoint).toBe('https://push.example/a')
  })

  it('removes a device on 410 and still sends to the others', async () => {
    const a = await makeUser(db)
    await device(a.id, 'https://push.example/gone')
    await device(a.id, 'https://push.example/ok')
    fakeClient(async (endpoint) => {
      if (endpoint.endsWith('/gone')) throw { statusCode: 410, message: 'Gone' }
    })
    const result = await sendPush([{ userId: a.id, payload: payload() }], db)
    expect(result).toEqual({ sent: 1, skipped: 0, failed: 0, removed: 1 })
    const rows = await db.select().from(pushSubscription)
    expect(rows.map((r) => r.endpoint)).toEqual(['https://push.example/ok'])
  })

  it('counts other failures and increments failureCount', async () => {
    const a = await makeUser(db)
    await device(a.id, 'https://push.example/bad')
    fakeClient(async () => {
      throw { statusCode: 500, message: 'boom' }
    })
    const result = await sendPush([{ userId: a.id, payload: payload() }], db)
    expect(result).toEqual({ sent: 0, skipped: 0, failed: 1, removed: 0 })
    const [row] = await db.select().from(pushSubscription)
    expect(row.failureCount).toBe(1)
  })

  it('deletes a device on its fifth failure in a row and counts it as removed', async () => {
    const a = await makeUser(db)
    await device(a.id, 'https://push.example/worn')
    await device(a.id, 'https://push.example/flaky')
    await db.update(pushSubscription).set({ failureCount: 4 }).where(eq(pushSubscription.endpoint, 'https://push.example/worn'))
    await db.update(pushSubscription).set({ failureCount: 2 }).where(eq(pushSubscription.endpoint, 'https://push.example/flaky'))
    fakeClient(async () => {
      throw { statusCode: 500, message: 'boom' }
    })
    const result = await sendPush([{ userId: a.id, payload: payload() }], db)
    expect(result).toEqual({ sent: 0, skipped: 0, failed: 1, removed: 1 })
    const rows = await db.select().from(pushSubscription)
    expect(rows.map((r) => [r.endpoint, r.failureCount])).toEqual([['https://push.example/flaky', 3]])
    const [failed] = await db.select().from(opsEvent).where(eq(opsEvent.kind, 'push_failed'))
    expect(failed.detail).toMatchObject({ count: 2, removed: 1 })
  })

  it('a success resets the failure count, so only failures in a row remove a device', async () => {
    const a = await makeUser(db)
    await device(a.id, 'https://push.example/a')
    await db.update(pushSubscription).set({ failureCount: 4 })
    fakeClient()
    await sendPush([{ userId: a.id, payload: payload() }], db)
    fakeClient(async () => {
      throw { statusCode: 500, message: 'boom' }
    })
    expect(await sendPush([{ userId: a.id, payload: payload() }], db)).toMatchObject({ failed: 1, removed: 0 })
    const [row] = await db.select().from(pushSubscription)
    expect(row.failureCount).toBe(1)
  })

  it('records one push_failed when the VAPID keys are malformed, and never throws', async () => {
    vi.stubEnv('NEXT_PUBLIC_VAPID_PUBLIC_KEY', 'not-a-key')
    vi.stubEnv('VAPID_PRIVATE_KEY', 'not-a-key-either')
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const a = await makeUser(db)
    await device(a.id, 'https://push.example/a1')
    await device(a.id, 'https://push.example/a2')
    await expect(sendPush([{ userId: a.id, payload: payload() }], db)).resolves.toEqual({
      sent: 0,
      skipped: 0,
      failed: 2,
      removed: 0,
    })
    const events = await db.select().from(opsEvent)
    expect(events).toHaveLength(1)
    expect(events[0]).toMatchObject({ kind: 'push_failed', ok: false, detail: { count: 2, error: expect.any(String) } })
    expect(JSON.stringify(events[0].detail)).not.toContain('not-a-key')
    // The devices are left alone: the fault is the server's, not theirs.
    expect((await db.select().from(pushSubscription)).every((r) => r.failureCount === 0)).toBe(true)
  })

  it('uses 15-minute TTL and high urgency for check-in, and a 10-second timeout for every send', async () => {
    const a = await makeUser(db)
    await device(a.id, 'https://push.example/a')
    const send = fakeClient()
    await sendPush([{ userId: a.id, payload: payload('checkInOpened') }], db)
    await sendPush([{ userId: a.id, payload: payload('testStarted') }], db)
    await sendPush([{ userId: a.id, payload: payload('notesAdded') }], db)
    expect(send.mock.calls[0][2]).toEqual({ TTL: 900, urgency: 'high', timeout: 10_000 })
    expect(send.mock.calls[1][2]).toEqual({ TTL: 3600, urgency: 'high', timeout: 10_000 })
    expect(send.mock.calls[2][2]).toEqual({ TTL: 86400, urgency: 'normal', timeout: 10_000 })
  })

  it('records push_sent and push_failed counts without endpoints', async () => {
    const a = await makeUser(db)
    await device(a.id, 'https://push.example/secret-ok')
    await device(a.id, 'https://push.example/secret-bad')
    fakeClient(async (endpoint) => {
      if (endpoint.endsWith('bad')) throw { statusCode: 500, message: 'failed' }
    })
    await sendPush([{ userId: a.id, payload: payload() }], db)
    const events = await db.select().from(opsEvent)
    const sent = events.find((e) => e.kind === 'push_sent')
    const failed = events.find((e) => e.kind === 'push_failed')
    expect(sent?.ok).toBe(true)
    expect(sent?.detail).toMatchObject({ count: 1 })
    expect(failed?.ok).toBe(false)
    expect(failed?.detail).toMatchObject({ count: 1 })
    expect(events).toHaveLength(2)
    expect(JSON.stringify(events.map((e) => e.detail))).not.toContain('secret')
  })
})

describe('queuePush', () => {
  it('sends nothing when build throws', async () => {
    const send = fakeClient()
    const tasks: Array<() => Promise<void>> = []
    setAfterResponseForTests((t) => {
      tasks.push(t)
    })
    vi.spyOn(console, 'error').mockImplementation(() => {})
    await expect(
      queuePush('test', async () => {
        throw new Error('nope')
      }),
    ).resolves.toBeUndefined()
    expect(tasks).toHaveLength(0)
    expect(send).not.toHaveBeenCalled()
  })

  it('sends after the response', async () => {
    const a = await makeUser(db)
    await device(a.id, 'https://push.example/a')
    const send = fakeClient()
    const tasks: Array<() => Promise<void>> = []
    setAfterResponseForTests((t) => {
      tasks.push(t)
    })
    setEmailDbForTests(db)
    await queuePush('test', async () => [{ userId: a.id, payload: payload() }])
    expect(send).not.toHaveBeenCalled()
    await Promise.all(tasks.map((t) => t()))
    expect(send).toHaveBeenCalledTimes(1)
  })
})
