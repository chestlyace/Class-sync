import { and, count, eq, sql } from 'drizzle-orm'
import { now as clockNow } from '@/server/core/clock'
import { db as defaultDb, type Db } from '@/server/db'
import { broadcast, broadcastRecipient, user } from '@/server/db/schema'
import { isAllowedRecipient } from '@/server/email/allowlist'
import { maskEmail, recordOpsEvent, scrubError } from '@/server/ops/events'
import { broadcastSender, renderBroadcast } from './sender'
import { unsubscribePageUrl, unsubscribeTokenFor, unsubscribeUrl } from './unsubscribe'

/** How long one run sends before it stops and leaves the rest to the next run (pg-boss expires a job at 300 s). */
const DEFAULT_BUDGET_MS = 120_000
/** At most 10 emails a second, well under SES's starting rate of 14. */
const PACE_MS = 100
/** One health event per this many handled rows, and one at the end of a run. */
const EVENT_EVERY = 25

let wait: (ms: number) => Promise<void> = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

/** Replaces the pause between two sends in tests. Pass null to restore the real timer. */
export function setBroadcastPaceWaitForTests(fn: ((ms: number) => Promise<void>) | null): void {
  wait = fn ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)))
}

type ClaimedRow = typeof broadcastRecipient.$inferSelect

/**
 * Moves one pending row of the broadcast to `sending` and returns it, or null when none is left. The
 * pick and the update are one statement, and a row another run holds is skipped, so two runs at once
 * never take the same row.
 */
async function claimNext(db: Db, broadcastId: string): Promise<ClaimedRow | null> {
  const next = db
    .select({ id: broadcastRecipient.id })
    .from(broadcastRecipient)
    .where(and(eq(broadcastRecipient.broadcastId, broadcastId), eq(broadcastRecipient.status, 'pending')))
    .limit(1)
    .for('update', { skipLocked: true })
  const [row] = await db
    .update(broadcastRecipient)
    .set({ status: 'sending' })
    .where(and(eq(broadcastRecipient.id, sql`(${next})`), eq(broadcastRecipient.status, 'pending')))
    .returning()
  return row ?? null
}

/**
 * Rows a run left in `sending` (the process stopped mid-send) become `failed`, never `pending`: SES
 * may already have accepted that email, and nobody gets a broadcast twice.
 */
async function failInterrupted(db: Db, broadcastId: string): Promise<void> {
  const stuck = await db
    .select({ id: broadcastRecipient.id, email: broadcastRecipient.email })
    .from(broadcastRecipient)
    .where(and(eq(broadcastRecipient.broadcastId, broadcastId), eq(broadcastRecipient.status, 'sending')))
  for (const row of stuck) {
    await db
      .update(broadcastRecipient)
      .set({ status: 'failed', error: 'interrupted', email: maskEmail(row.email) })
      .where(and(eq(broadcastRecipient.id, row.id), eq(broadcastRecipient.status, 'sending')))
  }
}

/** Why a recipient no longer gets the broadcast, or null when they still do. */
async function skipReason(db: Db, row: ClaimedRow): Promise<string | null> {
  if (!row.userId) return 'deleted'
  const [person] = await db
    .select({ suspendedAt: user.suspendedAt, optedOutAt: user.announcementsOptOutAt })
    .from(user)
    .where(eq(user.id, row.userId))
  if (!person) return 'deleted'
  if (person.suspendedAt) return 'suspended'
  if (person.optedOutAt) return 'opted_out'
  if (!isAllowedRecipient(row.email)) return 'not_allowed'
  return null
}

/** The row's final state. Its address is masked from here on: the full one was only needed to send. */
async function finish(
  db: Db,
  row: ClaimedRow,
  outcome: { status: 'sent' } | { status: 'failed' | 'skipped'; error: string },
): Promise<void> {
  await db
    .update(broadcastRecipient)
    .set({
      status: outcome.status,
      error: outcome.status === 'sent' ? null : outcome.error,
      sentAt: outcome.status === 'sent' ? clockNow() : null,
      email: maskEmail(row.email),
    })
    .where(eq(broadcastRecipient.id, row.id))
}

/**
 * Sends a broadcast's pending rows, one at a time at ≤ 10 a second, until none is left or the time
 * budget is spent. Each row is claimed before its email goes out and marked sent, failed or skipped
 * after, so a retried or repeated run never sends to anyone twice. Returns `done: false` when it
 * stopped at the budget with rows still pending; the caller queues the next run.
 *
 * Throws (leaving rows pending, for a later retry) when no sender is configured, or when the
 * database fails; a row caught mid-send by a failure is marked failed `interrupted` by the next run.
 */
export async function runBroadcastJob(
  db: Db,
  broadcastId: string,
  opts: { budgetMs?: number; now?: () => number } = {},
): Promise<{ done: boolean }> {
  const now = opts.now ?? Date.now
  const budgetMs = opts.budgetMs ?? DEFAULT_BUDGET_MS
  const startedAt = now()

  const [item] = await db.select().from(broadcast).where(eq(broadcast.id, broadcastId))
  if (!item) return { done: true }

  await failInterrupted(db, broadcastId)

  const sender = broadcastSender()
  if (!sender) throw new Error('Broadcast sender is not configured (SES_REGION is not set)')

  let sent = 0
  let failed = 0
  let handled = 0
  let lastSendAt: number | null = null

  const flush = async () => {
    if (sent > 0) await recordOpsEvent(db, { kind: 'email_sent', ok: true, detail: { kind: 'broadcast', count: sent } })
    if (failed > 0) await recordOpsEvent(db, { kind: 'email_failed', ok: false, detail: { kind: 'broadcast', count: failed } })
    sent = 0
    failed = 0
  }

  try {
    while (now() - startedAt < budgetMs) {
      const row = await claimNext(db, broadcastId)
      if (!row) break

      const reason = await skipReason(db, row)
      if (reason) {
        await finish(db, row, { status: 'skipped', error: reason })
      } else {
        const fr = row.locale === 'fr'
        let result: { ok: true } | { ok: false; error: string }
        try {
          const token = await unsubscribeTokenFor(db, row.userId!)
          const email = await renderBroadcast({
            locale: row.locale,
            subject: fr ? item.subjectFr : item.subjectEn,
            body: fr ? item.bodyFr : item.bodyEn,
            to: row.email,
            unsubscribeUrl: unsubscribeUrl(token),
            unsubscribePageUrl: unsubscribePageUrl(token),
          })
          if (lastSendAt !== null) {
            const pause = lastSendAt + PACE_MS - now()
            if (pause > 0) await wait(pause)
          }
          lastSendAt = now()
          result = await sender.send(email)
        } catch (error) {
          result = { ok: false, error: scrubError(error instanceof Error ? error.message : String(error)) }
        }
        if (result.ok) {
          await finish(db, row, { status: 'sent' })
          sent += 1
        } else {
          await finish(db, row, { status: 'failed', error: scrubError(result.error) })
          failed += 1
        }
      }

      handled += 1
      if (handled % EVENT_EVERY === 0) await flush()
    }
  } finally {
    await flush()
  }

  const [left] = await db
    .select({ pending: count() })
    .from(broadcastRecipient)
    .where(and(eq(broadcastRecipient.broadcastId, broadcastId), eq(broadcastRecipient.status, 'pending')))
  if ((left?.pending ?? 0) > 0) return { done: false }

  // A row still `sending` belongs to another run, which marks the broadcast done when it ends.
  const [inFlight] = await db
    .select({ sending: count() })
    .from(broadcastRecipient)
    .where(and(eq(broadcastRecipient.broadcastId, broadcastId), eq(broadcastRecipient.status, 'sending')))
  if ((inFlight?.sending ?? 0) === 0) {
    await db
      .update(broadcast)
      .set({ status: 'done', finishedAt: clockNow() })
      .where(and(eq(broadcast.id, broadcastId), eq(broadcast.status, 'sending')))
  }
  return { done: true }
}

/** `runBroadcastJob` on the app's own database, for the queue drivers and the pg-boss worker. */
export function runBroadcastJobDefault(broadcastId: string): Promise<{ done: boolean }> {
  return runBroadcastJob(defaultDb, broadcastId)
}
