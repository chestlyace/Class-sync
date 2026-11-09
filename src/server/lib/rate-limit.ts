import { and, eq, gte, lt, sql } from 'drizzle-orm'
import { db as defaultDb, type Db } from '@/server/db'
import { rateLimit } from '@/server/db/schema'

export type RateLimitRule = { max: number; windowMs: number }

/** `limited` once the key went over `max` in this window; `retryAfter` is seconds to its end. */
export type RateLimitResult = { limited: boolean; retryAfter: number }

function windowOf(rule: RateLimitRule, now: Date) {
  const start = Math.floor(now.getTime() / rule.windowMs) * rule.windowMs
  return { start: new Date(start), retryAfter: Math.max(1, Math.ceil((start + rule.windowMs - now.getTime()) / 1000)) }
}

/**
 * Counts one hit for `key` in the current fixed window (one upsert: a new window restarts at 1)
 * and says whether it went over the rule's max.
 */
export async function hitRateLimit(db: Db, key: string, rule: RateLimitRule, now: Date = new Date()): Promise<RateLimitResult> {
  const { start, retryAfter } = windowOf(rule, now)
  const [row] = await db
    .insert(rateLimit)
    .values({ key, windowStart: start, count: 1 })
    .onConflictDoUpdate({
      target: rateLimit.key,
      set: {
        count: sql`case when ${rateLimit.windowStart} = excluded.window_start then ${rateLimit.count} + 1 else 1 end`,
        windowStart: sql`excluded.window_start`,
      },
    })
    .returning({ count: rateLimit.count })
  return { limited: row.count > rule.max, retryAfter }
}

/** Whether `key` already used up the current window, without counting a hit (one indexed read). */
export async function isRateLimited(db: Db, key: string, rule: RateLimitRule, now: Date = new Date()): Promise<RateLimitResult> {
  const { start, retryAfter } = windowOf(rule, now)
  const [row] = await db
    .select({ count: rateLimit.count })
    .from(rateLimit)
    .where(and(eq(rateLimit.key, key), gte(rateLimit.windowStart, start)))
  return { limited: Boolean(row && row.count >= rule.max), retryAfter }
}

/** Deletes counters whose window started more than a day ago. Run from the daily cron. */
export async function pruneRateLimits(db: Db = defaultDb, now: Date = new Date()): Promise<number> {
  const cutoff = new Date(now.getTime() - 86_400_000)
  const deleted = await db.delete(rateLimit).where(lt(rateLimit.windowStart, cutoff)).returning({ key: rateLimit.key })
  return deleted.length
}
