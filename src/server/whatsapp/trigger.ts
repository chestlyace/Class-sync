import { runAfterResponse } from '@/server/lib/after-response'
import { whatsAppConfig } from './config'
import { enqueueWhatsApp, type WhatsAppEvent } from './events'

/**
 * Queues a WhatsApp event once the response has been sent. Best effort: a failure is logged and never
 * reaches the action that raised the event.
 */
export function queueWhatsApp(event: WhatsAppEvent, deliverAt?: Date): void {
  if (!whatsAppConfig()) return
  runAfterResponse(async () => {
    try {
      await enqueueWhatsApp(event, deliverAt)
    } catch (error) {
      console.error(`[whatsapp] could not queue ${event.kind}`, error)
    }
  })
}

/** Students get Web Push first: the WhatsApp fallback for check-in and test start goes out this long after. */
export const WHATSAPP_FALLBACK_DELAY_MS = 3 * 60_000
