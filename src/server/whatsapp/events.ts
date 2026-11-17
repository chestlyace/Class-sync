import { now } from '@/server/core/clock'
import { whatsAppConfig } from './config'

/** Something that may deserve a WhatsApp message, queued with the data needed to work out who still needs one. */
export type WhatsAppEvent =
  | { kind: 'checkinOpen'; windowId: string }
  | { kind: 'testStarted'; testId: string }
  | { kind: 'resultsReleased'; source: 'assignment' | 'test'; id: string }
  | { kind: 'assignmentPublished'; assignmentId: string }
  | { kind: 'classSoonLecturer'; courseId: string; sittingKey: string; startsAt: string }

/** One key per event; with the student it makes sending idempotent (`whatsapp_message`) and de-duplicates the queue. */
export function eventKey(event: WhatsAppEvent): string {
  switch (event.kind) {
    case 'checkinOpen':
      return `checkin:${event.windowId}`
    case 'testStarted':
      return `test:${event.testId}`
    case 'resultsReleased':
      return `results:${event.source}:${event.id}`
    case 'assignmentPublished':
      return `assignment:${event.assignmentId}`
    case 'classSoonLecturer':
      return `class:${event.sittingKey}`
  }
}

export type WhatsAppQueue = { send(event: WhatsAppEvent, deliverAt: Date): Promise<void> }

export const WHATSAPP_TOPIC = 'whatsapp'

/** Messages are kept this long after their delivery time, so retries still reach a consumer. */
const RETENTION_MARGIN_S = 3600

let testQueue: WhatsAppQueue | null = null

/** Replaces the queue in tests. Pass null to restore the real driver. */
export function setWhatsAppQueueForTests(q: WhatsAppQueue | null): void {
  testQueue = q
}

function delaySecondsUntil(deliverAt: Date): number {
  return Math.max(0, Math.ceil((deliverAt.getTime() - now().getTime()) / 1000))
}

/** Vercel Queues: the event is delivered to the `whatsapp` consumer after the delay. */
const vercelQueue: WhatsAppQueue = {
  async send(event, deliverAt) {
    const { send } = await import('@vercel/queue')
    const delaySeconds = delaySecondsUntil(deliverAt)
    await send(WHATSAPP_TOPIC, event, {
      delaySeconds,
      retentionSeconds: delaySeconds + RETENTION_MARGIN_S,
      idempotencyKey: eventKey(event),
    })
  },
}

/**
 * Local development: a timer in this process, then the same dispatcher the queue would call. Timers are
 * unref'd so they never keep a process alive, and a restart forgets them.
 */
const memoryQueue: WhatsAppQueue = {
  async send(event, deliverAt) {
    const timer = setTimeout(() => {
      void (async () => {
        try {
          const [{ handleWhatsAppEvent }, { db }] = await Promise.all([import('./dispatch'), import('@/server/db')])
          await handleWhatsAppEvent(db, event, now())
        } catch (error) {
          console.error('[whatsapp] in-memory event failed', error)
        }
      })()
    }, delaySecondsUntil(deliverAt) * 1000)
    timer.unref?.()
  },
}

/**
 * Queues an event for delivery at `deliverAt` (default: now). Does nothing when WhatsApp is not set up. The
 * dispatcher decides at delivery time who still needs a message, so a delay lets Web Push go first.
 */
export async function enqueueWhatsApp(event: WhatsAppEvent, deliverAt: Date = now()): Promise<void> {
  if (!whatsAppConfig()) return
  const queue = testQueue ?? (process.env.VERCEL ? vercelQueue : memoryQueue)
  await queue.send(event, deliverAt)
}
