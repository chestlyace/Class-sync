import { db } from '@/server/db'
import { handleSnsPost, type SnsResult } from './inbound'
import { handleWhatsAppEvent } from './dispatch'
import type { WhatsAppEvent } from './events'

// Route handlers under src/app may not import the database layer, so they reach these on the app's own database.

/** `handleSnsPost` on the app's own database. */
export function handleSnsPostDefault(rawBody: string): Promise<SnsResult> {
  return handleSnsPost(db, rawBody)
}

/** `handleWhatsAppEvent` on the app's own database. */
export function handleWhatsAppEventDefault(event: WhatsAppEvent, at: Date): Promise<{ sent: number; skipped: number }> {
  return handleWhatsAppEvent(db, event, at)
}
