import { queueDriver } from '@/server/jobs/driver'

export const BROADCAST_TOPIC = 'broadcast'

/** One run of a broadcast's sending job. A run that runs out of time queues the next one. */
export type BroadcastMessage = { broadcastId: string }

let testQueue: ((broadcastId: string) => Promise<void>) | null = null

/** Replaces the queue in tests. Pass null to restore the real driver. */
export function setBroadcastQueueForTests(fn: ((broadcastId: string) => Promise<void>) | null): void {
  testQueue = fn
}

/**
 * Queues the sending job for a broadcast whose recipient rows are already saved.
 * - pg-boss (Heroku): a job worked by the web process (src/server/jobs/worker.ts). Each run gets its own
 *   id, because the worker queues a fresh run whenever one stops at its time budget.
 * - Vercel and local development: the same job runs after the response, run after run until done.
 * Sending the same broadcast twice is harmless: a run only claims `pending` rows.
 */
export async function enqueueBroadcast(broadcastId: string): Promise<void> {
  if (testQueue) return testQueue(broadcastId)
  if (queueDriver() === 'pgboss') {
    const { getBoss, jobIdFor } = await import('@/server/jobs/boss')
    const boss = await getBoss()
    const message: BroadcastMessage = { broadcastId }
    await boss.send(BROADCAST_TOPIC, message, { id: jobIdFor(BROADCAST_TOPIC, `${broadcastId}:${Date.now()}`) })
    return
  }
  const { runAfterResponse } = await import('@/server/lib/after-response')
  runAfterResponse(async () => {
    const { runBroadcastJobDefault } = await import('./job')
    while (!(await runBroadcastJobDefault(broadcastId)).done) {
      // Each run stops at its time budget; the next one picks up the rows still pending.
    }
  })
}
