import { and, eq, exists, inArray, lt, sql } from 'drizzle-orm'
import { now as clockNow } from '@/server/core/clock'
import { db as defaultDb, type Db } from '@/server/db'
import { broadcast, broadcastRecipient } from '@/server/db/schema'
import { enqueueBroadcast } from './queue'

/** A broadcast still sending this long after it was saved has lost its job (queueing failed, or the job gave up). */
const STALE_AFTER_MS = 10 * 60_000

/**
 * Queues the sending job again for every broadcast that is still `sending`, was saved more than 10
 * minutes before `at`, and has rows nobody finished (`pending`, or `sending` from a run that
 * stopped mid-send, which the next run marks failed). A run only claims pending rows, so queueing
 * a broadcast whose job is in fact still alive sends nobody twice. Returns how many were queued;
 * a broadcast that fails to queue is logged and left for the next call.
 */
export async function requeueStaleBroadcasts(db: Db, at: Date = clockNow()): Promise<number> {
  const unfinished = db
    .select({ one: sql`1` })
    .from(broadcastRecipient)
    .where(and(eq(broadcastRecipient.broadcastId, broadcast.id), inArray(broadcastRecipient.status, ['pending', 'sending'])))
  const stale = await db
    .select({ id: broadcast.id })
    .from(broadcast)
    .where(
      and(
        eq(broadcast.status, 'sending'),
        lt(broadcast.createdAt, new Date(at.getTime() - STALE_AFTER_MS)),
        exists(unfinished),
      ),
    )
    .orderBy(broadcast.createdAt)

  let queued = 0
  for (const { id } of stale) {
    try {
      await enqueueBroadcast(id)
      queued += 1
    } catch (error) {
      console.error('[broadcasts] could not queue a stale broadcast again', { broadcastId: id }, error)
    }
  }
  return queued
}

/**
 * `requeueStaleBroadcasts` on the app's own database, for the pg-boss worker (at start and in the
 * daily run). Best effort: an error is logged, never thrown.
 */
export async function requeueStaleBroadcastsDefault(): Promise<void> {
  try {
    const queued = await requeueStaleBroadcasts(defaultDb)
    if (queued > 0) console.info(`[broadcasts] queued ${queued} stale broadcast(s) again`)
  } catch (error) {
    console.error('[broadcasts] re-queueing stale broadcasts failed', error)
  }
}
