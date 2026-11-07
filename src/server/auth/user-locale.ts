import { eq } from 'drizzle-orm'
import type { Locale } from '@/server/core/context'
import { db as defaultDb, type Db } from '@/server/db'
import { user } from '@/server/db/schema'

/** Persists a user's preferred language. */
export async function updateUserLocale(
  userId: string,
  locale: Locale,
  database: Db = defaultDb,
): Promise<void> {
  await database.update(user).set({ locale }).where(eq(user.id, userId))
}
