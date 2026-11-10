import { eq } from 'drizzle-orm'
import { beforeAll, describe, expect, it } from 'vitest'
import type { Db } from '@/server/db'
import { user } from '@/server/db/schema'
import { createTestDb } from '@/test/db'
import { makeUser } from '@/test/factories'
import { checkAccount, resolveSessionUser, SEEN_THROTTLE_MS } from './account-state'

const MINUTE = 60 * 1000

describe('account state', () => {
  let db: Db

  beforeAll(async () => {
    db = await createTestDb()
  })

  async function row(id: string) {
    const [r] = await db.select().from(user).where(eq(user.id, id))
    return r
  }

  describe('checkAccount', () => {
    it('throttles last_seen_at to one write an hour', async () => {
      expect(SEEN_THROTTLE_MS).toBe(60 * MINUTE)
      const u = await makeUser(db)
      const t0 = new Date('2026-11-10T08:00:00Z')

      expect(await checkAccount(db, u.id, t0)).toEqual({ suspended: false })
      expect((await row(u.id)).lastSeenAt?.toISOString()).toBe(t0.toISOString())

      await checkAccount(db, u.id, new Date(t0.getTime() + 30 * MINUTE))
      expect((await row(u.id)).lastSeenAt?.toISOString()).toBe(t0.toISOString())

      const later = new Date(t0.getTime() + 61 * MINUTE)
      await checkAccount(db, u.id, later)
      expect((await row(u.id)).lastSeenAt?.toISOString()).toBe(later.toISOString())
    })

    it('reports a suspended account and records no activity', async () => {
      const u = await makeUser(db)
      await db.update(user).set({ suspendedAt: new Date('2026-11-01T00:00:00Z') }).where(eq(user.id, u.id))
      expect(await checkAccount(db, u.id, new Date('2026-11-10T08:00:00Z'))).toEqual({ suspended: true })
      expect((await row(u.id)).lastSeenAt).toBeNull()
    })
  })

  describe('resolveSessionUser', () => {
    const at = new Date('2026-11-10T09:00:00Z')

    it('maps a raw Better Auth user to a SessionUser and records activity', async () => {
      const u = await makeUser(db, { role: 'student', locale: 'fr' })
      const raw = { ...u, image: null, createdAt: new Date(), updatedAt: new Date() }
      expect(await resolveSessionUser(db, raw, at)).toEqual(u)
      expect((await row(u.id)).lastSeenAt?.toISOString()).toBe(at.toISOString())
    })

    it('falls back to en for an unknown locale', async () => {
      const u = await makeUser(db)
      expect(await resolveSessionUser(db, { ...u, locale: 'xx' }, at)).toEqual({ ...u, locale: 'en' })
    })

    it('returns null for a suspended user', async () => {
      const u = await makeUser(db)
      await db.update(user).set({ suspendedAt: at }).where(eq(user.id, u.id))
      expect(await resolveSessionUser(db, { ...u }, at)).toBeNull()
    })

    it('returns null for a role other than lecturer or student', async () => {
      const u = await makeUser(db)
      expect(await resolveSessionUser(db, { ...u, role: 'admin' }, at)).toBeNull()
    })

    it('returns null without a session', async () => {
      expect(await resolveSessionUser(db, null, at)).toBeNull()
    })
  })
})
