import { handleCallback } from '@vercel/queue'
import { now } from '@/server/core/clock'
import type { WhatsAppEvent } from '@/server/whatsapp/events'
import { handleWhatsAppEventDefault } from '@/server/whatsapp/default-db'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

// Acked when this resolves; a throw (a database error) makes the queue retry the event.
export const POST = handleCallback<WhatsAppEvent>(async (event) => {
  await handleWhatsAppEventDefault(event, now())
})
