import type { ReactElement } from 'react'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Db } from '@/server/db'
import { setResendClientFactoryForTests, setRetryWaitForTests, type NotifyClient } from '@/server/email/notify'
import { setAfterResponseForTests } from '@/server/lib/after-response'
import { createTestDb } from '@/test/db'
import { at, clearMarkingData, insertStartedTest, joinTest, setClock, setupCourse } from '@/test/marking-fixture'
import { handIn, syncAttempt } from './attempt'

type Sent = { to: string; subject: string; react: ReactElement<Record<string, unknown>> }

describe('test hand-in receipts', () => {
  let db: Db
  let tasks: Array<() => Promise<void>>
  let sent: Sent[]

  beforeAll(async () => {
    db = await createTestDb()
  })
  beforeEach(() => {
    tasks = []
    sent = []
    setAfterResponseForTests((task) => {
      tasks.push(task)
    })
    const client: NotifyClient = {
      batch: {
        send: async (payload) => {
          sent.push(...(payload as Sent[]))
          return { error: null }
        },
      },
    }
    setResendClientFactoryForTests(() => client)
    setRetryWaitForTests(async () => {})
    vi.stubEnv('RESEND_API_KEY', 're_test')
    vi.stubEnv('BETTER_AUTH_URL', 'https://clasync.test/')
  })
  afterEach(async () => {
    setAfterResponseForTests(null)
    setResendClientFactoryForTests(null)
    setRetryWaitForTests(null)
    vi.unstubAllEnvs()
    vi.restoreAllMocks()
    await clearMarkingData(db)
  })

  async function flush() {
    const pending = tasks.splice(0)
    for (const task of pending) await task()
  }

  async function scenario() {
    const c = await setupCourse(db)
    tasks.splice(0) // the class-join confirmations
    const t = await insertStartedTest(db, c.lecturer, c.bio.id)
    const alice = await joinTest(db, t.test.id, c.alice)
    const bob = await joinTest(db, t.test.id, c.bob)
    return { ...c, ...t, attempts: { alice, bob } }
  }

  it('the hand-in that closes the attempt emails one receipt in the student language, without marks', async () => {
    const s = await scenario()
    setClock(at(20))
    await handIn(s.bob, s.attempts.bob.id, { deviceId: s.attempts.bob.deviceId, answers: [] })
    expect(sent).toHaveLength(0) // only after the response
    await flush()

    expect(sent).toHaveLength(1)
    const [m] = sent
    expect(m.to).toBe(s.bob.user.email)
    expect(m.subject).toBe('Test remis : CA 1 (Cell biology)')
    expect(m.react.props).toEqual({
      locale: 'fr',
      studentName: 'Bob',
      courseTitle: 'Cell biology',
      testTitle: 'CA 1',
      handedInAt: at(20),
      url: `https://clasync.test/t/${s.test.code}`,
      timeZone: expect.any(String),
    })

    // A second hand-in (another tab, a retry) changes nothing and sends nothing.
    setClock(at(21))
    await handIn(s.bob, s.attempts.bob.id, { deviceId: s.attempts.bob.deviceId, answers: [] })
    await flush()
    expect(sent).toHaveLength(1)
  })

  it('a sync, a hand-in after the end, or a refused hand-in sends nothing', async () => {
    const s = await scenario()
    setClock(at(10))
    await syncAttempt(s.alice, s.attempts.alice.id, { deviceId: s.attempts.alice.deviceId, answers: [], exits: [] })
    await expect(handIn(s.bob, s.attempts.alice.id, { deviceId: 'x', answers: [] })).rejects.toMatchObject({ code: 'FORBIDDEN' })
    setClock(at(31)) // ended for everyone: the hand-in is derived, never stored
    await handIn(s.alice, s.attempts.alice.id, { deviceId: s.attempts.alice.deviceId, answers: [] })
    expect(tasks).toHaveLength(0)
  })

  it('a provider outage never fails the hand-in', async () => {
    const s = await scenario()
    vi.spyOn(console, 'error').mockImplementation(() => {})
    setResendClientFactoryForTests(() => {
      throw new Error('down')
    })
    setClock(at(20))
    const view = await handIn(s.alice, s.attempts.alice.id, { deviceId: s.attempts.alice.deviceId, answers: [] })
    expect(view.stage).toBe('handed_in')
    await expect(flush()).resolves.toBeUndefined()
  })
})
