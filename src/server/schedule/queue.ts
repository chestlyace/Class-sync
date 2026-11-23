import { now } from '@/server/core/clock'
import { queueDriver } from '@/server/jobs/driver'

export type NoticeKind = 'reminder' | 'missed-check'

/** `expectedAt` (ISO) is the sitting's start for a reminder and its end for a missed-check. */
export type NoticeMessage = { sittingKey: string; kind: NoticeKind; expectedAt: string }

export type ScheduleQueue = { send(message: NoticeMessage, deliverAt: Date): Promise<void> }

export const CLASS_NOTICES_TOPIC = 'class-notices'

/** Messages are kept this long after their delivery time, so retries still reach a consumer. */
const RETENTION_MARGIN_S = 3600

let testQueue: ScheduleQueue | null = null

/** Replaces the queue in tests. Pass null to restore the real driver. */
export function setScheduleQueueForTests(q: ScheduleQueue | null): void {
  testQueue = q
}

function delaySecondsUntil(deliverAt: Date): number {
  return Math.max(0, Math.ceil((deliverAt.getTime() - now().getTime()) / 1000))
}

/** Vercel Queues: the message is delivered to the `class-notices` consumer after the delay. */
const vercelQueue: ScheduleQueue = {
  async send(message, deliverAt) {
    const { send } = await import('@vercel/queue')
    const delaySeconds = delaySecondsUntil(deliverAt)
    await send(CLASS_NOTICES_TOPIC, message, {
      delaySeconds,
      retentionSeconds: delaySeconds + RETENTION_MARGIN_S,
      idempotencyKey: `${message.sittingKey}:${message.kind}:${message.expectedAt}`,
    })
  },
}

/**
 * pg-boss (Heroku): a job in the app's database, started at the delivery time by the worker in the web
 * process (src/server/jobs/worker.ts). Its id comes from the same key the Vercel queue de-duplicated on.
 */
const pgBossQueue: ScheduleQueue = {
  async send(message, deliverAt) {
    const { getBoss, jobIdFor } = await import('@/server/jobs/boss')
    const boss = await getBoss()
    await boss.send(CLASS_NOTICES_TOPIC, message, {
      id: jobIdFor(CLASS_NOTICES_TOPIC, `${message.sittingKey}:${message.kind}:${message.expectedAt}`),
      startAfter: deliverAt,
    })
  },
}

/**
 * Local development: a timer in this process, then the same consumer the queue would call. Timers are unref'd so
 * they never keep a process alive, and a restart forgets them (the next enqueue sets them again).
 */
const memoryQueue: ScheduleQueue = {
  async send(message, deliverAt) {
    const timer = setTimeout(() => {
      void (async () => {
        try {
          const [{ handleNotice }, { db }] = await Promise.all([import('./notices'), import('@/server/db')])
          await handleNotice(db, message)
        } catch (error) {
          console.error('[schedule] in-memory class notice failed', error)
        }
      })()
    }, delaySecondsUntil(deliverAt) * 1000)
    timer.unref?.()
  },
}

/** The queue class notices go through: Vercel Queues, pg-boss or an in-process timer (see queueDriver). */
export function scheduleQueue(): ScheduleQueue {
  if (testQueue) return testQueue
  const driver = queueDriver()
  return driver === 'vercel' ? vercelQueue : driver === 'pgboss' ? pgBossQueue : memoryQueue
}
