import { and, isNull, lt, notExists, sql } from 'drizzle-orm'
import type { Db } from '@/server/db'
import { oauthAccessToken, oauthClient, oauthConsent, oauthRefreshToken } from '@/server/db/schema'

const DAY_MS = 86_400_000

/**
 * Deletes OAuth clients nobody uses: registered (or discovered) more than a day ago, owned by no
 * user, with no consent and no tokens. Dynamic registration is open, so this bounds what a
 * flood of registrations can leave behind. Returns how many were deleted. Run from the daily cron.
 */
export async function pruneUnusedOauthClients(db: Db, now: Date = new Date()): Promise<number> {
  const cutoff = new Date(now.getTime() - DAY_MS)
  const deleted = await db
    .delete(oauthClient)
    .where(
      and(
        isNull(oauthClient.userId),
        isNull(oauthClient.referenceId),
        lt(oauthClient.createdAt, cutoff),
        notExists(db.select({ x: sql`1` }).from(oauthConsent).where(sql`${oauthConsent.clientId} = ${oauthClient.clientId}`)),
        notExists(db.select({ x: sql`1` }).from(oauthAccessToken).where(sql`${oauthAccessToken.clientId} = ${oauthClient.clientId}`)),
        notExists(db.select({ x: sql`1` }).from(oauthRefreshToken).where(sql`${oauthRefreshToken.clientId} = ${oauthClient.clientId}`)),
      ),
    )
    .returning({ id: oauthClient.id })
  return deleted.length
}
