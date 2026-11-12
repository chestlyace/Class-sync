import { sql } from 'drizzle-orm'
import type { Db } from '@/server/db'
import { pushCooldown } from '@/server/db/schema'

/** A burst of notes in one course sends one notification per this window. */
export const NOTES_COOLDOWN_MS = 30 * 60_000

export function notesCooldownKey(courseId: string): string {
  return `notes:${courseId}`
}

/**
 * Try to take the cooldown for `key`. A single upsert statement, so that of several concurrent
 * callers exactly one gets a row back: the insert wins, or the conflict update only applies
 * when the previous window has ended. Returns true when this caller won.
 */
export async function claimCooldown(
  db: Pick<Db, 'insert'>,
  key: string,
  ms: number,
  at: Date,
): Promise<boolean> {
  const until = new Date(at.getTime() + ms)
  const rows = await db
    .insert(pushCooldown)
    .values({ key, until })
    .onConflictDoUpdate({
      target: pushCooldown.key,
      set: { until: sql`excluded.until` },
      setWhere: sql`${pushCooldown.until} <= ${at}`,
    })
    .returning({ key: pushCooldown.key })
  return rows.length > 0
}

/** Start a fresh window for `key` regardless of any current one. */
export async function forceCooldown(
  db: Pick<Db, 'insert'>,
  key: string,
  ms: number,
  at: Date,
): Promise<void> {
  const until = new Date(at.getTime() + ms)
  await db
    .insert(pushCooldown)
    .values({ key, until })
    .onConflictDoUpdate({ target: pushCooldown.key, set: { until } })
}
