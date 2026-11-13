import { db } from '@/server/db'
import { handleNotice, enqueueToday } from './notices'
import type { NoticeMessage } from './queue'

// Route handlers under src/app may not import the database layer, so they reach these on the app's own database.

/** `enqueueToday` on the app's own database. */
export function enqueueTodayDefault(at: Date): Promise<{ sittings: number }> {
  return enqueueToday(db, at)
}

/** `handleNotice` on the app's own database. */
export function handleNoticeDefault(message: NoticeMessage): Promise<'sent' | 'skipped'> {
  return handleNotice(db, message)
}
