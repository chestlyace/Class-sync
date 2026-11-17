import { db } from '@/server/db'
import { handleSnsPost, type SnsResult } from './inbound'

// Route handlers under src/app may not import the database layer, so they reach this on the app's own database.

/** `handleSnsPost` on the app's own database. */
export function handleSnsPostDefault(rawBody: string): Promise<SnsResult> {
  return handleSnsPost(db, rawBody)
}
