import { and, desc, eq } from 'drizzle-orm'
import { MEET_SCOPES } from '@/lib/google-meet-scopes'
import type { Db } from '@/server/db'
import { account } from '@/server/db/schema'
import { MeetPermissionError } from '@/server/schedule/meet-api'
import { getAuth } from './auth'

export { MEET_LINK_PARAMS } from '@/lib/google-meet-scopes'

export type MeetAccess = {
  /** Better Auth's `account.id` (not Google's own id): the value `getAccessToken` selects an account by. */
  accountId: string
  /** The lecturer allowed Clasync to create Meet rooms (both Meet scopes are on the account). */
  granted: boolean
}

/** Better Auth stores scopes comma separated; Google returns them space separated. Accept both. */
function parseScopes(scope: string | null): Set<string> {
  return new Set((scope ?? '').split(/[\s,]+/).filter((s) => s.length > 0))
}

/**
 * The user's linked Google account and whether it holds the Meet permission, or null without a Google
 * account. Linking Google again merges new scopes into the existing row (Better Auth `linkOAuthAccount`),
 * so one row is the user's whole grant; the newest row wins if there are ever several.
 */
export async function googleMeetAccess(db: Db, userId: string): Promise<MeetAccess | null> {
  const [row] = await db
    .select({ id: account.id, scope: account.scope })
    .from(account)
    .where(and(eq(account.userId, userId), eq(account.providerId, 'google')))
    .orderBy(desc(account.updatedAt))
    .limit(1)
  if (!row) return null
  const scopes = parseScopes(row.scope)
  return { accountId: row.id, granted: MEET_SCOPES.every((s) => scopes.has(s)) }
}

/**
 * A fresh Google access token for the account (Better Auth refreshes and decrypts it). Any refusal, a
 * revoked grant or a missing token becomes a MeetPermissionError: the lecturer must connect Google again.
 * The call carries no request headers, so Better Auth resolves the account for `userId` directly.
 */
export async function googleMeetAccessToken(userId: string, accountId: string): Promise<string> {
  let token: string | undefined
  try {
    const result = await getAuth().api.getAccessToken({ body: { accountId, userId } })
    token = result.accessToken
  } catch (error) {
    console.error('[meet] could not get a Google access token', error)
    throw new MeetPermissionError('Google did not give an access token')
  }
  if (!token) throw new MeetPermissionError('Google did not give an access token')
  return token
}
