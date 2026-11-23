import { beforeAll, describe, expect, it, vi } from 'vitest'
import { eq } from 'drizzle-orm'
import type { Db } from '@/server/db'
import { user } from '@/server/db/schema'
import { createTestDb } from '@/test/db'
import { ctxFor, makeUser } from '@/test/factories'
import {
  announcementsEnabled,
  describeUnsubscribeLink,
  setAnnouncementsEnabled,
  unsubscribePageUrl,
  unsubscribeByToken,
  unsubscribeTokenFor,
  unsubscribeUrl,
} from './unsubscribe'

describe('unsubscribe', () => {
  let db: Db

  beforeAll(async () => {
    db = await createTestDb()
  })

  const row = async (id: string) => (await db.select().from(user).where(eq(user.id, id)))[0]

  it('creates one token per user and returns the same one after', async () => {
    const a = await makeUser(db)
    const b = await makeUser(db)
    const first = await unsubscribeTokenFor(db, a.id)
    expect(first).toMatch(/^[A-Za-z0-9_-]{20,64}$/)
    expect(await unsubscribeTokenFor(db, a.id)).toBe(first)
    expect((await row(a.id)).unsubscribeToken).toBe(first)
    expect(await unsubscribeTokenFor(db, b.id)).not.toBe(first)
    // Two sends at once end up with the same stored token.
    const c = await makeUser(db)
    const [x, y] = await Promise.all([unsubscribeTokenFor(db, c.id), unsubscribeTokenFor(db, c.id)])
    expect(x).toBe(y)
  })

  it('unsubscribes by token and is idempotent', async () => {
    const person = await makeUser(db)
    const token = await unsubscribeTokenFor(db, person.id)
    expect(await describeUnsubscribeLink(token, { db })).toBe('valid')
    // Reading the link's state changes nothing.
    expect((await row(person.id)).announcementsOptOutAt).toBeNull()

    expect(await unsubscribeByToken(db, token)).toBe('unsubscribed')
    const firstTime = (await row(person.id)).announcementsOptOutAt
    expect(firstTime).toBeInstanceOf(Date)
    expect(await describeUnsubscribeLink(token, { db })).toBe('already')

    expect(await unsubscribeByToken(db, token)).toBe('unsubscribed')
    expect((await row(person.id)).announcementsOptOutAt).toEqual(firstTime)
  })

  it('returns unknown for a malformed or unknown token', async () => {
    const person = await makeUser(db)
    const spy = vi.spyOn(db, 'select')
    for (const bad of ['', 'short', 'has spaces in it and is long enough', "x'; drop table user; --xxxxxxxxxxxxxxxx", 'a'.repeat(65)]) {
      expect(await unsubscribeByToken(db, bad)).toBe('unknown')
      expect(await describeUnsubscribeLink(bad, { db })).toBe('unknown')
    }
    // Malformed tokens never reach the database.
    expect(spy).not.toHaveBeenCalled()
    spy.mockRestore()
    expect(await unsubscribeByToken(db, 'a'.repeat(32))).toBe('unknown')
    expect(await describeUnsubscribeLink('a'.repeat(32), { db })).toBe('unknown')
    expect((await row(person.id)).announcementsOptOutAt).toBeNull()
  })

  it('turns announcements back on from Settings', async () => {
    const person = await makeUser(db)
    const ctx = ctxFor(db, person)
    expect(await announcementsEnabled(ctx)).toBe(true)

    await setAnnouncementsEnabled(ctx, false)
    expect(await announcementsEnabled(ctx)).toBe(false)
    const firstTime = (await row(person.id)).announcementsOptOutAt
    // Turning off again keeps the first date.
    await setAnnouncementsEnabled(ctx, false)
    expect((await row(person.id)).announcementsOptOutAt).toEqual(firstTime)

    await setAnnouncementsEnabled(ctx, true)
    expect(await announcementsEnabled(ctx)).toBe(true)
    expect((await row(person.id)).announcementsOptOutAt).toBeNull()

    // An unsubscribe link also shows up in Settings.
    const token = await unsubscribeTokenFor(db, person.id)
    await unsubscribeByToken(db, token)
    expect(await announcementsEnabled(ctx)).toBe(false)
  })

  it('builds the one-click and page addresses from the app URL', () => {
    vi.stubEnv('BETTER_AUTH_URL', 'https://clasync.online/')
    expect(unsubscribeUrl('tok')).toBe('https://clasync.online/api/unsubscribe/tok')
    expect(unsubscribePageUrl('tok')).toBe('https://clasync.online/unsubscribe/tok')
    vi.unstubAllEnvs()
  })
})
