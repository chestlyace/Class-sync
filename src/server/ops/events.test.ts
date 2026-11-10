import { eq } from 'drizzle-orm'
import { beforeAll, describe, expect, it, vi } from 'vitest'
import type { Db } from '@/server/db'
import { opsEvent, user } from '@/server/db/schema'
import { createTestDb } from '@/test/db'
import { makeUser } from '@/test/factories'
import { dropSuspendedRecipients, maskEmail, pruneOpsEvents, recordOpsEvent, scrubError } from './events'

describe('maskEmail', () => {
  it('keeps the first letter and the domain', () => {
    expect(maskEmail('amina@example.com')).toBe('a***@example.com')
  })
  it('masks anything without an @ entirely', () => {
    expect(maskEmail('not-an-email')).toBe('***')
    expect(maskEmail('')).toBe('***')
  })
})

describe('scrubError', () => {
  it('masks any address in a provider message and bounds its length', () => {
    expect(scrubError('Invalid to address amina@example.com, try again')).toBe('Invalid to address a***@example.com try again'.replace('com try', 'com, try'))
    expect(scrubError('x'.repeat(500))).toHaveLength(200)
  })
})

describe('recordOpsEvent', () => {
  let db: Db
  beforeAll(async () => {
    db = await createTestDb()
  })

  it('inserts a row', async () => {
    await recordOpsEvent(db, { kind: 'email_sent', ok: true, detail: { kind: 'verify', to: 'a***@example.com' } })
    const rows = await db.select().from(opsEvent).where(eq(opsEvent.kind, 'email_sent'))
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ ok: true, detail: { kind: 'verify', to: 'a***@example.com' } })
  })

  it('uses the given time and an empty detail by default', async () => {
    const at = new Date('2026-01-02T03:04:05Z')
    await recordOpsEvent(db, { kind: 'cron_reminders', ok: true, at })
    const [row] = await db.select().from(opsEvent).where(eq(opsEvent.kind, 'cron_reminders'))
    expect(row!.at).toEqual(at)
    expect(row!.detail).toEqual({})
  })

  it('resolves without throwing when the database fails, and logs it', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    const broken = {
      insert() {
        throw new Error('connection closed')
      },
    } as unknown as Db
    await expect(recordOpsEvent(broken, { kind: 'mcp_request', ok: true })).resolves.toBeUndefined()
    const rejecting = {
      insert: () => ({ values: () => Promise.reject(new Error('boom')) }),
    } as unknown as Db
    await expect(recordOpsEvent(rejecting, { kind: 'mcp_request', ok: true })).resolves.toBeUndefined()
    expect(error).toHaveBeenCalledTimes(2)
    error.mockRestore()
  })
})

describe('pruneOpsEvents', () => {
  it('deletes rows older than 90 days and keeps newer ones', async () => {
    const db = await createTestDb()
    const now = new Date('2026-11-10T00:00:00Z')
    const day = 86_400_000
    await recordOpsEvent(db, { kind: 'mcp_request', ok: true, at: new Date(now.getTime() - 91 * day) })
    await recordOpsEvent(db, { kind: 'mcp_request', ok: true, at: new Date(now.getTime() - 89 * day) })
    expect(await pruneOpsEvents(db, now)).toBe(1)
    expect(await db.select().from(opsEvent)).toHaveLength(1)
  })
})

describe('dropSuspendedRecipients', () => {
  it('returns the lower-cased emails of suspended users among the given ones', async () => {
    const db = await createTestDb()
    const active = await makeUser(db, { email: 'active@example.com' })
    const gone = await makeUser(db, { email: 'Gone@Example.com' })
    await db.update(user).set({ suspendedAt: new Date() }).where(eq(user.id, gone.id))
    const result = await dropSuspendedRecipients(db, [active.email, 'GONE@example.com', 'stranger@example.com'])
    expect([...result]).toEqual(['gone@example.com'])
  })

  it('does no query for an empty list', async () => {
    const stub = { select: vi.fn() } as unknown as Db
    expect((await dropSuspendedRecipients(stub, [])).size).toBe(0)
    expect(stub.select).not.toHaveBeenCalled()
  })
})
