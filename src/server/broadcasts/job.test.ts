import { eq } from 'drizzle-orm'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Db } from '@/server/db'
import { broadcast, broadcastRecipient, opsEvent, user } from '@/server/db/schema'
import { maskEmail } from '@/server/ops/events'
import { createTestDb } from '@/test/db'
import { makeUser } from '@/test/factories'
import { runBroadcastJob, setBroadcastPaceWaitForTests } from './job'
import { setBroadcastSenderForTests, type BroadcastSender, type OutgoingBroadcast } from './sender'

type SendResult = { ok: true } | { ok: false; error: string }

function stubSender(result: (email: OutgoingBroadcast) => SendResult | Promise<SendResult> = () => ({ ok: true })) {
  const sent: OutgoingBroadcast[] = []
  const sender: BroadcastSender = {
    kind: 'ses',
    send: vi.fn(async (email: OutgoingBroadcast) => {
      sent.push(email)
      return result(email)
    }),
  }
  setBroadcastSenderForTests(sender)
  return { sender, sent }
}

describe('runBroadcastJob', () => {
  let db: Db

  beforeAll(async () => {
    db = await createTestDb()
  })
  beforeEach(() => {
    vi.stubEnv('BETTER_AUTH_URL', 'https://clasync.test')
    vi.stubEnv('EMAIL_ALLOWLIST', '*')
    setBroadcastPaceWaitForTests(async () => {})
  })
  afterEach(async () => {
    vi.unstubAllEnvs()
    vi.restoreAllMocks()
    setBroadcastSenderForTests(null)
    setBroadcastPaceWaitForTests(null)
    await db.delete(opsEvent)
    await db.delete(broadcastRecipient)
    await db.delete(broadcast)
    await db.delete(user)
  })

  async function seed(people: { locale?: 'en' | 'fr'; status?: 'pending' | 'sending' }[]) {
    const admin = await makeUser(db, { name: 'Admin' })
    const [item] = await db
      .insert(broadcast)
      .values({
        adminId: admin.id,
        audience: 'everyone',
        subjectEn: 'Exams moved',
        bodyEn: 'Hello everyone, the exams moved to Monday.',
        subjectFr: 'Examens deplaces',
        bodyFr: 'Bonjour a tous, les examens passent au lundi.',
      })
      .returning()
    const recipients = []
    for (const p of people) {
      const locale = p.locale ?? 'en'
      const u = await makeUser(db, { locale })
      const [row] = await db
        .insert(broadcastRecipient)
        .values({ broadcastId: item!.id, userId: u.id, email: u.email, locale, status: p.status ?? 'pending' })
        .returning()
      recipients.push({ user: u, row: row! })
    }
    return { broadcastId: item!.id, recipients }
  }

  const rowsOf = (broadcastId: string) =>
    db.select().from(broadcastRecipient).where(eq(broadcastRecipient.broadcastId, broadcastId))
  const rowFor = async (id: string) => (await db.select().from(broadcastRecipient).where(eq(broadcastRecipient.id, id)))[0]!
  const broadcastRow = async (id: string) => (await db.select().from(broadcast).where(eq(broadcast.id, id)))[0]!

  it('sends each recipient once in their language and marks the broadcast done', async () => {
    const { sender, sent } = stubSender()
    const { broadcastId, recipients } = await seed([{ locale: 'en' }, { locale: 'fr' }])
    const [en, fr] = recipients

    expect(await runBroadcastJob(db, broadcastId)).toEqual({ done: true })
    expect(sender.send).toHaveBeenCalledTimes(2)

    const toEn = sent.find((e) => e.to === en!.user.email)!
    const toFr = sent.find((e) => e.to === fr!.user.email)!
    expect(toEn.subject).toBe('Exams moved')
    expect(toEn.text).toContain('the exams moved to Monday')
    expect(toFr.subject).toBe('Examens deplaces')
    expect(toFr.text).toContain('les examens passent au lundi')
    expect(toEn.unsubscribeUrl).toMatch(/^https:\/\/clasync\.test\/api\/unsubscribe\/[A-Za-z0-9_-]+$/)
    expect(toFr.unsubscribeUrl).not.toBe(toEn.unsubscribeUrl)

    for (const r of await rowsOf(broadcastId)) {
      expect(r.status).toBe('sent')
      expect(r.sentAt).toBeInstanceOf(Date)
      expect(r.error).toBeNull()
    }
    const done = await broadcastRow(broadcastId)
    expect(done.status).toBe('done')
    expect(done.finishedAt).toBeInstanceOf(Date)

    // A repeated or retried run sends nothing more.
    expect(await runBroadcastJob(db, broadcastId)).toEqual({ done: true })
    expect(sender.send).toHaveBeenCalledTimes(2)
  })

  it('marks a leftover sending row failed as interrupted and does not resend it', async () => {
    const { sender, sent } = stubSender()
    const { broadcastId, recipients } = await seed([{ status: 'sending' }, { status: 'pending' }])
    const [stuck, waiting] = recipients

    expect(await runBroadcastJob(db, broadcastId)).toEqual({ done: true })
    expect(sender.send).toHaveBeenCalledTimes(1)
    expect(sent[0]!.to).toBe(waiting!.user.email)

    const left = await rowFor(stuck!.row.id)
    expect(left.status).toBe('failed')
    expect(left.error).toBe('interrupted')
    expect(left.email).toBe(maskEmail(stuck!.user.email))
    expect((await rowFor(waiting!.row.id)).status).toBe('sent')
    expect((await broadcastRow(broadcastId)).status).toBe('done')
  })

  it('skips users suspended or opted out after Send', async () => {
    const { sender, sent } = stubSender()
    const { broadcastId, recipients } = await seed([{}, {}, {}])
    const [suspended, optedOut, still] = recipients
    await db.update(user).set({ suspendedAt: new Date() }).where(eq(user.id, suspended!.user.id))
    await db.update(user).set({ announcementsOptOutAt: new Date() }).where(eq(user.id, optedOut!.user.id))

    expect(await runBroadcastJob(db, broadcastId)).toEqual({ done: true })
    expect(sender.send).toHaveBeenCalledTimes(1)
    expect(sent[0]!.to).toBe(still!.user.email)

    expect((await rowFor(suspended!.row.id)).status).toBe('skipped')
    expect((await rowFor(optedOut!.row.id)).status).toBe('skipped')
    expect((await rowFor(still!.row.id)).status).toBe('sent')
    expect((await rowFor(suspended!.row.id)).sentAt).toBeNull()
  })

  it('records a failed send with a scrubbed error and goes on', async () => {
    let failing = ''
    const { sender } = stubSender((email) =>
      email.to === failing ? { ok: false, error: `Address ${failing} is on the suppression list` } : { ok: true },
    )
    const { broadcastId, recipients } = await seed([{}, {}])
    const [bad, good] = recipients
    failing = bad!.user.email

    expect(await runBroadcastJob(db, broadcastId)).toEqual({ done: true })
    expect(sender.send).toHaveBeenCalledTimes(2)

    const failedRow = await rowFor(bad!.row.id)
    expect(failedRow.status).toBe('failed')
    expect(failedRow.error).toBe(`Address ${maskEmail(failing)} is on the suppression list`)
    expect(failedRow.sentAt).toBeNull()
    expect((await rowFor(good!.row.id)).status).toBe('sent')

    const events = await db.select().from(opsEvent)
    expect(events.map((e) => ({ kind: e.kind, ok: e.ok, detail: e.detail })).sort((a, b) => a.kind.localeCompare(b.kind))).toEqual([
      { kind: 'email_failed', ok: false, detail: { kind: 'broadcast', count: 1 } },
      { kind: 'email_sent', ok: true, detail: { kind: 'broadcast', count: 1 } },
    ])
    expect((await broadcastRow(broadcastId)).status).toBe('done')
  })

  it('masks every address once handled', async () => {
    let failing = ''
    stubSender((email) => (email.to === failing ? { ok: false, error: 'Throttled' } : { ok: true }))
    const { broadcastId, recipients } = await seed([{}, {}, {}, { status: 'sending' }])
    const [, failedTo, skippedTo] = recipients
    failing = failedTo!.user.email
    await db.update(user).set({ suspendedAt: new Date() }).where(eq(user.id, skippedTo!.user.id))

    await runBroadcastJob(db, broadcastId)

    const rows = await rowsOf(broadcastId)
    expect(rows.map((r) => r.status).sort()).toEqual(['failed', 'failed', 'sent', 'skipped'])
    for (const { user: u, row } of recipients) {
      const stored = rows.find((r) => r.id === row.id)!
      expect(stored.email).toBe(maskEmail(u.email))
      expect(stored.email).not.toBe(u.email)
    }
    const events = JSON.stringify(await db.select().from(opsEvent))
    for (const { user: u } of recipients) expect(events).not.toContain(u.email)
  })

  it('stops at the budget and reports not done', async () => {
    let clock = 0
    const { sender, sent } = stubSender(() => {
      clock += 1000
      return { ok: true }
    })
    const { broadcastId } = await seed([{}, {}, {}, {}, {}])

    // Checks at 0, 1000 and 2000 ms pass; at 3000 ms the 2500 ms budget is spent.
    expect(await runBroadcastJob(db, broadcastId, { budgetMs: 2500, now: () => clock })).toEqual({ done: false })
    expect(sender.send).toHaveBeenCalledTimes(3)
    const rows = await rowsOf(broadcastId)
    expect(rows.filter((r) => r.status === 'sent')).toHaveLength(3)
    expect(rows.filter((r) => r.status === 'pending')).toHaveLength(2)
    expect(rows.filter((r) => r.status === 'sending')).toHaveLength(0)
    expect((await broadcastRow(broadcastId)).status).toBe('sending')

    // The next run finishes the rest, sending nobody twice.
    expect(await runBroadcastJob(db, broadcastId)).toEqual({ done: true })
    expect(sender.send).toHaveBeenCalledTimes(5)
    expect(new Set(sent.map((e) => e.to)).size).toBe(5)
    expect((await broadcastRow(broadcastId)).status).toBe('done')
  })

  it('throws and leaves rows pending when no sender is configured', async () => {
    vi.stubEnv('APP_ENV', 'production')
    vi.stubEnv('SES_REGION', '')
    const { broadcastId } = await seed([{}, {}])

    await expect(runBroadcastJob(db, broadcastId)).rejects.toThrow(/not configured/)
    for (const r of await rowsOf(broadcastId)) expect(r.status).toBe('pending')
    expect((await broadcastRow(broadcastId)).status).toBe('sending')
  })
})
