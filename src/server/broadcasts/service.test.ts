import { eq } from 'drizzle-orm'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type { SessionUser } from '@/server/core/context'
import type { Db } from '@/server/db'
import { adminAction, broadcast, broadcastRecipient, user } from '@/server/db/schema'
import { createTestDb } from '@/test/db'
import { ctxFor, makeUser } from '@/test/factories'
import { setBroadcastQueueForTests } from './queue'
import { setBroadcastSenderForTests, type BroadcastSender, type OutgoingBroadcast } from './sender'
import {
  audienceCounts,
  createBroadcast,
  getBroadcast,
  isBroadcastReady,
  listBroadcasts,
  sendTestBroadcast,
  type BroadcastInput,
} from './service'

type SendResult = { ok: true } | { ok: false; error: string }

function stubSender(result: (email: OutgoingBroadcast) => SendResult = () => ({ ok: true })) {
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

describe('broadcast service', () => {
  let db: Db
  let admin: SessionUser
  let queued: string[]

  beforeAll(async () => {
    db = await createTestDb()
  })
  beforeEach(async () => {
    vi.stubEnv('BETTER_AUTH_URL', 'https://clasync.test')
    admin = await makeUser(db, { name: 'Admin', email: `admin-${crypto.randomUUID().slice(0, 8)}@example.com` })
    vi.stubEnv('ADMIN_EMAILS', admin.email)
    queued = []
    setBroadcastQueueForTests(async (id) => {
      queued.push(id)
    })
    stubSender()
  })
  afterEach(async () => {
    vi.unstubAllEnvs()
    vi.restoreAllMocks()
    setBroadcastQueueForTests(null)
    setBroadcastSenderForTests(null)
    await db.delete(adminAction)
    await db.delete(broadcastRecipient)
    await db.delete(broadcast)
    await db.delete(user)
  })

  function input(overrides: Partial<BroadcastInput> = {}): BroadcastInput {
    return {
      id: crypto.randomUUID(),
      audience: 'everyone',
      subjectEn: 'Exams moved',
      bodyEn: 'The exams moved to Monday.',
      subjectFr: 'Examens deplaces',
      bodyFr: 'Les examens passent au lundi.',
      ...overrides,
    }
  }

  const recipientsOf = (id: string) => db.select().from(broadcastRecipient).where(eq(broadcastRecipient.broadcastId, id))

  it('gives a non-admin NOT_FOUND from every function', async () => {
    const nobody = await makeUser(db)
    const ctx = ctxFor(db, nobody)
    const data = input()
    await expect(audienceCounts(ctx)).rejects.toMatchObject({ code: 'NOT_FOUND' })
    await expect(createBroadcast(ctx, data, 'SEND')).rejects.toMatchObject({ code: 'NOT_FOUND' })
    await expect(sendTestBroadcast(ctx, data)).rejects.toMatchObject({ code: 'NOT_FOUND' })
    await expect(listBroadcasts(ctx)).rejects.toMatchObject({ code: 'NOT_FOUND' })
    await expect(getBroadcast(ctx, data.id)).rejects.toMatchObject({ code: 'NOT_FOUND' })
    expect(queued).toEqual([])
    expect(await db.select().from(broadcast)).toHaveLength(0)
    expect(await db.select().from(adminAction)).toHaveLength(0)
  })

  it('counts only verified, active, opted-in users of the role', async () => {
    await makeUser(db, { role: 'lecturer' })
    await makeUser(db, { role: 'lecturer' })
    await makeUser(db, { role: 'student' })
    const unverified = await makeUser(db, { role: 'student', emailVerified: false })
    const suspended = await makeUser(db, { role: 'lecturer' })
    const optedOut = await makeUser(db, { role: 'student' })
    await db.update(user).set({ suspendedAt: new Date() }).where(eq(user.id, suspended.id))
    await db.update(user).set({ announcementsOptOutAt: new Date() }).where(eq(user.id, optedOut.id))
    expect(unverified.emailVerified).toBe(false)

    // The admin is a verified lecturer too, so lecturers = 2 + the admin.
    expect(await audienceCounts(ctxFor(db, admin))).toEqual({ lecturers: 3, students: 1, everyone: 4 })
  })

  it('snapshots recipients with their locale and writes one audit row', async () => {
    const fr = await makeUser(db, { role: 'student', locale: 'fr' })
    const en = await makeUser(db, { role: 'student', locale: 'en' })
    await makeUser(db, { role: 'lecturer' })
    const unverified = await makeUser(db, { role: 'student', emailVerified: false })
    const data = input({ audience: 'students' })

    const result = await createBroadcast(ctxFor(db, admin), data, ' send ')

    expect(result).toEqual({ id: data.id, recipients: 2 })
    const rows = await recipientsOf(data.id)
    expect(rows.map((r) => [r.userId, r.email, r.locale, r.status]).sort()).toEqual(
      [
        [fr.id, fr.email, 'fr', 'pending'],
        [en.id, en.email, 'en', 'pending'],
      ].sort(),
    )
    expect(rows.find((r) => r.userId === unverified.id)).toBeUndefined()

    const [saved] = await db.select().from(broadcast).where(eq(broadcast.id, data.id))
    expect(saved).toMatchObject({ adminId: admin.id, audience: 'students', subjectEn: 'Exams moved', status: 'sending' })

    const audits = await db.select().from(adminAction)
    expect(audits).toHaveLength(1)
    expect(audits[0]).toMatchObject({
      adminId: admin.id,
      action: 'broadcast_send',
      targetUserId: null,
      targetSchoolId: null,
      details: { kind: 'broadcast_send', broadcastId: data.id, audience: 'students', recipients: 2, subjectEn: 'Exams moved' },
    })
    expect(queued).toEqual([data.id])
  })

  it('accepts the French confirmation word', async () => {
    await makeUser(db, { role: 'student' })
    const data = input({ audience: 'students' })
    await expect(createBroadcast(ctxFor(db, admin), data, 'Envoyer')).resolves.toMatchObject({ recipients: 1 })
  })

  it('refuses a wrong confirmation word', async () => {
    await makeUser(db, { role: 'student' })
    const data = input({ audience: 'students' })
    await expect(createBroadcast(ctxFor(db, admin), data, 'yes')).rejects.toMatchObject({ code: 'VALIDATION' })
    await expect(createBroadcast(ctxFor(db, admin), data, '')).rejects.toMatchObject({ code: 'VALIDATION' })
    expect(await db.select().from(broadcast)).toHaveLength(0)
    expect(await db.select().from(adminAction)).toHaveLength(0)
    expect(queued).toEqual([])
  })

  it('refuses empty or too long fields', async () => {
    await makeUser(db, { role: 'student' })
    const ctx = ctxFor(db, admin)
    await expect(createBroadcast(ctx, input({ subjectFr: '   ' }), 'SEND')).rejects.toMatchObject({ code: 'VALIDATION' })
    await expect(createBroadcast(ctx, input({ bodyEn: 'x'.repeat(10_001) }), 'SEND')).rejects.toMatchObject({
      code: 'VALIDATION',
    })
    await expect(createBroadcast(ctx, input({ subjectEn: 'x'.repeat(151) }), 'SEND')).rejects.toMatchObject({
      code: 'VALIDATION',
    })
    await expect(createBroadcast(ctx, input({ id: 'not-a-uuid' }), 'SEND')).rejects.toMatchObject({ code: 'VALIDATION' })
    expect(await db.select().from(broadcast)).toHaveLength(0)
  })

  it('refuses an audience with nobody in it', async () => {
    const data = input({ audience: 'students' })
    await expect(createBroadcast(ctxFor(db, admin), data, 'SEND')).rejects.toMatchObject({ code: 'VALIDATION' })
    expect(await db.select().from(broadcast)).toHaveLength(0)
    expect(await db.select().from(adminAction)).toHaveLength(0)
    expect(queued).toEqual([])
  })

  it('returns the same broadcast for a repeated id and queues once', async () => {
    await makeUser(db, { role: 'student' })
    await makeUser(db, { role: 'student' })
    const data = input({ audience: 'students' })
    const first = await createBroadcast(ctxFor(db, admin), data, 'SEND')
    // Someone signs up in between: the repeat must not change the saved list.
    await makeUser(db, { role: 'student' })
    const second = await createBroadcast(ctxFor(db, admin), data, 'SEND')

    expect(second).toEqual(first)
    expect(second.recipients).toBe(2)
    expect(queued).toEqual([data.id])
    expect(await db.select().from(broadcast)).toHaveLength(1)
    expect(await db.select().from(adminAction)).toHaveLength(1)
    expect(await recipientsOf(data.id)).toHaveLength(2)
  })

  it('refuses when SES is not set up', async () => {
    vi.stubEnv('APP_ENV', 'production')
    vi.stubEnv('SES_REGION', '')
    setBroadcastSenderForTests(null)
    await makeUser(db, { role: 'student' })
    expect(isBroadcastReady()).toBe(false)

    const data = input({ audience: 'students' })
    await expect(createBroadcast(ctxFor(db, admin), data, 'SEND')).rejects.toMatchObject({ code: 'CONFLICT' })
    await expect(sendTestBroadcast(ctxFor(db, admin), data)).rejects.toMatchObject({ code: 'CONFLICT' })
    expect(await db.select().from(broadcast)).toHaveLength(0)
    expect(queued).toEqual([])
  })

  it('reports ready when a sender exists', () => {
    expect(isBroadcastReady()).toBe(true)
  })

  it('sends a test of both languages to the admin only', async () => {
    const { sent } = stubSender()
    await makeUser(db, { role: 'student' })
    // Opting out does not stop the admin's own test.
    await db.update(user).set({ announcementsOptOutAt: new Date() }).where(eq(user.id, admin.id))

    await sendTestBroadcast(ctxFor(db, admin), input())

    expect(sent).toHaveLength(2)
    expect(sent.map((e) => e.to)).toEqual([admin.email, admin.email])
    expect(sent.map((e) => e.subject)).toEqual(['[Test] Exams moved', '[Test] Examens deplaces'])
    expect(sent[0].text).toContain('The exams moved to Monday.')
    expect(sent[1].text).toContain('Les examens passent au lundi.')
    expect(sent[0].unsubscribeUrl).toMatch(/^https:\/\/clasync\.test\/api\/unsubscribe\//)
    expect(await db.select().from(broadcast)).toHaveLength(0)
    expect(await db.select().from(broadcastRecipient)).toHaveLength(0)
    expect(await db.select().from(adminAction)).toHaveLength(0)
    expect(queued).toEqual([])
  })

  it('turns a failed test send into an error with the scrubbed message', async () => {
    stubSender(() => ({ ok: false, error: 'Rejected a***@example.com' }))
    await expect(sendTestBroadcast(ctxFor(db, admin), input())).rejects.toMatchObject({
      code: 'CONFLICT',
      message: 'Rejected a***@example.com',
    })
  })

  it('lists broadcasts newest first with counts by status', async () => {
    const students = await Promise.all([1, 2, 3, 4, 5].map(() => makeUser(db, { role: 'student' })))
    const older = input({ audience: 'students', subjectEn: 'Older' })
    await createBroadcast(ctxFor(db, admin), older, 'SEND')
    await db.update(broadcast).set({ createdAt: new Date(Date.now() - 3600_000) }).where(eq(broadcast.id, older.id))
    const newer = input({ audience: 'students', subjectEn: 'Newer' })
    await createBroadcast(ctxFor(db, admin), newer, 'SEND')

    const rows = await recipientsOf(newer.id)
    const statusOf = new Map<string, 'sent' | 'failed' | 'skipped' | 'pending'>([
      [students[0].id, 'sent'],
      [students[1].id, 'sent'],
      [students[2].id, 'failed'],
      [students[3].id, 'skipped'],
      [students[4].id, 'pending'],
    ])
    for (const r of rows) {
      await db
        .update(broadcastRecipient)
        .set({ status: statusOf.get(r.userId!)! })
        .where(eq(broadcastRecipient.id, r.id))
    }

    const list = await listBroadcasts(ctxFor(db, admin))
    expect(list.map((b) => b.subjectEn)).toEqual(['Newer', 'Older'])
    expect(list[0]).toMatchObject({
      id: newer.id,
      adminName: 'Admin',
      audience: 'students',
      status: 'sending',
      total: 5,
      sent: 2,
      failed: 1,
      skipped: 1,
    })
    expect(list[1]).toMatchObject({ id: older.id, total: 5, sent: 0, failed: 0, skipped: 0 })
  })

  it('returns a broadcast with its failed and skipped addresses', async () => {
    const a = await makeUser(db, { role: 'student' })
    const b = await makeUser(db, { role: 'student' })
    await makeUser(db, { role: 'student' })
    const data = input({ audience: 'students' })
    await createBroadcast(ctxFor(db, admin), data, 'SEND')
    await db
      .update(broadcastRecipient)
      .set({ status: 'failed', error: 'Mailbox full' })
      .where(eq(broadcastRecipient.userId, a.id))
    await db
      .update(broadcastRecipient)
      .set({ status: 'skipped', error: 'opted_out' })
      .where(eq(broadcastRecipient.userId, b.id))

    const detail = await getBroadcast(ctxFor(db, admin), data.id)
    expect(detail).toMatchObject({
      id: data.id,
      bodyEn: 'The exams moved to Monday.',
      subjectFr: 'Examens deplaces',
      bodyFr: 'Les examens passent au lundi.',
      total: 3,
      sent: 0,
      failed: 1,
      skipped: 1,
    })
    expect(detail.problems).toEqual([
      { email: a.email, status: 'failed', error: 'Mailbox full' },
      { email: b.email, status: 'skipped', error: 'opted_out' },
    ])
  })

  it('gives NOT_FOUND for a broadcast that does not exist', async () => {
    await expect(getBroadcast(ctxFor(db, admin), crypto.randomUUID())).rejects.toMatchObject({ code: 'NOT_FOUND' })
  })
})
