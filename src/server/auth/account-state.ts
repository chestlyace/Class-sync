import { and, eq, isNull, lt, or } from 'drizzle-orm'
import { isLocale } from '@/i18n/locale'
import type { SessionUser } from '@/server/core/context'
import type { Db } from '@/server/db'
import { user } from '@/server/db/schema'

/** `last_seen_at` is written at most once an hour per user, not on every request. */
export const SEEN_THROTTLE_MS = 60 * 60 * 1000

/**
 * The one place that reads whether an account is suspended and records its activity, for the web
 * (every page and Server Action) and for MCP. One primary-key read; when the account is active,
 * an update that only writes when `last_seen_at` is empty or older than SEEN_THROTTLE_MS. A user
 * row that is gone counts as suspended (nothing should act for it).
 */
export async function checkAccount(db: Db, userId: string, at: Date): Promise<{ suspended: boolean }> {
  const [row] = await db.select({ suspendedAt: user.suspendedAt }).from(user).where(eq(user.id, userId))
  if (!row || row.suspendedAt !== null) return { suspended: true }
  await db
    .update(user)
    .set({ lastSeenAt: at })
    .where(
      and(
        eq(user.id, userId),
        or(isNull(user.lastSeenAt), lt(user.lastSeenAt, new Date(at.getTime() - SEEN_THROTTLE_MS))),
      ),
    )
  return { suspended: false }
}

/**
 * The signed-in user from Better Auth's session user, or null: no session, a role other than
 * lecturer or student (the DB CHECK constraint guarantees one; anything else counts as no
 * session), or a suspended account. Records the user's activity.
 */
export async function resolveSessionUser(
  db: Db,
  raw: Record<string, unknown> | null,
  at: Date,
): Promise<SessionUser | null> {
  if (!raw) return null
  const { id, name, email, role, locale, emailVerified } = raw
  if (role !== 'lecturer' && role !== 'student') return null
  if (typeof id !== 'string') return null
  if ((await checkAccount(db, id, at)).suspended) return null
  return {
    id,
    name: String(name),
    email: String(email),
    role,
    locale: isLocale(locale) ? locale : 'en',
    emailVerified: emailVerified === true,
  }
}
