import { randomBytes } from 'node:crypto'
import { and, eq, isNull } from 'drizzle-orm'
import type { Ctx } from '@/server/core/context'
import { now } from '@/server/core/clock'
import { db as defaultDb, type Db } from '@/server/db'
import { user } from '@/server/db/schema'
import { appLinkBuilder } from '@/server/email/notify'

/** What a token we made looks like: 24 random bytes in base64url (32 characters), with room to spare. */
const TOKEN_PATTERN = /^[A-Za-z0-9_-]{20,64}$/

/**
 * The person's unsubscribe token, made on first use. Stored once and never changed, so the link in
 * an old announcement keeps working. Two sends at once both try the update; only one wins, and
 * both read the winner back.
 */
export async function unsubscribeTokenFor(db: Db, userId: string): Promise<string> {
  const [existing] = await db.select({ token: user.unsubscribeToken }).from(user).where(eq(user.id, userId))
  if (existing?.token) return existing.token
  await db
    .update(user)
    .set({ unsubscribeToken: randomBytes(24).toString('base64url') })
    .where(and(eq(user.id, userId), isNull(user.unsubscribeToken)))
  const [row] = await db.select({ token: user.unsubscribeToken }).from(user).where(eq(user.id, userId))
  if (!row?.token) throw new Error(`No user ${userId} to make an unsubscribe token for`)
  return row.token
}

/**
 * Turns announcements off for the account the token belongs to. Safe to repeat: the first time
 * stays on record. A malformed token is refused without touching the database.
 */
export async function unsubscribeByToken(db: Db, token: string): Promise<'unsubscribed' | 'unknown'> {
  if (!TOKEN_PATTERN.test(token)) return 'unknown'
  const [row] = await db.select({ id: user.id }).from(user).where(eq(user.unsubscribeToken, token))
  if (!row) return 'unknown'
  await db
    .update(user)
    .set({ announcementsOptOutAt: now() })
    .where(and(eq(user.id, row.id), isNull(user.announcementsOptOutAt)))
  return 'unsubscribed'
}

/** `unsubscribeByToken` on the app's own database, for the route and the page's Server Action (UI code never sees `db`). */
export function unsubscribeLinkToken(token: string): Promise<'unsubscribed' | 'unknown'> {
  return unsubscribeByToken(defaultDb, token)
}

/**
 * What the unsubscribe page shows when it opens. Read only: opening the link must never change
 * anything (mail scanners open links), only the button does.
 */
export async function describeUnsubscribeLink(token: string, deps: { db?: Db } = {}): Promise<'valid' | 'already' | 'unknown'> {
  if (!TOKEN_PATTERN.test(token)) return 'unknown'
  const [row] = await (deps.db ?? defaultDb)
    .select({ optedOutAt: user.announcementsOptOutAt })
    .from(user)
    .where(eq(user.unsubscribeToken, token))
  if (!row) return 'unknown'
  return row.optedOutAt ? 'already' : 'valid'
}

/** Whether the signed-in user receives announcements from Clasync. */
export async function announcementsEnabled(ctx: Ctx): Promise<boolean> {
  const [row] = await ctx.db.select({ optedOutAt: user.announcementsOptOutAt }).from(user).where(eq(user.id, ctx.user.id))
  return !row?.optedOutAt
}

/** The Settings switch. Turning off keeps the first opt-out date; turning on clears it. */
export async function setAnnouncementsEnabled(ctx: Ctx, enabled: boolean): Promise<void> {
  if (enabled) {
    await ctx.db.update(user).set({ announcementsOptOutAt: null }).where(eq(user.id, ctx.user.id))
    return
  }
  await ctx.db
    .update(user)
    .set({ announcementsOptOutAt: now() })
    .where(and(eq(user.id, ctx.user.id), isNull(user.announcementsOptOutAt)))
}

/** The address in the `List-Unsubscribe` header: a POST to it unsubscribes (RFC 8058 one-click). */
export function unsubscribeUrl(token: string): string {
  return appLinkBuilder('broadcasts')(`/api/unsubscribe/${token}`)
}

/** The page the email footer links to: opening it changes nothing until the button is pressed. */
export function unsubscribePageUrl(token: string): string {
  return appLinkBuilder('broadcasts')(`/unsubscribe/${token}`)
}
