import { createElement } from 'react'
import { eq } from 'drizzle-orm'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Db } from '@/server/db'
import { opsEvent, user } from '@/server/db/schema'
import { createTestDb } from '@/test/db'
import { makeUser } from '@/test/factories'
import { setEmailDbForTests } from './db'
import {
  appLinkBuilder,
  queueNotifications,
  sendNotifications,
  setResendClientFactoryForTests,
  setRetryWaitForTests,
  type Notification,
} from './notify'
import { runAfterResponse, setAfterResponseForTests } from '@/server/lib/after-response'

function items(n: number): Notification[] {
  return Array.from({ length: n }, (_, i) => ({
    to: `student${i}@example.com`,
    locale: i % 2 ? 'fr' : 'en',
    subject: `Subject ${i}`,
    kind: 'assignmentPublished' as const,
    react: createElement('p', null, `Hi ${i}`),
  }))
}

let db: Db
beforeAll(async () => {
  db = await createTestDb()
  setEmailDbForTests(db)
})
afterAll(() => setEmailDbForTests(null))
beforeEach(async () => {
  await db.delete(opsEvent)
})

describe('sendNotifications without RESEND_API_KEY', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
    vi.restoreAllMocks()
    setResendClientFactoryForTests(null)
  })

  it('skips everything, warns once with the count and never throws in production', async () => {
    vi.stubEnv('NODE_ENV', 'production')
    vi.stubEnv('RESEND_API_KEY', '')
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    await expect(sendNotifications(items(3))).resolves.toEqual({ sent: 0, skipped: 3, failed: 0 })
    expect(warn).toHaveBeenCalledTimes(1)
    const logged = JSON.stringify(warn.mock.calls)
    expect(logged).toContain('3')
    expect(logged).not.toContain('@example.com')
  })

  it('skips quietly for an empty list', async () => {
    vi.stubEnv('RESEND_API_KEY', '')
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    await expect(sendNotifications([])).resolves.toEqual({ sent: 0, skipped: 0, failed: 0 })
    expect(warn).not.toHaveBeenCalled()
  })
})

describe('sendNotifications with a key', () => {
  const send = vi.fn()
  const wait = vi.fn<(ms: number) => Promise<void>>(async () => {})

  beforeEach(() => {
    wait.mockClear()
    setRetryWaitForTests(wait)
    vi.stubEnv('RESEND_API_KEY', 're_test')
    send.mockReset()
    setResendClientFactoryForTests(() => ({ batch: { send } }))
  })
  afterEach(() => {
    vi.unstubAllEnvs()
    vi.restoreAllMocks()
    setResendClientFactoryForTests(null)
    setRetryWaitForTests(null)
  })

  it('on a preview, sends only to EMAIL_ALLOWLIST addresses and counts the rest as skipped', async () => {
    vi.stubEnv('VERCEL_ENV', 'preview')
    vi.stubEnv('EMAIL_ALLOWLIST', 'student1@example.com')
    const info = vi.spyOn(console, 'info').mockImplementation(() => {})
    send.mockResolvedValue({ data: { data: [] }, error: null })
    const result = await sendNotifications(items(3))
    expect(result).toEqual({ sent: 1, skipped: 2, failed: 0 })
    expect(send).toHaveBeenCalledTimes(1)
    expect(send.mock.calls[0]![0].map((p: { to: string }) => p.to)).toEqual(['student1@example.com'])
    expect(JSON.stringify(info.mock.calls)).not.toContain('student0@example.com')
  })

  it('on a preview without EMAIL_ALLOWLIST, sends nothing', async () => {
    vi.stubEnv('VERCEL_ENV', 'preview')
    vi.stubEnv('EMAIL_ALLOWLIST', '')
    vi.spyOn(console, 'info').mockImplementation(() => {})
    const result = await sendNotifications(items(3))
    expect(result).toEqual({ sent: 0, skipped: 3, failed: 0 })
    expect(send).not.toHaveBeenCalled()
  })

  it('sends 230 items in 3 batch calls of at most 100', async () => {
    send.mockResolvedValue({ data: { data: [] }, error: null })
    const result = await sendNotifications(items(230))
    expect(result).toEqual({ sent: 230, skipped: 0, failed: 0 })
    expect(send).toHaveBeenCalledTimes(3)
    expect(send.mock.calls.map((c) => c[0].length)).toEqual([100, 100, 30])
    expect(send.mock.calls[0]![0][0]).toMatchObject({
      to: 'student0@example.com',
      subject: 'Subject 0',
      replyTo: 'support@clasync.online',
    })
  })

  it('retries a failing batch once and counts it as failed when the retry fails too', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    send
      .mockResolvedValueOnce({ data: { data: [] }, error: null })
      .mockResolvedValueOnce({ data: null, error: { message: 'boom' } })
      .mockResolvedValueOnce({ data: null, error: { message: 'boom again' } })
    const result = await sendNotifications(items(150))
    expect(result).toEqual({ sent: 100, skipped: 0, failed: 50 })
    expect(send).toHaveBeenCalledTimes(3)
    expect(wait).toHaveBeenCalledTimes(1)
    expect(error).toHaveBeenCalled()
  })

  it('counts a batch as sent when the single retry succeeds', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    send
      .mockResolvedValueOnce({ data: null, error: { message: 'boom' } })
      .mockResolvedValueOnce({ data: { data: [] }, error: null })
    await expect(sendNotifications(items(10))).resolves.toEqual({ sent: 10, skipped: 0, failed: 0 })
    expect(send).toHaveBeenCalledTimes(2)
    expect(wait).toHaveBeenCalledTimes(1)
    expect(wait).toHaveBeenCalledWith(750)
  })

  it('never throws when the client itself throws', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    send.mockRejectedValue(new Error('network down'))
    await expect(sendNotifications(items(5))).resolves.toEqual({ sent: 0, skipped: 0, failed: 5 })
  })

  it('never throws when the client cannot be built', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    setResendClientFactoryForTests(() => {
      throw new Error('bad key')
    })
    await expect(sendNotifications(items(2))).resolves.toEqual({ sent: 0, skipped: 0, failed: 2 })
  })
})

describe('runAfterResponse', () => {
  afterEach(() => {
    setAfterResponseForTests(null)
    vi.restoreAllMocks()
  })

  it('hands the task to the test runner', async () => {
    const captured: Array<() => Promise<void>> = []
    setAfterResponseForTests((task) => captured.push(task))
    const task = vi.fn(async () => {})
    runAfterResponse(task)
    expect(task).not.toHaveBeenCalled()
    expect(captured).toHaveLength(1)
    await captured[0]!()
    expect(task).toHaveBeenCalledTimes(1)
  })

  it('outside a request scope falls back to fire-and-forget and logs failures', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    const task = vi.fn(async () => {
      throw new Error('late failure')
    })
    expect(() => runAfterResponse(task)).not.toThrow()
    await vi.waitFor(() => expect(error).toHaveBeenCalled())
    expect(task).toHaveBeenCalledTimes(1)
  })
})

describe('sendNotifications suspension and health events', () => {
  const send = vi.fn()
  beforeEach(() => {
    send.mockReset()
    setRetryWaitForTests(async () => {})
    vi.stubEnv('RESEND_API_KEY', 're_test')
    setResendClientFactoryForTests(() => ({ batch: { send } }))
  })
  afterEach(() => {
    vi.unstubAllEnvs()
    vi.restoreAllMocks()
    setResendClientFactoryForTests(null)
    setRetryWaitForTests(null)
  })

  it('drops items for a suspended user: counted as skipped, address never reaches the provider', async () => {
    send.mockResolvedValue({ data: { data: [] }, error: null })
    // Stored lower-cased, as Better Auth does.
    const u = await makeUser(db, { email: 'student1@example.com' })
    await db.update(user).set({ suspendedAt: new Date() }).where(eq(user.id, u.id))
    const result = await sendNotifications(items(3))
    expect(result).toEqual({ sent: 2, skipped: 1, failed: 0 })
    const addresses = send.mock.calls.flatMap((c) => c[0].map((p: { to: string }) => p.to))
    expect(addresses).toEqual(['student0@example.com', 'student2@example.com'])
    await db.update(user).set({ suspendedAt: null }).where(eq(user.id, u.id))
  })

  it('sends nothing at all when every recipient is suspended', async () => {
    const u = await makeUser(db, { email: 'student0@example.com' })
    await db.update(user).set({ suspendedAt: new Date() }).where(eq(user.id, u.id))
    expect(await sendNotifications(items(1))).toEqual({ sent: 0, skipped: 1, failed: 0 })
    expect(send).not.toHaveBeenCalled()
    expect(await db.select().from(opsEvent)).toHaveLength(0)
    await db.update(user).set({ suspendedAt: null }).where(eq(user.id, u.id))
  })

  it('records one email_sent per chunk sent, with the count and no addresses', async () => {
    send.mockResolvedValue({ data: { data: [] }, error: null })
    await sendNotifications(items(150))
    const rows = await db.select().from(opsEvent).where(eq(opsEvent.kind, 'email_sent'))
    expect(rows).toHaveLength(2)
    expect(rows.map((r) => r.detail).sort((a, b) => (a as { count: number }).count - (b as { count: number }).count)).toEqual([
      { kind: 'batch', count: 50 },
      { kind: 'batch', count: 100 },
    ])
    expect(rows.every((r) => r.ok)).toBe(true)
  })

  it('records one email_failed per failed chunk, with the count and the error', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    send
      .mockResolvedValueOnce({ data: { data: [] }, error: null })
      .mockResolvedValue({ data: null, error: { message: 'boom' } })
    expect(await sendNotifications(items(150))).toEqual({ sent: 100, skipped: 0, failed: 50 })
    const failed = await db.select().from(opsEvent).where(eq(opsEvent.kind, 'email_failed'))
    expect(failed).toHaveLength(1)
    expect(failed[0]).toMatchObject({ ok: false, detail: { kind: 'batch', count: 50, error: 'boom' } })
    expect(await db.select().from(opsEvent).where(eq(opsEvent.kind, 'email_sent'))).toHaveLength(1)
  })

  it('a chunk that succeeds on retry records one email_sent and no failure', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    send
      .mockResolvedValueOnce({ data: null, error: { message: 'blip' } })
      .mockResolvedValueOnce({ data: { data: [] }, error: null })
    await sendNotifications(items(2))
    expect(await db.select().from(opsEvent).where(eq(opsEvent.kind, 'email_failed'))).toHaveLength(0)
    expect(await db.select().from(opsEvent).where(eq(opsEvent.kind, 'email_sent'))).toHaveLength(1)
  })

  it('never throws and sends nothing when the suspension lookup fails', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    setEmailDbForTests({
      select: () => {
        throw new Error('db down')
      },
    } as unknown as Db)
    try {
      await expect(sendNotifications(items(2))).resolves.toEqual({ sent: 0, skipped: 0, failed: 2 })
      expect(send).not.toHaveBeenCalled()
    } finally {
      setEmailDbForTests(db)
    }
  })
})

describe('queueNotifications', () => {
  let tasks: Array<() => Promise<void>>
  beforeEach(() => {
    tasks = []
    setAfterResponseForTests((task) => {
      tasks.push(task)
    })
  })
  afterEach(() => {
    setAfterResponseForTests(null)
    setResendClientFactoryForTests(null)
    vi.unstubAllEnvs()
    vi.restoreAllMocks()
  })

  it('prepares now and sends only after the response', async () => {
    vi.stubEnv('RESEND_API_KEY', 're_test')
    const send = vi.fn(async () => ({ error: null }))
    setResendClientFactoryForTests(() => ({ batch: { send } }))
    await queueNotifications('test', async () => items(2))
    expect(send).not.toHaveBeenCalled()
    expect(tasks).toHaveLength(1)
    await tasks[0]()
    expect(send).toHaveBeenCalledTimes(1)
  })

  it('a failure while preparing is logged and schedules nothing, never thrown', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    await expect(
      queueNotifications('test', async () => {
        throw new Error('db down')
      }),
    ).resolves.toBeUndefined()
    expect(tasks).toHaveLength(0)
    expect(error).toHaveBeenCalledWith('[test] could not prepare notification emails', expect.any(Error))
  })

  it('nothing to send schedules nothing', async () => {
    await queueNotifications('test', async () => [])
    expect(tasks).toHaveLength(0)
  })
})

describe('appLinkBuilder', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
    vi.restoreAllMocks()
  })

  it('builds absolute links from BETTER_AUTH_URL, without a doubled slash', () => {
    vi.stubEnv('BETTER_AUTH_URL', 'https://clasync.online/')
    expect(appLinkBuilder('test')('/dashboard')).toBe('https://clasync.online/dashboard')
  })

  it('falls back to relative links with one warning when the base is missing', () => {
    vi.stubEnv('BETTER_AUTH_URL', '')
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const link = appLinkBuilder('test')
    expect(link('/a')).toBe('/a')
    expect(link('/b')).toBe('/b')
    expect(warn).toHaveBeenCalledTimes(1)
  })
})
