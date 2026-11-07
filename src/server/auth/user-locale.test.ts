import { eq } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'
import { user } from '@/server/db/schema'
import { createTestDb } from '@/test/db'
import { makeUser } from '@/test/factories'
import { updateUserLocale } from './user-locale'

describe('updateUserLocale', () => {
  it('stores the new locale for that user only', async () => {
    const db = await createTestDb()
    const a = await makeUser(db, { locale: 'en' })
    const b = await makeUser(db, { locale: 'en' })
    await updateUserLocale(a.id, 'fr', db)
    const rows = await db.select().from(user).where(eq(user.id, a.id))
    expect(rows[0].locale).toBe('fr')
    const other = await db.select().from(user).where(eq(user.id, b.id))
    expect(other[0].locale).toBe('en')
  })
})
