import { eq } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'
import { AppError } from '@/server/core/errors'
import { user } from '@/server/db/schema'
import { createTestDb } from '@/test/db'
import { ctxFor, makeUser } from '@/test/factories'
import { getPhoneNumberState, removePhoneNumber } from './phone-number'

const PHONE = '+237677000301'

async function row(db: Awaited<ReturnType<typeof createTestDb>>, id: string) {
  const [r] = await db.select().from(user).where(eq(user.id, id))
  return r
}

describe('removePhoneNumber', () => {
  it('clears the number and its proof when the email is verified', async () => {
    const db = await createTestDb()
    const u = await makeUser(db, { emailVerified: true, phoneNumberVerified: true })
    await db.update(user).set({ phoneNumber: PHONE }).where(eq(user.id, u.id))
    await removePhoneNumber(ctxFor(db, u))
    expect(await row(db, u.id)).toMatchObject({ phoneNumber: null, phoneNumberVerified: false })
  })

  it('refuses while the email is not verified: the number is the only proof', async () => {
    const db = await createTestDb()
    const u = await makeUser(db, { emailVerified: false, phoneNumberVerified: true })
    await db.update(user).set({ phoneNumber: PHONE }).where(eq(user.id, u.id))
    await expect(removePhoneNumber(ctxFor(db, u))).rejects.toMatchObject({ code: 'CONFLICT' })
    await expect(removePhoneNumber(ctxFor(db, u))).rejects.toBeInstanceOf(AppError)
    expect(await row(db, u.id)).toMatchObject({ phoneNumber: PHONE, phoneNumberVerified: true })
  })

  it('reads the stored email state, not the session copy', async () => {
    const db = await createTestDb()
    const u = await makeUser(db, { emailVerified: false, phoneNumberVerified: true })
    await db.update(user).set({ phoneNumber: PHONE }).where(eq(user.id, u.id))
    // A session that still says "verified" cannot remove the only proof.
    await expect(removePhoneNumber(ctxFor(db, { ...u, emailVerified: true }))).rejects.toMatchObject({ code: 'CONFLICT' })
  })

  it('leaves another account alone', async () => {
    const db = await createTestDb()
    const a = await makeUser(db)
    const b = await makeUser(db)
    await db.update(user).set({ phoneNumber: PHONE, phoneNumberVerified: true }).where(eq(user.id, b.id))
    await removePhoneNumber(ctxFor(db, a))
    expect(await row(db, b.id)).toMatchObject({ phoneNumber: PHONE, phoneNumberVerified: true })
  })
})

describe('getPhoneNumberState', () => {
  it('reports the number, its proof and the email state', async () => {
    const db = await createTestDb()
    const u = await makeUser(db, { emailVerified: false, phoneNumberVerified: true })
    await db.update(user).set({ phoneNumber: PHONE }).where(eq(user.id, u.id))
    expect(await getPhoneNumberState(ctxFor(db, u))).toEqual({ phone: PHONE, verified: true, emailVerified: false })
  })

  it('reports no number for an account without one', async () => {
    const db = await createTestDb()
    const u = await makeUser(db)
    expect(await getPhoneNumberState(ctxFor(db, u))).toEqual({ phone: null, verified: false, emailVerified: true })
  })
})
