import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { eq } from 'drizzle-orm'
import type { SessionUser } from '@/server/core/context'
import type { Db } from '@/server/db'
import { adminAction, session, user } from '@/server/db/schema'
import { createTestDb } from '@/test/db'
import { ctxFor, makeUser } from '@/test/factories'
import { resendVerification, revokeSessions, suspendUser, unsuspendUser } from './actions'

describe('admin actions', () => {
  let db: Db
  let admin: SessionUser

  beforeAll(async () => {
    db = await createTestDb()
  })
  beforeEach(async () => {
    admin = await makeUser(db, { email: `admin-${crypto.randomUUID().slice(0, 8)}@example.com` })
    vi.stubEnv('ADMIN_EMAILS', admin.email)
  })
  afterEach(async () => {
    vi.unstubAllEnvs()
    await db.delete(adminAction)
    await db.delete(session)
  })

  async function addSession(userId: string) {
    const id = crypto.randomUUID()
    await db.insert(session).values({
      id,
      token: `tok-${id}`,
      userId,
      expiresAt: new Date(Date.now() + 3600_000),
    })
  }
  const sessionsOf = (userId: string) => db.select().from(session).where(eq(session.userId, userId))
  const audits = () => db.select().from(adminAction)
  const row = async (id: string) => (await db.select().from(user).where(eq(user.id, id)))[0]

  it('gives a non-admin NOT_FOUND from every action', async () => {
    const nobody = await makeUser(db)
    const target = await makeUser(db, { emailVerified: false })
    const ctx = ctxFor(db, nobody)
    const send = vi.fn()
    await expect(suspendUser(ctx, target.id)).rejects.toMatchObject({ code: 'NOT_FOUND' })
    await expect(unsuspendUser(ctx, target.id)).rejects.toMatchObject({ code: 'NOT_FOUND' })
    await expect(revokeSessions(ctx, target.id)).rejects.toMatchObject({ code: 'NOT_FOUND' })
    await expect(resendVerification(ctx, target.id, undefined, send)).rejects.toMatchObject({ code: 'NOT_FOUND' })
    expect(send).not.toHaveBeenCalled()
    expect(await audits()).toHaveLength(0)
  })

  it('suspends a user, deletes their sessions and audits with the reason', async () => {
    const target = await makeUser(db)
    const other = await makeUser(db)
    await addSession(target.id)
    await addSession(target.id)
    await addSession(other.id)
    await suspendUser(ctxFor(db, admin), target.id, '  spam  ')
    const after = await row(target.id)
    expect(after.suspendedAt).toBeInstanceOf(Date)
    expect(after.suspendedReason).toBe('spam')
    expect(await sessionsOf(target.id)).toHaveLength(0)
    expect(await sessionsOf(other.id)).toHaveLength(1)
    const [a] = await audits()
    expect(a).toMatchObject({ adminId: admin.id, action: 'suspend', targetUserId: target.id, reason: 'spam' })
  })

  it('trims the reason to 500 characters and stores empty as null', async () => {
    const t1 = await makeUser(db)
    const t2 = await makeUser(db)
    await suspendUser(ctxFor(db, admin), t1.id, 'x'.repeat(600))
    await suspendUser(ctxFor(db, admin), t2.id, '   ')
    expect((await row(t1.id)).suspendedReason).toHaveLength(500)
    expect((await row(t2.id)).suspendedReason).toBeNull()
    const reasons = (await audits()).map((a) => a.reason)
    expect(reasons).toContain('x'.repeat(500))
    expect(reasons).toContain(null)
  })

  it('refuses to suspend yourself or another admin, with no audit row', async () => {
    const otherAdmin = await makeUser(db, { email: `admin2-${crypto.randomUUID().slice(0, 8)}@example.com` })
    vi.stubEnv('ADMIN_EMAILS', `${admin.email},${otherAdmin.email}`)
    await expect(suspendUser(ctxFor(db, admin), admin.id)).rejects.toMatchObject({ code: 'FORBIDDEN' })
    await expect(suspendUser(ctxFor(db, admin), otherAdmin.id)).rejects.toMatchObject({ code: 'FORBIDDEN' })
    expect(await audits()).toHaveLength(0)
    expect((await row(otherAdmin.id)).suspendedAt).toBeNull()
  })

  it('gives CONFLICT when suspending twice and NOT_FOUND for an unknown user', async () => {
    const target = await makeUser(db)
    await suspendUser(ctxFor(db, admin), target.id)
    await expect(suspendUser(ctxFor(db, admin), target.id)).rejects.toMatchObject({ code: 'CONFLICT' })
    await expect(suspendUser(ctxFor(db, admin), 'nope')).rejects.toMatchObject({ code: 'NOT_FOUND' })
    expect(await audits()).toHaveLength(1)
  })

  it('unsuspends, clearing both columns, and audits; CONFLICT when not suspended', async () => {
    const target = await makeUser(db)
    await expect(unsuspendUser(ctxFor(db, admin), target.id)).rejects.toMatchObject({ code: 'CONFLICT' })
    await suspendUser(ctxFor(db, admin), target.id, 'because')
    await unsuspendUser(ctxFor(db, admin), target.id, 'appeal')
    const after = await row(target.id)
    expect(after.suspendedAt).toBeNull()
    expect(after.suspendedReason).toBeNull()
    const acts = await audits()
    expect(acts.map((a) => a.action).sort()).toEqual(['suspend', 'unsuspend'])
    expect(acts.find((a) => a.action === 'unsuspend')?.reason).toBe('appeal')
  })

  it('revokes only the target sessions, allowed on yourself, and audits', async () => {
    const target = await makeUser(db)
    const other = await makeUser(db)
    await addSession(target.id)
    await addSession(target.id)
    await addSession(other.id)
    await addSession(admin.id)
    await revokeSessions(ctxFor(db, admin), target.id, 'lost laptop')
    expect(await sessionsOf(target.id)).toHaveLength(0)
    expect(await sessionsOf(other.id)).toHaveLength(1)
    await revokeSessions(ctxFor(db, admin), admin.id)
    expect(await sessionsOf(admin.id)).toHaveLength(0)
    const acts = await audits()
    expect(acts).toHaveLength(2)
    expect(acts[0].action).toBe('revoke_sessions')
    await expect(revokeSessions(ctxFor(db, admin), 'nope')).rejects.toMatchObject({ code: 'NOT_FOUND' })
  })

  it('resends verification once for an unverified user and audits', async () => {
    const target = await makeUser(db, { emailVerified: false })
    const send = vi.fn().mockResolvedValue(undefined)
    await resendVerification(ctxFor(db, admin), target.id, 'asked', send)
    expect(send).toHaveBeenCalledTimes(1)
    expect(send).toHaveBeenCalledWith(target.email)
    const [a] = await audits()
    expect(a).toMatchObject({ action: 'resend_verification', targetUserId: target.id, reason: 'asked' })
  })

  it('refuses to resend to a verified or suspended user', async () => {
    const verified = await makeUser(db)
    const suspended = await makeUser(db, { emailVerified: false })
    await suspendUser(ctxFor(db, admin), suspended.id)
    const send = vi.fn()
    await expect(resendVerification(ctxFor(db, admin), verified.id, undefined, send)).rejects.toMatchObject({
      code: 'CONFLICT',
    })
    await expect(resendVerification(ctxFor(db, admin), suspended.id, undefined, send)).rejects.toMatchObject({
      code: 'CONFLICT',
    })
    expect(send).not.toHaveBeenCalled()
    expect(await audits()).toHaveLength(1)
  })
})
