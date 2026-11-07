'use server'

import { eq } from 'drizzle-orm'
import { cookies } from 'next/headers'
import { revalidatePath } from 'next/cache'
import { isLocale, LOCALE_COOKIE, type Locale } from '@/i18n/locale'
import { getSessionUser } from '@/server/auth/session'
import { AppError } from '@/server/core/errors'
import { db } from '@/server/db'
import { user } from '@/server/db/schema'

/** Remembers the language in a cookie and, when signed in, on the user's profile. */
export async function setLocale(locale: Locale): Promise<void> {
  if (!isLocale(locale)) throw new AppError('VALIDATION', 'Unsupported locale')
  const store = await cookies()
  store.set(LOCALE_COOKIE, locale, {
    path: '/',
    maxAge: 60 * 60 * 24 * 365,
    sameSite: 'lax',
  })
  const current = await getSessionUser()
  if (current) await db.update(user).set({ locale }).where(eq(user.id, current.id))
  revalidatePath('/', 'layout')
}
