export const MARKING_TOPIC = 'assignment-marking'

/**
 * One AI marking job: the submission and the hand-in it was queued for (`submittedAt`, ISO), so a
 * newer hand-in makes the job skip. `requestedAt` (ISO) tells two requests for the same version apart.
 */
export type MarkingMessage = { submissionId: string; submittedAt: string; requestedAt: string }

export type MarkingQueue = { send(message: MarkingMessage): Promise<void> }

let testQueue: MarkingQueue | null = null

/** Replaces the queue in tests. Pass null to restore the real driver. */
export function setMarkingQueueForTests(q: MarkingQueue | null): void {
  testQueue = q
}

/** Vercel Queues: the message goes to the `assignment-marking` consumer. */
const vercelQueue: MarkingQueue = {
  async send(message) {
    const { send } = await import('@vercel/queue')
    await send(MARKING_TOPIC, message, {
      idempotencyKey: `${message.submissionId}:${message.submittedAt}:${message.requestedAt}`,
    })
  },
}

/**
 * Local development: the job runs in this process on the next tick, on the app's own database. The
 * timer is unref'd so it never keeps a process alive; a restart forgets it.
 */
const memoryQueue: MarkingQueue = {
  async send(message) {
    const timer = setTimeout(() => {
      void (async () => {
        try {
          const [{ runMarkingJob }, { db }] = await Promise.all([import('./job'), import('@/server/db')])
          await runMarkingJob(db, message)
        } catch (error) {
          console.error('[ai-marking] in-memory marking job failed', error)
        }
      })()
    }, 0)
    timer.unref?.()
  },
}

/** The queue AI marking jobs go through: Vercel Queues on Vercel, an in-process timer elsewhere. */
export function markingQueue(): MarkingQueue {
  if (testQueue) return testQueue
  return process.env.VERCEL ? vercelQueue : memoryQueue
}
